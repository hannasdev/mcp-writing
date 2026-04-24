import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import yaml from "js-yaml";
import { z } from "zod";
import { openDb } from "./db.js";
import { syncAll, isSyncDirWritable, getSyncOwnershipDiagnostics, getFileWriteDiagnostics, writeMeta, readMeta, indexSceneFile, normalizeSceneMetaForPath, sidecarPath } from "./sync.js";
import { isGitAvailable, isGitRepository, initGitRepository, createSnapshot, listSnapshots, getSceneProseAtCommit } from "./git.js";
import { renderCharacterArcTemplate, renderCharacterSheetTemplate, renderPlaceSheetTemplate, slugifyEntityName } from "./world-entity-templates.js";
import { importScrivenerSync, validateProjectId } from "./importer.js";
import { mergeScrivenerProjectMetadata } from "./scrivener-direct.js";
import { ASYNC_PROGRESS_PREFIX } from "./async-progress.js";

const SYNC_DIR = process.env.WRITING_SYNC_DIR ?? "./sync";
const DB_PATH = process.env.DB_PATH ?? "./writing.db";
const SYNC_DIR_ABS = path.resolve(SYNC_DIR);
const SYNC_DIR_REAL = (() => {
  try {
    return fs.realpathSync(SYNC_DIR_ABS);
  } catch {
    return SYNC_DIR_ABS;
  }
})();
const DB_PATH_DISPLAY = DB_PATH === ":memory:" ? DB_PATH : path.resolve(DB_PATH);

