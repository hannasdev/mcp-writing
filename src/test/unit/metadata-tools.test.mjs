import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
      assert.ok(parsed.next_steps.includes("Use connect_character_place_evidence for scene-backed character/place relationships."));
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
