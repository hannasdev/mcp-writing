import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../core/db.js";
import {
  resolveValidatedChapterFilter,
  resolveValidatedChapterNumberFilters,
} from "../../core/chapter-resolution.js";

function seedProject(db, projectId = "test-novel") {
  db.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`)
    .run(projectId, null, "Test Novel");
}

function seedChapter(db, {
  projectId = "test-novel",
  chapterId = "ch-01-arrival",
  sortIndex = 1,
  title = "Arrival",
} = {}) {
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(chapterId, projectId, title, sortIndex, `/tmp/${chapterId}`, null, 0, new Date().toISOString());
}

function seedScene(db, {
  sceneId,
  projectId = "test-novel",
  chapterId,
  chapter,
  title = "Scene",
} = {}) {
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, chapter, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    chapterId,
    title,
    chapter,
    `/tmp/${sceneId}.md`,
    "deadbeef",
    0,
    new Date().toISOString()
  );
}

describe("chapter compatibility resolution", () => {
  test("resolves numeric compatibility chapters to canonical chapter identity", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);
      seedChapter(db, { chapterId: "ch-02-second", sortIndex: 2, title: "Second" });

      const result = resolveValidatedChapterFilter(db, {
        projectId: "test-novel",
        chapterNumber: 2,
      });

      assert.equal(result.error, undefined);
      assert.equal(result.chapter.chapter_id, "ch-02-second");
      assert.equal(result.chapter.sort_index, 2);
    } finally {
      db.close();
    }
  });

  test("rejects unresolved numeric compatibility chapters instead of falling back silently", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);

      const result = resolveValidatedChapterFilter(db, {
        projectId: "test-novel",
        chapterNumber: 7,
      });

      assert.equal(result.error.code, "NOT_FOUND");
      assert.equal(result.error.details.chapter, 7);
    } finally {
      db.close();
    }
  });

  test("rejects ambiguous scene-derived compatibility chapters", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);
      seedScene(db, { sceneId: "sc-001", chapterId: "ch-01-arrival", chapter: 1 });
      seedScene(db, { sceneId: "sc-002", chapterId: "ch-01-other", chapter: 1 });

      const result = resolveValidatedChapterFilter(db, {
        projectId: "test-novel",
        chapterNumber: 1,
      });

      assert.equal(result.error.code, "AMBIGUOUS_CHAPTER");
      assert.deepEqual(result.error.details.candidate_chapter_ids, ["ch-01-arrival", "ch-01-other"]);
    } finally {
      db.close();
    }
  });

  test("resolves chapter arrays to canonical chapter identities", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);
      seedChapter(db, { chapterId: "ch-03-third", sortIndex: 3, title: "Third" });
      seedChapter(db, { chapterId: "ch-01-first", sortIndex: 1, title: "First" });

      const result = resolveValidatedChapterNumberFilters(db, {
        projectId: "test-novel",
        chapterNumbers: [3, 1, 3],
      });

      assert.equal(result.error, undefined);
      assert.deepEqual(result.chapter_numbers, [1, 3]);
      assert.deepEqual(result.chapters.map(row => row.chapter_id), ["ch-01-first", "ch-03-third"]);
    } finally {
      db.close();
    }
  });

  test("rejects mixed chapter_id and chapter filters that resolve to different chapters", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);
      seedChapter(db, { chapterId: "ch-01-first", sortIndex: 1, title: "First" });
      seedChapter(db, { chapterId: "ch-02-second", sortIndex: 2, title: "Second" });

      const result = resolveValidatedChapterFilter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-first",
        chapterNumber: 2,
      });

      assert.equal(result.error.code, "VALIDATION_ERROR");
      assert.equal(
        result.error.message,
        "chapter_id and chapter must refer to the same canonical chapter when both are provided."
      );
      assert.deepEqual(result.error.details, {
        chapter_id: "ch-01-first",
        chapter: 2,
        resolved_chapter_id: "ch-02-second",
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed chapter arrays before resolving canonical identity", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db);

      const result = resolveValidatedChapterNumberFilters(db, {
        projectId: "test-novel",
        chapterNumbers: [1, null, 2.5, "3"],
      });

      assert.equal(result.error.code, "VALIDATION_ERROR");
      assert.equal(result.error.message, "chapters must contain only integer chapter numbers.");
      assert.deepEqual(result.error.details.invalid_chapters, [null, 2.5, "3"]);
      assert.deepEqual(result.error.details.requested_chapters, [1, null, 2.5, "3"]);
    } finally {
      db.close();
    }
  });
});
