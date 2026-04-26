import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { buildReviewBundlePlan, renderReviewBundleMarkdown, ReviewBundlePlanError } from "../../review-bundles.js";
import { insertTestScene, setupReviewBundleTestDb } from "../helpers/db.js";

describe("buildReviewBundlePlan", () => {
  test("orders scenes deterministically with timeline and scene_id fallback", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-002",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 400,
      });
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: null,
        wordCount: 500,
      });
      insertTestScene(db, {
        sceneId: "sc-003",
        part: 1,
        chapter: 2,
        timelinePosition: 1,
        wordCount: 300,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
      });

      assert.equal(plan.ok, true);
      assert.deepEqual(
        plan.ordering.map(row => row.scene_id),
        ["sc-002", "sc-001", "sc-003"]
      );
      assert.equal(plan.summary.estimated_word_count, 1200);
      assert.ok(plan.warning_summary.missing_ordering_fields);
    } finally {
      db.close();
    }
  });

  test("applies scene_ids as intersection with chapter filter", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 300,
      });
      insertTestScene(db, {
        sceneId: "sc-003",
        part: 1,
        chapter: 2,
        timelinePosition: 1,
        wordCount: 350,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        chapter: 1,
        scene_ids: ["sc-001", "sc-003"],
      });

      assert.deepEqual(plan.ordering.map(row => row.scene_id), ["sc-001"]);
      assert.deepEqual(plan.summary.excluded_scene_ids, ["sc-003"]);
      assert.ok(plan.warning_summary.requested_scene_ids_filtered_out);
    } finally {
      db.close();
    }
  });

  test("strictness fail blocks when stale scenes are included", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        metadataStale: 1,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
        strictness: "fail",
      });

      assert.equal(plan.strictness_result.can_proceed, false);
      assert.equal(plan.strictness_result.blockers[0].code, "STALE_METADATA");
      assert.ok(plan.warning_summary.metadata_stale);
    } finally {
      db.close();
    }
  });

  test("beta profile plans companion notice and feedback outputs", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-010",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Alex Reader",
        format: "both",
      });

      assert.equal(plan.ok, true);
      assert.equal(plan.resolved_scope.options.recipient_name, "Alex Reader");
      assert.ok(
        plan.planned_outputs.some(
          name =>
            name.endsWith(".md") &&
            !name.endsWith(".notice.md") &&
            !name.endsWith(".feedback-form.md")
        )
      );
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".pdf")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".notice.md")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".feedback-form.md")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".manifest.json")));
    } finally {
      db.close();
    }
  });

  test("beta profile normalizes recipient_name in resolved options", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-011",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "  Jordan\n\tExample  ",
      });

      assert.equal(plan.resolved_scope.options.recipient_name, "Jordan Example");
    } finally {
      db.close();
    }
  });

  test("renderReviewBundleMarkdown escapes outline loglines with markdown metacharacters", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-outline-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    fs.writeFileSync(scenePath, "Plain prose body.\n", "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          logline, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Markdown Test",
        1,
        1,
        1,
        10,
        "A *bold* [link] `code` logline",
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
      });
      const markdown = renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" });

      assert.ok(markdown.includes("A \\*bold\\* \\[link\\] \\`code\\` logline"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws when planned scene rows are missing", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-missing-rows-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    fs.writeFileSync(scenePath, "Plain prose body.\n", "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Missing Row Test",
        1,
        1,
        1,
        10,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      db.prepare(`DELETE FROM scenes WHERE scene_id = ? AND project_id = ?`).run("sc-001", "test-novel");

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "MISSING_SCENE_ROWS"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws when scene prose cannot be read", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-prose-read-"));
    // Use the real path to avoid macOS /tmp → /private/tmp symlink discrepancy.
    const realTempDir = fs.realpathSync.native(tempDir);
    const prevSyncDir = process.env.WRITING_SYNC_DIR;
    process.env.WRITING_SYNC_DIR = realTempDir;
    // Deliberately do NOT create the file — readProse should throw SCENE_PROSE_READ_FAILED.
    const scenePath = path.join(realTempDir, "sc-001.md");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sc-001", "test-novel", "Prose Read Test", 1, 1, 1, 10, scenePath, "deadbeef", 0, now);

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "SCENE_PROSE_READ_FAILED"
      );
    } finally {
      if (prevSyncDir === undefined) {
        delete process.env.WRITING_SYNC_DIR;
      } else {
        process.env.WRITING_SYNC_DIR = prevSyncDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws SCENE_PROSE_READ_FAILED when file_path is null", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-null-path-"));
    const realTempDir = fs.realpathSync.native(tempDir);
    const prevSyncDir = process.env.WRITING_SYNC_DIR;
    process.env.WRITING_SYNC_DIR = realTempDir;

    try {
      const now = new Date().toISOString();
      // Use a path outside syncDir — resolveSceneFilePath returns null,
      // which should trigger SCENE_PROSE_READ_FAILED rather than silent empty prose.
      const outsidePath = "/nonexistent-outside-sync/scene.md";
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sc-001", "test-novel", "Null Path Scene", 1, 1, 1, 10, outsidePath, null, 0, now);

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "SCENE_PROSE_READ_FAILED"
      );
    } finally {
      if (prevSyncDir === undefined) {
        delete process.env.WRITING_SYNC_DIR;
      } else {
        process.env.WRITING_SYNC_DIR = prevSyncDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// walkFiles
// ---------------------------------------------------------------------------
