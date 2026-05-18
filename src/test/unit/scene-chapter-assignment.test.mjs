import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildSceneChapterAssignmentPlan } from "../../structure/scene-chapter-assignment.js";

describe("buildSceneChapterAssignmentPlan", () => {
  const chapter = {
    chapter_id: "ch-02-second",
    sort_index: 2,
    title: "Second",
  };

  test("builds sidecar fields for a canonical assignment", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildSceneChapterAssignmentPlan(syncDir, filePath, {
      scene_id: "sc-loose",
      title: "Loose",
    }, { chapter });

    assert.equal(plan.ok, true);
    assert.equal(plan.meta.chapter_id, "ch-02-second");
    assert.equal(plan.meta.chapter, 2);
    assert.equal(plan.meta.chapter_title, "Second");
    assert.deepEqual(plan.assignedChapter, chapter);
  });

  test("clears a chapter link for a scene without path-derived chapter structure", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildSceneChapterAssignmentPlan(syncDir, filePath, {
      scene_id: "sc-loose",
      chapter_id: "ch-02-second",
      chapter: 2,
      chapter_title: "Second",
    }, { chapter: null });

    assert.equal(plan.ok, true);
    assert.equal(plan.meta.chapter_id, null);
    assert.equal(plan.meta.chapter, null);
    assert.equal(plan.meta.chapter_title, null);
    assert.equal(plan.assignedChapter, null);
  });

  test("rejects clearing a path-chaptered scene", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "part-1", "chapter-1", "sc-001.md");

    const plan = buildSceneChapterAssignmentPlan(syncDir, filePath, {
      scene_id: "sc-001",
      chapter_id: "ch-01-first",
    }, { chapter: null });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.match(plan.error.message, /file path implies a chapter/);
  });

  test("rejects assignment that conflicts with explicit folder-derived structure", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "Draft", "01-First", "sc-001.md");

    const plan = buildSceneChapterAssignmentPlan(syncDir, filePath, {
      scene_id: "sc-001",
    }, { chapter });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.equal(plan.error.details.requested_chapter_id, "ch-02-second");
    assert.equal(plan.error.details.path_chapter, "ch-01-first");
  });

  test("rejects assignment that conflicts with legacy path-derived chapter structure", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "part-1", "chapter-1", "sc-001.md");

    const plan = buildSceneChapterAssignmentPlan(syncDir, filePath, {
      scene_id: "sc-001",
    }, { chapter });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.equal(plan.error.details.requested_chapter_id, "ch-02-second");
    assert.equal(plan.error.details.requested_chapter, 2);
    assert.equal(plan.error.details.path_chapter, "ch-01-chapter-1");
    assert.equal(plan.error.details.path_chapter_number, 1);
  });
});
