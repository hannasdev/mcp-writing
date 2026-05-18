import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateChapterPlan,
  buildRenameChapterPlan,
  buildReorderChapterPlan,
  insertCanonicalChapter,
  renameCanonicalChapter,
  reorderCanonicalChapter,
} from "../../structure/chapter-commands.js";
import { setupReviewBundleTestDb } from "../helpers/db.js";

describe("buildCreateChapterPlan", () => {
  test("derives a canonical chapter id and prepares a chapter insert", () => {
    const db = setupReviewBundleTestDb();

    const plan = buildCreateChapterPlan(db, {
      projectId: "test-novel",
      title: "The Silver Door",
      sortIndex: 3,
      logline: "A door appears where the wall should be.",
      updatedAt: "2026-05-18T00:00:00.000Z",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.chapter.chapter_id, "ch-03-the-silver-door");
    assert.equal(plan.chapter.project_id, "test-novel");
    assert.equal(plan.chapter.title, "The Silver Door");
    assert.equal(plan.chapter.sort_index, 3);
    assert.equal(plan.chapter.logline, "A door appears where the wall should be.");
    assert.equal(plan.chapter.source_path, null);
    assert.equal(plan.diagnostics[0].code, "REPRESENTATION_DEFERRED");
  });

  test("rejects a reused sort index before writing", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildCreateChapterPlan(db, {
      projectId: "test-novel",
      title: "New Chapter",
      sortIndex: 3,
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.match(plan.error.message, /sort_index 3 is already used/);
    assert.equal(plan.error.details.existing_chapter_id, "ch-03-existing");
    assert.match(plan.error.details.next_step, /reorder_chapter/);
  });

  test("rejects duplicate chapter titles to avoid ambiguous title resolution", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildCreateChapterPlan(db, {
      projectId: "test-novel",
      title: "Existing",
      sortIndex: 4,
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.match(plan.error.message, /title 'Existing' is already used/);
    assert.equal(plan.error.details.existing_chapter_id, "ch-03-existing");
    assert.match(plan.error.details.next_step, /rename_chapter/);
  });
});

describe("buildRenameChapterPlan", () => {
  test("prepares a canonical title update and updates indexed scene compatibility", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });
    db.prepare(`
      INSERT INTO scenes (
        scene_id, project_id, chapter_id, title, chapter, chapter_title, file_path, prose_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sc-linked",
      "test-novel",
      "ch-03-existing",
      "Linked",
      3,
      "Existing",
      "/tmp/sc-linked.md",
      "deadbeef",
      0,
      "2026-05-18T00:00:00.000Z"
    );

    const plan = buildRenameChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      title: "Renamed",
      updatedAt: "2026-05-18T01:00:00.000Z",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.previousChapter.title, "Existing");
    assert.equal(plan.chapter.title, "Renamed");
    assert.deepEqual(plan.diagnostics, []);

    renameCanonicalChapter(db, plan.chapter);

    const chapter = db.prepare(`
      SELECT title
      FROM chapters
      WHERE project_id = ? AND chapter_id = ?
    `).get("test-novel", "ch-03-existing");
    const scene = db.prepare(`
      SELECT chapter_title
      FROM scenes
      WHERE project_id = ? AND scene_id = ?
    `).get("test-novel", "sc-linked");

    assert.equal(chapter.title, "Renamed");
    assert.equal(scene.chapter_title, "Renamed");
  });

  test("rejects a rename to another chapter title", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });
    insertCanonicalChapter(db, {
      chapter_id: "ch-04-other",
      project_id: "test-novel",
      title: "Other",
      sort_index: 4,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildRenameChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      title: "Other",
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.equal(plan.error.details.existing_chapter_id, "ch-04-other");
  });

  test("warns when the chapter still has a source folder representation", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: "projects/test-novel/scenes/Draft/03-Existing",
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildRenameChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      title: "Renamed",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.diagnostics[0].code, "REPRESENTATION_NOT_RENAMED");
    assert.equal(plan.diagnostics[0].details.source_path, "projects/test-novel/scenes/Draft/03-Existing");
  });
});

describe("buildReorderChapterPlan", () => {
  test("prepares a canonical order update and updates indexed scene compatibility", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });
    db.prepare(`
      INSERT INTO scenes (
        scene_id, project_id, chapter_id, title, chapter, chapter_title, file_path, prose_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sc-linked",
      "test-novel",
      "ch-03-existing",
      "Linked",
      3,
      "Existing",
      "/tmp/sc-linked.md",
      "deadbeef",
      0,
      "2026-05-18T00:00:00.000Z"
    );

    const plan = buildReorderChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      sortIndex: 7,
      updatedAt: "2026-05-18T01:00:00.000Z",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.previousChapter.sort_index, 3);
    assert.equal(plan.chapter.sort_index, 7);
    assert.deepEqual(plan.diagnostics, []);

    reorderCanonicalChapter(db, plan.chapter);

    const chapter = db.prepare(`
      SELECT sort_index
      FROM chapters
      WHERE project_id = ? AND chapter_id = ?
    `).get("test-novel", "ch-03-existing");
    const scene = db.prepare(`
      SELECT chapter, chapter_title
      FROM scenes
      WHERE project_id = ? AND scene_id = ?
    `).get("test-novel", "sc-linked");

    assert.equal(chapter.sort_index, 7);
    assert.equal(scene.chapter, 7);
    assert.equal(scene.chapter_title, "Existing");
  });

  test("rejects a reorder to another chapter sort index", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });
    insertCanonicalChapter(db, {
      chapter_id: "ch-04-other",
      project_id: "test-novel",
      title: "Other",
      sort_index: 4,
      logline: null,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildReorderChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      sortIndex: 4,
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.equal(plan.error.details.existing_chapter_id, "ch-04-other");
    assert.match(plan.error.details.next_step, /Automatic resequencing/);
  });

  test("warns when reordering a chapter with a source folder representation", () => {
    const db = setupReviewBundleTestDb();
    insertCanonicalChapter(db, {
      chapter_id: "ch-03-existing",
      project_id: "test-novel",
      title: "Existing",
      sort_index: 3,
      logline: null,
      source_path: "projects/test-novel/scenes/Draft/03-Existing",
      source_checksum: null,
      metadata_stale: 0,
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const plan = buildReorderChapterPlan(db, {
      projectId: "test-novel",
      chapterId: "ch-03-existing",
      sortIndex: 7,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.diagnostics[0].code, "REPRESENTATION_NOT_REORDERED");
    assert.equal(plan.diagnostics[0].details.source_path, "projects/test-novel/scenes/Draft/03-Existing");
  });
});
