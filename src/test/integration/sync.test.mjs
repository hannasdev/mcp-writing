import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { spawnServer, waitForServer, waitForExit, connectClient } from "../helpers/server.js";
import { copyDirSync, createScrivenerDraftFixture, createScrivenerProjectBundleFixture } from "../helpers/fixtures.js";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3079, 3078);
let writeSyncDir, readSyncDir;
let scrivenerImportDir, scrivenerProjectDir;
before(async () => {
  await ctx.setup();
  writeSyncDir = ctx.writeSyncDir;
  readSyncDir = ctx.readSyncDir;
  scrivenerImportDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-scrivener-import-"));
  createScrivenerDraftFixture(scrivenerImportDir);
  const scrivenerProjectBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-scrivener-project-"));
  scrivenerProjectDir = createScrivenerProjectBundleFixture(scrivenerProjectBaseDir);
});

after(async () => {
  await ctx.teardown();
  if (scrivenerImportDir) fs.rmSync(scrivenerImportDir, { recursive: true, force: true });
  if (scrivenerProjectDir) fs.rmSync(path.dirname(scrivenerProjectDir), { recursive: true, force: true });
});

const callTool = (n, a) => ctx.callTool(n, a);
const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
const waitForAsyncJob = (id, t) => ctx.waitForAsyncJob(id, t);
describe("sync tool", () => {
  test("returns scene indexed count after initial sync", async () => {
    const text = await callTool("sync");
    assert.match(text, /3 scenes indexed/);
  });
});

describe("import_scrivener_sync tool", () => {
  test("dry-run returns machine-readable counts without writing files", async () => {
    const projectId = "import-preview";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.dry_run, true);
    assert.equal(parsed.import.created, 2);
    assert.equal(parsed.import.existing, 0);
    assert.equal(parsed.import.skipped, 3);
    assert.equal(parsed.import.beat_markers_seen, 1);
    assert.equal(parsed.sync, null);
    assert.equal(fs.existsSync(scenesDir), false);
  });

  test("non-dry-run writes sidecars and returns counts", async () => {
    const projectId = "import-apply";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.dry_run, false);
    assert.equal(parsed.import.created, 2);
    assert.equal(parsed.import.existing, 0);
    assert.equal(parsed.import.skipped, 3);
    assert.equal(parsed.import.beat_markers_seen, 1);
    assert.equal(parsed.sync, null);

    assert.equal(fs.existsSync(scenesDir), true);
    const files = fs.readdirSync(scenesDir);
    const sidecars = files.filter(name => name.endsWith(".meta.yaml"));
    assert.equal(sidecars.length, 2);
    assert.ok(sidecars.some(name => name.includes("001 Scene Arrival [10].meta.yaml")));
    assert.ok(sidecars.some(name => name.includes("004 Scene Debate [13].meta.yaml")));
  });

  test("rejects path traversal in project_id", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "../../escape",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_PROJECT_ID");
  });

  test("rejects non-slug project_id segments", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "my_universe/MyProject",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_PROJECT_ID");
  });

  test("universe-scoped project_id routes to universes/<universe>/<project>/scenes", async () => {
    const projectId = "aether/book-one";
    const expectedScenesDir = path.join(writeSyncDir, "universes", "aether", "book-one", "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.scenes_dir, expectedScenesDir);
    assert.equal(fs.existsSync(expectedScenesDir), true);
    const sidecars = fs.readdirSync(expectedScenesDir).filter(n => n.endsWith(".meta.yaml"));
    assert.equal(sidecars.length, 2);
  });
});