function isPathInsideSyncDir(candidatePath) {
  const resolvedCandidate = path.resolve(candidatePath);
  const canonicalCandidate = (() => {
    try {
      return fs.realpathSync(resolvedCandidate);
    } catch {
      return resolvedCandidate;
    }
  })();

  const rel = path.relative(SYNC_DIR_REAL, canonicalCandidate);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function parsePositiveIntEnv(rawValue, defaultValue) {
  const parsed = parseInt(rawValue ?? String(defaultValue), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function validateRegexPatterns(patterns) {
  for (const pattern of patterns ?? []) {
    try {
      // Validation-only compile so async and sync paths share the same input contract.
      new RegExp(pattern);
    } catch (error) {
      return {
        ok: false,
        pattern,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true };
}

const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? "3000", 10);
const MAX_CHAPTER_SCENES = parseInt(process.env.MAX_CHAPTER_SCENES ?? "10", 10);
const DEFAULT_METADATA_PAGE_SIZE = parseInt(process.env.DEFAULT_METADATA_PAGE_SIZE ?? "20", 10);
const ASYNC_JOB_TTL_MS = parsePositiveIntEnv(process.env.ASYNC_JOB_TTL_MS, 86400000);
// Maximum time to wait for running async jobs to complete before forcing process exit on SIGTERM/SIGINT.
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = parsePositiveIntEnv(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 30000);
const OWNERSHIP_GUARD_MODE_RAW = (process.env.OWNERSHIP_GUARD_MODE ?? "warn").trim().toLowerCase();
const OWNERSHIP_GUARD_MODE = OWNERSHIP_GUARD_MODE_RAW === "fail" || OWNERSHIP_GUARD_MODE_RAW === "warn"
  ? OWNERSHIP_GUARD_MODE_RAW
  : "warn";
const OWNERSHIP_GUARD_MODE_RAW_DISPLAY = JSON.stringify(OWNERSHIP_GUARD_MODE_RAW);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const asyncJobs = new Map();

function pruneAsyncJobs() {
  const now = Date.now();
  for (const [id, job] of asyncJobs.entries()) {
    if (!job.finishedAt) continue;
    if (now - Date.parse(job.finishedAt) > ASYNC_JOB_TTL_MS) {
      try {
        if (job.tmpDir && fs.existsSync(job.tmpDir)) {
          fs.rmSync(job.tmpDir, { recursive: true, force: true });
        } else {
          if (job.requestPath && fs.existsSync(job.requestPath)) fs.unlinkSync(job.requestPath);
          if (job.resultPath && fs.existsSync(job.resultPath)) fs.unlinkSync(job.resultPath);
        }
      } catch {
        // best effort cleanup
      }
      asyncJobs.delete(id);
    }
  }
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function toPublicJob(job, includeResult = true) {
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    pid: job.pid,
    error: job.error,
    ...(job.progress ? { progress: job.progress } : {}),
    ...(includeResult ? { result: job.result } : {}),
  };
}

function startAsyncJob({ kind, requestPayload, onComplete }) {
  pruneAsyncJobs();
  const progressPrefix = ASYNC_PROGRESS_PREFIX;

  const id = randomUUID();
  const tmpPrefix = path.join(os.tmpdir(), "mcp-writing-job-");
  const tmpDir = fs.mkdtempSync(tmpPrefix);
  const requestPath = path.join(tmpDir, `${id}.request.json`);
  const resultPath = path.join(tmpDir, `${id}.result.json`);

  fs.writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");

  const runnerPath = path.join(__dirname, "scripts", "async-job-runner.mjs");
  const child = spawn(
    process.execPath,
    ["--experimental-sqlite", runnerPath, requestPath, resultPath],
    {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const job = {
    id,
    kind,
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pid: child.pid,
    tmpDir,
    requestPath,
    resultPath,
    result: null,
    progress: null,
    error: null,
    onComplete,
    child,
  };
  asyncJobs.set(id, job);

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(progressPrefix)) continue;
      const payload = trimmed.slice(progressPrefix.length);
      try {
        const progress = JSON.parse(payload);
        if (progress && typeof progress === "object") {
          const nextProgress = {
            total_scenes: Number(progress.total_scenes ?? 0),
            processed_scenes: Number(progress.processed_scenes ?? 0),
            scenes_changed: Number(progress.scenes_changed ?? 0),
            failed_scenes: Number(progress.failed_scenes ?? 0),
          };
          job.progress = nextProgress;
        }
      } catch {
        // Ignore malformed progress lines; they are best-effort telemetry.
      }
    }
  });
  child.stderr.on("data", () => {
    // avoid crashing on stderr backpressure for noisy runs
  });

  child.on("error", (error) => {
    if (job.status === "cancelling") {
      job.status = "cancelled";
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      pruneAsyncJobs();
      return;
    }
    job.status = "failed";
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    pruneAsyncJobs();
  });

  child.on("exit", (code, signal) => {
    const payload = readJsonIfExists(resultPath);
    const successful = payload?.ok === true;
    const cancelledBySignal = signal === "SIGTERM" || signal === "SIGKILL";
    const cancelledByPayload = payload?.cancelled === true;

    job.finishedAt = new Date().toISOString();
    job.result = payload;

    const hasProgressFields = payload && (
      payload.total_scenes !== undefined
      || payload.processed_scenes !== undefined
      || payload.scenes_changed !== undefined
      || payload.failed_scenes !== undefined
    );

    if (payload && payload.ok === true && hasProgressFields) {
      job.progress = {
        total_scenes: Number(payload.total_scenes ?? job.progress?.total_scenes ?? 0),
        processed_scenes: Number(payload.processed_scenes ?? job.progress?.processed_scenes ?? 0),
        scenes_changed: Number(payload.scenes_changed ?? job.progress?.scenes_changed ?? 0),
        failed_scenes: Number(payload.failed_scenes ?? job.progress?.failed_scenes ?? 0),
      };
    }

    if (job.status === "cancelling") {
      if (cancelledByPayload) {
        job.status = "cancelled";
        job.error = "Async job cancelled after returning partial results.";
      } else if (successful && !cancelledBySignal) {
        // Race: cancellation was requested as work completed successfully.
        job.status = "completed";
      } else {
        job.status = "cancelled";
        job.error = cancelledBySignal
          ? `Async job cancelled by signal ${signal}.`
          : payload?.error?.message ?? payload?.error ?? "Async job cancelled.";
        pruneAsyncJobs();
        return;
      }
    } else {
      job.status = successful ? "completed" : "failed";
      if (!successful) {
        job.error = payload?.error?.message
          ?? payload?.error
          ?? (signal
            ? `Async job exited due to signal ${signal}.`
            : `Async job exited with code ${code}.`);
      }
    }

    if (job.status === "completed" && typeof job.onComplete === "function") {
      try {
        job.onComplete(job);
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      }
    }
    pruneAsyncJobs();
  });

  return job;
}

function paginateRows(rows, { page, pageSize, forcePagination = false }) {
  const totalCount = rows.length;
  const shouldPaginate = forcePagination || page !== undefined || pageSize !== undefined;

  if (!shouldPaginate) {
    return {
      paginated: false,
      rows,
      meta: null,
    };
  }

  const safePageSize = Math.max(1, pageSize ?? DEFAULT_METADATA_PAGE_SIZE);
  const safePage = Math.max(1, page ?? 1);
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const normalizedPage = Math.min(safePage, totalPages);
  const offset = (normalizedPage - 1) * safePageSize;
  const pageRows = rows.slice(offset, offset + safePageSize);

  return {
    paginated: true,
    rows: pageRows,
    meta: {
      total_count: totalCount,
      page: normalizedPage,
      page_size: safePageSize,
      total_pages: totalPages,
      has_next_page: normalizedPage < totalPages,
      has_prev_page: normalizedPage > 1,
    },
  };
}

function jsonResponse(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResponse(code, message, details) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
  return jsonResponse(payload);
}

function deriveLoglineFromProse(prose) {
  const compact = prose.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const sentence = compact.match(/^(.+?[.!?])(?:\s|$)/);
  const candidate = (sentence?.[1] ?? compact).trim();
  if (candidate.length <= 220) return candidate;
  return `${candidate.slice(0, 217).trimEnd()}...`;
}

function inferCharacterIdsFromProse(dbHandle, prose, projectId) {
  const lower = prose.toLowerCase();
  const rows = dbHandle.prepare(`
    SELECT character_id, name
    FROM characters
    WHERE project_id = ? OR universe_id = (SELECT universe_id FROM projects WHERE project_id = ?)
    ORDER BY length(name) DESC
  `).all(projectId, projectId);

  const found = [];
  for (const row of rows) {
    if (!row.name) continue;
    const words = row.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && words.every(w => lower.includes(w))) {
      found.push(row.character_id);
    }
  }
  return [...new Set(found)].slice(0, 12);
}

function readSupportingNotesForEntity(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext).toLowerCase();
  if (base !== "sheet") return [];

  const dir = path.dirname(filePath);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /\.(md|txt)$/i.test(name))
    .filter(name => !/^sheet\.(md|txt)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map(name => {
      const notePath = path.join(dir, name);
      try {
        const raw = fs.readFileSync(notePath, "utf8");
        const { content } = matter(raw);
        return {
          file_name: name,
          content: content.trim(),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(note => note.content);
}

function readEntityMetadata(filePath) {
  const metaPath = sidecarPath(filePath);
  if (fs.existsSync(metaPath)) {
    try {
      return yaml.load(fs.readFileSync(metaPath, "utf8")) ?? {};
    } catch {
      return {};
    }
  }

  try {
    return matter(fs.readFileSync(filePath, "utf8")).data ?? {};
  } catch {
    return {};
  }
}

function resolveProjectRoot(projectId) {
  if (projectId.includes("/")) {
    const [universeId, projectSlug] = projectId.split("/");
    return path.join(SYNC_DIR, "universes", universeId, projectSlug);
  }
  return path.join(SYNC_DIR, "projects", projectId);
}

function resolveWorldEntityDir({ kind, projectId, universeId, name }) {
  const slug = slugifyEntityName(name);
  const baseDir = projectId
    ? path.join(resolveProjectRoot(projectId), "world")
    : path.join(SYNC_DIR, "universes", universeId, "world");
  const bucket = kind === "character" ? "characters" : "places";
  return {
    slug,
    dir: path.join(baseDir, bucket, slug),
  };
}

function resolveBatchTargetScenes(dbHandle, {
  projectId,
  sceneIds,
  part,
  chapter,
  onlyStale,
}) {
  const projectExists = Boolean(
    dbHandle.prepare(`SELECT 1 FROM projects WHERE project_id = ? LIMIT 1`).get(projectId)
  );

  if (sceneIds?.length) {
    const placeholders = sceneIds.map(() => "?").join(",");
    const existingRows = dbHandle.prepare(
      `SELECT scene_id FROM scenes WHERE project_id = ? AND scene_id IN (${placeholders})`
    ).all(projectId, ...sceneIds);
    const existing = new Set(existingRows.map(row => row.scene_id));
    const missing = sceneIds.filter(sceneId => !existing.has(sceneId));
    if (missing.length > 0) {
      return { ok: false, code: "NOT_FOUND", message: `Requested scene IDs were not found in project '${projectId}'.`, details: { missing_scene_ids: missing, project_id: projectId } };
    }
  }

  const conditions = ["project_id = ?"];
  const params = [projectId];

  if (sceneIds?.length) {
    const placeholders = sceneIds.map(() => "?").join(",");
    conditions.push(`scene_id IN (${placeholders})`);
    params.push(...sceneIds);
  }
  if (part !== undefined) {
    conditions.push("part = ?");
    params.push(part);
  }
  if (chapter !== undefined) {
    conditions.push("chapter = ?");
    params.push(chapter);
  }
  if (onlyStale) {
    conditions.push("metadata_stale = 1");
  }

  const query = `
    SELECT scene_id, project_id, file_path
    FROM scenes
    WHERE ${conditions.join(" AND ")}
    ORDER BY part, chapter, timeline_position
  `;

  return {
    ok: true,
    rows: dbHandle.prepare(query).all(...params),
    project_exists: projectExists,
  };
}

function createCanonicalWorldEntity({ kind, name, notes, projectId, universeId, meta }) {
  const prefix = kind === "character" ? "char" : "place";
  const idKey = kind === "character" ? "character_id" : "place_id";
  const slug = slugifyEntityName(name);
  if (!slug) throw new Error("Name must contain at least one alphanumeric character.");

  const { dir } = resolveWorldEntityDir({ kind, projectId, universeId, name });
  const prosePath = path.join(dir, "sheet.md");
  const metaPath = sidecarPath(prosePath);
  const hadProse = fs.existsSync(prosePath);
  const hadMeta = fs.existsSync(metaPath);

  let shouldWriteMeta = !hadMeta;
  let payload;
  const derivedId = `${prefix}-${slug}`;
  if (hadMeta) {
    let parsedMeta;
    try {
      parsedMeta = yaml.load(fs.readFileSync(metaPath, "utf8"));
    } catch (err) {
      throw new Error(
        `Existing metadata sidecar is invalid YAML at ${metaPath}: ${err.message}`,
        { cause: err }
      );
    }

    if (parsedMeta != null && (typeof parsedMeta !== "object" || Array.isArray(parsedMeta))) {
      throw new Error(`Existing metadata sidecar must be a YAML mapping at ${metaPath}.`);
    }

    const existingMeta = parsedMeta ?? {};

    const backfilledId = existingMeta[idKey] ?? derivedId;
    const backfilledName = existingMeta.name ?? name;
    shouldWriteMeta = existingMeta[idKey] == null || existingMeta.name == null;
    payload = shouldWriteMeta
      ? {
        ...existingMeta,
        [idKey]: backfilledId,
        name: backfilledName,
      }
      : existingMeta;
  } else {
    payload = {
      [idKey]: derivedId,
      name,
      ...(meta ?? {}),
    };
  }

  fs.mkdirSync(dir, { recursive: true });

  if (!hadProse) {
    const defaultSheet = kind === "character"
      ? renderCharacterSheetTemplate(name)
      : renderPlaceSheetTemplate(name);
    const body = notes?.trim() ?? defaultSheet;
    fs.writeFileSync(prosePath, `${body}${body ? "\n" : ""}`, "utf8");
  }

  if (kind === "character") {
    const arcPath = path.join(dir, "arc.md");
    if (!fs.existsSync(arcPath)) {
      fs.writeFileSync(arcPath, `${renderCharacterArcTemplate(name)}\n`, "utf8");
    }
  }

  if (shouldWriteMeta) {
    fs.writeFileSync(metaPath, yaml.dump(payload, { lineWidth: 120 }), "utf8");
  }

  syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });

  return {
    created: !hadProse && !hadMeta,
    id: payload[idKey],
    prose_path: prosePath,
    meta_path: metaPath,
    project_id: projectId ?? null,
    universe_id: universeId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = openDb(DB_PATH);

process.stderr.write(`[mcp-writing] Sync dir: ${SYNC_DIR_ABS}\n`);
process.stderr.write(`[mcp-writing] DB path: ${DB_PATH_DISPLAY}\n`);

// Check sync dir writability once at startup (needed for Phase 2 sidecar writes)
const SYNC_DIR_WRITABLE = isSyncDirWritable(SYNC_DIR);
const SYNC_OWNERSHIP_DIAGNOSTICS = getSyncOwnershipDiagnostics(SYNC_DIR);
if (!SYNC_DIR_WRITABLE) {
  process.stderr.write(`[mcp-writing] WARNING: sync dir is not writable — sidecar auto-migration and metadata write-back will be unavailable\n`);
}

// Check git availability and initialize repository if needed (Phase 3)
const GIT_AVAILABLE = isGitAvailable();
let GIT_ENABLED = false;
if (GIT_AVAILABLE && SYNC_DIR_WRITABLE) {
  if (!isGitRepository(SYNC_DIR)) {
    try {
      initGitRepository(SYNC_DIR);
      process.stderr.write(`[mcp-writing] Initialized git repository at ${SYNC_DIR}\n`);
      GIT_ENABLED = true;
    } catch (err) {
      process.stderr.write(`[mcp-writing] WARNING: Failed to initialize git repository: ${err.message}\n`);
    }
  } else {
    GIT_ENABLED = true;
    process.stderr.write(`[mcp-writing] Git repository detected at ${SYNC_DIR} — Phase 3 editing tools enabled\n`);
  }
} else if (!GIT_AVAILABLE) {
  process.stderr.write(`[mcp-writing] WARNING: git not found on PATH — Phase 3 editing tools will be unavailable\n`);
} else if (!SYNC_DIR_WRITABLE) {
  process.stderr.write(`[mcp-writing] NOTE: sync dir is read-only — Phase 3 editing tools will be unavailable\n`);
}

// In-memory storage for pending edit proposals (Phase 3)
const pendingProposals = new Map();
let nextProposalId = 1;
function generateProposalId() {
  return `proposal-${nextProposalId++}`;
}

function getRuntimeDiagnostics() {
  const warnings = [];
  const recommendations = [];

  if (OWNERSHIP_GUARD_MODE_RAW !== OWNERSHIP_GUARD_MODE) {
    warnings.push(
      `OWNERSHIP_GUARD_MODE_INVALID: Unsupported OWNERSHIP_GUARD_MODE=${OWNERSHIP_GUARD_MODE_RAW_DISPLAY}. Falling back to 'warn'.`
    );
    recommendations.push("Set OWNERSHIP_GUARD_MODE to either 'warn' or 'fail'.");
  }

  if (SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid_override_ignored) {
    warnings.push("RUNTIME_UID_OVERRIDE_IGNORED: RUNTIME_UID_OVERRIDE is ignored unless NODE_ENV=test or ALLOW_RUNTIME_UID_OVERRIDE=1.");
    recommendations.push("Avoid RUNTIME_UID_OVERRIDE in production runtime environments.");
  }

  if (SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid_override_invalid) {
    warnings.push("RUNTIME_UID_OVERRIDE_INVALID: RUNTIME_UID_OVERRIDE must be a non-negative integer when enabled.");
    recommendations.push("Set RUNTIME_UID_OVERRIDE to a non-negative integer, or unset it.");
  }

  if (!SYNC_DIR_WRITABLE) {
    warnings.push("SYNC_DIR_READ_ONLY: sync dir is read-only; metadata write-back and prose editing tools are unavailable.");
    recommendations.push("Mount WRITING_SYNC_DIR with write access (avoid read-only mounts like ':ro').");
    recommendations.push("If running in Docker/OpenClaw, verify volume ownership and permissions for the container user.");
  }

  if (SYNC_OWNERSHIP_DIAGNOSTICS.supported && SYNC_OWNERSHIP_DIAGNOSTICS.non_runtime_owned_paths > 0) {
    warnings.push(
      `OWNERSHIP_MISMATCH: ${SYNC_OWNERSHIP_DIAGNOSTICS.non_runtime_owned_paths} sampled path(s) are not owned by runtime UID ${SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid}.`
    );
    recommendations.push(
      `Repair ownership once on host: sudo chown -R "$(id -u):$(id -g)" "${SYNC_DIR_ABS}"`
    );
    recommendations.push(
      "For Docker/OpenClaw, run container as host user (compose: user: \"${OPENCLAW_UID:-1000}:${OPENCLAW_GID:-1000}\")."
    );
  }

  if (OWNERSHIP_GUARD_MODE === "fail" && SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid === 0) {
    warnings.push(
      "OWNERSHIP_GUARD_SKIPPED_FOR_ROOT: OWNERSHIP_GUARD_MODE=fail is skipped because runtime UID is 0 (root)."
    );
    recommendations.push("Prefer running as a non-root host-mapped UID/GID to make ownership guard checks meaningful.");
  }

  if (SYNC_OWNERSHIP_DIAGNOSTICS.supported && SYNC_OWNERSHIP_DIAGNOSTICS.root_owned_paths > 0) {
    warnings.push(
      `ROOT_OWNED_PATHS: ${SYNC_OWNERSHIP_DIAGNOSTICS.root_owned_paths} sampled path(s) are owned by UID 0 (root).`
    );
  }

  if (!GIT_AVAILABLE) {
    warnings.push("GIT_NOT_FOUND: git is not available on PATH; snapshot/edit tools are unavailable.");
    recommendations.push("Install git in the runtime image/environment.");
  }

  if (GIT_AVAILABLE && SYNC_DIR_WRITABLE && !GIT_ENABLED) {
    warnings.push("GIT_DISABLED: git is available but repository snapshot tools are not active.");
    recommendations.push("Ensure WRITING_SYNC_DIR points to a writable git repository root, or allow mcp-writing to initialize one.");
  }

  if (GIT_AVAILABLE && !SYNC_DIR_WRITABLE) {
    recommendations.push("If git reports 'dubious ownership' for mounted repos, add: git config --system --add safe.directory /sync");
  }

  recommendations.push("If indexing finds many files without scene_id, run scripts/import.js first for Scrivener Draft exports, then run sync.");

  return { warnings, recommendations };
}

const RUNTIME_DIAGNOSTICS = getRuntimeDiagnostics();
if (RUNTIME_DIAGNOSTICS.warnings.length) {
  process.stderr.write(`[mcp-writing] Runtime diagnostics:\n`);
  for (const line of RUNTIME_DIAGNOSTICS.warnings) {
    process.stderr.write(`[mcp-writing] - ${line}\n`);
  }
}

const SHOULD_ENFORCE_OWNERSHIP_FAIL_GUARD = OWNERSHIP_GUARD_MODE === "fail"
  && SYNC_OWNERSHIP_DIAGNOSTICS.supported
  && SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid !== 0;

if (SHOULD_ENFORCE_OWNERSHIP_FAIL_GUARD && SYNC_OWNERSHIP_DIAGNOSTICS.non_runtime_owned_paths > 0) {
  process.stderr.write(
    `[mcp-writing] FATAL: OWNERSHIP_GUARD_MODE=fail and ${SYNC_OWNERSHIP_DIAGNOSTICS.non_runtime_owned_paths} sampled path(s) are not owned by runtime UID ${SYNC_OWNERSHIP_DIAGNOSTICS.runtime_uid}.\n`
  );
  process.stderr.write(
    `[mcp-writing] FATAL: Repair ownership once on the host directory mounted at ${SYNC_DIR_ABS}: sudo chown -R "$(id -u):$(id -g)" /path/to/host-sync-dir\n`
  );
  process.exit(1);
}

// Run sync on startup
syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });

// ---------------------------------------------------------------------------
// Graceful shutdown — drain running async jobs before exit
// ---------------------------------------------------------------------------
async function waitForRunningJobs() {
  const running = [...asyncJobs.values()].filter(
    (j) => j.status === "running" || j.status === "cancelling"
  );
  if (!running.length) return;

  process.stderr.write(
    `[mcp-writing] Waiting for ${running.length} async job(s) to finish (max ${GRACEFUL_SHUTDOWN_TIMEOUT_MS / 1000}s)...\n`
  );
  const deadline = Date.now() + GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  return new Promise((resolve) => {
    const check = () => {
      const stillRunning = [...asyncJobs.values()].filter(
        (j) => j.status === "running" || j.status === "cancelling"
      );
      if (!stillRunning.length) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        process.stderr.write(
          `[mcp-writing] Shutdown timeout: force-killing ${stillRunning.length} remaining job(s).\n`
        );
        for (const job of stillRunning) {
          try { job.child.kill("SIGKILL"); } catch { /* ignore */ }
        }
        resolve();
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

async function gracefulShutdown(signal) {
  process.stderr.write(`[mcp-writing] Received ${signal}, shutting down gracefully.\n`);
  await waitForRunningJobs();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
function createMcpServer() {
  const s = new McpServer({ name: "mcp-writing", version: "0.1.0" });

  // ---- sync ----------------------------------------------------------------
  s.tool("sync", "Re-scan the sync folder and update the scene/character/place index from disk. Call this after making edits in Scrivener or updating sidecar files outside the MCP.", {}, async () => {
    const result = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
    const parts = [`Sync complete. ${result.indexed} scenes indexed. ${result.staleMarked} scenes marked stale.`];
    if (result.sidecarsMigrated) parts.push(`${result.sidecarsMigrated} sidecar(s) auto-generated from frontmatter.`);
    if (result.skipped) parts.push(`${result.skipped} file(s) skipped (no scene_id).`);
    if (result.skipped) parts.push(`Tip: for raw Scrivener Draft exports, run scripts/import.js first, then run sync again.`);
    const summary = result.warningSummary;
    const summaryEntries = Object.entries(summary);
    if (summaryEntries.length) {
      const lines = summaryEntries.map(([type, entry]) => `- ${type}: ${entry.count} (e.g. ${entry.examples[0]})`);
      parts.push(`\n⚠️ Warning summary:\n` + lines.join("\n"));
    }
    return { content: [{ type: "text", text: parts.join(" ") }] };
  });

  // ---- import_scrivener_sync ----------------------------------------------
  s.tool(
    "import_scrivener_sync",
    "[STABLE] Import Scrivener External Folder Sync Draft files into this server's WRITING_SYNC_DIR by generating scene sidecars and reconciling by Scrivener binder ID. This is the recommended default path for first-time setup before sync().",
    {
      source_dir: z.string().describe("Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself)."),
      project_id: z.string().optional().describe("Project ID override (e.g. 'the-lamb'). Defaults to a slug derived from WRITING_SYNC_DIR."),
      dry_run: z.boolean().optional().describe("If true, reports planned writes without changing files."),
      auto_sync: z.boolean().optional().describe("If true (default), runs sync() after import when not dry-run."),
      preflight: z.boolean().optional().describe("If true, returns a list of files that would be processed without doing any work. Use to verify scope before a large import."),
      ignore_patterns: z.array(z.string()).optional().describe("Array of regex patterns matched against filenames. Files matching any pattern are excluded from import. Useful to skip fragments, beat-sheet notes, or feedback files."),
    },
    async ({ source_dir, project_id, dry_run = false, auto_sync = true, preflight = false, ignore_patterns = [] }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const ignorePatternCheck = validateRegexPatterns(ignore_patterns);
      if (!ignorePatternCheck.ok) {
        return errorResponse(
          "INVALID_IGNORE_PATTERN",
          `Invalid ignore pattern '${ignorePatternCheck.pattern}': ${ignorePatternCheck.reason}`,
          {
            source_dir,
            sync_dir: SYNC_DIR_ABS,
            project_id: project_id ?? null,
            pattern: ignorePatternCheck.pattern,
          }
        );
      }

      if (!dry_run && !SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot import because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      let importResult;
      try {
        importResult = importScrivenerSync({
          scrivenerDir: source_dir,
          mcpSyncDir: SYNC_DIR,
          projectId: project_id,
          dryRun: Boolean(dry_run) || preflight,
          preflight: Boolean(preflight),
          ignorePatterns: ignore_patterns,
        });
      } catch (error) {
        if (error && typeof error === "object" && error.code === "INVALID_IGNORE_PATTERN") {
          return errorResponse(
            "INVALID_IGNORE_PATTERN",
            error instanceof Error ? error.message : "Invalid ignore pattern.",
            {
              source_dir,
              sync_dir: SYNC_DIR_ABS,
              project_id: project_id ?? null,
              pattern: error.pattern ?? null,
            }
          );
        }
        return errorResponse(
          "IMPORT_FAILED",
          error instanceof Error ? error.message : "Import failed.",
          {
            source_dir,
            sync_dir: SYNC_DIR_ABS,
            project_id: project_id ?? null,
          }
        );
      }

      let syncResult = null;
      if (!dry_run && !preflight && auto_sync) {
        syncResult = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
      }

      return jsonResponse({
        ok: true,
        import: {
          source_dir: importResult.scrivenerDir,
          sync_dir: importResult.mcpSyncDir,
          scenes_dir: importResult.scenesDir,
          project_id: importResult.projectId,
          preflight: importResult.preflight,
          source_files: importResult.sourceFiles,
          ignored_files: importResult.ignoredFiles,
          ...(importResult.preflight ? {
            files_to_process: importResult.filesToProcess,
            file_previews: importResult.filePreviews,
            existing_sidecars: importResult.existingSidecars,
          } : {}),
          created: importResult.created,
          existing: importResult.existing,
          skipped: importResult.skipped,
          beat_markers_seen: importResult.beatMarkersSeen,
          dry_run: importResult.dryRun,
        },
        sync: syncResult
          ? {
            indexed: syncResult.indexed,
            stale_marked: syncResult.staleMarked,
            sidecars_migrated: syncResult.sidecarsMigrated,
            skipped: syncResult.skipped,
            warning_summary: syncResult.warningSummary,
          }
          : null,
        next_step: preflight
          ? "Preflight complete. Review file_previews and ignored_files, then re-run without preflight=true."
          : dry_run
            ? "Dry run complete. Re-run with dry_run=false to write files."
            : auto_sync
              ? "Import and sync complete."
              : "Import complete. Run sync() to index imported scenes.",
      });
    }
  );

  // ---- merge_scrivener_project_beta --------------------------------------
  s.tool(
    "merge_scrivener_project_beta",
    "[BETA] Merge metadata directly from a Scrivener .scriv project into existing scene sidecars. This path is opt-in, requires sidecars to already exist (for example, from import_scrivener_sync), and may be sensitive to Scrivener internal format changes.",
    {
      source_project_dir: z.string().describe("Path to a Scrivener .scriv bundle directory."),
      project_id: z.string().optional().describe("Project ID containing existing sidecars (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). Defaults to a slug derived from WRITING_SYNC_DIR."),
      scenes_dir: z.string().optional().describe("Absolute path to the scenes directory containing .meta.yaml sidecars. Overrides the path derived from project_id. Use this for non-standard sync layouts."),
      dry_run: z.boolean().optional().describe("If true (default), reports planned merges without writing files."),
      auto_sync: z.boolean().optional().describe("If true (default), runs sync() after a non-dry-run merge."),
      organize_by_chapters: z.boolean().optional().describe("If true (default false), relocate scene files into chapter-based folder hierarchies (e.g., chapter-7-harbor/). Chapter metadata is always extracted to sidecars regardless of this flag."),
    },
    async ({ source_project_dir, project_id, scenes_dir, dry_run = true, auto_sync = true, organize_by_chapters = false }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (!dry_run && !SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot merge Scrivener metadata because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const resolvedScenesDir = scenes_dir
        ?? (project_id ? path.join(resolveProjectRoot(project_id), "scenes") : undefined);
      const normalizedScenesDir = resolvedScenesDir ? path.resolve(resolvedScenesDir) : undefined;

      if (normalizedScenesDir) {
        if (!isPathInsideSyncDir(normalizedScenesDir)) {
          return errorResponse(
            "INVALID_SCENES_DIR",
            "scenes_dir must be inside WRITING_SYNC_DIR.",
            { scenes_dir: normalizedScenesDir, sync_dir: SYNC_DIR_ABS, sync_dir_real: SYNC_DIR_REAL }
          );
        }
      }

      let mergeResult;
      try {
        mergeResult = mergeScrivenerProjectMetadata({
          scrivPath: source_project_dir,
          mcpSyncDir: SYNC_DIR,
          projectId: project_id,
          scenesDir: normalizedScenesDir,
          dryRun: Boolean(dry_run),
          organizeByChapters: Boolean(organize_by_chapters),
        });
      } catch (error) {
        return errorResponse(
          "SCRIVENER_DIRECT_BETA_FAILED",
          error instanceof Error ? error.message : "Scrivener direct beta merge failed.",
          {
            source_project_dir,
            sync_dir: SYNC_DIR_ABS,
            project_id: project_id ?? null,
            fallback: "Use import_scrivener_sync with a Scrivener External Folder Sync export as the stable default path.",
          }
        );
      }

      let syncResult = null;
      if (!dry_run && auto_sync) {
        syncResult = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
      }

      return jsonResponse({
        ok: true,
        beta: true,
        merge: {
          source_project_dir: mergeResult.scrivPath,
          sync_dir: mergeResult.mcpSyncDir,
          scenes_dir: mergeResult.scenesDir,
          project_id: mergeResult.projectId,
          dry_run: mergeResult.dryRun,
          sidecar_files: mergeResult.sidecarFiles,
          updated: mergeResult.updated,
          relocated: mergeResult.relocated,
          unchanged: mergeResult.unchanged,
          no_data: mergeResult.noData,
          field_add_counts: mergeResult.fieldAddCounts,
          preview_changes: mergeResult.previewChanges,
          warnings: mergeResult.warnings,
          warnings_truncated: mergeResult.warningsTruncated,
          warning_summary: mergeResult.warningSummary,
          stats: {
            sync_map_entries: mergeResult.stats.syncMapEntries,
            keyword_map_entries: mergeResult.stats.keywordMapEntries,
            binder_items: mergeResult.stats.binderItems,
            part_chapter_assignments: mergeResult.stats.partChapterAssignments,
          },
        },
        sync: syncResult
          ? {
            indexed: syncResult.indexed,
            stale_marked: syncResult.staleMarked,
            sidecars_migrated: syncResult.sidecarsMigrated,
            skipped: syncResult.skipped,
            warning_summary: syncResult.warningSummary,
          }
          : null,
        next_step: dry_run
          ? "Dry run complete. Re-run with dry_run=false to write metadata merges."
          : auto_sync
            ? "Beta merge and sync complete."
            : "Beta merge complete. Run sync() to refresh index.",
        warnings: [
          "BETA_FEATURE: Direct Scrivener project parsing may be sensitive to Scrivener internal format changes.",
          "If this fails, use import_scrivener_sync with an External Folder Sync export as the stable fallback.",
        ],
      });
    }
  );

  // ---- async import/merge jobs --------------------------------------------
  s.tool(
    "import_scrivener_sync_async",
    "[STABLE] Start an asynchronous Scrivener External Folder Sync import job. This is the recommended default import path when the sync tree is large. Returns immediately with a job_id to poll via get_async_job_status.",
    {
      source_dir: z.string().describe("Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself)."),
      project_id: z.string().optional().describe("Project ID override (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb')."),
      dry_run: z.boolean().optional().describe("If true, reports planned writes without changing files."),
      auto_sync: z.boolean().optional().describe("If true, runs sync() after a non-dry-run async import finishes."),
      preflight: z.boolean().optional().describe("If true, returns a list of files that would be processed without doing any work."),
      ignore_patterns: z.array(z.string()).optional().describe("Array of regex patterns matched against filenames. Files matching any pattern are excluded from import."),
    },
    async ({ source_dir, project_id, dry_run = false, auto_sync = false, preflight = false, ignore_patterns = [] }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const ignorePatternCheck = validateRegexPatterns(ignore_patterns);
      if (!ignorePatternCheck.ok) {
        return errorResponse(
          "INVALID_IGNORE_PATTERN",
          `Invalid ignore pattern '${ignorePatternCheck.pattern}': ${ignorePatternCheck.reason}`,
          {
            source_dir,
            sync_dir: SYNC_DIR_ABS,
            project_id: project_id ?? null,
            pattern: ignorePatternCheck.pattern,
          }
        );
      }

      if (!dry_run && !preflight && !SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot import because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const job = startAsyncJob({
        kind: "import_scrivener_sync",
        requestPayload: {
          kind: "import_scrivener_sync",
          args: {
            source_dir,
            project_id,
            dry_run: Boolean(dry_run),
            preflight: Boolean(preflight),
            ignore_patterns,
          },
          context: {
            sync_dir: SYNC_DIR,
          },
        },
        onComplete: (completedJob) => {
          if (!auto_sync || dry_run || preflight || completedJob.status !== "completed") return;
          const syncResult = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
          if (completedJob.result && completedJob.result.ok) {
            completedJob.result.sync = {
              indexed: syncResult.indexed,
              stale_marked: syncResult.staleMarked,
              sidecars_migrated: syncResult.sidecarsMigrated,
              skipped: syncResult.skipped,
              warning_summary: syncResult.warningSummary,
            };
          }
        },
      });

      return jsonResponse({
        ok: true,
        async: true,
        job: toPublicJob(job, false),
        next_step: "Call get_async_job_status with job_id until status is 'completed' or 'failed'.",
      });
    }
  );

  s.tool(
    "merge_scrivener_project_beta_async",
    "[BETA] Start an asynchronous Scrivener metadata merge job from a `.scriv` project into existing scene sidecars. Use this only after the stable import path has created sidecars. Returns immediately with a job_id to poll via get_async_job_status.",
    {
      source_project_dir: z.string().describe("Path to a Scrivener .scriv bundle directory."),
      project_id: z.string().optional().describe("Project ID containing existing sidecars (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb')."),
      scenes_dir: z.string().optional().describe("Absolute path to the scenes directory containing .meta.yaml sidecars. Overrides the path derived from project_id."),
      dry_run: z.boolean().optional().describe("If true (default), reports planned merges without writing files."),
      auto_sync: z.boolean().optional().describe("If true, runs sync() after a non-dry-run async merge finishes."),
      organize_by_chapters: z.boolean().optional().describe("If true (default false), relocate scene files into chapter-based folder hierarchies. Chapter metadata is always extracted to sidecars."),
    },
    async ({ source_project_dir, project_id, scenes_dir, dry_run = true, auto_sync = false, organize_by_chapters = false }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (!dry_run && !SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot merge Scrivener metadata because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const resolvedScenesDir = scenes_dir
        ?? (project_id ? path.join(resolveProjectRoot(project_id), "scenes") : undefined);
      const normalizedScenesDir = resolvedScenesDir ? path.resolve(resolvedScenesDir) : undefined;

      if (normalizedScenesDir) {
        if (!isPathInsideSyncDir(normalizedScenesDir)) {
          return errorResponse(
            "INVALID_SCENES_DIR",
            "scenes_dir must be inside WRITING_SYNC_DIR.",
            { scenes_dir: normalizedScenesDir, sync_dir: SYNC_DIR_ABS, sync_dir_real: SYNC_DIR_REAL }
          );
        }
      }

      const job = startAsyncJob({
        kind: "merge_scrivener_project_beta",
        requestPayload: {
          kind: "merge_scrivener_project_beta",
          args: {
            source_project_dir,
            project_id,
            scenes_dir: normalizedScenesDir,
            dry_run: Boolean(dry_run),
            organize_by_chapters: Boolean(organize_by_chapters),
          },
          context: {
            sync_dir: SYNC_DIR,
          },
        },
        onComplete: (completedJob) => {
          if (!auto_sync || dry_run || completedJob.status !== "completed") return;
          const syncResult = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
          if (completedJob.result && completedJob.result.ok) {
            completedJob.result.sync = {
              indexed: syncResult.indexed,
              stale_marked: syncResult.staleMarked,
              sidecars_migrated: syncResult.sidecarsMigrated,
              skipped: syncResult.skipped,
              warning_summary: syncResult.warningSummary,
            };
          }
        },
      });

      return jsonResponse({
        ok: true,
        async: true,
        beta: true,
        job: toPublicJob(job, false),
        next_step: "Call get_async_job_status with job_id until status is 'completed' or 'failed'.",
      });
    }
  );

  s.tool(
    "enrich_scene_characters_batch",
    "Start an asynchronous batch job that infers scene character mentions and updates scene metadata links. Version 1 uses canonical character names only (no aliases). Defaults to dry_run=true.",
    {
      project_id: z.string().describe("Project ID (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb')."),
      scene_ids: z.array(z.string()).optional().describe("Optional allowlist of scene IDs to process before other filters are applied."),
      part: z.number().int().optional().describe("Optional part number filter."),
      chapter: z.number().int().optional().describe("Optional chapter number filter."),
      only_stale: z.boolean().optional().describe("If true, only process scenes currently marked metadata_stale."),
      dry_run: z.boolean().optional().describe("If true (default), returns preview results without writing sidecars."),
      replace_mode: z.enum(["merge", "replace"]).optional().describe("merge (default): add inferred IDs; replace: overwrite characters with inferred IDs."),
      max_scenes: z.number().int().positive().optional().describe("Hard guardrail for resolved scene count (default: 200)."),
      include_match_details: z.boolean().optional().describe("If true, include extra match diagnostics per scene."),
      confirm_replace: z.boolean().optional().describe("Must be true when replace_mode=replace."),
    },
    async ({
      project_id,
      scene_ids,
      part,
      chapter,
      only_stale = false,
      dry_run = true,
      replace_mode = "merge",
      max_scenes = 200,
      include_match_details = false,
      confirm_replace = false,
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      if (replace_mode === "replace" && !confirm_replace) {
        return errorResponse(
          "VALIDATION_ERROR",
          "replace_mode=replace requires confirm_replace=true.",
          { replace_mode, confirm_replace }
        );
      }

      if (!dry_run && !SYNC_DIR_WRITABLE) {
        return errorResponse(
          "READ_ONLY",
          "Cannot run batch character enrichment in write mode: sync dir is read-only.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const characterRows = db.prepare(`
        SELECT character_id, name
        FROM characters
        WHERE project_id = ? OR universe_id = (SELECT universe_id FROM projects WHERE project_id = ?)
        ORDER BY length(name) DESC
      `).all(project_id, project_id);

      const targetResolution = resolveBatchTargetScenes(db, {
        projectId: project_id,
        sceneIds: scene_ids,
        part,
        chapter,
        onlyStale: Boolean(only_stale),
      });
      if (!targetResolution.ok) {
        return errorResponse(targetResolution.code, targetResolution.message, targetResolution.details);
      }

      const targetScenes = targetResolution.rows;
      const projectExists = targetResolution.project_exists !== false;
      if (targetScenes.length > max_scenes) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Matched ${targetScenes.length} scenes, which exceeds max_scenes=${max_scenes}.`,
          {
            matched_scenes: targetScenes.length,
            max_scenes,
            project_id,
          }
        );
      }

      const job = startAsyncJob({
        kind: "enrich_scene_characters_batch",
        requestPayload: {
          kind: "enrich_scene_characters_batch",
          args: {
            project_id,
            dry_run: Boolean(dry_run),
            replace_mode,
            include_match_details: Boolean(include_match_details),
            project_exists: projectExists,
            target_scenes: targetScenes,
            character_rows: characterRows,
          },
          context: { sync_dir: SYNC_DIR },
        },
        onComplete: (completedJob) => {
          if (dry_run || completedJob.status !== "completed" || !completedJob.result?.ok) return;

          syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });

          const changedScenes = (completedJob.result.results ?? [])
            .filter(row => row.status === "changed")
            .map(row => row.scene_id);

          for (const sceneId of changedScenes) {
            db.prepare(`UPDATE scenes SET metadata_stale = 0 WHERE scene_id = ? AND project_id = ?`)
              .run(sceneId, project_id);
          }
        },
      });

      return jsonResponse({
        ok: true,
        async: true,
        job: toPublicJob(job, false),
        next_step: "Call get_async_job_status with job_id until status is 'completed', 'failed', or 'cancelled'.",
      });
    }
  );

  s.tool(
    "get_async_job_status",
    "Get status and result for an asynchronous job started by async tools such as import_scrivener_sync_async, merge_scrivener_project_beta_async, or enrich_scene_characters_batch. Use this to poll job progress after receiving a job_id. Common next step: if status is still running, call this tool again; if completed, inspect result and optionally run sync().",
    {
      job_id: z.string().describe("Job ID returned by an async start tool."),
      include_result: z.boolean().optional().describe("If true (default), includes completed result payload when available."),
    },
    async ({ job_id, include_result = true }) => {
      pruneAsyncJobs();
      const job = asyncJobs.get(job_id);
      if (!job) {
        return errorResponse("NOT_FOUND", `Async job '${job_id}' was not found. It may have expired. Hint: call list_async_jobs to see currently tracked job IDs.`);
      }
      return jsonResponse({ ok: true, async: true, job: toPublicJob(job, include_result) });
    }
  );

  s.tool(
    "list_async_jobs",
    "List asynchronous jobs currently known to this server. Use this when you lost a job_id or need a dashboard view of running/completed jobs. Returns an object envelope containing a "jobs" array of job objects sorted by newest first.",
    {
      include_results: z.boolean().optional().describe("If true, includes completed result payloads."),
    },
    async ({ include_results = false }) => {
      pruneAsyncJobs();
      const jobs = [...asyncJobs.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(job => toPublicJob(job, include_results));
      return jsonResponse({ ok: true, async: true, jobs });
    }
  );

  s.tool(
    "cancel_async_job",
    "Cancel a running asynchronous job. Use this when an import/merge/batch run was started with overly broad scope or is no longer needed. Returns the updated job state; cancellation is cooperative and may transition through 'cancelling' before 'cancelled'.",
    {
      job_id: z.string().describe("Job ID returned by an async start tool."),
    },
    async ({ job_id }) => {
      pruneAsyncJobs();
      const job = asyncJobs.get(job_id);
      if (!job) {
        return errorResponse("NOT_FOUND", `Async job '${job_id}' was not found. It may have expired. Hint: call list_async_jobs to find active IDs.`);
      }

      if (job.status !== "running") {
        return jsonResponse({
          ok: true,
          async: true,
          cancelled: false,
          message: `Job is already ${job.status}.`,
          job: toPublicJob(job, false),
        });
      }

      // Guard: if the child has already exited, its exit handler will have
      // set the terminal status. Don't overwrite it.
      const childHasExited = job.child.exitCode !== null || job.child.signalCode !== null;
      if (childHasExited) {
        return jsonResponse({
          ok: true,
          async: true,
          cancelled: false,
          message: "Job is no longer running.",
          job: toPublicJob(job, false),
        });
      }

      let signalSent = false;
      try {
        signalSent = job.child.kill("SIGTERM");
      } catch {
        // kill() threw — treat as signal not sent
      }

      if (!signalSent) {
        return jsonResponse({
          ok: true,
          async: true,
          cancelled: false,
          message: "Cancellation could not be requested; job may have already finished.",
          job: toPublicJob(job, false),
        });
      }

      // Transitional: signal sent but worker has not yet exited.
      // Exit/error handlers will finalise status to "cancelled".
      job.status = "cancelling";

      return jsonResponse({
        ok: true,
        async: true,
        cancelled: true,
        message: "Cancellation requested. Poll get_async_job_status until status is 'cancelled'.",
        job: toPublicJob(job, false),
      });
    }
  );

  // ---- get_runtime_config --------------------------------------------------
  s.tool(
    "get_runtime_config",
    "Show the active runtime paths and capabilities for this server instance (sync dir, database path, writability, permission diagnostics, and git availability). Use this to verify which manuscript location is currently connected.",
    {},
    async () => {
      return jsonResponse({
        sync_dir: SYNC_DIR_ABS,
        db_path: DB_PATH_DISPLAY,
        sync_dir_writable: SYNC_DIR_WRITABLE,
        ownership_guard_mode: OWNERSHIP_GUARD_MODE,
        permission_diagnostics: SYNC_OWNERSHIP_DIAGNOSTICS,
        git_available: GIT_AVAILABLE,
        git_enabled: GIT_ENABLED,
        http_port: HTTP_PORT,
        runtime_warnings: RUNTIME_DIAGNOSTICS.warnings,
        setup_recommendations: RUNTIME_DIAGNOSTICS.recommendations,
      });
    }
  );

  // ---- find_scenes ---------------------------------------------------------
  s.tool(
    "find_scenes",
    "Find scenes by filtering on character, Save the Cat beat, tags, part, chapter, or POV. Returns ordered scene metadata only — no prose. All filters are optional and combinable. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Warns if any matching scenes have stale metadata.",
    {
      project_id: z.string().optional().describe("Project ID (e.g. 'the-lamb'). Use to scope results to one project."),
      character:  z.string().optional().describe("A character_id (e.g. 'char-mira-nystrom'). Returns only scenes that character appears in. Use list_characters first to find valid IDs."),
      beat:       z.string().optional().describe("Save the Cat beat name (e.g. 'Opening Image'). Exact match."),
      tag:        z.string().optional().describe("Scene tag to filter by. Exact match."),
      part:       z.number().int().optional().describe("Part number (integer, e.g. 1). Chapters are numbered globally across the whole project."),
      chapter:    z.number().int().optional().describe("Chapter number (integer, e.g. 3). Chapters are numbered globally across the whole project — do not reset per part."),
      pov:        z.string().optional().describe("POV character_id. Use list_characters first to find valid IDs."),
      page:       z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size:  z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ project_id, character, beat, tag, part, chapter, pov, page, page_size }) => {
      let query = `
        SELECT DISTINCT s.scene_id, s.project_id, s.title, s.part, s.chapter, s.chapter_title, s.pov,
               s.logline, s.scene_change, s.causality, s.stakes, s.scene_functions,
               s.save_the_cat_beat, s.timeline_position, s.story_time,
               s.word_count, s.metadata_stale
        FROM scenes s
      `;
      const joins = [];
      const conditions = [];
      const params = [];

      if (character) {
        joins.push(`JOIN scene_characters sc ON sc.scene_id = s.scene_id AND sc.character_id = ?`);
        params.push(character);
      }
      if (tag) {
        joins.push(`JOIN scene_tags st ON st.scene_id = s.scene_id AND st.tag = ?`);
        params.push(tag);
      }
      if (project_id)  { conditions.push(`s.project_id = ?`);        params.push(project_id); }
      if (beat)        { conditions.push(`s.save_the_cat_beat = ?`);  params.push(beat); }
      if (part)        { conditions.push(`s.part = ?`);               params.push(part); }
      if (chapter)     { conditions.push(`s.chapter = ?`);            params.push(chapter); }
      if (pov)         { conditions.push(`s.pov = ?`);                params.push(pov); }

      if (joins.length)      query += " " + joins.join(" ");
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY s.part, s.chapter, s.timeline_position";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No scenes match the given filters. Hint: broaden filters or call search_metadata with a keyword first.");
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `${staleCount} scene(s) have stale metadata — prose has changed since last enrichment. Consider running enrich_scene() before relying on this data for analysis.`
        : undefined;

      const paged = paginateRows(rows, {
        page,
        pageSize: page_size,
        forcePagination: rows.length > DEFAULT_METADATA_PAGE_SIZE,
      });

      const payload = paged.paginated
        ? {
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : rows;

      return {
        content: [{
          type: "text",
          text: JSON.stringify(payload, null, 2),
        }],
      };
    }
  );

  // ---- get_scene_prose -----------------------------------------------------
  s.tool(
    "get_scene_prose",
    "Load the full prose text of a single scene. Use this for close reading, continuity checks, or when you need the actual writing. For overview or filtering, use find_scenes instead — it is much cheaper. Optionally retrieve a past version from git history.",
    {
      scene_id: z.string().describe("The scene_id to retrieve (e.g. 'sc-001-prologue'). Get this from find_scenes or get_arc."),
      commit: z.string().optional().describe("Optional git commit hash to retrieve a past version. Use list_snapshots to find valid hashes. If omitted, returns the current prose."),
    },
    async ({ scene_id, commit }) => {
      const scene = db.prepare(`SELECT file_path, metadata_stale FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found. Run sync() if you just added it.`);
      }
      try {
        let rawContent;
        if (commit && GIT_ENABLED) {
          // Retrieve from git history
          rawContent = getSceneProseAtCommit(SYNC_DIR, scene.file_path, commit);
        } else if (commit && !GIT_ENABLED) {
          return errorResponse("GIT_UNAVAILABLE", "Git is not available — cannot retrieve historical versions.");
        } else {
          // Retrieve current version
          rawContent = fs.readFileSync(scene.file_path, "utf8");
        }

        const { content: prose } = matter(rawContent);
        const versionNote = commit ? `\n\n(Retrieved from commit: ${commit})` : "";
        const warning = scene.metadata_stale && !commit
          ? `\n\n⚠️ Metadata for this scene may be stale — prose has changed since last enrichment.`
          : "";
        return { content: [{ type: "text", text: prose.trim() + versionNote + warning }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse(
            "STALE_PATH",
            `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved since the last sync. Run sync() to refresh the index.`,
            { indexed_path: scene.file_path }
          );
        }
        return errorResponse("IO_ERROR", `Failed to read scene file: ${err.message}`);
      }
    }
  );

  // ---- get_chapter_prose ---------------------------------------------------
  s.tool(
    "get_chapter_prose",
    `Load the full prose for every scene in a chapter, concatenated in order. Expensive — only use when you need to read an entire chapter. Capped at ${MAX_CHAPTER_SCENES} scenes. Use find_scenes first to confirm the chapter exists.`,
    {
      project_id: z.string().describe("Project ID (e.g. 'the-lamb')."),
      part:       z.number().int().describe("Part number (integer)."),
      chapter:    z.number().int().describe("Chapter number (integer, globally numbered across the whole project)."),
    },
    async ({ project_id, part, chapter }) => {
      const allScenes = db.prepare(`
        SELECT scene_id, title, file_path FROM scenes
        WHERE project_id = ? AND part = ? AND chapter = ?
        ORDER BY timeline_position
      `).all(project_id, part, chapter);

      if (allScenes.length === 0) {
        return errorResponse("NO_RESULTS", `No scenes found for Part ${part}, Chapter ${chapter}.`);
      }

      const truncated = allScenes.length > MAX_CHAPTER_SCENES;
      const scenes = truncated ? allScenes.slice(0, MAX_CHAPTER_SCENES) : allScenes;

      const parts = [];
      for (const scene of scenes) {
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          const { content: prose } = matter(raw);
          parts.push(`## ${scene.title ?? scene.scene_id}\n\n${prose.trim()}`);
        } catch (err) {
          parts.push(`## ${scene.scene_id}\n\n[Error reading file: ${err.message}]`);
        }
      }

      const warning = truncated
        ? `\n\n⚠️ Chapter has ${allScenes.length} scenes — only the first ${MAX_CHAPTER_SCENES} were loaded. Set MAX_CHAPTER_SCENES to increase this limit.`
        : "";
      return { content: [{ type: "text", text: parts.join("\n\n---\n\n") + warning }] };
    }
  );

  // ---- get_arc -------------------------------------------------------------
  s.tool(
    "get_arc",
    "Get every scene a character appears in, ordered by part/chapter/position. Returns scene metadata only — no prose. Use this to trace a character's arc through the story. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Call list_characters first to get the character_id.",
    {
      character_id: z.string().describe("The character_id to trace (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs."),
      project_id:   z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      page:         z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size:    z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ character_id, project_id, page, page_size }) => {
      let query = `
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.chapter_title, s.title, s.logline,
               s.scene_change, s.causality, s.stakes, s.scene_functions,
               s.save_the_cat_beat, s.timeline_position, s.story_time, s.pov, s.metadata_stale
        FROM scenes s
        JOIN scene_characters sc ON sc.scene_id = s.scene_id
        WHERE sc.character_id = ?
      `;
      const params = [character_id];
      if (project_id) { query += ` AND s.project_id = ?`; params.push(project_id); }
      query += ` ORDER BY s.part, s.chapter, s.timeline_position`;

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", `No scenes found for character '${character_id}'.`);
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `${staleCount} scene(s) have stale metadata.`
        : undefined;

      const paged = paginateRows(rows, {
        page,
        pageSize: page_size,
        forcePagination: rows.length > DEFAULT_METADATA_PAGE_SIZE,
      });

      const payload = paged.paginated
        ? {
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : rows;

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- list_characters -----------------------------------------------------
  s.tool(
    "list_characters",
    "List all indexed characters with their character_id, name, role, and arc_summary. Call this first whenever you need to filter scenes by character or look up a character sheet — it gives you the character_id values required by other tools.",
    {
      project_id:  z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      universe_id: z.string().optional().describe("Limit to a specific universe (if using cross-project world-building)."),
    },
    async ({ project_id, universe_id }) => {
      let query = `SELECT character_id, name, role, arc_summary, project_id, universe_id FROM characters`;
      const conditions = [];
      const params = [];
      if (project_id)  { conditions.push(`project_id = ?`);  params.push(project_id); }
      if (universe_id) { conditions.push(`universe_id = ?`); params.push(universe_id); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY name";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No characters found.");
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- get_character_sheet -------------------------------------------------
  s.tool(
    "get_character_sheet",
    "Get full character details: role, arc_summary, traits, the canonical sheet content, and any adjacent support notes when the character uses a folder-based layout. Use list_characters first to get the character_id.",
    {
      character_id: z.string().describe("The character_id to look up (e.g. 'char-sebastian'). Use list_characters to find valid IDs."),
    },
    async ({ character_id }) => {
      const character = db.prepare(`SELECT * FROM characters WHERE character_id = ?`).get(character_id);
      if (!character) {
        return errorResponse("NOT_FOUND", `Character '${character_id}' not found.`);
      }

      const traits = db.prepare(`SELECT trait FROM character_traits WHERE character_id = ?`)
        .all(character_id).map(r => r.trait);

      let notes = "";
      let supportingNotes = [];
      if (character.file_path) {
        try {
          const raw = fs.readFileSync(character.file_path, "utf8");
          const { content } = matter(raw);
          notes = content.trim();
          supportingNotes = readSupportingNotesForEntity(character.file_path);
        } catch { /* empty */ }
      }

      const result = {
        ...character,
        traits,
        notes: notes || undefined,
        supporting_notes: supportingNotes.length ? supportingNotes : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---- create_character_sheet ---------------------------------------------
  s.tool(
    "create_character_sheet",
    "Create or reuse a canonical character sheet folder with sheet.md and sheet.meta.yaml so the character can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.",
    {
      name: z.string().describe("Display name of the character (e.g. 'Mira Nystrom')."),
      project_id: z.string().optional().describe("Project scope for a book-local character (e.g. 'universe-1/book-1-the-lamb' or 'test-novel')."),
      universe_id: z.string().optional().describe("Universe scope for a cross-book shared character (e.g. 'universe-1')."),
      notes: z.string().optional().describe("Optional starter prose content for sheet.md."),
      fields: z.object({
        role: z.string().optional(),
        arc_summary: z.string().optional(),
        first_appearance: z.string().optional(),
        traits: z.array(z.string()).optional(),
      }).optional().describe("Optional starter metadata fields for the character sidecar."),
    },
    async ({ name, project_id, universe_id, notes, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot create character sheet: sync dir is read-only.");
      }
      if ((project_id && universe_id) || (!project_id && !universe_id)) {
        return errorResponse("VALIDATION_ERROR", "Provide exactly one of project_id or universe_id.");
      }

      try {
        const result = createCanonicalWorldEntity({
          kind: "character",
          name,
          notes,
          projectId: project_id,
          universeId: universe_id,
          meta: fields ?? {},
        });

        return jsonResponse({ ok: true, action: result.created ? "created" : "exists", kind: "character", ...result });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to create character sheet: ${err.message}`);
      }
    }
  );

  // ---- list_places ---------------------------------------------------------
  s.tool(
    "list_places",
    "List all indexed places with their place_id and name. Use this to find place_id values for scene filtering or to get an overview of the story's locations.",
    {
      project_id:  z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      universe_id: z.string().optional().describe("Limit to a specific universe."),
    },
    async ({ project_id, universe_id }) => {
      let query = `SELECT place_id, name, project_id, universe_id FROM places`;
      const conditions = [];
      const params = [];
      if (project_id)  { conditions.push(`project_id = ?`);  params.push(project_id); }
      if (universe_id) { conditions.push(`universe_id = ?`); params.push(universe_id); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY name";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No places found.");
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- create_place_sheet -------------------------------------------------
  s.tool(
    "create_place_sheet",
    "Create or reuse a canonical place sheet folder with sheet.md and sheet.meta.yaml so the place can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.",
    {
      name: z.string().describe("Display name of the place (e.g. 'University Hospital')."),
      project_id: z.string().optional().describe("Project scope for a book-local place (e.g. 'universe-1/book-1-the-lamb' or 'test-novel')."),
      universe_id: z.string().optional().describe("Universe scope for a cross-book shared place (e.g. 'universe-1')."),
      notes: z.string().optional().describe("Optional starter prose content for sheet.md."),
      fields: z.object({
        associated_characters: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      }).optional().describe("Optional starter metadata fields for the place sidecar."),
    },
    async ({ name, project_id, universe_id, notes, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot create place sheet: sync dir is read-only.");
      }
      if ((project_id && universe_id) || (!project_id && !universe_id)) {
        return errorResponse("VALIDATION_ERROR", "Provide exactly one of project_id or universe_id.");
      }

      try {
        const result = createCanonicalWorldEntity({
          kind: "place",
          name,
          notes,
          projectId: project_id,
          universeId: universe_id,
          meta: fields ?? {},
        });

        return jsonResponse({ ok: true, action: result.created ? "created" : "exists", kind: "place", ...result });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to create place sheet: ${err.message}`);
      }
    }
  );

  // ---- get_place_sheet -----------------------------------------------------
  s.tool(
    "get_place_sheet",
    "Get full place details: associated_characters, tags, the canonical sheet content, and any adjacent support notes when the place uses a folder-based layout. Use list_places first to get the place_id.",
    {
      place_id: z.string().describe("The place_id to look up (e.g. 'place-harbor-district'). Use list_places to find valid IDs."),
    },
    async ({ place_id }) => {
      const place = db.prepare(`SELECT * FROM places WHERE place_id = ?`).get(place_id);
      if (!place) {
        return errorResponse("NOT_FOUND", `Place '${place_id}' not found.`);
      }

      let notes = "";
      let supportingNotes = [];
      let associatedCharacters = [];
      let tags = [];

      if (place.file_path) {
        try {
          const raw = fs.readFileSync(place.file_path, "utf8");
          const { content } = matter(raw);
          notes = content.trim();
          supportingNotes = readSupportingNotesForEntity(place.file_path);

          const meta = readEntityMetadata(place.file_path);
          associatedCharacters = Array.isArray(meta.associated_characters) ? meta.associated_characters : [];
          tags = Array.isArray(meta.tags) ? meta.tags : [];
        } catch { /* empty */ }
      }

      const result = {
        ...place,
        associated_characters: associatedCharacters.length ? associatedCharacters : undefined,
        tags: tags.length ? tags : undefined,
        notes: notes || undefined,
        supporting_notes: supportingNotes.length ? supportingNotes : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---- search_metadata -----------------------------------------------------
  s.tool(
    "search_metadata",
    "Full-text search across scene titles, loglines (synopsis/logline text fields), and metadata keywords (tags/characters/places/versions). Use this when you don't know the exact scene_id or chapter but want to find scenes by topic, theme, or metadata keyword. Not a prose search — use get_scene_prose to read actual text. Supports pagination via page/page_size and auto-paginates large result sets with total_count.",
    {
      query: z.string().describe("Search terms (e.g. 'hospital' or 'Sebastian feeding'). FTS5 syntax supported."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ query, page, page_size }) => {
      let totalCount;
      try {
        totalCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM scenes_fts f
          JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
          WHERE scenes_fts MATCH ?
        `).get(query)?.count ?? 0;
      } catch (err) {
        return errorResponse("INVALID_QUERY", "Invalid search query syntax. Use plain keywords or quoted phrases.", { detail: err.message });
      }

      if (totalCount === 0) {
        return errorResponse("NO_RESULTS", "No scenes matched the search query.");
      }

      const shouldPaginate = totalCount > DEFAULT_METADATA_PAGE_SIZE || page !== undefined || page_size !== undefined;

      if (!shouldPaginate) {
        const rows = db.prepare(`
          SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.chapter_title, s.metadata_stale
          FROM scenes_fts f
          JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
          WHERE scenes_fts MATCH ?
          ORDER BY rank
        `).all(query);

        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      }

      const safePageSize = Math.max(1, page_size ?? DEFAULT_METADATA_PAGE_SIZE);
      const safePage = Math.max(1, page ?? 1);
      const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
      const normalizedPage = Math.min(safePage, totalPages);
      const offset = (normalizedPage - 1) * safePageSize;

      const rows = db.prepare(`
        SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.chapter_title, s.metadata_stale
        FROM scenes_fts f
        JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
        WHERE scenes_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(query, safePageSize, offset);

      const payload = {
        results: rows,
        total_count: totalCount,
        page: normalizedPage,
        page_size: safePageSize,
        total_pages: totalPages,
        has_next_page: normalizedPage < totalPages,
        has_prev_page: normalizedPage > 1,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- list_threads --------------------------------------------------------
  s.tool(
    "list_threads",
    "List all subplot/storyline threads for a project. Returns a structured JSON envelope with results and total_count. Use this to discover valid thread_id values before calling get_thread_arc or upsert_thread_link. Supports pagination via page/page_size.",
    {
      project_id: z.string().describe("Project ID."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ project_id, page, page_size }) => {
      const rows = db.prepare(`SELECT * FROM threads WHERE project_id = ? ORDER BY name`).all(project_id);
      const paged = paginateRows(rows, { page, pageSize: page_size, forcePagination: false });
      const payload = paged.paginated
        ? {
            project_id,
            results: paged.rows,
            ...paged.meta,
          }
        : {
            project_id,
            results: rows,
            total_count: rows.length,
          };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- get_thread_arc ------------------------------------------------------
  s.tool(
    "get_thread_arc",
    "Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat. Returns a structured JSON envelope with thread metadata, results, and total_count. Use list_threads first to find a valid thread_id, then call get_scene_prose for close reading of specific scenes. Supports pagination via page/page_size.",
    {
      thread_id: z.string().describe("Thread ID."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ thread_id, page, page_size }) => {
      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      if (!thread) {
        return errorResponse("NOT_FOUND", `Thread '${thread_id}' not found. Hint: call list_threads with project_id to get valid thread IDs.`);
      }

      const rows = db.prepare(`
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.chapter_title, s.title, s.logline,
               st.beat AS thread_beat, s.timeline_position, s.story_time, s.metadata_stale
        FROM scenes s
        JOIN scene_threads st ON st.scene_id = s.scene_id AND st.thread_id = ?
        ORDER BY s.part, s.chapter, s.timeline_position
      `).all(thread_id);
      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0 ? `${staleCount} scene(s) have stale metadata.` : undefined;
      const paged = paginateRows(rows, { page, pageSize: page_size, forcePagination: false });

      const payload = paged.paginated
        ? {
            thread,
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : {
            thread,
            results: rows,
            total_count: rows.length,
            warning,
          };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- upsert_thread_link ---------------------------------------------------
  s.tool(
    "upsert_thread_link",
    "Create or update a thread and link it to a scene. Idempotent: if the link already exists, updates its beat. Only available when the sync dir is writable.",
    {
      project_id: z.string().describe("Project the thread belongs to (e.g. 'the-lamb')."),
      thread_id: z.string().describe("Thread ID (e.g. 'thread-reconciliation')."),
      thread_name: z.string().describe("Thread display name."),
      scene_id: z.string().describe("Scene to link to the thread (e.g. 'sc-011-sebastian')."),
      beat: z.string().optional().describe("Optional thread-specific beat label for this scene."),
      status: z.string().optional().describe("Thread status (e.g. 'active', 'resolved'). Defaults to 'active'."),
    },
    async ({ project_id, thread_id, thread_name, scene_id, beat, status }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot write thread links: sync dir is read-only.");
      }

      const existingThread = db.prepare(`SELECT thread_id, project_id FROM threads WHERE thread_id = ?`).get(thread_id);
      if (existingThread && existingThread.project_id !== project_id) {
        return errorResponse(
          "CONFLICT",
          `Thread '${thread_id}' already exists in project '${existingThread.project_id}', cannot reuse it for project '${project_id}'.`
        );
      }

      const scene = db.prepare(`SELECT scene_id FROM scenes WHERE scene_id = ? AND project_id = ?`).get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      db.prepare(`
        INSERT INTO threads (thread_id, project_id, name, status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (thread_id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status
      `).run(thread_id, project_id, thread_name, status ?? "active");

      db.prepare(`
        INSERT INTO scene_threads (scene_id, thread_id, beat)
        VALUES (?, ?, ?)
        ON CONFLICT (scene_id, thread_id) DO UPDATE SET
          beat = excluded.beat
      `).run(scene_id, thread_id, beat ?? null);

      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      const link = db.prepare(`SELECT scene_id, thread_id, beat FROM scene_threads WHERE scene_id = ? AND thread_id = ?`)
        .get(scene_id, thread_id);

      return jsonResponse({
        ok: true,
        action: "upserted",
        thread,
        link,
      });
    }
  );

  // ---- enrich_scene --------------------------------------------------------
  s.tool(
    "enrich_scene",
    "Re-derive lightweight scene metadata from current prose (logline and character mentions) and clear metadata_stale for that scene. Only available when the sync dir is writable.",
    {
      scene_id: z.string().describe("Scene to enrich (e.g. 'sc-011-sebastian')."),
      project_id: z.string().optional().describe("Project ID. Required when scene_id is duplicated across projects."),
    },
    async ({ scene_id, project_id }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot enrich scene: sync dir is read-only.");
      }

      let scene;
      if (project_id) {
        scene = db.prepare(`SELECT scene_id, project_id, file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
          .get(scene_id, project_id);
      } else {
        const matches = db.prepare(`SELECT scene_id, project_id, file_path FROM scenes WHERE scene_id = ?`).all(scene_id);
        if (matches.length > 1) {
          return errorResponse("VALIDATION_ERROR", `Scene '${scene_id}' exists in multiple projects. Provide project_id.`);
        }
        scene = matches[0];
      }

      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found${project_id ? ` in project '${project_id}'` : ""}.`);
      }

      try {
        const raw = fs.readFileSync(scene.file_path, "utf8");
        const { content: prose } = matter(raw);
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });

        const inferredLogline = deriveLoglineFromProse(prose);
        const inferredCharacters = inferCharacterIdsFromProse(db, prose, scene.project_id);

        const updatedMeta = normalizeSceneMetaForPath(SYNC_DIR, scene.file_path, {
          ...meta,
          ...(inferredLogline ? { logline: inferredLogline } : {}),
          ...((inferredCharacters.length > 0 || (meta.characters?.length ?? 0) > 0)
            ? { characters: inferredCharacters.length > 0 ? inferredCharacters : meta.characters }
            : {}),
        }).meta;

        writeMeta(scene.file_path, updatedMeta);
        indexSceneFile(db, SYNC_DIR, scene.file_path, updatedMeta, prose);
        db.prepare(`UPDATE scenes SET metadata_stale = 0 WHERE scene_id = ? AND project_id = ?`)
          .run(scene.scene_id, scene.project_id);

        return jsonResponse({
          ok: true,
          action: "enriched",
          scene_id: scene.scene_id,
          project_id: scene.project_id,
          updated_fields: {
            logline: Boolean(inferredLogline),
            characters: inferredCharacters.length,
          },
          metadata_stale: false,
        });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to enrich scene '${scene.scene_id}': ${err.message}`);
      }
    }
  );

  // ---- update_scene_metadata -----------------------------------------------
  s.tool(
    "update_scene_metadata",
    "Update one or more metadata fields for a scene. Writes to the .meta.yaml sidecar — never modifies prose. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      scene_id:   z.string().describe("The scene_id to update (e.g. 'sc-011-sebastian')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      fields: z.object({
        title:             z.string().optional(),
        logline:           z.string().optional(),
        status:            z.string().optional().describe("Workflow status (e.g. 'draft', 'revision', 'complete'). Free text — no fixed vocabulary."),
        save_the_cat_beat: z.string().optional(),
        pov:               z.string().optional(),
        part:              z.number().int().optional(),
        chapter:           z.number().int().optional(),
        timeline_position: z.number().int().optional(),
        story_time:        z.string().optional(),
        tags:              z.array(z.string()).optional(),
        characters:        z.array(z.string()).optional(),
        places:            z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ scene_id, project_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update metadata: sync dir is read-only.");
      }
      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }
      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const updated = normalizeSceneMetaForPath(SYNC_DIR, scene.file_path, { ...meta, ...fields }).meta;
        writeMeta(scene.file_path, updated);

        // Re-index the scene immediately so the DB reflects the new metadata
        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        indexSceneFile(db, SYNC_DIR, scene.file_path, updated, prose);

        return { content: [{ type: "text", text: `Updated metadata for scene '${scene_id}'.` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write metadata for scene '${scene_id}': ${err.message}`);
      }
    }
  );

  // ---- update_character_sheet ----------------------------------------------
  s.tool(
    "update_character_sheet",
    "Update structured metadata fields for a character (role, arc_summary, traits, etc). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      character_id: z.string().describe("The character_id to update (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs."),
      fields: z.object({
        name:             z.string().optional(),
        role:             z.string().optional(),
        arc_summary:      z.string().optional(),
        first_appearance: z.string().optional(),
        traits:           z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ character_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update character: sync dir is read-only.");
      }
      const char = db.prepare(`SELECT file_path FROM characters WHERE character_id = ?`).get(character_id);
      if (!char) {
        return errorResponse("NOT_FOUND", `Character '${character_id}' not found.`);
      }
      try {
        const { meta } = readMeta(char.file_path, SYNC_DIR, { writable: true });
        const updated = { ...meta, ...fields };
        writeMeta(char.file_path, updated);

        // Update DB directly
        db.prepare(`
          UPDATE characters SET name = ?, role = ?, arc_summary = ?, first_appearance = ?
          WHERE character_id = ?
        `).run(
          updated.name ?? meta.name, updated.role ?? null,
          updated.arc_summary ?? null, updated.first_appearance ?? null,
          character_id
        );
        if (fields.traits) {
          db.prepare(`DELETE FROM character_traits WHERE character_id = ?`).run(character_id);
          for (const t of fields.traits) {
            db.prepare(`INSERT OR IGNORE INTO character_traits (character_id, trait) VALUES (?, ?)`).run(character_id, t);
          }
        }

        return { content: [{ type: "text", text: `Updated character sheet for '${character_id}'.` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Character file for '${character_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: char.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write character metadata for '${character_id}': ${err.message}`);
      }
    }
  );

  // ---- update_place_sheet --------------------------------------------------
  s.tool(
    "update_place_sheet",
    "Update structured metadata fields for a place (name, associated_characters, tags). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      place_id: z.string().describe("The place_id to update (e.g. 'place-harbor-district'). Use list_places to find valid IDs."),
      fields: z.object({
        name:                  z.string().optional(),
        associated_characters: z.array(z.string()).optional(),
        tags:                  z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ place_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update place: sync dir is read-only.");
      }
      const place = db.prepare(`SELECT file_path FROM places WHERE place_id = ?`).get(place_id);
      if (!place) {
        return errorResponse("NOT_FOUND", `Place '${place_id}' not found.`);
      }
      try {
        const { meta } = readMeta(place.file_path, SYNC_DIR, { writable: true });
        const updated = { ...meta, ...fields };
        writeMeta(place.file_path, updated);

        // Update DB directly
        db.prepare(`UPDATE places SET name = ? WHERE place_id = ?`)
          .run(updated.name ?? meta.name ?? place_id, place_id);

        return { content: [{ type: "text", text: `Updated place sheet for '${place_id}'.` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Place file for '${place_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: place.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write place metadata for '${place_id}': ${err.message}`);
      }
    }
  );

  // ---- flag_scene ----------------------------------------------------------
  s.tool(
    "flag_scene",
    "Attach a continuity or review note to a scene. Flags are appended to the sidecar file and accumulate over time — they are never overwritten. Use this to record continuity problems, revision notes, or questions you want to revisit.",
    {
      scene_id:   z.string().describe("The scene_id to flag (e.g. 'sc-012-open-to-anyone')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      note:       z.string().describe("The flag note (e.g. 'Victor knows Mira\u2019s name here, but they haven\u2019t been introduced yet \u2014 contradicts sc-006')."),
    },
    async ({ scene_id, project_id, note }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot flag scene: sync dir is read-only.");
      }
      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }
      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const flags = meta.flags ?? [];
        flags.push({ note, flagged_at: new Date().toISOString() });
        writeMeta(scene.file_path, { ...meta, flags });
        return { content: [{ type: "text", text: `Flagged scene '${scene_id}': ${note}` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to flag scene '${scene_id}': ${err.message}`);
      }
    }
  );

  // ---- get_relationship_arc ------------------------------------------------
  s.tool(
    "get_relationship_arc",
    "Show how the relationship between two characters evolves across scenes, in order. Uses explicitly recorded relationship entries — returns nothing if no entries exist yet. Use list_characters to get character_id values.",
    {
      from_character: z.string().describe("character_id of the first character (e.g. 'char-sebastian')."),
      to_character:   z.string().describe("character_id of the second character (e.g. 'char-mira-nystrom')."),
      project_id:     z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
    },
    async ({ from_character, to_character, project_id }) => {
      let query = `
        SELECT r.from_character, r.to_character, r.relationship_type, r.strength,
               r.scene_id, r.note,
               s.part, s.chapter, s.chapter_title, s.timeline_position, s.title AS scene_title
        FROM character_relationships r
        LEFT JOIN scenes s ON s.scene_id = r.scene_id
        WHERE r.from_character = ? AND r.to_character = ?
      `;
      const params = [from_character, to_character];
      if (project_id) { query += ` AND (s.project_id = ? OR r.scene_id IS NULL)`; params.push(project_id); }
      query += ` ORDER BY s.part, s.chapter, s.timeline_position`;

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", `No relationship data found between '${from_character}' and '${to_character}'.`);
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- PHASE 3: Prose Editing (git-backed) --------------------------------

  // ---- propose_edit --------------------------------------------------------
  s.tool(
    "propose_edit",
    "Generate a proposed revision for a scene. Returns a proposal_id and a diff preview. Nothing is written yet — you must call commit_edit to apply the change. This tool requires git to be available.",
    {
      scene_id: z.string().describe("The scene_id to revise (e.g. 'sc-011-sebastian')."),
      instruction: z.string().describe("A brief instruction for the edit (e.g. 'Tighten the opening paragraph'). Used in the git commit message."),
      revised_prose: z.string().describe("The complete revised prose text for the scene."),
    },
    async ({ scene_id, instruction, revised_prose }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — prose editing is not supported. Ensure git is installed and the sync directory is writable.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found. Hint: call find_scenes to get valid scene IDs.`);
      }

      try {
        // Read current prose
        const raw = fs.readFileSync(scene.file_path, "utf8");
        const { data: metadata, content: currentProse } = matter(raw);

        // Generate a simple diff representation
        const currentLines = currentProse.trim().split("\n");
        const revisedLines = revised_prose.trim().split("\n");
        const diffLines = [];
        const maxLines = Math.max(currentLines.length, revisedLines.length);

        // Simple line-by-line diff
        for (let i = 0; i < Math.min(3, maxLines); i++) {
          const curr = currentLines[i] || "(removed)";
          const rev = revisedLines[i] || "(removed)";
          if (curr !== rev) {
            diffLines.push(`- ${curr.substring(0, 80)}`);
            diffLines.push(`+ ${rev.substring(0, 80)}`);
          }
        }
        if (maxLines > 3) {
          diffLines.push(`... (${maxLines - 3} more lines)`);
        }

        const proposalId = generateProposalId();
        pendingProposals.set(proposalId, {
          scene_id,
          scene_file_path: scene.file_path,
          instruction,
          revised_prose,
          original_prose: currentProse,
          metadata,
          created_at: new Date().toISOString(),
        });

        const summary = {
          proposal_id: proposalId,
          scene_id,
          instruction,
          diff_preview: diffLines.join("\n"),
          note: "Review the diff above. Call commit_edit with this proposal_id to apply the change.",
        };

        return jsonResponse(summary);
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to read scene file: ${err.message}`);
      }
    }
  );

  // ---- commit_edit ---------------------------------------------------------
  s.tool(
    "commit_edit",
    "Apply a proposed edit and commit it to git. First creates a pre-edit snapshot, then writes the revised prose and metadata back to disk. The scene metadata stale flag is cleared.",
    {
      scene_id: z.string().describe("The scene_id being revised."),
      proposal_id: z.string().describe("The proposal_id returned by propose_edit."),
    },
    async ({ scene_id, proposal_id }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — prose editing is not supported.");
      }

      const proposal = pendingProposals.get(proposal_id);
      if (!proposal) {
        return errorResponse("PROPOSAL_NOT_FOUND", `Proposal '${proposal_id}' not found or has expired. Hint: call propose_edit again to create a fresh proposal_id.`);
      }

      if (proposal.scene_id !== scene_id) {
        return errorResponse("INVALID_EDIT", `Proposal '${proposal_id}' is for scene '${proposal.scene_id}', not '${scene_id}'.`);
      }

      try {
        const proseWriteDiagnostics = getFileWriteDiagnostics(proposal.scene_file_path);
        if (proseWriteDiagnostics.stat_error_code === "EACCES" || proseWriteDiagnostics.stat_error_code === "EPERM") {
          return errorResponse(
            "PROSE_FILE_NOT_WRITABLE",
            "Scene prose file cannot be accessed by the current runtime user.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        if (proseWriteDiagnostics.stat_error_code && proseWriteDiagnostics.stat_error_code !== "ENOENT" && proseWriteDiagnostics.stat_error_code !== "ENOTDIR") {
          return errorResponse(
            "IO_ERROR",
            "Failed to inspect scene prose path before writing.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        if (!proseWriteDiagnostics.exists) {
          return errorResponse("STALE_PATH", "Prose file not found at indexed path.", {
            indexed_path: proposal.scene_file_path,
            prose_write_diagnostics: proseWriteDiagnostics,
          });
        }

        if (!proseWriteDiagnostics.is_file) {
          return errorResponse("INVALID_PROSE_PATH", "Indexed prose path is not a regular file.", {
            indexed_path: proposal.scene_file_path,
            prose_write_diagnostics: proseWriteDiagnostics,
          });
        }

        if (!proseWriteDiagnostics.writable) {
          return errorResponse(
            "PROSE_FILE_NOT_WRITABLE",
            "Scene prose file is not writable by the current runtime user.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        // Reconstruct file content, preserving frontmatter only if the original had it
        const hasFrontmatter = proposal.metadata && Object.keys(proposal.metadata).length > 0;
        const content = hasFrontmatter
          ? `---\n${yaml.dump(proposal.metadata)}---\n\n${proposal.revised_prose}\n`
          : `${proposal.revised_prose}\n`;

        // Create pre-edit snapshot (commits current state before overwriting)
        const snapshot = createSnapshot(SYNC_DIR, proposal.scene_file_path, scene_id, proposal.instruction);

        // Write the revised prose to disk
        fs.writeFileSync(proposal.scene_file_path, content, "utf8");

        // Re-index using canonical metadata (sidecar takes precedence over inline frontmatter)
        const { meta: canonicalMeta } = readMeta(proposal.scene_file_path, SYNC_DIR, { writable: false });
        const { content: newProse } = matter(content);
        indexSceneFile(db, SYNC_DIR, proposal.scene_file_path, canonicalMeta, newProse);

        // Clean up the proposal
        pendingProposals.delete(proposal_id);

        const result = {
          ok: true,
          scene_id,
          proposal_id,
          snapshot_commit: snapshot.commit_hash,
          message: `Committed edit for scene '${scene_id}'${snapshot.commit_hash ? ` (snapshot: ${snapshot.commit_hash.substring(0, 7)})` : " (no changes to snapshot)"}`,
        };

        return jsonResponse(result);
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file not found at indexed path.`, { indexed_path: proposal.scene_file_path });
        }
        return errorResponse("IO_ERROR", `Failed to commit edit: ${err.message}`);
      }
    }
  );

  // ---- discard_edit --------------------------------------------------------
  s.tool(
    "discard_edit",
    "Discard a pending proposal without applying it. The proposal is deleted and the prose remains unchanged.",
    {
      proposal_id: z.string().describe("The proposal_id to discard (from propose_edit)."),
    },
    async ({ proposal_id }) => {
      const proposal = pendingProposals.get(proposal_id);
      if (!proposal) {
        return errorResponse("PROPOSAL_NOT_FOUND", `Proposal '${proposal_id}' not found or has already been discarded.`);
      }

      pendingProposals.delete(proposal_id);
      return jsonResponse({
        ok: true,
        proposal_id,
        message: `Discarded proposal '${proposal_id}' for scene '${proposal.scene_id}'.`,
      });
    }
  );

  // ---- snapshot_scene -------------------------------------------------------
  s.tool(
    "snapshot_scene",
    "Manually create a git commit (snapshot) for the current state of a scene. Use this to mark important editing checkpoints outside of the propose/commit workflow.",
    {
      scene_id: z.string().describe("The scene_id to snapshot."),
      project_id: z.string().describe("Project the scene belongs to."),
      reason: z.string().describe("A brief reason for the snapshot (e.g. 'Character arc milestone reached')."),
    },
    async ({ scene_id, project_id, reason }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — snapshots cannot be created.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      try {
        const snapshot = createSnapshot(SYNC_DIR, scene.file_path, scene_id, reason);
        if (!snapshot.commit_hash) {
          return jsonResponse({
            ok: true,
            scene_id,
            reason,
            message: "No changes to snapshot.",
          });
        }

        return jsonResponse({
          ok: true,
          scene_id,
          reason,
          commit_hash: snapshot.commit_hash,
          message: `Created snapshot for scene '${scene_id}': ${reason}`,
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file not found at indexed path.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to create snapshot: ${err.message}`);
      }
    }
  );

  // ---- list_snapshots -------------------------------------------------------
  s.tool(
    "list_snapshots",
    "List git commit history for a scene, with timestamps and commit messages. Use this to find commit hashes for get_scene_prose historical retrieval.",
    {
      scene_id: z.string().describe("The scene_id to list snapshots for."),
    },
    async ({ scene_id }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — snapshots cannot be retrieved.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found.`);
      }

      try {
        const snapshots = listSnapshots(SYNC_DIR, scene.file_path);
        if (!snapshots || snapshots.length === 0) {
          return errorResponse("NO_RESULTS", `No snapshots found for scene '${scene_id}'. Try editing and committing the scene first.`);
        }

        return jsonResponse({
          scene_id,
          snapshots: snapshots.map(s => ({
            commit_hash: s.commit_hash,
            short_hash: s.commit_hash.substring(0, 7),
            timestamp: s.timestamp,
            message: s.message,
          })),
          note: "Use the commit_hash values with get_scene_prose(scene_id, commit) to retrieve a past version.",
        });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to list snapshots: ${err.message}`);
      }
    }
  );

  return s;
}

// ---------------------------------------------------------------------------
// Transport startup
// ---------------------------------------------------------------------------
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT ?? "http").trim().toLowerCase();

if (MCP_TRANSPORT === "stdio") {
  const stdioServer = createMcpServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  process.stderr.write("[mcp-writing] Running in stdio transport mode\n");
} else {
  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------
  const activeSessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/sse") {
      const transport = new SSEServerTransport("/message", res);
      const sessionId = transport.sessionId;

      const existing = activeSessions.get(sessionId);
      if (existing) {
        try { await existing.transport.close(); } catch { /* empty */ }
        try { await existing.server.close(); } catch { /* empty */ }
        activeSessions.delete(sessionId);
      }

      const sessionServer = createMcpServer();
      activeSessions.set(sessionId, { transport, server: sessionServer });
      res.on("close", () => activeSessions.delete(sessionId));

      await sessionServer.connect(transport);
      process.stderr.write(`[mcp-writing] SSE client connected (session=${sessionId})\n`);
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/message")) {
      const url = new URL(req.url, `http://localhost`);
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? activeSessions.get(sessionId) : null;
      if (!session) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Session not found");
        return;
      }
      await session.transport.handlePostMessage(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  httpServer.listen(HTTP_PORT, () => {
    process.stderr.write(`[mcp-writing] Listening on port ${HTTP_PORT}\n`);
  });
}

// Register after transport setup so signal handlers can reference asyncJobs.
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => void gracefulShutdown("SIGINT"));
