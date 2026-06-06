import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { openDb } from "../../core/db.js";
import { registerMetadataTools } from "../../tools/metadata.js";

const SEED_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-metadata-tools-"));
let seedCounter = 0;

after(() => {
  fs.rmSync(SEED_TMP_DIR, { recursive: true, force: true });
});

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
    SYNC_DIR: SEED_TMP_DIR,
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

function seedProject(db, projectId, { universeId = null } = {}) {
  if (universeId) {
    db.prepare(`
      INSERT OR IGNORE INTO universes (universe_id, name)
      VALUES (?, ?)
    `).run(universeId, universeId);
  }
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run(projectId, universeId, projectId);
}

function seedScene(db, { sceneId, projectId }) {
  seedCounter += 1;
  const scenePath = path.join(SEED_TMP_DIR, `${projectId}-${sceneId}-${seedCounter}.md`);
  fs.writeFileSync(
    scenePath,
    `---\nscene_id: ${sceneId}\ntitle: ${sceneId}\n---\nScene prose.`,
    "utf8"
  );
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(sceneId, projectId, sceneId, scenePath, "deadbeef", new Date().toISOString());
}

function seedProjectSceneFile(db, { sceneId, projectId, metadata = {} }) {
  seedCounter += 1;
  const sceneDir = path.join(SEED_TMP_DIR, "projects", projectId, "scenes");
  fs.mkdirSync(sceneDir, { recursive: true });
  const scenePath = path.join(sceneDir, `${sceneId}-${seedCounter}.md`);
  const frontmatter = yaml.dump({
    scene_id: sceneId,
    title: sceneId,
    ...metadata,
  });
  fs.writeFileSync(scenePath, `---\n${frontmatter}---\nScene prose.`, "utf8");
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(sceneId, projectId, sceneId, scenePath, "deadbeef", new Date().toISOString());
  return scenePath;
}

