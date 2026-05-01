import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../core/db.js";
import { registerSearchTools } from "../../tools/search.js";
import { upsertExplicitReferenceLinkRow } from "../../tools/reference-link-persistence.js";

function makeToolHarness(db, { syncDir = "", writable = false } = {}) {
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
    SYNC_DIR: syncDir,
    SYNC_DIR_WRITABLE: writable,
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
  origin = "inferred",
}) {
  db.prepare(`
    INSERT INTO reference_links (
      source_kind, source_project_id, source_id, target_doc_id, relation, origin
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceKind, sourceProjectId, sourceId, targetDocId, relation, origin);
}

describe("reference link search tools", () => {
  test("upsertExplicitReferenceLinkRow is atomic when insert fails", () => {
    class FakeDb {
      constructor() {
        this.rows = [
          {
            source_kind: "scene",
            source_project_id: "test-novel",
            source_id: "sc-001",
            target_doc_id: "ref-vampirism",
            relation: "informs",
            origin: "explicit",
          },
        ];
      }

      prepare(sql) {
        if (sql.includes("DELETE FROM reference_links")) {
          return {
            run: (sourceKind, sourceProjectId, sourceId, targetDocId) => {
              this.rows = this.rows.filter((row) => !(
                row.source_kind === sourceKind
                && row.source_project_id === sourceProjectId
                && row.source_id === sourceId
                && row.target_doc_id === targetDocId
              ));
            },
          };
        }

        if (sql.includes("INSERT INTO reference_links")) {
          return {
            run: () => {
              throw new Error("simulated insert failure");
            },
          };
        }

        throw new Error(`Unexpected SQL in fake db: ${sql}`);
      }

      transaction(fn) {
        return () => {
          const snapshot = structuredClone(this.rows);
          try {
            fn();
          } catch (err) {
            this.rows = snapshot;
            throw err;
          }
        };
      }
    }

    const db = new FakeDb();
    assert.throws(
      () => upsertExplicitReferenceLinkRow(db, {
        sourceKind: "scene",
        sourceProjectId: "test-novel",
        sourceId: "sc-001",
        targetDocId: "ref-vampirism",
        relation: "see_also",
      }),
      /simulated insert failure/
    );

    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].relation, "informs");
  });

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

  test("suggest_scene_references scores references by character/place links", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });
      
      // Create characters and places
      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");
      
      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-sebastian", "test-novel", "Sebastian", "/tmp/sebastian.md");
      
      db.prepare(`
        INSERT INTO places (place_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("place-hospital", "test-novel", "Hospital", "/tmp/hospital.md");
      
      // Add scene characters and places
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-sebastian");
      db.prepare(`INSERT INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run("sc-001", "place-hospital");
      
      // Create reference docs
      seedReferenceDoc(db, { docId: "ref-vampirism", projectId: "test-novel", title: "Vampirism in the World", type: "world" });
      seedReferenceDoc(db, { docId: "ref-hospital-layout", projectId: "test-novel", title: "Hospital Layout", type: "world" });
      seedReferenceDoc(db, { docId: "ref-unrelated", projectId: "test-novel", title: "Unrelated Doc", type: "world" });
      
      // Link references to characters and places
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-sebastian",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });
      seedReferenceLink(db, {
        sourceKind: "place",
        sourceProjectId: "test-novel",
        sourceId: "place-hospital",
        targetDocId: "ref-hospital-layout",
        relation: "informs",
      });
      
      const tools = makeToolHarness(db);
      const suggestions = await tools.call("suggest_scene_references", { scene_id: "sc-001", project_id: "test-novel" });
      
      assert.equal(suggestions.scene_id, "sc-001");
      assert.equal(suggestions.total_candidates, 2);
      
      // Check scoring: vampirism should be first (score 2: 2 characters link to it)
      assert.equal(suggestions.candidates[0].doc_id, "ref-vampirism");
      assert.equal(suggestions.candidates[0].score, 2);
      assert.equal(suggestions.candidates[0].sources.length, 2);
      
      // Hospital layout should be second (score 1: 1 place links to it)
      assert.equal(suggestions.candidates[1].doc_id, "ref-hospital-layout");
      assert.equal(suggestions.candidates[1].score, 1);
      assert.equal(suggestions.candidates[1].sources.length, 1);
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references excludes already-explicit scene links", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });
      
      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");
      
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");
      
      seedReferenceDoc(db, { docId: "ref-vampirism", projectId: "test-novel", title: "Vampirism", type: "world" });
      
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });
      
      // Add an explicit scene link to the same reference
      seedReferenceLink(db, {
        sourceKind: "scene",
        sourceProjectId: "test-novel",
        sourceId: "sc-001",
        targetDocId: "ref-vampirism",
        relation: "informs",
        origin: "explicit",
      });
      
      const tools = makeToolHarness(db);
      const suggestions = await tools.call("suggest_scene_references", { scene_id: "sc-001", project_id: "test-novel" });
      
      // Should return empty suggestions because the only candidate is already explicitly linked
      assert.equal(suggestions.total_candidates, 0);
      assert.equal(suggestions.candidates.length, 0);
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references excludes explicit scene links even when relation differs", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");

      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");

      seedReferenceDoc(db, { docId: "ref-vampirism", projectId: "test-novel", title: "Vampirism", type: "world" });

      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });

      // Explicit scene link points to the same doc with a different relation.
      seedReferenceLink(db, {
        sourceKind: "scene",
        sourceProjectId: "test-novel",
        sourceId: "sc-001",
        targetDocId: "ref-vampirism",
        relation: "see_also",
        origin: "explicit",
      });

      const tools = makeToolHarness(db);
      const suggestions = await tools.call("suggest_scene_references", { scene_id: "sc-001", project_id: "test-novel" });

      assert.equal(suggestions.total_candidates, 0);
      assert.equal(suggestions.candidates.length, 0);
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references ignores links from other projects", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedProject(db, "other-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");

      db.prepare(`
        INSERT INTO places (place_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("place-hospital", "test-novel", "Hospital", "/tmp/hospital.md");

      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");
      db.prepare(`INSERT INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run("sc-001", "place-hospital");

      seedReferenceDoc(db, { docId: "ref-correct", projectId: "test-novel", title: "Correct Doc", type: "world" });
      seedReferenceDoc(db, { docId: "ref-foreign", projectId: "other-novel", title: "Foreign Doc", type: "world" });

      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-correct",
        relation: "informs",
      });
      seedReferenceLink(db, {
        sourceKind: "place",
        sourceProjectId: "test-novel",
        sourceId: "place-hospital",
        targetDocId: "ref-correct",
        relation: "informs",
      });

      // Same source IDs, but links from another project should not affect score or candidates.
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "other-novel",
        sourceId: "char-mira",
        targetDocId: "ref-foreign",
        relation: "informs",
      });
      seedReferenceLink(db, {
        sourceKind: "place",
        sourceProjectId: "other-novel",
        sourceId: "place-hospital",
        targetDocId: "ref-foreign",
        relation: "informs",
      });

      const tools = makeToolHarness(db);
      const suggestions = await tools.call("suggest_scene_references", { scene_id: "sc-001", project_id: "test-novel" });

      assert.equal(suggestions.total_candidates, 1);
      assert.equal(suggestions.candidates[0].doc_id, "ref-correct");
      assert.equal(suggestions.candidates[0].score, 2);
      assert.equal(suggestions.candidates[0].sources.length, 2);
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references uses resolved scene metadata to avoid cross-project scene_id leakage", async () => {
    const db = openDb(":memory:");
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-suggest-meta-"));
    try {
      seedProject(db, "test-novel");
      seedProject(db, "other-novel");

      const testSceneDir = path.join(syncDir, "projects", "test-novel", "scenes");
      fs.mkdirSync(testSceneDir, { recursive: true });
      const testScenePath = path.join(testSceneDir, "sc-001.md");
      fs.writeFileSync(
        testScenePath,
        "---\nscene_id: sc-001\ncharacters:\n  - char-mira\n---\nScene prose.",
        "utf8"
      );

      // Same scene_id in another project to reproduce potential join-table leakage.
      const otherScenePath = path.join(syncDir, "projects", "other-novel", "scenes", "sc-001.md");
      fs.mkdirSync(path.dirname(otherScenePath), { recursive: true });
      fs.writeFileSync(otherScenePath, "---\nscene_id: sc-001\ncharacters:\n  - char-ghost\n---\nOther prose.", "utf8");

      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-001", "test-novel", "Scene 1", testScenePath, "deadbeef", new Date().toISOString());

      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-001", "other-novel", "Scene 1", otherScenePath, "deadbeef", new Date().toISOString());

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-ghost", "test-novel", "Ghost", "/tmp/ghost.md");

      // Join table contains both rows because it is not project-scoped.
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-ghost");

      seedReferenceDoc(db, { docId: "ref-correct", projectId: "test-novel", title: "Correct Doc", type: "world" });
      seedReferenceDoc(db, { docId: "ref-leaked", projectId: "test-novel", title: "Leaked Doc", type: "world" });

      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-correct",
        relation: "informs",
      });
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-ghost",
        targetDocId: "ref-leaked",
        relation: "informs",
      });

      const tools = makeToolHarness(db, { syncDir, writable: true });
      const suggestions = await tools.call("suggest_scene_references", { scene_id: "sc-001", project_id: "test-novel" });

      assert.equal(suggestions.total_candidates, 1);
      assert.equal(suggestions.candidates[0].doc_id, "ref-correct");
      assert.equal(suggestions.candidates[0].score, 1);
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("suggest_scene_references returns not-found for non-existent scene", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      
      const tools = makeToolHarness(db);
      const result = await tools.call("suggest_scene_references", { scene_id: "sc-nonexistent", project_id: "test-novel" });
      
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "NOT_FOUND");
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references apply mode returns READ_ONLY when sync dir is not writable", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-001", projectId: "test-novel" });

      const tools = makeToolHarness(db, { writable: false });
      const result = await tools.call("suggest_scene_references", {
        scene_id: "sc-001",
        project_id: "test-novel",
        mode: "apply",
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "READ_ONLY");
    } finally {
      db.close();
    }
  });

  test("suggest_scene_references apply mode persists explicit scene links", async () => {
    const db = openDb(":memory:");
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-apply-"));
    try {
      seedProject(db, "test-novel");

      const sceneDir = path.join(syncDir, "projects", "test-novel", "scenes");
      fs.mkdirSync(sceneDir, { recursive: true });
      const scenePath = path.join(sceneDir, "sc-001.md");
      fs.writeFileSync(scenePath, "---\nscene_id: sc-001\ntitle: Scene 1\n---\nScene prose.", "utf8");

      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-001", "test-novel", "Scene 1", scenePath, "deadbeef", new Date().toISOString());

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");

      seedReferenceDoc(db, { docId: "ref-vampirism", projectId: "test-novel", title: "Vampirism", type: "world" });
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });

      const tools = makeToolHarness(db, { syncDir, writable: true });
      const result = await tools.call("suggest_scene_references", {
        scene_id: "sc-001",
        project_id: "test-novel",
        mode: "apply",
      });

      assert.equal(result.applied_count, 1);
      assert.equal(result.applied_links.length, 1);
      assert.equal(result.applied_links[0].target_doc_id, "ref-vampirism");

      const row = db.prepare(`
        SELECT relation, origin
        FROM reference_links
        WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-001' AND target_doc_id = 'ref-vampirism'
      `).get();
      assert.equal(row.relation, "informs");
      assert.equal(row.origin, "explicit");

      const sidecar = fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8");
      assert.match(sidecar, /reference_links:/);
      assert.match(sidecar, /target_doc_id: ref-vampirism/);
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("suggest_scene_references apply mode reports failures when scene path is stale", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");

      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-001", "test-novel", "Scene 1", "/tmp/missing-scene.md", "deadbeef", new Date().toISOString());

      db.prepare(`
        INSERT INTO characters (character_id, project_id, name, file_path)
        VALUES (?, ?, ?, ?)
      `).run("char-mira", "test-novel", "Mira", "/tmp/mira.md");
      db.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");

      seedReferenceDoc(db, { docId: "ref-vampirism", projectId: "test-novel", title: "Vampirism", type: "world" });
      seedReferenceLink(db, {
        sourceKind: "character",
        sourceProjectId: "test-novel",
        sourceId: "char-mira",
        targetDocId: "ref-vampirism",
        relation: "informs",
      });

      const tools = makeToolHarness(db, { writable: true });
      const result = await tools.call("suggest_scene_references", {
        scene_id: "sc-001",
        project_id: "test-novel",
        mode: "apply",
      });

      assert.equal(result.applied_count, 0);
      assert.equal(result.failed_count, 1);
      assert.equal(result.failed_links.length, 1);
      assert.equal(result.failed_links[0].target_doc_id, "ref-vampirism");
      assert.equal(result.failed_links[0].stage, "metadata");
      assert.equal(result.failed_links[0].code, "ENOENT");
    } finally {
      db.close();
    }
  });
});
