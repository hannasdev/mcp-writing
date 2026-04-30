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
    GIT_ENABLED: false,
    errorResponse,
    paginateRows: (rows, _opts) => ({ paginated: false, rows, meta: null }),
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

function seedScene(db, { sceneId, projectId }) {
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(sceneId, projectId, sceneId, `/tmp/${projectId}-${sceneId}.md`, "deadbeef", new Date().toISOString());
}

function seedReferenceDoc(db, { docId, projectId, title, type = "reference", summary = null }) {
  db.prepare(`
    INSERT INTO reference_docs (
      doc_id, project_id, universe_id, type, title, summary, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(docId, projectId, null, type, title, summary, `/tmp/${projectId}-${docId}.md`);
}

function seedReferenceTag(db, { docId, tag }) {
  db.prepare(`
    INSERT INTO reference_doc_tags (doc_id, tag)
    VALUES (?, ?)
  `).run(docId, tag);
}

function seedReferenceLink(db, {
  sourceKind,
  sourceProjectId = "",
  sourceId,
  targetDocId,
  relation,
}) {
  db.prepare(`
    INSERT INTO reference_links (
      source_kind, source_project_id, source_id, target_doc_id, relation
    ) VALUES (?, ?, ?, ?, ?)
  `).run(sourceKind, sourceProjectId, sourceId, targetDocId, relation);
}

describe("reference link search tools", () => {
  test("list_scene_references returns conflict when scene_id is ambiguous across projects", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "alpha-novel");
      seedProject(db, "beta-novel");
      seedScene(db, { sceneId: "sc-shared", projectId: "alpha-novel" });
      seedScene(db, { sceneId: "sc-shared", projectId: "beta-novel" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("list_scene_references", { scene_id: "sc-shared" });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "CONFLICT");
      assert.deepEqual(parsed.error.details.project_ids, ["alpha-novel", "beta-novel"]);
    } finally {
      db.close();
    }
  });

  test("list_scene_references returns direct references with tags for scoped scene", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });
      seedReferenceDoc(db, {
        docId: "ref-vampirism",
        projectId: "test-novel",
        title: "Vampirism in this universe",
        type: "world",
      });
      seedReferenceTag(db, { docId: "ref-vampirism", tag: "vampirism" });
      seedReferenceTag(db, { docId: "ref-vampirism", tag: "lore" });
      seedReferenceLink(db, {
        sourceKind: "scene",
        sourceProjectId: "test-novel",
        sourceId: "sc-001",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("list_scene_references", {
        scene_id: "sc-001",
        project_id: "test-novel",
      });

      assert.equal(parsed.scene_id, "sc-001");
      assert.equal(parsed.project_id, "test-novel");
      assert.equal(parsed.references.length, 1);
      assert.equal(parsed.references[0].doc_id, "ref-vampirism");
      assert.deepEqual(parsed.references[0].tags, ["lore", "vampirism"]);
    } finally {
      db.close();
    }
  });

  test("get_reference_doc includes one-hop related docs only when requested", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedReferenceDoc(db, {
        docId: "ref-root",
        projectId: "test-novel",
        title: "Root Doc",
        type: "world",
      });
      seedReferenceTag(db, { docId: "ref-root", tag: "root" });
      seedReferenceDoc(db, {
        docId: "ref-related",
        projectId: "test-novel",
        title: "Related Doc",
        type: "continuity",
      });
      seedReferenceTag(db, { docId: "ref-related", tag: "related" });
      seedReferenceDoc(db, {
        docId: "ref-deep",
        projectId: "test-novel",
        title: "Deep Doc",
        type: "continuity",
      });
      seedReferenceTag(db, { docId: "ref-deep", tag: "deep" });

      seedReferenceLink(db, {
        sourceKind: "reference",
        sourceProjectId: "test-novel",
        sourceId: "ref-root",
        targetDocId: "ref-related",
        relation: "related",
      });
      // Exists in graph but should not be auto-expanded by one-hop response.
      seedReferenceLink(db, {
        sourceKind: "reference",
        sourceProjectId: "test-novel",
        sourceId: "ref-related",
        targetDocId: "ref-deep",
        relation: "related",
      });

      const tools = makeToolHarness(db);
      const withoutRelated = await tools.call("get_reference_doc", { doc_id: "ref-root" });
      assert.equal(withoutRelated.doc_id, "ref-root");
      assert.equal(withoutRelated.related, undefined);

      const withRelated = await tools.call("get_reference_doc", {
        doc_id: "ref-root",
        include_related: true,
      });
      assert.equal(withRelated.doc_id, "ref-root");
      assert.equal(withRelated.related.length, 1);
      assert.equal(withRelated.related[0].doc_id, "ref-related");
      assert.deepEqual(withRelated.related[0].tags, ["related"]);
      assert.ok(!withRelated.related.some(item => item.doc_id === "ref-deep"));
    } finally {
      db.close();
    }
  });
});