function seedReferenceDoc(db, { docId, projectId, title }) {
  seedCounter += 1;
  const referencePath = path.join(SEED_TMP_DIR, `${projectId ?? "global"}-${docId}-${seedCounter}.md`);
  fs.writeFileSync(
    referencePath,
    `---\ndoc_id: ${docId}\ntitle: ${title}\n---\nReference body.`,
    "utf8"
  );
  db.prepare(`
    INSERT INTO reference_docs (
      doc_id, project_id, universe_id, type, title, summary, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(docId, projectId, null, "world", title, null, referencePath);
}

function seedCharacter(db, { characterId, projectId, universeId = null, name = characterId, filePath = null }) {
  const characterPath = filePath ?? path.join(SEED_TMP_DIR, `${projectId ?? universeId ?? "global"}-${characterId}-${++seedCounter}.md`);
  if (!filePath) {
    fs.writeFileSync(
      characterPath,
      `---\ncharacter_id: ${characterId}\nname: ${name}\n---\nCharacter notes.`,
      "utf8"
    );
  }
  db.prepare(`
    INSERT INTO characters (
      character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(characterId, projectId, universeId, name, null, null, null, characterPath);
}

function seedPlace(db, { placeId, projectId, universeId = null, name = placeId, filePath = null }) {
  const placePath = filePath ?? path.join(SEED_TMP_DIR, `${projectId ?? universeId ?? "global"}-${placeId}-${++seedCounter}.md`);
  if (!filePath) {
    fs.writeFileSync(
      placePath,
      `---\nplace_id: ${placeId}\nname: ${name}\n---\nPlace notes.`,
      "utf8"
    );
  }
  db.prepare(`
    INSERT INTO places (place_id, project_id, universe_id, name, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(placeId, projectId, universeId, name, placePath);
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
      assert.deepEqual(created.mutation_order, [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ]);
      assert.equal(created.compatibility_output.generated_transparency, true);
      assert.equal(created.compatibility_output.mutation_surface, false);
      assert.equal(created.compatibility_output.refreshed, true);
      assert.deepEqual(created.compatibility_diagnostics, []);

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

  test("link_reference_evidence exposes the outcome-oriented reference workflow", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-evidence", projectId: "test-novel" });
      seedReferenceDoc(db, { docId: "ref-evidence", projectId: "test-novel", title: "Evidence Ref" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("link_reference_evidence", {
        source_kind: "scene",
        source_id: "sc-evidence",
        source_project_id: "test-novel",
        target_doc_id: "ref-evidence",
        relation: "Informs",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.action, "linked");
      assert.equal(parsed.link.source_kind, "scene");
      assert.equal(parsed.link.source_project_id, "test-novel");
      assert.equal(parsed.link.source_id, "sc-evidence");
      assert.equal(parsed.link.target_doc_id, "ref-evidence");
      assert.equal(parsed.link.relation, "informs");
      assert.deepEqual(parsed.mutation_order, [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ]);
      assert.equal(parsed.compatibility_output.generated_transparency, true);
      assert.equal(parsed.compatibility_output.mutation_surface, false);
      assert.equal(parsed.compatibility_output.refreshed, true);

      const row = db.prepare(`
        SELECT relation, origin
        FROM reference_links
        WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-evidence' AND target_doc_id = 'ref-evidence'
      `).get();
      assert.equal(row.relation, "informs");
      assert.equal(row.origin, "explicit");
    } finally {
      db.close();
    }
  });

  test("link_reference_evidence commits SQLite when compatibility output is stale", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-stale-output", projectId: "test-novel" });
      seedReferenceDoc(db, { docId: "ref-stale-output", projectId: "test-novel", title: "Stale Output Ref" });
      const filePath = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get("sc-stale-output", "test-novel").file_path;
      fs.rmSync(filePath, { force: true });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("link_reference_evidence", {
        source_kind: "scene",
        source_id: "sc-stale-output",
        source_project_id: "test-novel",
        target_doc_id: "ref-stale-output",
        relation: "informs",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.compatibility_output.refreshed, false);
      assert.equal(parsed.compatibility_diagnostics[0].severity, "warning");
      assert.equal(parsed.compatibility_diagnostics[0].details.indexed_path, filePath);

      const row = db.prepare(`
        SELECT relation, origin
        FROM reference_links
        WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-stale-output' AND target_doc_id = 'ref-stale-output'
      `).get();
      assert.equal(row.relation, "informs");
      assert.equal(row.origin, "explicit");
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

describe("metadata update_scene_metadata relationship guardrail", () => {
  test("rejects characters and places before writing sidecar metadata or relationship indexes", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-elena", projectId: "test-novel", name: "Elena" });
      seedCharacter(db, { characterId: "char-marcus", projectId: "test-novel", name: "Marcus" });
      seedPlace(db, { placeId: "place-harbor", projectId: "test-novel", name: "Harbor" });
      const scenePath = seedProjectSceneFile(db, {
        sceneId: "sc-relationship-characterization",
        projectId: "test-novel",
        metadata: {
          characters: ["char-elena"],
          places: ["place-harbor"],
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-relationship-characterization", "test-novel", "char-elena");
      db.prepare(`
        INSERT INTO scene_places (scene_id, project_id, place_id)
        VALUES (?, ?, ?)
      `).run("sc-relationship-characterization", "test-novel", "place-harbor");

      const sidecarPath = scenePath.replace(/\.md$/, ".meta.yaml");
      const sourceBefore = fs.readFileSync(scenePath, "utf8");
      assert.equal(fs.existsSync(sidecarPath), false);

      const tools = makeToolHarness(db);
      const parsed = await tools.call("update_scene_metadata", {
        scene_id: "sc-relationship-characterization",
        project_id: "test-novel",
        fields: {
          characters: ["char-marcus"],
          places: [],
        },
      });

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "VALIDATION_ERROR");
      assert.match(parsed.error.message, /relationship-boundary fields/);
      assert.deepEqual(parsed.error.details.blocked_fields, ["characters", "places"]);
      assert.deepEqual(parsed.error.details.relationship_tools, [
        "connect_character_place_evidence",
        "connect_scene_character_evidence",
        "connect_scene_place_evidence",
        "audit_relationship_metadata",
      ]);
      assert.ok(parsed.error.details.discovery_workflows.includes("find_scenes"));
      assert.ok(parsed.error.details.discovery_workflows.includes("list_characters"));
      assert.ok(parsed.error.details.discovery_workflows.includes("list_places"));
      assert.match(parsed.error.details.next_step, /connect_character_place_evidence/);
      assert.match(parsed.error.details.next_step, /audit_relationship_metadata/);
      assert.match(parsed.error.details.next_step, /find_scenes/);
      assert.match(parsed.error.details.next_step, /paired sheet-backed character\/place evidence/);
      assert.match(parsed.error.details.next_step, /connect_scene_character_evidence/);
      assert.match(parsed.error.details.next_step, /connect_scene_place_evidence/);
      assert.equal(fs.existsSync(sidecarPath), false);
      assert.equal(fs.readFileSync(scenePath, "utf8"), sourceBefore);

      const sceneCharacters = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = ? AND project_id = ?
        ORDER BY character_id
      `).all("sc-relationship-characterization", "test-novel").map((row) => row.character_id);
      const scenePlaces = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = ? AND project_id = ?
        ORDER BY place_id
      `).all("sc-relationship-characterization", "test-novel").map((row) => row.place_id);

      assert.deepEqual(sceneCharacters, ["char-elena"]);
      assert.deepEqual(scenePlaces, ["place-harbor"]);
    } finally {
      db.close();
    }
  });

  test("continues to update allowed editorial metadata without changing relationship indexes", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "sidecarstalecharacter", projectId: "test-novel", name: "Stale Sidecar Character" });
      seedCharacter(db, { characterId: "canonicalcharacter", projectId: "test-novel", name: "Canonical Character" });
      seedPlace(db, { placeId: "sidecarstaleplace", projectId: "test-novel", name: "Stale Sidecar Place" });
      seedPlace(db, { placeId: "canonicalplace", projectId: "test-novel", name: "Canonical Place" });
      const scenePath = seedProjectSceneFile(db, {
        sceneId: "sc-relationship-allowed-update",
        projectId: "test-novel",
        metadata: {
          characters: "sidecarstalecharacter, v7.3",
          places: ["sidecarstaleplace"],
          logline: "Original logline.",
          versions: ["v8.1"],
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-relationship-allowed-update", "test-novel", "canonicalcharacter");
      db.prepare(`
        INSERT INTO scene_places (scene_id, project_id, place_id)
        VALUES (?, ?, ?)
      `).run("sc-relationship-allowed-update", "test-novel", "canonicalplace");

      const tools = makeToolHarness(db);
      const parsed = await tools.call("update_scene_metadata", {
        scene_id: "sc-relationship-allowed-update",
        project_id: "test-novel",
        fields: {
          logline: "Allowed editorial update.",
          status: "revision",
          tags: ["relationship-boundary"],
          story_time: "Act II night",
        },
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.action, "updated");

      const sidecar = yaml.load(fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8"));
      assert.equal(sidecar.logline, "Allowed editorial update.");
      assert.equal(sidecar.status, "revision");
      assert.deepEqual(sidecar.tags, ["relationship-boundary"]);
      assert.equal(sidecar.story_time, "Act II night");
      assert.equal(sidecar.characters, "sidecarstalecharacter, v7.3");
      assert.deepEqual(sidecar.places, ["sidecarstaleplace"]);
      assert.deepEqual(sidecar.versions, ["v8.1"]);

      const sceneCharacters = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = ? AND project_id = ?
        ORDER BY character_id
      `).all("sc-relationship-allowed-update", "test-novel").map((row) => row.character_id);
      const scenePlaces = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = ? AND project_id = ?
        ORDER BY place_id
      `).all("sc-relationship-allowed-update", "test-novel").map((row) => row.place_id);

      assert.deepEqual(sceneCharacters, ["canonicalcharacter"]);
      assert.deepEqual(scenePlaces, ["canonicalplace"]);

      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get("sidecarstalecharacter").count,
        0
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get("sidecarstaleplace").count,
        0
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get("canonicalcharacter").count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get("canonicalplace").count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"v7.3"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"v8.1"').count,
        1
      );
    } finally {
      db.close();
    }
  });
});

describe("metadata relationship outcome tools", () => {
  test("connect_character_place_evidence writes scene relationship indexes before compatibility output", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-evidence", projectId: "test-novel" });
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira" });
      seedPlace(db, { placeId: "place-harbor", projectId: "test-novel", name: "Harbor" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_character_place_evidence", {
        project_id: "test-novel",
        scene_id: "sc-evidence",
        character_id: "char-mira",
        place_id: "place-harbor",
        note: "Mira reaches the harbor here.",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.action, "connected");
      assert.deepEqual(parsed.mutation_order, [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ]);
      assert.equal(parsed.compatibility_output.mutation_surface, false);

      const sceneCharacter = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = 'sc-evidence' AND project_id = 'test-novel'
      `).get();
      const scenePlace = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = 'sc-evidence' AND project_id = 'test-novel'
      `).get();
      assert.equal(sceneCharacter.character_id, "char-mira");
      assert.equal(scenePlace.place_id, "place-harbor");
    } finally {
      db.close();
    }
  });

  test("connect_character_place_evidence warns when scene compatibility output has no usable indexed path", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-no-path", "test-novel", "Scene Without Path", "", "deadbeef", new Date().toISOString());
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira" });
      seedPlace(db, { placeId: "place-harbor", projectId: "test-novel", name: "Harbor" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_character_place_evidence", {
        project_id: "test-novel",
        scene_id: "sc-no-path",
        character_id: "char-mira",
        place_id: "place-harbor",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.compatibility_output.refreshed, false);
      assert.equal(parsed.compatibility_output.diagnostics[0].code, "STALE_PATH");
      assert.equal(parsed.compatibility_output.diagnostics[0].details.indexed_path, null);

      const sceneCharacter = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = 'sc-no-path' AND project_id = 'test-novel'
      `).get();
      const scenePlace = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = 'sc-no-path' AND project_id = 'test-novel'
      `).get();
      assert.equal(sceneCharacter.character_id, "char-mira");
      assert.equal(scenePlace.place_id, "place-harbor");
    } finally {
      db.close();
    }
  });

  test("connect_scene_character_evidence warns when scene compatibility output has no usable indexed path", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-one-sided-no-path", "test-novel", "One-Sided Scene Without Path", "", "deadbeef", new Date().toISOString());
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_scene_character_evidence", {
        project_id: "test-novel",
        scene_id: "sc-one-sided-no-path",
        character_id: "char-mira",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.already_linked, false);
      assert.equal(parsed.compatibility_output.refreshed, false);
      assert.equal(parsed.compatibility_output.diagnostics[0].code, "STALE_PATH");
      assert.equal(parsed.compatibility_output.diagnostics[0].details.indexed_path, null);
      assert.equal(parsed.operation_history.appended, true);
      assert.equal(parsed.backup_refresh.ok, true);

      const sceneCharacterCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM scene_characters
        WHERE scene_id = ? AND project_id = ? AND character_id = ?
      `).get("sc-one-sided-no-path", "test-novel", "char-mira").count;
      const scenePlaceCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM scene_places
        WHERE scene_id = ? AND project_id = ?
      `).get("sc-one-sided-no-path", "test-novel").count;
      assert.equal(sceneCharacterCount, 1);
      assert.equal(scenePlaceCount, 0);
    } finally {
      db.close();
    }
  });

  test("connect_scene_character_evidence adds only a character link and regenerates compatibility output from canonical rows", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira" });
      const scenePath = seedProjectSceneFile(db, {
        sceneId: "sc-character-only",
        projectId: "test-novel",
        metadata: {
          characters: ["stale-sidecar-character"],
          places: ["stale-sidecar-place"],
        },
      });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_scene_character_evidence", {
        project_id: "test-novel",
        scene_id: "sc-character-only",
        character_id: "char-mira",
        note: "Mira appears without a specific place beat.",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.action, "connected");
      assert.equal(parsed.already_linked, false);
      assert.equal(parsed.character_id, "char-mira");
      assert.equal(parsed.note, "Mira appears without a specific place beat.");
      assert.deepEqual(parsed.scene_relationships, {
        characters: ["char-mira"],
        places: [],
      });
      assert.deepEqual(parsed.mutation_order, [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ]);
      assert.equal(parsed.operation_history.appended, true);
      assert.equal(parsed.backup_refresh.ok, true);
      assert.equal(parsed.compatibility_output.generated_transparency, true);
      assert.equal(parsed.compatibility_output.mutation_surface, false);
      assert.equal(parsed.compatibility_output.refreshed, true);

      const sceneCharacters = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = ? AND project_id = ?
      `).all("sc-character-only", "test-novel").map(row => row.character_id);
      const scenePlaces = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = ? AND project_id = ?
      `).all("sc-character-only", "test-novel").map(row => row.place_id);
      assert.deepEqual(sceneCharacters, ["char-mira"]);
      assert.deepEqual(scenePlaces, []);

      const sidecar = yaml.load(fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8"));
      assert.deepEqual(sidecar.characters, ["char-mira"]);
      assert.deepEqual(sidecar.places, []);

      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"char-mira"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"stale-sidecar-character"').count,
        0
      );

      const repeated = await tools.call("connect_scene_character_evidence", {
        project_id: "test-novel",
        scene_id: "sc-character-only",
        character_id: "char-mira",
      });
      assert.equal(repeated.ok, true);
      assert.equal(repeated.already_linked, true);
      assert.equal(
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM scene_characters
          WHERE scene_id = ? AND project_id = ? AND character_id = ?
        `).get("sc-character-only", "test-novel", "char-mira").count,
        1
      );
    } finally {
      db.close();
    }
  });

  test("connect_scene_character_evidence preserves existing FTS title and logline when source metadata omits them", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira" });
      const scenePath = path.join(SEED_TMP_DIR, `test-novel-sc-preserve-fts-${++seedCounter}.md`);
      fs.writeFileSync(scenePath, "---\nscene_id: sc-preserve-fts\n---\nScene prose.", "utf8");
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run("sc-preserve-fts", "test-novel", "Existing Search Title", scenePath, "deadbeef", new Date().toISOString());
      db.prepare(`
        INSERT INTO scenes_fts (scene_id, project_id, logline, title, keywords)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        "sc-preserve-fts",
        "test-novel",
        "original logline token",
        "original title token",
        "legacy relationship keyword"
      );

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_scene_character_evidence", {
        project_id: "test-novel",
        scene_id: "sc-preserve-fts",
        character_id: "char-mira",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.compatibility_output.refreshed, true);
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"original logline token"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"original title token"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"char-mira"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"legacy relationship keyword"').count,
        0
      );
    } finally {
      db.close();
    }
  });

  test("connect_scene_place_evidence adds only a place link and preserves existing character links", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-elena", projectId: "test-novel", name: "Elena" });
      seedPlace(db, { placeId: "place-harbor", projectId: "test-novel", name: "Harbor" });
      const scenePath = seedProjectSceneFile(db, {
        sceneId: "sc-place-only",
        projectId: "test-novel",
        metadata: {
          characters: ["stale-sidecar-character"],
          places: ["stale-sidecar-place"],
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-place-only", "test-novel", "char-elena");

      const tools = makeToolHarness(db);
      const parsed = await tools.call("connect_scene_place_evidence", {
        project_id: "test-novel",
        scene_id: "sc-place-only",
        place_id: "place-harbor",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.place_id, "place-harbor");
      assert.deepEqual(parsed.scene_relationships, {
        characters: ["char-elena"],
        places: ["place-harbor"],
      });

      const sceneCharacters = db.prepare(`
        SELECT character_id
        FROM scene_characters
        WHERE scene_id = ? AND project_id = ?
        ORDER BY character_id
      `).all("sc-place-only", "test-novel").map(row => row.character_id);
      const scenePlaces = db.prepare(`
        SELECT place_id
        FROM scene_places
        WHERE scene_id = ? AND project_id = ?
        ORDER BY place_id
      `).all("sc-place-only", "test-novel").map(row => row.place_id);
      assert.deepEqual(sceneCharacters, ["char-elena"]);
      assert.deepEqual(scenePlaces, ["place-harbor"]);

      const sidecar = yaml.load(fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8"));
      assert.deepEqual(sidecar.characters, ["char-elena"]);
      assert.deepEqual(sidecar.places, ["place-harbor"]);
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"place-harbor"').count,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE scenes_fts MATCH ?`).get('"stale-sidecar-place"').count,
        0
      );
    } finally {
      db.close();
    }
  });

  test("one-sided scene evidence workflows reject freeform names that are not sheet-backed IDs", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-freeform-rejected", projectId: "test-novel" });

      const tools = makeToolHarness(db);
      const characterResult = await tools.call("connect_scene_character_evidence", {
        project_id: "test-novel",
        scene_id: "sc-freeform-rejected",
        character_id: "Mira Nystrom",
      });
      const placeResult = await tools.call("connect_scene_place_evidence", {
        project_id: "test-novel",
        scene_id: "sc-freeform-rejected",
        place_id: "The old harbor",
      });

      assert.equal(characterResult.ok, false);
      assert.equal(characterResult.error.code, "NOT_FOUND");
      assert.equal(placeResult.ok, false);
      assert.equal(placeResult.error.code, "NOT_FOUND");
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scene_characters WHERE scene_id = ? AND project_id = ?`).get("sc-freeform-rejected", "test-novel").count,
        0
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM scene_places WHERE scene_id = ? AND project_id = ?`).get("sc-freeform-rejected", "test-novel").count,
        0
      );
    } finally {
      db.close();
    }
  });

  test("record_character_relationship_beat writes canonical relationship beats without sidecar output", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-trust", projectId: "test-novel" });
      seedCharacter(db, { characterId: "char-elena", projectId: "test-novel", name: "Elena" });
      seedCharacter(db, { characterId: "char-marcus", projectId: "test-novel", name: "Marcus" });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("record_character_relationship_beat", {
        project_id: "test-novel",
        from_character: "char-elena",
        to_character: "char-marcus",
        relationship_type: "Trusts",
        strength: "fragile",
        scene_id: "sc-trust",
        note: "Elena chooses to tell Marcus the truth.",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.relationship.relationship_type, "trusts");
      assert.equal(parsed.compatibility_output.role, "none");
      assert.deepEqual(parsed.mutation_order, [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
      ]);

      const row = db.prepare(`
        SELECT relationship_type, strength, scene_id, note
        FROM character_relationships
        WHERE from_character = 'char-elena' AND to_character = 'char-marcus'
      `).get();
      assert.equal(row.relationship_type, "trusts");
      assert.equal(row.strength, "fragile");
      assert.equal(row.scene_id, "sc-trust");
    } finally {
      db.close();
    }
  });

  test("audit_relationship_metadata classifies retained sidecar fields as compatibility notes", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { sceneId: "sc-audit", projectId: "test-novel" });
      const characterPath = path.join(SEED_TMP_DIR, `audit-char-${++seedCounter}.md`);
      fs.writeFileSync(
        characterPath,
        "---\ncharacter_id: char-audit\nname: Audit Character\ntags:\n  - legacy-tag\n---\nCharacter notes.",
        "utf8"
      );
      seedCharacter(db, {
        characterId: "char-audit",
        projectId: "test-novel",
        name: "Audit Character",
        filePath: characterPath,
      });
      const placePath = path.join(SEED_TMP_DIR, `audit-place-${++seedCounter}.md`);
      fs.writeFileSync(
        placePath,
        "---\nplace_id: place-audit\nname: Audit Place\nassociated_characters:\n  - char-audit\ntags:\n  - legacy-place\n---\nPlace notes.",
        "utf8"
      );
      seedPlace(db, {
        placeId: "place-audit",
        projectId: "test-novel",
        name: "Audit Place",
        filePath: placePath,
      });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("audit_relationship_metadata", {
        project_id: "test-novel",
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.audit_authority.compatibility_mutation_surface, false);
      assert.ok(parsed.diagnostics.some(diagnostic => diagnostic.type === "character_tags_review_note"));
      assert.ok(parsed.diagnostics.some(diagnostic => diagnostic.type === "place_associated_characters_review_note"));
      assert.ok(parsed.next_steps.includes("Use connect_character_place_evidence when scene-backed character/place evidence is paired; use connect_scene_character_evidence or connect_scene_place_evidence for one-sided scene evidence."));
    } finally {
      db.close();
    }
  });

  test("audit_relationship_metadata reports scene relationship compatibility drift", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "canonicalcharacter", projectId: "test-novel", name: "Canonical Character" });
      seedPlace(db, { placeId: "canonicalplace", projectId: "test-novel", name: "Canonical Place" });
      seedProjectSceneFile(db, {
        sceneId: "sc-audit-drift",
        projectId: "test-novel",
        metadata: {
          characters: "sidecarstalecharacter, v7.3",
          places: ["sidecarstaleplace"],
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-audit-drift", "test-novel", "canonicalcharacter");
      db.prepare(`
        INSERT INTO scene_places (scene_id, project_id, place_id)
        VALUES (?, ?, ?)
      `).run("sc-audit-drift", "test-novel", "canonicalplace");

      const tools = makeToolHarness(db);
      const parsed = await tools.call("audit_relationship_metadata", {
        project_id: "test-novel",
      });

      const compatibilityInput = parsed.diagnostics.find(diagnostic =>
        diagnostic.type === "scene_relationship_compatibility_input"
      );
      const drift = parsed.diagnostics.find(diagnostic =>
        diagnostic.type === "scene_relationship_compatibility_drift"
      );
      assert.equal(parsed.ok, true);
      assert.equal(parsed.summary.compatibility_drift_count, 1);
      assert.deepEqual(compatibilityInput.compatibility.characters, ["sidecarstalecharacter"]);
      assert.deepEqual(compatibilityInput.compatibility.places, ["sidecarstaleplace"]);
      assert.deepEqual(drift.canonical.characters, ["canonicalcharacter"]);
      assert.deepEqual(drift.canonical.places, ["canonicalplace"]);
      assert.match(drift.next_step, /Treat SQLite relationship rows as canonical/);
    } finally {
      db.close();
    }
  });

  test("audit_relationship_metadata resolves legacy character names before drift comparison", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, {
        characterId: "char-elena-vasquez",
        projectId: "test-novel",
        name: "Elena Vasquez",
      });
      seedProjectSceneFile(db, {
        sceneId: "sc-audit-name-compat",
        projectId: "test-novel",
        metadata: {
          characters: "Elena Vasquez",
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-audit-name-compat", "test-novel", "char-elena-vasquez");

      const tools = makeToolHarness(db);
      const parsed = await tools.call("audit_relationship_metadata", {
        project_id: "test-novel",
      });

      const compatibilityInput = parsed.diagnostics.find(diagnostic =>
        diagnostic.type === "scene_relationship_compatibility_input"
      );
      assert.equal(parsed.ok, true);
      assert.equal(parsed.summary.compatibility_drift_count, 0);
      assert.deepEqual(compatibilityInput.compatibility.characters, ["char-elena-vasquez"]);
      assert.deepEqual(compatibilityInput.canonical.characters, ["char-elena-vasquez"]);
    } finally {
      db.close();
    }
  });

  test("audit_relationship_metadata ignores absent compatibility relationship fields when checking drift", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "canonicalcharacter", projectId: "test-novel", name: "Canonical Character" });
      seedPlace(db, { placeId: "canonicalplace", projectId: "test-novel", name: "Canonical Place" });
      seedProjectSceneFile(db, {
        sceneId: "sc-audit-partial-fields",
        projectId: "test-novel",
        metadata: {
          characters: ["canonicalcharacter"],
        },
      });
      db.prepare(`
        INSERT INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run("sc-audit-partial-fields", "test-novel", "canonicalcharacter");
      db.prepare(`
        INSERT INTO scene_places (scene_id, project_id, place_id)
        VALUES (?, ?, ?)
      `).run("sc-audit-partial-fields", "test-novel", "canonicalplace");

      const tools = makeToolHarness(db);
      const parsed = await tools.call("audit_relationship_metadata", {
        project_id: "test-novel",
      });

      const compatibilityInput = parsed.diagnostics.find(diagnostic =>
        diagnostic.type === "scene_relationship_compatibility_input"
      );
      assert.equal(parsed.ok, true);
      assert.equal(parsed.summary.compatibility_drift_count, 0);
      assert.equal(compatibilityInput.compatibility.has_characters_field, true);
      assert.equal(compatibilityInput.compatibility.has_places_field, false);
      assert.deepEqual(compatibilityInput.canonical.places, ["canonicalplace"]);
    } finally {
      db.close();
    }
  });

  test("audit_relationship_metadata includes universe-scoped compatibility notes for a project", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "book-one", { universeId: "shared-universe" });
      seedScene(db, { sceneId: "sc-audit-universe", projectId: "book-one" });
      const characterPath = path.join(SEED_TMP_DIR, `audit-universe-char-${++seedCounter}.md`);
      fs.writeFileSync(
        characterPath,
        "---\ncharacter_id: char-shared\nname: Shared Character\ntags:\n  - universe-tag\n---\nCharacter notes.",
        "utf8"
      );
      seedCharacter(db, {
        characterId: "char-shared",
        projectId: null,
        universeId: "shared-universe",
        name: "Shared Character",
        filePath: characterPath,
      });
      const placePath = path.join(SEED_TMP_DIR, `audit-universe-place-${++seedCounter}.md`);
      fs.writeFileSync(
        placePath,
        "---\nplace_id: place-shared\nname: Shared Place\nassociated_characters:\n  - char-shared\n---\nPlace notes.",
        "utf8"
      );
      seedPlace(db, {
        placeId: "place-shared",
        projectId: null,
        universeId: "shared-universe",
        name: "Shared Place",
        filePath: placePath,
      });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("audit_relationship_metadata", {
        project_id: "book-one",
      });

      assert.equal(parsed.ok, true);
      assert.ok(parsed.diagnostics.some(diagnostic =>
        diagnostic.type === "character_tags_review_note" &&
        diagnostic.character_id === "char-shared"
      ));
      assert.ok(parsed.diagnostics.some(diagnostic =>
        diagnostic.type === "place_associated_characters_review_note" &&
        diagnostic.place_id === "place-shared"
      ));
    } finally {
      db.close();
    }
  });

  test("update_character_sheet commits SQLite even when compatibility output cannot refresh", async () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-missing-file", projectId: "test-novel", name: "Missing File" });
      const filePath = db.prepare(`SELECT file_path FROM characters WHERE character_id = ?`).get("char-missing-file").file_path;
      fs.rmSync(filePath, { force: true });

      const tools = makeToolHarness(db);
      const parsed = await tools.call("update_character_sheet", {
        character_id: "char-missing-file",
        fields: { arc_summary: "Canonical update survives missing compatibility output." },
      });

      assert.equal(parsed.ok, true);
      assert.equal(parsed.compatibility_output.refreshed, false);
      assert.equal(parsed.compatibility_output.diagnostics[0].severity, "warning");
      const row = db.prepare(`SELECT arc_summary FROM characters WHERE character_id = ?`).get("char-missing-file");
      assert.equal(row.arc_summary, "Canonical update survives missing compatibility output.");
    } finally {
      db.close();
    }
  });
});