describe("merge_scrivener_project_beta tool", () => {
  test("completes and returns merge payload with dry-run", async () => {
    const projectId = "direct-beta-preview";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(started.beta, undefined);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.beta, undefined);
    assert.equal(done.job.result.merge.project_id, projectId);
    assert.equal(done.job.result.merge.dry_run, true);
    assert.equal(done.job.result.merge.sidecar_files, 2);
    assert.equal(done.job.result.merge.updated, 2);
    assert.ok(done.job.result.merge.field_add_counts.synopsis >= 1);
    assert.ok(Array.isArray(done.job.result.merge.preview_changes));
  });

  test("returns structured fallback guidance on parser/path failure", async () => {
    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: "/tmp/does-not-exist-for-mcp-writing-tests.scriv",
      project_id: "direct-beta-preview",
      dry_run: true,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "failed");
    assert.equal(done.job.result.ok, false);
    const errorCode = done.job.result.error.code;
    assert.ok(
      errorCode === "SCRIVENER_DIRECT_BETA_FAILED" || errorCode === "ASYNC_JOB_FAILED",
      `Unexpected error code: ${errorCode}`
    );
    const fallback = done.job.result.error.details?.fallback
      ?? done.job.result.error.details?.cause?.details?.fallback;
    assert.ok(typeof fallback === "string" && fallback.includes("import_scrivener_sync"));
  });

  test("returns structured warning summary for skipped beta merge sidecars", async () => {
    const projectId = "direct-beta-warnings";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    fs.writeFileSync(
      path.join(scenesDir, "Loose Notes.meta.yaml"),
      "scene_id: sc-loose\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(scenesDir, "999 Missing Mapping [999].meta.yaml"),
      "scene_id: sc-999\n",
      "utf8"
    );

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.merge.warning_summary.missing_bracket_id.count, 1);
    assert.equal(done.job.result.merge.warning_summary.missing_uuid_mapping.count, 1);
    assert.ok(done.job.result.merge.warnings.some(w => w.code === "missing_bracket_id"));
    assert.ok(done.job.result.merge.warnings.some(w => w.code === "missing_uuid_mapping" && w.sync_number === "999"));
  });

  test("returns ambiguity warning taxonomy for conflicting sidecar mappings", async () => {
    const projectId = "direct-beta-ambiguity";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    const primarySidecarFilename = fs.readdirSync(scenesDir).find(name => /\[\d+\]\.meta\.yaml$/.test(name));
    assert.ok(primarySidecarFilename, "Expected imported sidecar with bracketed sync marker");
    const primarySidecarPath = path.join(scenesDir, primarySidecarFilename);
    const primarySidecar = yaml.load(fs.readFileSync(primarySidecarPath, "utf8"));
    fs.writeFileSync(
      primarySidecarPath,
      yaml.dump(
        {
          ...primarySidecar,
          chapter: 9,
          synopsis: "Conflicting sidecar synopsis",
          external_source: "manual",
        },
        { lineWidth: 120 }
      ),
      "utf8"
    );

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_identity_tie.count, 1);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_structure_mapping.count, 1);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_metadata_mapping.count, 1);
  });

  test("scenes_dir override uses explicit path instead of project_id-derived path", async () => {
    const projectId = "solar/book-alpha";
    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const derivedScenesDir = path.join(writeSyncDir, "universes", "solar", "book-alpha", "scenes");
    assert.equal(fs.existsSync(derivedScenesDir), true);

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      scenes_dir: derivedScenesDir,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.scenes_dir, derivedScenesDir);
    assert.equal(done.job.result.merge.sidecar_files, 2);
    assert.equal(done.job.result.merge.updated, 2);
  });

  test("scenes_dir takes priority over project_id when both are supplied", async () => {
    const projectId = "solar/book-beta";
    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const actualScenesDir = path.join(writeSyncDir, "universes", "solar", "book-beta", "scenes");

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: "solar/nonexistent-project",
      scenes_dir: actualScenesDir,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.scenes_dir, actualScenesDir);
    assert.equal(done.job.result.merge.sidecar_files, 2);
  });

  test("idempotent: second merge run finds no updates", async () => {
    const projectId = "direct-beta-idempotent";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    // First merge with write
    const firstStartText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const firstStarted = JSON.parse(firstStartText);
    const firstDone = await waitForAsyncJob(firstStarted.job.job_id);
    assert.equal(firstDone.ok, true);
    assert.equal(firstDone.job.result.merge.updated, 2);

    // Second merge with dry-run should find no changes
    const secondStartText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const secondStarted = JSON.parse(secondStartText);
    const secondDone = await waitForAsyncJob(secondStarted.job.job_id);

    assert.equal(secondDone.ok, true);
    assert.equal(secondDone.job.result.merge.updated, 0);
    assert.equal(secondDone.job.result.merge.unchanged, secondDone.job.result.merge.sidecar_files);
    assert.deepEqual(secondDone.job.result.merge.field_add_counts, {});
    assert.deepEqual(secondDone.job.result.merge.preview_changes, []);
  });

  test("organize_by_chapters: true relocates scenes into chapter folders", async () => {
    const projectId = "direct-beta-relocate";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
      organize_by_chapters: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.ok(done.job.result.merge.relocated >= 2);

    const relocatedScenePath = path.join(
      writeSyncDir,
      "projects",
      projectId,
      "scenes",
      "part-1",
      "chapter-1-arrival",
      "001 Scene Arrival [10].txt"
    );
    const relocatedMetaPath = relocatedScenePath.replace(/\.txt$/, ".meta.yaml");
    assert.equal(fs.existsSync(relocatedScenePath), true);
    assert.equal(fs.existsSync(relocatedMetaPath), true);

    const scenesText = await callWriteTool("find_scenes", { project_id: projectId });
    const scenes = JSON.parse(scenesText);
    assert.equal(scenes[0].chapter, 1);
    assert.equal(scenes[0].chapter_title, "Arrival");
  });

  test("organize_by_chapters: false keeps scenes in place", async () => {
    const projectId = "direct-beta-no-organize";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
      organize_by_chapters: false,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.relocated, 0);

    const originalScenePath = path.join(
      writeSyncDir,
      "projects",
      projectId,
      "scenes",
      "001 Scene Arrival [10].txt"
    );
    const originalMetaPath = originalScenePath.replace(/\.txt$/, ".meta.yaml");
    assert.equal(fs.existsSync(originalScenePath), true);
    assert.equal(fs.existsSync(originalMetaPath), true);

    const scenesText = await callWriteTool("find_scenes", { project_id: projectId });
    const scenes = JSON.parse(scenesText);
    assert.equal(scenes[0].chapter, 1);
  });
});


