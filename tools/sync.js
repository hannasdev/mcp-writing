import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { syncAll, writeMeta, readMeta, indexSceneFile, normalizeSceneMetaForPath } from "../src/sync/sync.js";
import { importScrivenerSync, validateProjectId } from "../src/sync/importer.js";

export function registerSyncTools(s, {
  db,
  SYNC_DIR,
  SYNC_DIR_ABS,
  SYNC_DIR_REAL,
  SYNC_DIR_WRITABLE,
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
}) {
  s.tool("sync", "Re-scan the sync folder and update the scene/character/place index from disk. Call this after making edits in Scrivener or updating sidecar files outside the MCP.", {}, async () => {
    const result = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
    const parts = [`Sync complete. ${result.indexed} scenes indexed. ${result.staleMarked} scenes marked stale.`];
    if (result.sidecarsMigrated) parts.push(`${result.sidecarsMigrated} sidecar(s) auto-generated from frontmatter.`);
    if (result.skipped) {
      parts.push(`${result.skipped} file(s) skipped (no scene_id).`);
      parts.push(`Tip: for raw Scrivener Draft exports, run scripts/import.js first, then run sync again.`);
    }
    const summary = result.warningSummary;
    const summaryEntries = Object.entries(summary);
    if (summaryEntries.length) {
      const lines = summaryEntries.map(([type, entry]) => `- ${type}: ${entry.count} (e.g. ${entry.examples[0]})`);
      parts.push(`\n⚠️ Warning summary:\n` + lines.join("\n"));
    }
    return { content: [{ type: "text", text: parts.join(" ") }] };
  });

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
    "merge_scrivener_project_beta",
    "Merge metadata directly from a Scrivener .scriv project into existing scene sidecars by starting a background job. This path is opt-in and requires sidecars to already exist (for example, from import_scrivener_sync). Returns immediately with a job_id to poll via get_async_job_status.",
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
            next_step: maxScenesNextStep(targetScenes.length),
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
    "Get status and result for an asynchronous job started by async tools such as import_scrivener_sync_async, merge_scrivener_project_beta, or enrich_scene_characters_batch. Use this to poll job progress after receiving a job_id. Common next step: if status is still running, call this tool again; if status is completed inspect result, and if status is failed or cancelled inspect job/result diagnostics.",
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
    "List asynchronous jobs currently known to this server. Use this when you lost a job_id or need a dashboard view of running/completed jobs. Returns an object envelope containing a jobs array of job objects sorted by newest first.",
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

  // ---- enrichment ----------------------------------------------------------
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
}
