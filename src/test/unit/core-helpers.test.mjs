import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../core/db.js";
import { resolveBatchTargetScenes } from "../../core/helpers.js";

function seedProject(db, projectId) {
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run(projectId, null, projectId);
}

function seedChapter(db, { projectId, chapterId, sortIndex, title }) {
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(chapterId, projectId, title, sortIndex, `/tmp/${chapterId}`, null, 0, new Date().toISOString());
}

function seedScene(db, {
  projectId,
  sceneId,
  chapterId,
  chapter,
  timelinePosition,
}) {
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, part, chapter, timeline_position,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    chapterId,
    sceneId,
    1,
    chapter,
    timelinePosition,
    `/tmp/${sceneId}.md`,
    "deadbeef",
    0,
    new Date().toISOString()
  );
}

describe("resolveBatchTargetScenes", () => {
  test("orders managed scenes by canonical chapter sort before compatibility fields", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-canonical",
        sortIndex: 1,
        title: "Canonical One",
      });
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-02-canonical",
        sortIndex: 2,
        title: "Canonical Two",
      });
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-second-canonical",
        chapterId: "ch-02-canonical",
        chapter: 1,
        timelinePosition: 1,
      });
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-first-canonical",
        chapterId: "ch-01-canonical",
        chapter: 99,
        timelinePosition: 1,
      });

      const result = resolveBatchTargetScenes(db, {
        projectId: "test-novel",
        onlyStale: false,
      });

      assert.equal(result.ok, true);
      assert.deepEqual(
        result.rows.map(row => row.scene_id),
        ["sc-first-canonical", "sc-second-canonical"]
      );
    } finally {
      db.close();
    }
  });
});
