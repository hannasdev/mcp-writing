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
import { syncAll, isSyncDirWritable, getSyncOwnershipDiagnostics, getFileWriteDiagnostics, readMeta, indexSceneFile, sidecarPath, isStructuralProjectId } from "./sync.js";
import { isGitAvailable, isGitRepository, initGitRepository, createSnapshot, listSnapshots, getSceneProseAtCommit } from "./git.js";
import { renderCharacterArcTemplate, renderCharacterSheetTemplate, renderPlaceSheetTemplate, slugifyEntityName } from "./world-entity-templates.js";
import { validateProjectId } from "./importer.js";
import { ASYNC_PROGRESS_PREFIX } from "./async-progress.js";
import {
  STYLEGUIDE_CONFIG_BASENAME,
  STYLEGUIDE_ENUMS,
  buildStyleguideConfigDraft,
  previewStyleguideConfigUpdate,
  resolveStyleguideConfig,
  summarizeStyleguideConfig,
  updateStyleguideConfig,
} from "./prose-styleguide.js";
import {
  detectStyleguideSignals,
  analyzeSceneStyleguideDrift,
  suggestStyleguideUpdatesFromScenes,
} from "./prose-styleguide-drift.js";
import {
  PROSE_STYLEGUIDE_SKILL_BASENAME,
  PROSE_STYLEGUIDE_SKILL_DIRNAME,
  buildProseStyleguideSkill,
} from "./prose-styleguide-skill.js";
import { ReviewBundlePlanError } from "./review-bundles.js";
import { registerSyncTools } from "./tools/sync.js";
import { registerSearchTools } from "./tools/search.js";
import { registerMetadataTools } from "./tools/metadata.js";
import { registerReviewBundleTools } from "./tools/review-bundles.js";

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
  };
  registerSyncTools(s, toolContext);
  registerSearchTools(s, toolContext);
  registerMetadataTools(s, toolContext);
  registerReviewBundleTools(s, toolContext);

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
  s.tool(
    "setup_prose_styleguide_config",
    "Create prose-styleguide.config.yaml at sync root or project root using language defaults plus optional explicit overrides.",
    {
      scope: z.enum(["sync_root", "project_root"]).optional().describe("Config write target scope. Defaults to project_root when project_id is supplied, otherwise sync_root."),
      project_id: z.string().optional().describe("Project ID when writing project_root config (e.g. 'the-lamb' or 'universe-1/book-1')."),
      language: z.enum(STYLEGUIDE_ENUMS.language).describe("Primary writing language. Seeds language-specific defaults."),
      overrides: z.object({
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
      }).optional().describe("Optional overrides layered on top of language defaults."),
      voice_notes: z.string().optional().describe("Optional freeform voice notes to include in config."),
      overwrite: z.boolean().optional().describe("If true, replaces an existing config file at the target location."),
    },
    async ({ scope, project_id, language, overrides = {}, voice_notes, overwrite = false }) => {
      const resolvedScope = scope ?? (project_id ? "project_root" : "sync_root");

      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (resolvedScope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot write styleguide config because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const targetPath = resolvedScope === "sync_root"
        ? path.join(SYNC_DIR, STYLEGUIDE_CONFIG_BASENAME)
        : path.join(resolveProjectRoot(project_id), STYLEGUIDE_CONFIG_BASENAME);

      if (!isPathCandidateInsideSyncDir(targetPath)) {
        return errorResponse(
          "INVALID_CONFIG_PATH",
          "Resolved styleguide config path must be inside WRITING_SYNC_DIR.",
          { target_path: path.resolve(targetPath), sync_dir: SYNC_DIR_ABS }
        );
      }

      if (fs.existsSync(targetPath) && !overwrite) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_EXISTS",
          "Styleguide config already exists at target path. Set overwrite=true to replace it.",
          { target_path: path.resolve(targetPath) }
        );
      }

      const draft = buildStyleguideConfigDraft({
        language,
        overrides,
        voice_notes,
      });
      if (!draft.ok) {
        return errorResponse(
          draft.error.code,
          draft.error.message,
          draft.error.details
        );
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, yaml.dump(draft.config, { lineWidth: 120 }), "utf8");

      return jsonResponse({
        ok: true,
        scope: resolvedScope,
        file_path: path.resolve(targetPath),
        config: draft.config,
        inferred_defaults: draft.inferred_defaults,
        warnings: draft.warnings,
        next_step: "Config created. Call update_prose_styleguide_config to apply field updates.",
      });
    }
  );

  s.tool(
    "get_prose_styleguide_config",
    "Resolve prose-styleguide.config.yaml with cascading precedence (sync root, then universe root, then project root). Applies language-derived defaults and nested quotation defaults when omitted.",
    {
      project_id: z.string().optional().describe("Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
    },
    async ({ project_id }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });

      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }

      return jsonResponse({
        ok: true,
        styleguide: resolved,
        next_step: resolved.setup_required
          ? "No prose-styleguide.config.yaml was found. Call setup_prose_styleguide_config (with language e.g. 'en') to create one at sync root or project root."
          : "Config resolved successfully.",
      });
    }
  );

  s.tool(
    "summarize_prose_styleguide_config",
    "Summarize the currently resolved prose styleguide config in plain language for review or confirmation.",
    {
      project_id: z.string().optional().describe("Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
    },
    async ({ project_id }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot summarize prose styleguide config before prose-styleguide.config.yaml is set up.",
          {
            project_id: project_id ?? null,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config.",
          }
        );
      }

      const summary = summarizeStyleguideConfig({
        resolvedConfig: resolved.resolved_config,
        inferredDefaults: resolved.inferred_defaults,
      });
      if (!summary.ok) {
        return errorResponse(summary.error.code, summary.error.message);
      }

      return jsonResponse({
        ok: true,
        project_id: project_id ?? null,
        summary_text: summary.summary_text,
        summary_lines: summary.summary_lines,
        styleguide: resolved,
      });
    }
  );

  s.tool(
    "bootstrap_prose_styleguide_config",
    "Detect dominant prose conventions from existing scenes and suggest initial prose-styleguide config values.",
    {
      project_id: z.string().describe("Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1')."),
      scene_ids: z.array(z.string()).optional().describe("Optional scene_id allowlist to analyze."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional chapter filter."),
      max_scenes: z.number().int().positive().optional().describe("Maximum number of scenes to analyze (default: 50)."),
      min_agreement: z.number().min(0).max(1).optional().describe("Minimum agreement ratio for suggested fields (default: 0.6)."),
      min_evidence: z.number().int().positive().optional().describe("Minimum number of observed scenes per field before suggesting it (default: 3)."),
      include_scene_signals: z.boolean().optional().describe("If true, include per-scene detected signals in the response."),
    },
    async ({
      project_id,
      scene_ids,
      part,
      chapter,
      max_scenes = 50,
      min_agreement = 0.6,
      min_evidence = 3,
      include_scene_signals = false,
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const targetResolution = resolveBatchTargetScenes(db, {
        projectId: project_id,
        sceneIds: scene_ids,
        part,
        chapter,
        onlyStale: false,
      });
      if (!targetResolution.ok) {
        return errorResponse(targetResolution.code, targetResolution.message, targetResolution.details);
      }

      const targetScenes = targetResolution.rows;
      if (targetScenes.length === 0) {
        return errorResponse(
          "NOT_FOUND",
          `No scenes were found for project '${project_id}' with the requested filters.`,
          { project_id, scene_ids: scene_ids ?? null, part: part ?? null, chapter: chapter ?? null }
        );
      }

      if (targetScenes.length > max_scenes) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Matched ${targetScenes.length} scenes, which exceeds max_scenes=${max_scenes}.`,
          {
            matched_scenes: targetScenes.length,
            max_scenes,
            project_id,
            next_step: maxScenesNextStep(targetScenes.length),
          }
        );
      }

      const sceneSignals = [];
      let unreadableScenes = 0;

      for (const scene of targetScenes) {
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          const prose = matter(raw).content;
          sceneSignals.push({
            scene_id: scene.scene_id,
            observed: detectStyleguideSignals(prose),
          });
        } catch {
          unreadableScenes += 1;
          sceneSignals.push({
            scene_id: scene.scene_id,
            observed: {},
          });
        }
      }

      const suggestedConfig = suggestStyleguideUpdatesFromScenes({
        sceneAnalyses: sceneSignals,
        resolvedConfig: null,
        minAgreement: min_agreement,
        minEvidence: min_evidence,
      });

      return jsonResponse({
        ok: true,
        project_id,
        checked_scenes: sceneSignals.length,
        unreadable_scenes: unreadableScenes,
        suggested_config: suggestedConfig,
        next_step: `To apply: (1) If no project-scoped config exists yet, call setup_prose_styleguide_config first with scope=project_root, project_id=${project_id}, and language (e.g. 'en'). (2) Then call update_prose_styleguide_config with the fields from suggested_config you want to apply.`,
        scene_signals: include_scene_signals ? sceneSignals : undefined,
      });
    }
  );

  s.tool(
    "update_prose_styleguide_config",
    "Update an existing prose-styleguide.config.yaml at sync-root or project-root scope by writing only explicit field changes.",
    {
      scope: z.enum(["sync_root", "project_root"]).describe("Config scope to update."),
      project_id: z.string().optional().describe("Project ID when updating project_root config (e.g. 'the-lamb' or 'universe-1/book-1')."),
      updates: z.object({
        language: z.enum(STYLEGUIDE_ENUMS.language).optional(),
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
        voice_notes: z.string().optional(),
      }).strict().describe("Explicit config field changes to write at the selected scope."),
    },
    async ({ scope, project_id, updates }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (scope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot update styleguide config because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const updated = updateStyleguideConfig({
        syncDir: SYNC_DIR,
        scope,
        projectId: project_id,
        updates,
      });
      if (!updated.ok) {
        return errorResponse(
          updated.error.code,
          updated.error.message,
          updated.error.details
        );
      }

      return jsonResponse({
        ok: true,
        scope: updated.scope,
        project_id: updated.project_id,
        file_path: path.resolve(updated.file_path),
        config: updated.config,
        changed_fields: updated.changed_fields,
        noop: Boolean(updated.noop),
        message: updated.message,
        warnings: updated.warnings,
      });
    }
  );

  s.tool(
    "preview_prose_styleguide_config_update",
    "Preview how explicit updates would change an existing prose-styleguide.config.yaml without writing any files.",
    {
      scope: z.enum(["sync_root", "project_root"]).describe("Config scope to preview updates for."),
      project_id: z.string().optional().describe("Project ID when previewing project_root config updates (e.g. 'the-lamb' or 'universe-1/book-1')."),
      updates: z.object({
        language: z.enum(STYLEGUIDE_ENUMS.language).optional(),
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
        voice_notes: z.string().optional(),
      }).strict().describe("Explicit config field changes to preview at the selected scope."),
    },
    async ({ scope, project_id, updates }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (scope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      const preview = previewStyleguideConfigUpdate({
        syncDir: SYNC_DIR,
        scope,
        projectId: project_id,
        updates,
      });
      if (!preview.ok) {
        return errorResponse(
          preview.error.code,
          preview.error.message,
          preview.error.details
        );
      }

      return jsonResponse({
        ok: true,
        scope: preview.scope,
        project_id: preview.project_id,
        file_path: path.resolve(preview.file_path),
        current_config: preview.current_config,
        next_config: preview.config,
        changed_fields: preview.changed_fields,
        noop: preview.changed_fields.length === 0,
        message: preview.changed_fields.length === 0
          ? "No changes detected for requested styleguide updates."
          : "Preview generated.",
        warnings: preview.warnings,
      });
    }
  );

  s.tool(
    "check_prose_styleguide_drift",
    "Detect styleguide drift by comparing declared config conventions against observed signals in scene prose.",
    {
      project_id: z.string().describe("Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1')."),
      scene_ids: z.array(z.string()).optional().describe("Optional scene_id allowlist to analyze."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional chapter filter."),
      max_scenes: z.number().int().positive().optional().describe("Maximum number of scenes to analyze (default: 50)."),
      min_agreement: z.number().min(0).max(1).optional().describe("Minimum agreement ratio for suggested updates (default: 0.6)."),
      include_clean_scenes: z.boolean().optional().describe("If true, include scenes with no detected drift in scene_results."),
    },
    async ({
      project_id,
      scene_ids,
      part,
      chapter,
      max_scenes = 50,
      min_agreement = 0.6,
      include_clean_scenes = false,
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot check prose styleguide drift before prose-styleguide.config.yaml is set up.",
          {
            project_id,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config.",
          }
        );
      }

      const targetResolution = resolveBatchTargetScenes(db, {
        projectId: project_id,
        sceneIds: scene_ids,
        part,
        chapter,
        onlyStale: false,
      });
      if (!targetResolution.ok) {
        return errorResponse(targetResolution.code, targetResolution.message, targetResolution.details);
      }

      const targetScenes = targetResolution.rows;
      if (targetScenes.length > max_scenes) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Matched ${targetScenes.length} scenes, which exceeds max_scenes=${max_scenes}.`,
          {
            matched_scenes: targetScenes.length,
            max_scenes,
            project_id,
            next_step: maxScenesNextStep(targetScenes.length),
          }
        );
      }

      const sceneAnalyses = [];
      for (const scene of targetScenes) {
        let prose;
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          prose = matter(raw).content;
        } catch {
          sceneAnalyses.push({
            scene_id: scene.scene_id,
            observed: {},
            drift: [{ field: "scene_file", declared: "readable", observed: "unreadable" }],
          });
          continue;
        }

        const analysis = analyzeSceneStyleguideDrift({
          prose,
          resolvedConfig: resolved.resolved_config,
        });
        sceneAnalyses.push({
          scene_id: scene.scene_id,
          observed: analysis.observed,
          drift: analysis.drift,
        });
      }

      const suggestedUpdates = suggestStyleguideUpdatesFromScenes({
        sceneAnalyses,
        resolvedConfig: resolved.resolved_config,
        minAgreement: min_agreement,
      });

      const filteredScenes = include_clean_scenes
        ? sceneAnalyses
        : sceneAnalyses.filter((scene) => scene.drift.length > 0);

      const driftByField = {};
      for (const scene of sceneAnalyses) {
        for (const entry of scene.drift) {
          driftByField[entry.field] = (driftByField[entry.field] ?? 0) + 1;
        }
      }

      return jsonResponse({
        ok: true,
        project_id,
        checked_scenes: sceneAnalyses.length,
        scenes_with_drift: sceneAnalyses.filter((scene) => scene.drift.length > 0).length,
        drift_by_field: driftByField,
        scene_results: filteredScenes,
        suggested_updates: suggestedUpdates,
      });
    }
  );

  s.tool(
    "setup_prose_styleguide_skill",
    "Generate skills/prose-styleguide.md from the resolved prose styleguide config and universal craft rules.",
    {
      project_id: z.string().optional().describe("Optional project ID for scoped config resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
      overwrite: z.boolean().optional().describe("If true, replaces an existing skills/prose-styleguide.md file."),
    },
    async ({ project_id, overwrite = false }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot write prose styleguide skill because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot generate prose-styleguide.md before prose-styleguide.config.yaml is set up.",
          {
            project_id: project_id ?? null,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config first.",
          }
        );
      }

      const skillPath = path.join(SYNC_DIR, PROSE_STYLEGUIDE_SKILL_DIRNAME, PROSE_STYLEGUIDE_SKILL_BASENAME);
      if (!isPathCandidateInsideSyncDir(skillPath)) {
        return errorResponse(
          "INVALID_SKILL_PATH",
          "Resolved prose styleguide skill path must be inside WRITING_SYNC_DIR.",
          { target_path: path.resolve(skillPath), sync_dir: SYNC_DIR_ABS }
        );
      }

      if (fs.existsSync(skillPath) && !overwrite) {
        return errorResponse(
          "STYLEGUIDE_SKILL_EXISTS",
          "skills/prose-styleguide.md already exists. Set overwrite=true to replace it.",
          { target_path: path.resolve(skillPath) }
        );
      }

      const generated = buildProseStyleguideSkill({
        resolvedConfig: resolved.resolved_config,
        sources: resolved.sources,
        projectId: project_id ?? null,
      });
      if (!generated.ok) {
        return errorResponse(generated.error.code, generated.error.message);
      }

      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, generated.markdown, "utf8");

      return jsonResponse({
        ok: true,
        file_path: path.resolve(skillPath),
        project_id: project_id ?? null,
        injected_rules: generated.injected_rules,
        source_count: resolved.sources.length,
      });
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
