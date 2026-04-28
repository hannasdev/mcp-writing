import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDb, checkpointJobFinish, loadStalledJobs, pruneJobCheckpoints } from "./core/db.js";
import { syncAll, isSyncDirWritable, getSyncOwnershipDiagnostics, isStructuralProjectId } from "./sync/sync.js";
import { isGitAvailable, isGitRepository, initGitRepository, getSceneProseAtCommit } from "./core/git.js";
import { createAsyncJobManager, readJsonIfExists } from "./runtime/async-jobs.js";
import {
  createHelpers,
  deriveLoglineFromProse,
  inferCharacterIdsFromProse,
  readSupportingNotesForEntity,
  readEntityMetadata,
  resolveBatchTargetScenes,
} from "../helpers.js";
import { STYLEGUIDE_CONFIG_BASENAME } from "./styleguide/prose-styleguide.js";
import { registerSyncTools } from "../tools/sync.js";
import { registerSearchTools } from "../tools/search.js";
import { registerMetadataTools } from "../tools/metadata.js";
import { registerReviewBundleTools } from "../tools/review-bundles.js";
import { registerStyleguideTools } from "../tools/styleguide.js";
import { registerEditingTools } from "../tools/editing.js";
import { WORKFLOW_CATALOGUE } from "./workflows/workflow-catalogue.js";
import { getRuntimeDiagnostics } from "./runtime/runtime-diagnostics.js";

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

const HTTP_PORT = parsePositiveIntEnv(process.env.HTTP_PORT, 3000);
const MAX_CHAPTER_SCENES = parsePositiveIntEnv(process.env.MAX_CHAPTER_SCENES, 10);
const DEFAULT_METADATA_PAGE_SIZE = parsePositiveIntEnv(process.env.DEFAULT_METADATA_PAGE_SIZE, 20);
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
const ROOT_DIR = path.resolve(__dirname, "..");
const pkg = readJsonIfExists(path.join(ROOT_DIR, "package.json")) ?? {};
const MCP_SERVER_VERSION = typeof pkg.version === "string" && pkg.version.trim()
  ? pkg.version
  : "0.0.0";
const asyncJobs = new Map();

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

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = openDb(DB_PATH);

// Recover jobs that were in-flight when the server last exited.
const stalledJobs = loadStalledJobs(db);
for (const job of stalledJobs) {
  job.status = "failed";
  job.error = "server restarted while job was running";
  job.finishedAt = new Date().toISOString();
  try {
    checkpointJobFinish(db, job);
  } catch (err) {
    process.stderr.write(`[mcp-writing] WARNING: failed to checkpoint recovered stalled job ${job.id}: ${err.message}\n`);
  }
  asyncJobs.set(job.id, job);
}
// Prune expired rows from previous sessions unconditionally — completed/failed
// jobs from prior runs are never loaded into asyncJobs, so anyPruned in
// pruneAsyncJobs() would never be true for them.
try { pruneJobCheckpoints(db, ASYNC_JOB_TTL_MS); } catch { /* best effort */ }

if (stalledJobs.length > 0) {
  process.stderr.write(`[mcp-writing] Marked ${stalledJobs.length} stalled job(s) as failed after restart.\n`);
}

const { pruneAsyncJobs, startAsyncJob, toPublicJob } = createAsyncJobManager({
  db,
  asyncJobs,
  ttlMs: ASYNC_JOB_TTL_MS,
  runnerDir: ROOT_DIR,
});

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

const RUNTIME_DIAGNOSTICS = getRuntimeDiagnostics({
  ownershipGuardModeRaw: OWNERSHIP_GUARD_MODE_RAW,
  ownershipGuardMode: OWNERSHIP_GUARD_MODE,
  ownershipGuardModeRawDisplay: OWNERSHIP_GUARD_MODE_RAW_DISPLAY,
  syncDirWritable: SYNC_DIR_WRITABLE,
  syncDirAbs: SYNC_DIR_ABS,
  syncOwnershipDiagnostics: SYNC_OWNERSHIP_DIAGNOSTICS,
  gitAvailable: GIT_AVAILABLE,
  gitEnabled: GIT_ENABLED,
});
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

const {
  isPathInsideSyncDir,
  isPathCandidateInsideSyncDir,
  resolveOutputDirWithinSync,
  resolveProjectRoot,
  createCanonicalWorldEntity,
} = createHelpers({
  syncDir: SYNC_DIR,
  syncDirReal: SYNC_DIR_REAL,
  syncDirAbs: SYNC_DIR_ABS,
  db,
  syncDirWritable: SYNC_DIR_WRITABLE,
});

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