describe("async import/merge job tools", () => {
  test("import_scrivener_sync_async completes and returns import payload", async () => {
    const projectId = "async-import-preview";
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.import.project_id, projectId);
    assert.equal(done.job.result.import.created, 2);
  });

  test("cancel_async_job sets transitional 'cancelling' status and resolves to terminal state", async () => {
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "cancel-semantics-test",
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const cancelText = await callWriteTool("cancel_async_job", {
      job_id: started.job.job_id,
    });
    const cancelResult = JSON.parse(cancelText);
    assert.equal(cancelResult.ok, true);

    if (cancelResult.cancelled === true) {
      // cancellation was accepted — status must be transitional, not yet finalised
      assert.equal(
        cancelResult.job.status,
        "cancelling",
        `cancel_async_job must return 'cancelling' (got '${cancelResult.job.status}'); ` +
          "setting 'cancelled' immediately is the pre-fix optimistic bug."
      );
    } else {
      // job already reached a terminal state before signal was delivered — acceptable race
      assert.ok(
        ["completed", "failed", "cancelled"].includes(cancelResult.job.status),
        `Expected terminal status, got '${cancelResult.job.status}'`
      );
    }

    // Regardless of race, polling must eventually reach a terminal state
    const done = await waitForAsyncJob(started.job.job_id);
    assert.ok(done.ok, "get_async_job_status must succeed");
    assert.ok(
      ["completed", "cancelled"].includes(done.job.status),
      `Expected 'completed' or 'cancelled', got '${done.job.status}'`
    );
  });

  test("cancel_async_job on already-completed job returns cancelled: false without mutation", async () => {
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "cancel-after-done-test",
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    // Wait for job to complete
    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.job.status, "completed");

    // Now cancel the completed job
    const cancelText = await callWriteTool("cancel_async_job", {
      job_id: started.job.job_id,
    });
    const cancelResult = JSON.parse(cancelText);
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.cancelled, false);
    assert.equal(cancelResult.job.status, "completed", "completed status must not be overwritten");
  });


  test("preflight returns file list without writing anything", async () => {
    const projectId = "preflight-test";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      preflight: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.preflight, true);
    assert.equal(typeof parsed.import.files_to_process, "number");
    assert.ok(Array.isArray(parsed.import.file_previews));
    assert.equal(fs.existsSync(scenesDir), false, "preflight must not write any files");
    assert.equal(parsed.next_step.includes("preflight"), true);
  });

  test("ignore_patterns excludes matching filenames from import", async () => {
    const projectId = "ignore-patterns-test";

    // Without ignore: 2 scenes created (Arrival [10] and Debate [13])
    const baseText = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId + "-base",
      dry_run: true,
    });
    const baseParsed = JSON.parse(baseText);
    const baseCreated = baseParsed.import.created;

    // With ignore pattern targeting "Arrival" filename
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
      ignore_patterns: ["Arrival"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.ignored_files, 1);
    assert.equal(parsed.import.created, baseCreated - 1);
  });

  test("invalid ignore_patterns returns INVALID_IGNORE_PATTERN (sync)", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "invalid-ignore-sync",
      dry_run: true,
      ignore_patterns: ["[unterminated"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_IGNORE_PATTERN");
  });

  test("invalid ignore_patterns returns INVALID_IGNORE_PATTERN (async)", async () => {
    const text = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "invalid-ignore-async",
      dry_run: true,
      ignore_patterns: ["[unterminated"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_IGNORE_PATTERN");
  });
});

