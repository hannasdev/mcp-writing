import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCreateChapterPlan, insertCanonicalChapter } from "../../structure/chapter-commands.js";
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
