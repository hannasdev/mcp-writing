import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildMoveScenePlan, buildSceneChapterAssignmentPlan } from "../../structure/scene-chapter-assignment.js";

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

describe("buildMoveScenePlan", () => {
  const chapter = {
    chapter_id: "ch-02-second",
    sort_index: 2,
    title: "Second",
  };

  test("moves a scene to a canonical chapter and timeline position", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildMoveScenePlan(syncDir, filePath, {
      scene_id: "sc-loose",
      title: "Loose",
      chapter_id: "ch-01-first",
      chapter: 1,
      chapter_title: "First",
      timeline_position: 3,
    }, {
      chapter,
      timelinePosition: 7,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.meta.chapter_id, "ch-02-second");
    assert.equal(plan.meta.chapter, 2);
    assert.equal(plan.meta.chapter_title, "Second");
    assert.equal(plan.meta.timeline_position, 7);
    assert.equal(plan.previousChapterId, "ch-01-first");
    assert.equal(plan.previousTimelinePosition, 3);
    assert.deepEqual(plan.assignedChapter, chapter);
  });

  test("updates timeline position while preserving the current chapter", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildMoveScenePlan(syncDir, filePath, {
      scene_id: "sc-loose",
      chapter_id: "ch-01-first",
      chapter: 1,
      chapter_title: "First",
      timeline_position: 3,
    }, {
      currentScene: {
        chapter_id: "ch-01-first",
        chapter: 1,
        chapter_title: "First",
        timeline_position: 3,
      },
      timelinePosition: 4,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.meta.chapter_id, "ch-01-first");
    assert.equal(plan.meta.chapter, 1);
    assert.equal(plan.meta.chapter_title, "First");
    assert.equal(plan.meta.timeline_position, 4);
    assert.equal(plan.previousTimelinePosition, 3);
  });

  test("returns null chapter payload for timeline-only unchaptered moves", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildMoveScenePlan(syncDir, filePath, {
      scene_id: "sc-loose",
      timeline_position: 3,
    }, {
      currentScene: {
        chapter_id: null,
        chapter: null,
        chapter_title: null,
        timeline_position: 3,
      },
      timelinePosition: 4,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.assignedChapter, null);
    assert.equal(plan.timelinePosition, 4);
  });

  test("carries indexed timeline position into sidecar metadata when changing chapters", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildMoveScenePlan(syncDir, filePath, {
      scene_id: "sc-loose",
      chapter_id: "ch-01-first",
      chapter: 1,
      chapter_title: "First",
    }, {
      currentScene: {
        chapter_id: "ch-01-first",
        chapter: 1,
        chapter_title: "First",
        timeline_position: 6,
      },
      chapter,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.meta.chapter_id, "ch-02-second");
    assert.equal(plan.meta.timeline_position, 6);
    assert.equal(plan.timelinePosition, 6);
  });

  test("rejects a move with no target chapter or timeline position", () => {
    const syncDir = "/sync";
    const filePath = path.join(syncDir, "projects", "book", "scenes", "loose.md");

    const plan = buildMoveScenePlan(syncDir, filePath, {
      scene_id: "sc-loose",
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.error.code, "VALIDATION_ERROR");
    assert.match(plan.error.message, /Provide chapter_id/);
  });
});
