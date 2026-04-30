import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../core/db.js";
import { registerMetadataTools } from "../../tools/metadata.js";

function makeToolHarness(db, { writable = true } = {}) {
  const handlers = new Map();
  const server = {
    tool(name, _description, _schema, handler) {
      handlers.set(name, handler);
    },
  };

  function jsonResponse(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }

  function errorResponse(code, message, details) {
    return jsonResponse({
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  }

  registerMetadataTools(server, {
    db,
    SYNC_DIR: "",
    SYNC_DIR_WRITABLE: writable,
    errorResponse,
    jsonResponse,
    createCanonicalWorldEntity: () => {
      throw new Error("createCanonicalWorldEntity should not be called in these tests");
    },
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

function seedReferenceDoc(db, { docId, projectId, title }) {
  db.prepare(`
    INSERT INTO reference_docs (
      doc_id, project_id, universe_id, type, title, summary, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(docId, projectId, null, "world", title, null, `/tmp/${projectId}-${docId}.md`);
}

describe("metadata upsert_reference_link tool", () => {
  test("returns READ_ONLY when writable mode is disabled", async () => {
    const db = openDb(":memory:");
    try {
      const tools = makeToolHarness(db, { writable: false });
      const parsed = await tools.call("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-001",
        target_doc_id: "ref-001",
        relation: "informs",
      });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "READ_ONLY");
    } finally {
      db.close();
    }
  });

  test("validates relation format", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });
      seedReferenceDoc(db, { docId: "ref-001", projectId: "test-novel", title: "Ref 1" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-001",
        source_project_id: "test-novel",
        target_doc_id: "ref-001",
        relation: "Bad Relation",
      });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "VALIDATION_ERROR");
    } finally {
      db.close();
    }
  });

  test("returns conflict for ambiguous scene IDs without source_project_id", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "alpha");
      seedProject(db, "beta");
      seedScene(db, { sceneId: "sc-shared", projectId: "alpha" });
      seedScene(db, { sceneId: "sc-shared", projectId: "beta" });
      seedReferenceDoc(db, { docId: "ref-001", projectId: "alpha", title: "Ref 1" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-shared",
        target_doc_id: "ref-001",
        relation: "informs",
      });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "CONFLICT");
      assert.deepEqual(parsed.error.details.project_ids, ["alpha", "beta"]);
    } finally {
      db.close();
    }
  });

  test("upserts scene->reference links idempotently by source and target", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });
      seedReferenceDoc(db, { docId: "ref-001", projectId: "test-novel", title: "Ref 1" });

      const tools = makeToolHarness(db);

      const created = await tools.call("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-001",
        source_project_id: "test-novel",
        target_doc_id: "ref-001",
        relation: "Informs",
      });
      assert.equal(created.ok, true);
      assert.equal(created.link.relation, "informs");

      const updated = await tools.call("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-001",
        source_project_id: "test-novel",
        target_doc_id: "ref-001",
        relation: "history_of",
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.link.relation, "history_of");

      const rows = db.prepare(`
        SELECT relation
        FROM reference_links
        WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-001' AND target_doc_id = 'ref-001'
      `).all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].relation, "history_of");
    } finally {
      db.close();
    }
  });

  test("creates reference->reference links and enforces project ownership check", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedReferenceDoc(db, { docId: "ref-source", projectId: "test-novel", title: "Source" });
      seedReferenceDoc(db, { docId: "ref-target", projectId: "test-novel", title: "Target" });

      const tools = makeToolHarness(db);
      const created = await tools.call("upsert_reference_link", {
        source_kind: "reference",
        source_id: "ref-source",
        source_project_id: "test-novel",
        target_doc_id: "ref-target",
        relation: "Related",
      });
      assert.equal(created.ok, true);
      assert.equal(created.link.source_kind, "reference");
      assert.equal(created.link.relation, "related");

      const mismatched = await tools.call("upsert_reference_link", {
        source_kind: "reference",
        source_id: "ref-source",
        source_project_id: "wrong-project",
        target_doc_id: "ref-target",
        relation: "related",
      });
      assert.equal(mismatched.ok, false);
      assert.equal(mismatched.error.code, "CONFLICT");
    } finally {
      db.close();
    }
  });

  test("reports unscoped reference ownership clearly in conflict details", async () => {
    const db = openDb(":memory:");
    try {
      seedReferenceDoc(db, { docId: "ref-global-source", projectId: null, title: "Global Source" });
      seedReferenceDoc(db, { docId: "ref-global-target", projectId: null, title: "Global Target" });

      const tools = makeToolHarness(db);
      const mismatched = await tools.call("upsert_reference_link", {
        source_kind: "reference",
        source_id: "ref-global-source",
        source_project_id: "test-novel",
        target_doc_id: "ref-global-target",
        relation: "related",
      });
      assert.equal(mismatched.ok, false);
      assert.equal(mismatched.error.code, "CONFLICT");
      assert.equal(mismatched.error.details.resolved_source_project_id, "");
      assert.equal(mismatched.error.details.source_project_id, "test-novel");
      assert.ok(mismatched.error.message.includes("unscoped/no project"));
    } finally {
      db.close();
    }
  });

  test("rejects reference self-links", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedReferenceDoc(db, { docId: "ref-self", projectId: "test-novel", title: "Self" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("upsert_reference_link", {
        source_kind: "reference",
        source_id: "ref-self",
        target_doc_id: "ref-self",
        relation: "related",
      });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "VALIDATION_ERROR");
    } finally {
      db.close();
    }
  });
});
