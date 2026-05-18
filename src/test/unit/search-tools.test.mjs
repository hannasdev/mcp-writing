import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../core/db.js";
import { registerSearchTools } from "../../tools/search.js";

function makeToolHarness(db) {
  const handlers = new Map();
  const server = {
    tool(name, _description, _schema, handler) {
      handlers.set(name, handler);
    },
  };

  function errorResponse(code, message, details) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code,
            message,
            ...(details ? { details } : {}),
          },
        }),
      }],
    };
  }

  registerSearchTools(server, {
    db,
    SYNC_DIR: "",
    SYNC_DIR_WRITABLE: false,
    GIT_ENABLED: false,
    errorResponse,
    paginateRows: (rows) => ({ paginated: false, rows, meta: null }),
    DEFAULT_METADATA_PAGE_SIZE: 20,
    MAX_CHAPTER_SCENES: 20,
    getSceneProseAtCommit: () => "",
    readSupportingNotesForEntity: () => [],
    readEntityMetadata: () => ({}),
  });

  return {
    async call(name, args) {
      const handler = handlers.get(name);
      assert.ok(handler, `Expected tool '${name}' to be registered`);
      const result = await handler(args);
      return JSON.parse(result.content?.[0]?.text ?? "{}");
    },
  };
}

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
  title = sceneId,
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
    title,
    1,
    chapter,
    timelinePosition,
    `/tmp/${sceneId}.md`,
    "deadbeef",
    0,
    new Date().toISOString()
  );
}

describe("search tools chapter compatibility filters", () => {
  test("find_scenes resolves project-scoped chapter filters through canonical chapter identity", async () => {
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
        sceneId: "sc-canonical-match",
        chapterId: "ch-01-canonical",
        chapter: 99,
        timelinePosition: 1,
      });
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-legacy-only-match",
        chapterId: null,
        chapter: 1,
        timelinePosition: 2,
      });
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-other-canonical",
        chapterId: "ch-02-canonical",
        chapter: 1,
        timelinePosition: 3,
      });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("find_scenes", {
        project_id: "test-novel",
        chapter: 1,
      });

      assert.equal(parsed.total_count, 1);
      assert.deepEqual(parsed.results.map(row => row.scene_id), ["sc-canonical-match"]);
      assert.equal(parsed.results[0].chapter_id, "ch-01-canonical");
      assert.equal(parsed.results[0].chapter, 99);
    } finally {
      db.close();
    }
  });
});
