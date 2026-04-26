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
import { openDb } from "./db.js";
import { syncAll, isSyncDirWritable, getSyncOwnershipDiagnostics, sidecarPath, isStructuralProjectId } from "./sync.js";
import { isGitAvailable, isGitRepository, initGitRepository, getSceneProseAtCommit } from "./git.js";
import { renderCharacterArcTemplate, renderCharacterSheetTemplate, renderPlaceSheetTemplate, slugifyEntityName } from "./world-entity-templates.js";
import { ASYNC_PROGRESS_PREFIX } from "./async-progress.js";
import { STYLEGUIDE_CONFIG_BASENAME } from "./prose-styleguide.js";
import { ReviewBundlePlanError } from "./review-bundles.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerSearchTools } from "./tools/search.js";
import { registerMetadataTools } from "./tools/metadata.js";
import { registerReviewBundleTools } from "./tools/review-bundles.js";
import { registerStyleguideTools } from "./tools/styleguide.js";
import { registerEditingTools } from "./tools/editing.js";

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

// Like isPathInsideSyncDir, but works for paths that do not yet exist by
// walking up to the nearest existing ancestor before canonicalising.
function isPathCandidateInsideSyncDir(candidatePath) {
  const resolvedCandidate = path.resolve(candidatePath);

  let existingAncestor = resolvedCandidate;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }

  const canonicalBase = (() => {
    try {
      return fs.realpathSync(existingAncestor);
    } catch {
      return existingAncestor;
    }
  })();

  const canonical = path.resolve(canonicalBase, path.relative(existingAncestor, resolvedCandidate));
  const rel = path.relative(SYNC_DIR_REAL, canonical);
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function resolveOutputDirWithinSync(outputDir) {
  let resolvedOutputDir = path.resolve(outputDir);
  let existingAncestor = resolvedOutputDir;

  while (!fs.existsSync(existingAncestor)) {
    const parentDir = path.dirname(existingAncestor);
    if (parentDir === existingAncestor) {
      throw new ReviewBundlePlanError(
        "INVALID_OUTPUT_DIR",
        "output_dir must be inside WRITING_SYNC_DIR.",
        { output_dir: resolvedOutputDir, sync_dir: SYNC_DIR_ABS }
      );
    }
    existingAncestor = parentDir;
  }

  let realExistingAncestor;
  try {
    realExistingAncestor = fs.realpathSync.native(existingAncestor);
  } catch (err) {
    throw new ReviewBundlePlanError(
      "INVALID_OUTPUT_DIR",
      "output_dir ancestor could not be resolved: path may be inaccessible.",
      { output_dir: outputDir, existing_ancestor: existingAncestor, cause: err.message }
    );
  }
  const relativeFromAncestor = path.relative(existingAncestor, resolvedOutputDir);
  resolvedOutputDir = path.resolve(realExistingAncestor, relativeFromAncestor);

  const relativeToSyncDir = path.relative(SYNC_DIR_REAL, resolvedOutputDir);
  if (relativeToSyncDir.startsWith("..") || path.isAbsolute(relativeToSyncDir)) {
    throw new ReviewBundlePlanError(
      "INVALID_OUTPUT_DIR",
      "output_dir must be inside WRITING_SYNC_DIR.",
      { output_dir: resolvedOutputDir, sync_dir: SYNC_DIR_ABS }
    );
  }

  return { resolvedOutputDir, relativeToSyncDir };
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
const pkg = readJsonIfExists(path.join(__dirname, "package.json")) ?? {};
const MCP_SERVER_VERSION = typeof pkg.version === "string" && pkg.version.trim()
  ? pkg.version
  : "0.0.0";
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
function generateProposalId() {
  return `proposal-${randomUUID()}`;
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

function maxScenesNextStep(matchedCount) {
  return `Re-run with max_scenes set to at least ${matchedCount}.`;
}

const WORKFLOW_CATALOGUE = [
  {
    id: "first_time_setup",
    label: "First-time setup",
    use_when: "Connecting to a project for the first time or verifying the runtime is correctly configured.",
    steps: [
      { tool: "get_runtime_config", note: "Verify sync dir, writability, and git availability." },
      { tool: "sync", note: "Index scenes from disk." },
    ],
  },
  {
    id: "styleguide_setup_new",
    label: "Styleguide setup (new project)",
    use_when: "No prose styleguide config exists and you want to create one based on the manuscript's existing conventions.",
    steps: [
      { tool: "describe_workflows", note: "Check context.scene_count; use that value as max_scenes in the next call." },
      { tool: "bootstrap_prose_styleguide_config", note: "Detect dominant conventions. Confirm suggestions with the user before applying." },
      { tool: "setup_prose_styleguide_config", note: "Only if ALL context.styleguide_exists fields are false — a config at any scope is sufficient. Create at project_root scope (requires project_id and language e.g. 'english_us'), or sync_root if no project_id is known." },
      { tool: "update_prose_styleguide_config", note: "Apply the fields accepted from bootstrap suggestions." },
    ],
  },
  {
    id: "styleguide_drift_check",
    label: "Styleguide drift check",
    use_when: "A styleguide config exists and you want to check whether recent scenes conform to it.",
    steps: [
      { tool: "get_prose_styleguide_config", note: "Confirm the currently resolved config." },
      { tool: "check_prose_styleguide_drift", note: "Detect non-conforming scenes. Pass project_id from context.project_id and set max_scenes from context.scene_count." },
      { tool: "update_prose_styleguide_config", note: "If drift found and user approves, update config or note the outliers." },
    ],
  },
  {
    id: "manuscript_exploration",
    label: "Manuscript exploration",
    use_when: "Answering questions about the manuscript, finding scenes, or getting an overview.",
    steps: [
      { tool: "find_scenes", note: "Filter by character, beat, tag, part, chapter, or POV. No filters returns all scenes." },
      { tool: "get_scene_prose", note: "Load prose for specific scenes identified by find_scenes." },
      { tool: "get_chapter_prose", note: "Load all prose for a chapter. Use sparingly — large chapters can overflow context." },
      { tool: "search_metadata", note: "Full-text search across scene metadata fields." },
    ],
  },
  {
    id: "prose_editing",
    label: "Prose editing",
    use_when: "Revising scene prose. All edits require explicit user confirmation before writing.",
    steps: [
      { tool: "find_scenes", note: "Identify the target scene." },
      { tool: "get_scene_prose", note: "Load the current prose." },
      { tool: "propose_edit", note: "Stage a revision; returns a diff preview and a proposal_id." },
      { tool: "commit_edit", note: "Write the revision after the user confirms. Runs preflight checks before writing." },
      { tool: "discard_edit", note: "Reject the revision if the user does not approve." },
    ],
  },
  {
    id: "character_management",
    label: "Character management",
    use_when: "Finding characters, reading their sheets, or updating character details.",
    steps: [
      { tool: "list_characters", note: "Find character_id values." },
      { tool: "get_character_sheet", note: "Read full character details." },
      { tool: "create_character_sheet", note: "Create a new character. Requires exactly one of project_id or universe_id." },
      { tool: "update_character_sheet", note: "Edit character metadata." },
    ],
  },
  {
    id: "place_management",
    label: "Place management",
    use_when: "Finding locations, reading place sheets, or updating place details.",
    steps: [
      { tool: "list_places", note: "Find place_id values." },
      { tool: "get_place_sheet", note: "Read full place details." },
      { tool: "create_place_sheet", note: "Create a new place. Requires exactly one of project_id or universe_id." },
      { tool: "update_place_sheet", note: "Edit place metadata." },
    ],
  },
  {
    id: "review_bundle",
    label: "Review bundle",
    use_when: "Preparing a formatted bundle for human review (outline, editorial, or beta read profile).",
    steps: [
      { tool: "preview_review_bundle", note: "Check which scenes would be included and the estimated size. Requires project_id and profile." },
      { tool: "create_review_bundle", note: "Generate the bundle. Requires project_id." },
    ],
  },
  {
    id: "async_job_tracking",
    label: "Async job tracking",
    use_when: "A tool returned a job_id instead of an immediate result (e.g. import_scrivener_sync_async).",
    steps: [
      { tool: "get_async_job_status", note: "Poll with the job_id until status is 'completed' or 'failed'." },
      { tool: "sync", note: "Call after a completed job that modified files on disk." },
    ],
  },
];

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
function createMcpServer() {
  const s = new McpServer({ name: "mcp-writing", version: MCP_SERVER_VERSION });

  // ---- describe_workflows --------------------------------------------------
  s.tool(
    "describe_workflows",
    "Return a map of available task workflows and the current project context. Call this at the start of a session or whenever you are unsure what to do next. Never write scripts to invoke tools — call them directly.",
    {},
    async () => {
      const projectRow = db.prepare(
        `SELECT project_id FROM scenes GROUP BY project_id ORDER BY COUNT(*) DESC, project_id ASC LIMIT 1`
      ).get();
      // Suppress structural-dir names (e.g. "scenes") that appear when SYNC_DIR points at the
      // project directory itself rather than the universe root. They are path artifacts, not
      // real project identifiers. Only suppress when no real project directory exists at that
      // path, so a project intentionally named "scenes" (though inadvisable) is still honoured.
      const rawProjectId = projectRow?.project_id ?? null;
      const rawProjectRootPath = rawProjectId ? resolveProjectRoot(rawProjectId) : null;
      const project_id = (
        isStructuralProjectId(rawProjectId) && !fs.existsSync(rawProjectRootPath)
      ) ? null : rawProjectId;

      const sceneCountRow = db.prepare(`SELECT COUNT(*) as count FROM scenes`).get();
      const scene_count = sceneCountRow?.count ?? 0;

      const syncRootConfigPath = path.join(SYNC_DIR, STYLEGUIDE_CONFIG_BASENAME);
      const projectRootConfigPath = project_id
        ? path.join(resolveProjectRoot(project_id), STYLEGUIDE_CONFIG_BASENAME)
        : null;
      const universeSegment = project_id?.includes("/") ? project_id.split("/")[0] : null;
      const universeRootConfigPath = universeSegment
        ? path.join(SYNC_DIR, "universes", universeSegment, STYLEGUIDE_CONFIG_BASENAME)
        : null;

      const syncRootExists = fs.existsSync(syncRootConfigPath);
      const universeRootExists = universeRootConfigPath !== null && fs.existsSync(universeRootConfigPath);
      const projectRootExists = projectRootConfigPath !== null && fs.existsSync(projectRootConfigPath);

      return jsonResponse({
        ok: true,
        context: {
          project_id,
          scene_count,
          sync_dir: SYNC_DIR_ABS,
          styleguide_exists: {
            sync_root: syncRootExists,
            universe_root: universeRootExists,
            project_root: projectRootExists,
          },
          git_available: GIT_AVAILABLE,
          pending_proposals: pendingProposals.size,
        },
        workflows: WORKFLOW_CATALOGUE,
        notes: [
          "Never write JavaScript or shell scripts to invoke tools. Call them directly.",
          "If a tool returns a next_step field (in a success or error response), follow it before trying anything else.",
          "Use find_scenes without filters to discover what project_ids are indexed.",
          "When calling bootstrap_prose_styleguide_config or check_prose_styleguide_drift, set max_scenes to context.scene_count to avoid the default limit.",
          "Styleguide tools resolve config in priority order: project_root > universe_root > sync_root. If any styleguide_exists field is true, a config exists and styleguide tools will work — do not run setup_prose_styleguide_config unless ALL styleguide_exists fields are false.",
        ],
      });
    }
  );

  // Passed to each tool registration module (tools/*.js) to thread state and
  // shared helpers without circular imports. Grows as groups are extracted.
  const toolContext = {
    db,
    SYNC_DIR,
    SYNC_DIR_ABS,
    SYNC_DIR_REAL,
    SYNC_DIR_WRITABLE,
    GIT_ENABLED,
    asyncJobs,
    errorResponse,
    jsonResponse,
    validateRegexPatterns,
    startAsyncJob,
    pruneAsyncJobs,
    toPublicJob,
    resolveProjectRoot,
    resolveBatchTargetScenes,
    maxScenesNextStep,
    isPathInsideSyncDir,
    deriveLoglineFromProse,
    inferCharacterIdsFromProse,
    paginateRows,
    DEFAULT_METADATA_PAGE_SIZE,
    MAX_CHAPTER_SCENES,
    getSceneProseAtCommit,
    readSupportingNotesForEntity,
    readEntityMetadata,
    createCanonicalWorldEntity,
    resolveOutputDirWithinSync,
    isPathCandidateInsideSyncDir,
    pendingProposals,
    generateProposalId,
  };
  registerSyncTools(s, toolContext);
  registerSearchTools(s, toolContext);
  registerMetadataTools(s, toolContext);
  registerReviewBundleTools(s, toolContext);
  registerStyleguideTools(s, toolContext);
  registerEditingTools(s, toolContext);

  // ---- get_runtime_config --------------------------------------------------
  s.tool(
    "get_runtime_config",
    "Show the active runtime paths and capabilities for this server instance (server version, sync dir, database path, writability, permission diagnostics, and git availability). Use this to verify which manuscript location is currently connected.",
    {},
    async () => {
      return jsonResponse({
        server_version: MCP_SERVER_VERSION,
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

  // ---- prose styleguide ---------------------------------------------------
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