describe("enrich_scene_characters_batch tool", () => {
  test("requires confirm_replace when replace_mode=replace", async () => {
    const text = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      replace_mode: "replace",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
  });

  test("runs async dry-run and returns batch result payload", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      dry_run: true,
      include_match_details: true,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.project_id, "test-novel");
    assert.equal(typeof done.job.result.total_scenes, "number");
    assert.equal(typeof done.job.result.processed_scenes, "number");
    assert.ok(Array.isArray(done.job.result.results));
    assert.equal(typeof done.job.progress?.total_scenes, "number");
    assert.equal(typeof done.job.progress?.processed_scenes, "number");
    assert.equal(done.job.progress?.processed_scenes, done.job.result.processed_scenes);
  });

  test("returns completed async job with total_scenes=0 when filters match nothing", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      part: 99,
      dry_run: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.total_scenes, 0);
    assert.equal(done.job.result.processed_scenes, 0);
    assert.deepEqual(done.job.result.results, []);
  });

  test("returns completed zero-target job with explicit warning when project_id is unknown", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "project-does-not-exist",
      dry_run: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.total_scenes, 0);
    assert.equal(done.job.result.processed_scenes, 0);
    assert.equal(typeof done.job.result.warning, "string");
    assert.ok(done.job.result.warning.includes("PROJECT_NOT_FOUND_WARNING"));
  });

  test("returns VALIDATION_ERROR when resolved scenes exceed max_scenes", async () => {
    await callWriteTool("sync");

    const text = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      part: 1,
      dry_run: true,
      max_scenes: 1,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
    assert.equal(parsed.error.details.max_scenes, 1);
  });

  test("applies scene_ids allowlist before part/chapter/only_stale narrowing", async () => {
    await callWriteTool("sync");

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");

    try {
      fs.writeFileSync(scenePath, `${before}\n\nStale marker for filter precedence test.\n`, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        scene_ids: ["sc-002", "sc-003"],
        chapter: 1,
        only_stale: true,
        dry_run: true,
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.total_scenes, 1);
      assert.equal(done.job.result.results[0].scene_id, "sc-002");
    } finally {
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("dry_run=false updates sidecar links and scene_characters index", async () => {
    await callWriteTool("sync");

    const sceneMetaPath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.meta.yaml");
    const originalMeta = fs.readFileSync(sceneMetaPath, "utf8");

    try {
      // Remove Elena link from sidecar and re-sync to drop it from index.
      const modifiedMeta = originalMeta.replace(/characters:\n(?:\s*- .*\n)+/, "characters: []\n");
      fs.writeFileSync(sceneMetaPath, modifiedMeta, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        scene_ids: ["sc-003"],
        dry_run: false,
        replace_mode: "merge",
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.ok, true);
      assert.equal(done.job.result.scenes_changed, 1);
      assert.equal(done.job.result.links_added >= 1, true);

      // Ensure parent index is refreshed before asserting link visibility.
      await callWriteTool("sync");

      const afterText = await callWriteTool("find_scenes", {
        project_id: "test-novel",
        character: "elena",
        page_size: 10,
      });
      const after = JSON.parse(afterText);
      assert.ok(after.results.some(r => r.scene_id === "sc-003"));
    } finally {
      fs.writeFileSync(sceneMetaPath, originalMeta, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-003", project_id: "test-novel" });
    }
  });

  test("only_stale=true scopes processing to stale scenes", async () => {
    await callWriteTool("sync");

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");

    try {
      fs.writeFileSync(scenePath, `${before}\n\nStale marker for only_stale batch test.\n`, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        part: 1,
        chapter: 1,
        only_stale: true,
        dry_run: true,
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.total_scenes, 1);
      assert.equal(done.job.result.results[0].scene_id, "sc-002");
    } finally {
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("returns READ_ONLY when write mode is requested on read-only runtime", async () => {
    const roPort = 3096;
    const roUrl = `http://localhost:${roPort}`;
    const roSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-readonly-"));
    copyDirSync(writeSyncDir, roSyncDir);
    fs.chmodSync(roSyncDir, 0o555);

    const roProc = spawnServer(roPort, roSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2" });
    let roClient;
    try {
      await waitForServer(roUrl);
      roClient = await connectClient(roUrl);
      const result = await roClient.callTool({
        name: "enrich_scene_characters_batch",
        arguments: {
          project_id: "test-novel",
          dry_run: false,
        },
      });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "READ_ONLY");
    } finally {
      try { await roClient?.close(); } catch {}
      if (roProc) roProc.kill();
      try { fs.chmodSync(roSyncDir, 0o755); } catch {}
      fs.rmSync(roSyncDir, { recursive: true, force: true });
    }
  });

  test("cancellation retains partial results for batch jobs when cancellation lands mid-run", async () => {
    const isolatedPort = 3197;
    const isolatedUrl = `http://localhost:${isolatedPort}`;
    const isolatedSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-cancel-"));
    const projectId = "cancel-batch-test";
    const projectRoot = path.join(isolatedSyncDir, "projects", projectId);
    const scenesDir = path.join(projectRoot, "scenes");
    const charsDir = path.join(projectRoot, "world", "characters");
    let isolatedProc;
    let isolatedClient;

    async function callIsolatedTool(name, args = {}) {
      const result = await isolatedClient.callTool({ name, arguments: args });
      return result.content[0].text;
    }

    fs.mkdirSync(scenesDir, { recursive: true });
    fs.mkdirSync(charsDir, { recursive: true });
    fs.writeFileSync(
      path.join(charsDir, "elena.md"),
      `---\ncharacter_id: elena\nname: Elena Vasquez\nrole: protagonist\n---\nCharacter notes.\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(charsDir, "elena.meta.yaml"),
      `character_id: elena\nname: Elena Vasquez\nrole: protagonist\n`,
      "utf8"
    );

    for (let index = 1; index <= 1000; index += 1) {
      const sceneId = `sc-${String(index).padStart(3, "0")}`;
      fs.writeFileSync(
        path.join(scenesDir, `${sceneId}.md`),
        `---\nscene_id: ${sceneId}\ntitle: ${sceneId}\npart: 1\nchapter: 1\npov: elena\n---\nElena Vasquez reviews scene ${index}.\n`,
        "utf8"
      );
      fs.writeFileSync(
        path.join(scenesDir, `${sceneId}.meta.yaml`),
        `scene_id: ${sceneId}\ntitle: ${sceneId}\npart: 1\nchapter: 1\ncharacters: []\n`,
        "utf8"
      );
    }

    try {
      isolatedProc = spawnServer(isolatedPort, isolatedSyncDir, {
        MCP_WRITING_SCENE_CHARACTER_BATCH_DELAY_MS: "2",
      });
      await waitForServer(isolatedUrl);
      isolatedClient = await connectClient(isolatedUrl);
      await callIsolatedTool("sync");

      const startText = await callIsolatedTool("enrich_scene_characters_batch", {
        project_id: projectId,
        dry_run: true,
        max_scenes: 2000,
      });
      const started = JSON.parse(startText);
      assert.equal(started.ok, true);

      let status;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const statusText = await callIsolatedTool("get_async_job_status", {
          job_id: started.job.job_id,
        });
        status = JSON.parse(statusText);
        if ((status.job?.progress?.processed_scenes ?? 0) > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      assert.ok(
        (status?.job?.progress?.processed_scenes ?? 0) > 0,
        "Cancellation test requires observed batch progress before cancel_async_job is called."
      );

      const cancelText = await callIsolatedTool("cancel_async_job", {
        job_id: started.job.job_id,
      });
      const cancelResult = JSON.parse(cancelText);
      assert.equal(cancelResult.ok, true);
      assert.equal(cancelResult.cancelled, true);

      let done;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const statusText = await callIsolatedTool("get_async_job_status", {
          job_id: started.job.job_id,
        });
        done = JSON.parse(statusText);
        if (done.job?.status === "cancelled") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      assert.equal(done.job?.status, "cancelled");
      assert.equal(done.job.result?.cancelled, true);
      assert.ok(Array.isArray(done.job.result?.results));
      assert.equal(done.job.result.results.length, done.job.result.processed_scenes);
      assert.ok(done.job.result.processed_scenes < done.job.result.total_scenes);
    } finally {
      try { await isolatedClient?.close(); } catch {}
      if (isolatedProc) {
        isolatedProc.kill();
        try { await waitForExit(isolatedProc); } catch {}
      }
      fs.rmSync(isolatedSyncDir, { recursive: true, force: true });
    }
  });
});

describe("sync warning_summary", () => {
  test("sync response includes warning_summary instead of raw warning list for import+sync", async () => {
    const projectId = "warning-summary-test";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
    });

    // Run a standalone sync to get a structured result
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    if (parsed.sync !== null) {
      assert.ok(typeof parsed.sync.warning_summary === "object", "warning_summary should be an object");
      assert.equal("warnings" in parsed.sync, false, "raw warnings list should not appear in sync response");
    }
  });
});

describe("enrich_scene tool", () => {
  test("returns not-found envelope for unknown scene", async () => {
    const text = await callWriteTool("enrich_scene", { scene_id: "sc-999", project_id: "test-novel" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
  });

  test("clears stale warning after re-enrichment", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nFresh prose delta for enrich_scene test.\n`, "utf8");

    await callWriteTool("sync");
    const staleArcText = await callWriteTool("get_arc", { character_id: "elena" });
    const staleArc = JSON.parse(staleArcText);
    assert.ok(staleArc.warning);

    const enrichText = await callWriteTool("enrich_scene", { scene_id: "sc-001", project_id: "test-novel" });
    const enrich = JSON.parse(enrichText);
    assert.equal(enrich.ok, true);
    assert.equal(enrich.action, "enriched");
    assert.equal(enrich.scene_id, "sc-001");

    const freshArcText = await callWriteTool("get_arc", { character_id: "elena" });
    const freshArc = JSON.parse(freshArcText);
    assert.equal(freshArc.warning, undefined);
  });
});
