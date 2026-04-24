import fs from "node:fs";
import path from "node:path";
import { importScrivenerSync } from "../importer.js";
import { mergeScrivenerProjectMetadata } from "../scrivener-direct.js";
import { runSceneCharacterBatch } from "../scene-character-batch.js";
import { ASYNC_PROGRESS_PREFIX } from "../async-progress.js";

const PROGRESS_PREFIX = ASYNC_PROGRESS_PREFIX;

function writeResult(resultPath, payload) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
}

function writeProgress(payload) {
  try {
    process.stdout.write(`${PROGRESS_PREFIX}${JSON.stringify(payload)}\n`);
  } catch {
    // Best-effort only; never fail the job due to progress telemetry.
  }
}

function normalizeImportResult(importResult) {
  const importPayload = {
    source_dir: importResult.scrivenerDir,
    sync_dir: importResult.mcpSyncDir,
    scenes_dir: importResult.scenesDir,
    project_id: importResult.projectId,
    source_files: importResult.sourceFiles,
    created: importResult.created,
    existing: importResult.existing,
    skipped: importResult.skipped,
    beat_markers_seen: importResult.beatMarkersSeen,
    dry_run: importResult.dryRun,
    preflight: importResult.preflight,
    ignored_files: importResult.ignoredFiles,
  };

  if (importResult.preflight) {
    importPayload.files_to_process = importResult.filesToProcess;
    importPayload.file_previews = importResult.filePreviews;
    importPayload.existing_sidecars = importResult.existingSidecars;
  }

  return {
    ok: true,
    import: importPayload,
    sync: null,
  };
}

function normalizeMergeResult(mergeResult) {
  return {
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
    sync: null,
    warnings: [
      "BETA_FEATURE: Direct Scrivener project parsing may be sensitive to Scrivener internal format changes.",
      "If this fails, use import_scrivener_sync with an External Folder Sync export as the stable fallback.",
    ],
  };
}

function normalizeSceneCharacterBatchResult(batchResult) {
  return {
    ok: true,
    ...batchResult,
  };
}

async function main() {
  const requestPath = process.argv[2];
  const resultPath = process.argv[3];

  if (!requestPath || !resultPath) {
    throw new Error("Usage: node scripts/async-job-runner.mjs <request.json> <result.json>");
  }

  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const syncDir = request.context?.sync_dir;
  if (!syncDir) {
    throw new Error("Missing sync_dir in async job request context.");
  }

  if (request.kind === "import_scrivener_sync") {
    const result = importScrivenerSync({
      scrivenerDir: request.args?.source_dir,
      mcpSyncDir: syncDir,
      projectId: request.args?.project_id,
      dryRun: Boolean(request.args?.dry_run) || Boolean(request.args?.preflight),
      preflight: Boolean(request.args?.preflight),
      ignorePatterns: request.args?.ignore_patterns ?? [],
    });
    writeResult(resultPath, normalizeImportResult(result));
    return;
  }

  if (request.kind === "merge_scrivener_project_beta") {
    const result = mergeScrivenerProjectMetadata({
      scrivPath: request.args?.source_project_dir,
      mcpSyncDir: syncDir,
      projectId: request.args?.project_id,
      scenesDir: request.args?.scenes_dir,
      dryRun: Boolean(request.args?.dry_run),
      organizeByChapters: Boolean(request.args?.organize_by_chapters),
    });
    writeResult(resultPath, normalizeMergeResult(result));
    return;
  }

  if (request.kind === "enrich_scene_characters_batch") {
    let cancellationRequested = false;
    const handleSigterm = () => {
      cancellationRequested = true;
    };
    process.on("SIGTERM", handleSigterm);

    const result = await runSceneCharacterBatch({
      syncDir,
      args: {
        project_id: request.args?.project_id,
        dry_run: Boolean(request.args?.dry_run),
        replace_mode: request.args?.replace_mode ?? "merge",
        include_match_details: Boolean(request.args?.include_match_details),
        project_exists: request.args?.project_exists !== false,
        target_scenes: request.args?.target_scenes ?? [],
        character_rows: request.args?.character_rows ?? [],
      },
      onProgress: progress => writeProgress({ kind: request.kind, ...progress }),
      shouldCancel: () => cancellationRequested,
    });
    process.off("SIGTERM", handleSigterm);
    writeResult(resultPath, normalizeSceneCharacterBatchResult(result));
    return;
  }

  throw new Error(`Unsupported async job kind '${request.kind}'.`);
}

try {
  await main();
} catch (error) {
  const resultPath = process.argv[3];
  const requestPath = process.argv[2];
  if (resultPath) {
    const errorCode = error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "ASYNC_JOB_FAILED";
    let requestKind = null;
    if (requestPath && fs.existsSync(requestPath)) {
      try {
        const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
        requestKind = request?.kind ?? null;
      } catch {
        requestKind = null;
      }
    }

    const errorDetails = {
      ...(error && typeof error === "object" && error.pattern ? { pattern: error.pattern } : {}),
      ...(error && typeof error === "object" && error.details && typeof error.details === "object" ? error.details : {}),
      ...(requestKind === "merge_scrivener_project_beta"
        ? {
          fallback: "Use import_scrivener_sync with an External Folder Sync export as the stable default path.",
        }
        : {}),
    };
    writeResult(resultPath, {
      ok: false,
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : String(error),
        ...(Object.keys(errorDetails).length ? { details: errorDetails } : {}),
      },
    });
  }
  process.exit(1);
}
