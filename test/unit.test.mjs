import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import {
  checksumProse,
  inferProjectAndUniverse,
  inferScenePositionFromPath,
  isCanonicalWorldEntityFile,
  getSyncOwnershipDiagnostics,
  getFileWriteDiagnostics,
  isWorldFile,
  readMeta,
  isSyncDirWritable,
  sidecarPath,
  syncAll,
  walkFiles,
  walkSidecars,
  worldEntityFolderKey,
  worldEntityKindForPath,
} from "../sync.js";
import { lintMetadataInSyncDir, validateMetadataObject } from "../metadata-lint.js";
import { openDb } from "../db.js";
import { importScrivenerSync } from "../importer.js";

// ---------------------------------------------------------------------------
// checksumProse
// ---------------------------------------------------------------------------
describe("checksumProse", () => {
  test("returns the same hash for identical input", () => {
    assert.equal(checksumProse("hello world"), checksumProse("hello world"));
  });

  test("returns a different hash for different input", () => {
    assert.notEqual(checksumProse("hello world"), checksumProse("bye world"));
  });

  test("returns a non-empty hex string", () => {
    const result = checksumProse("some prose");
    assert.match(result, /^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// walkFiles
// ---------------------------------------------------------------------------
describe("walkFiles", () => {
  test("returns empty array for non-existent dir", () => {
    assert.deepEqual(walkFiles("/tmp/__nonexistent_dir_xyz__"), []);
  });

  test("finds .md files recursively", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "a.md"), "");
    fs.writeFileSync(path.join(dir, "sub", "b.md"), "");
    fs.writeFileSync(path.join(dir, "ignored.json"), "");
    const files = walkFiles(dir);
    assert.equal(files.length, 2);
    assert.ok(files.some(f => f.endsWith("a.md")));
    assert.ok(files.some(f => f.endsWith("b.md")));
    fs.rmSync(dir, { recursive: true });
  });

  test("finds .txt files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    const files = walkFiles(dir);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith("notes.txt"));
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// walkSidecars / sidecarPath
// ---------------------------------------------------------------------------
describe("walkSidecars", () => {
  test("finds .meta.yaml files recursively", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidecars-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sc-001.meta.yaml"), "");
    fs.writeFileSync(path.join(dir, "sub", "sc-002.meta.yaml"), "");
    fs.writeFileSync(path.join(dir, "sc-001.md"), "");   // should not be returned
    const files = walkSidecars(dir);
    assert.equal(files.length, 2);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("sidecarPath", () => {
  test("replaces .md extension", () => {
    assert.equal(sidecarPath("/sync/sc-001.md"), "/sync/sc-001.meta.yaml");
  });

  test("replaces .txt extension", () => {
    assert.equal(sidecarPath("/sync/sc-001.txt"), "/sync/sc-001.meta.yaml");
  });
});

// ---------------------------------------------------------------------------
// readMeta
// ---------------------------------------------------------------------------
describe("readMeta", () => {
  test("reads from sidecar when present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
    fs.writeFileSync(path.join(dir, "sc-001.md"), "some prose");
    fs.writeFileSync(path.join(dir, "sc-001.meta.yaml"), "scene_id: sc-001\ntitle: Test\n");
    const { meta, sidecarGenerated } = readMeta(path.join(dir, "sc-001.md"), dir);
    assert.equal(meta.scene_id, "sc-001");
    assert.equal(sidecarGenerated, false);
    fs.rmSync(dir, { recursive: true });
  });

  test("falls back to frontmatter when no sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
    fs.writeFileSync(path.join(dir, "sc-001.md"), "---\nscene_id: sc-001\n---\nsome prose");
    const { meta } = readMeta(path.join(dir, "sc-001.md"), dir);
    assert.equal(meta.scene_id, "sc-001");
    fs.rmSync(dir, { recursive: true });
  });

  test("auto-generates sidecar from frontmatter when writable=true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
    fs.writeFileSync(path.join(dir, "sc-001.md"), "---\nscene_id: sc-001\n---\nsome prose");
    const { sidecarGenerated } = readMeta(path.join(dir, "sc-001.md"), dir, { writable: true });
    assert.equal(sidecarGenerated, true);
    assert.ok(fs.existsSync(path.join(dir, "sc-001.meta.yaml")));
    fs.rmSync(dir, { recursive: true });
  });

  test("does not auto-generate sidecar when writable=false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
    fs.writeFileSync(path.join(dir, "sc-001.md"), "---\nscene_id: sc-001\n---\nsome prose");
    readMeta(path.join(dir, "sc-001.md"), dir, { writable: false });
    assert.ok(!fs.existsSync(path.join(dir, "sc-001.meta.yaml")));
    fs.rmSync(dir, { recursive: true });
  });

  test("sidecar wins over frontmatter when both exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
    fs.writeFileSync(path.join(dir, "sc-001.md"), "---\nscene_id: old-id\n---\nsome prose");
    fs.writeFileSync(path.join(dir, "sc-001.meta.yaml"), "scene_id: new-id\n");
    const { meta } = readMeta(path.join(dir, "sc-001.md"), dir);
    assert.equal(meta.scene_id, "new-id");
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// isSyncDirWritable
// ---------------------------------------------------------------------------
describe("isSyncDirWritable", () => {
  test("returns true for writable directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-"));
    assert.ok(isSyncDirWritable(dir));
    fs.rmSync(dir, { recursive: true });
  });

  test("returns false for non-existent directory", () => {
    assert.ok(!isSyncDirWritable("/tmp/__nonexistent_dir_xyz__/subdir"));
  });
});

describe("getSyncOwnershipDiagnostics", () => {
  test("returns diagnostics for existing directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-"));
    fs.writeFileSync(path.join(dir, "scene.md"), "---\nscene_id: sc-001\n---\nProse");

    const diagnostics = getSyncOwnershipDiagnostics(dir, { sampleLimit: 25 });
    assert.equal(diagnostics.sync_dir_exists, true);
    assert.equal(diagnostics.sync_dir_path_exists, true);
    assert.equal(diagnostics.sync_dir_is_directory, true);
    assert.equal(typeof diagnostics.supported, "boolean");
    assert.equal(diagnostics.sample_limit, 25);
    if (diagnostics.supported) {
      assert.ok(diagnostics.sampled_paths >= 1);
    } else {
      assert.equal(diagnostics.sampled_paths, 0);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("handles non-existent directory gracefully", () => {
    const diagnostics = getSyncOwnershipDiagnostics("/tmp/__nonexistent_dir_xyz__/subdir", { sampleLimit: 10 });
    assert.equal(diagnostics.sync_dir_exists, false);
    assert.equal(diagnostics.sync_dir_path_exists, false);
    assert.equal(diagnostics.sync_dir_is_directory, false);
    assert.equal(diagnostics.sampled_paths, 0);
  });

  test("treats non-directory path as invalid sync dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-"));
    const filePath = path.join(dir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "content", "utf8");

    const diagnostics = getSyncOwnershipDiagnostics(filePath, { sampleLimit: 10 });
    assert.equal(diagnostics.sync_dir_path_exists, true);
    assert.equal(diagnostics.sync_dir_is_directory, false);
    assert.equal(diagnostics.sync_dir_exists, false);
    assert.equal(diagnostics.sampled_paths, 0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("getFileWriteDiagnostics", () => {
  test("reports writable regular files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-write-"));
    try {
      const filePath = path.join(dir, "scene.md");
      fs.writeFileSync(filePath, "Prose", "utf8");

      const diagnostics = getFileWriteDiagnostics(filePath);
      assert.equal(diagnostics.exists, true);
      assert.equal(diagnostics.is_file, true);
      assert.equal(diagnostics.parent_dir_writable, true);
      assert.equal(typeof diagnostics.writable, "boolean");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports missing files without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-write-missing-"));
    try {
      const missingPath = path.join(dir, "definitely-missing.md");
      const diagnostics = getFileWriteDiagnostics(missingPath);
      assert.equal(diagnostics.exists, false);
      assert.equal(diagnostics.is_file, false);
      assert.equal(diagnostics.writable, false);
      assert.equal(diagnostics.parent_dir_writable, true);
      assert.ok(diagnostics.stat_error_code === "ENOENT" || diagnostics.stat_error_code === "ENOTDIR");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports directories as non-writable prose targets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-write-"));
    try {
      const diagnostics = getFileWriteDiagnostics(dir);
      assert.equal(diagnostics.exists, true);
      assert.equal(diagnostics.is_file, false);
      assert.equal(diagnostics.writable, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// inferScenePositionFromPath
// ---------------------------------------------------------------------------
describe("inferScenePositionFromPath", () => {
  const syncDir = "/sync";

  test("extracts part and chapter numbers from the path", () => {
    const result = inferScenePositionFromPath(syncDir, "/sync/projects/novel/part-2/chapter-7/scene.md");
    assert.deepEqual(result, { part: 2, chapter: 7 });
  });

  test("returns nulls when the path has no part/chapter segments", () => {
    const result = inferScenePositionFromPath(syncDir, "/sync/projects/novel/scenes/scene.md");
    assert.deepEqual(result, { part: null, chapter: null });
  });
});

// ---------------------------------------------------------------------------
// inferProjectAndUniverse
// ---------------------------------------------------------------------------
describe("inferProjectAndUniverse", () => {
  const syncDir = "/sync";

  test("projects/ layout", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/projects/my-novel/scenes/sc-001.md");
    assert.deepEqual(result, { universe_id: null, project_id: "my-novel" });
  });

  test("universes/ layout", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/universes/aether/book-one/scenes/sc-001.md");
    assert.deepEqual(result, { universe_id: "aether", project_id: "aether/book-one" });
  });

  test("universe-level world layout has no project_id", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/universes/aether/world/characters/elena/sheet.md");
    assert.deepEqual(result, { universe_id: "aether", project_id: null });
  });

  test("flat layout fallback", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/my-standalone/sc-001.md");
    assert.deepEqual(result, { universe_id: null, project_id: "my-standalone" });
  });
});

// ---------------------------------------------------------------------------
// isWorldFile
// ---------------------------------------------------------------------------
describe("isWorldFile", () => {
  const syncDir = "/sync";

  test("character file in world dir returns true", () => {
    assert.ok(isWorldFile(syncDir, "/sync/projects/novel/world/characters/elena.md"));
  });

  test("place file in world dir returns true", () => {
    assert.ok(isWorldFile(syncDir, "/sync/projects/novel/world/places/harbor.md"));
  });

  test("scene file returns false", () => {
    assert.ok(!isWorldFile(syncDir, "/sync/projects/novel/scenes/sc-001.md"));
  });
});

describe("world entity canonical detection", () => {
  const syncDir = "/sync";

  test("flat character file remains canonical for compatibility", () => {
    assert.equal(worldEntityKindForPath(syncDir, "/sync/projects/novel/world/characters/elena.md"), "character");
    assert.equal(worldEntityFolderKey(syncDir, "/sync/projects/novel/world/characters/elena.md"), null);
    assert.ok(isCanonicalWorldEntityFile(syncDir, "/sync/projects/novel/world/characters/elena.md"));
  });

  test("nested sheet file is canonical", () => {
    assert.ok(isCanonicalWorldEntityFile(syncDir, "/sync/projects/novel/world/characters/elena/sheet.md"));
  });

  test("nested support note is not canonical unless explicitly marked", () => {
    assert.ok(!isCanonicalWorldEntityFile(syncDir, "/sync/projects/novel/world/characters/elena/arc.md"));
    assert.ok(isCanonicalWorldEntityFile(syncDir, "/sync/projects/novel/world/characters/elena/arc.md", { canonical: true }));
  });
});

// ---------------------------------------------------------------------------
// openDb migration safety
// ---------------------------------------------------------------------------
describe("openDb", () => {
  test("migrates legacy scenes_fts schema and preserves existing rows", () => {
    const dbPath = path.join(os.tmpdir(), `mcp-writing-db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);

    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE VIRTUAL TABLE scenes_fts USING fts5(
          scene_id, project_id, logline, title
        );
      `);
      legacyDb.prepare(`
        INSERT INTO scenes_fts (scene_id, project_id, logline, title)
        VALUES (?, ?, ?, ?)
      `).run("sc-legacy", "test-novel", "Legacy envelope logline", "Legacy Scene");
      legacyDb.close();

      const db = openDb(dbPath);

      const ftsSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'scenes_fts'
      `).get()?.sql;
      assert.ok(typeof ftsSql === "string" && ftsSql.toLowerCase().includes("keywords"));

      const matches = db.prepare(`
        SELECT scene_id
        FROM scenes_fts
        WHERE scenes_fts MATCH 'envelope'
      `).all();
      assert.equal(matches.length, 1);
      assert.equal(matches[0].scene_id, "sc-legacy");

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// syncAll — integration-style unit test using a temp dir + in-memory DB
// ---------------------------------------------------------------------------
describe("syncAll", () => {
  function makeTempSync() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "characters"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "places"), { recursive: true });
    return dir;
  }

  function writeScene(dir, id, overrides = {}) {
    const meta = {
      scene_id: id,
      title: `Scene ${id}`,
      part: 1,
      chapter: 1,
      pov: "elena",
      logline: `Logline for ${id}`,
      save_the_cat: "Opening Image",
      characters: ["elena"],
      places: ["harbor"],
      timeline_position: 1,
      ...overrides,
    };
    const header = "---\n" + Object.entries(meta)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `\n${v.map(i => `  - ${i}`).join("\n")}` : v}`)
      .join("\n") + "\n---\n";
    const prose = `Prose content for scene ${id}.`;
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", `${id}.md`),
      header + prose
    );
  }

  function writeCharacter(dir, id) {
    const content = `---\ncharacter_id: ${id}\nname: Elena Vasquez\nrole: protagonist\n---\nCharacter notes.`;
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "characters", `${id}.md`),
      content
    );
  }

  function writePlace(dir, id) {
    const content = `---\nplace_id: ${id}\nname: Harbor District\n---\nPlace notes.`;
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "places", `${id}.md`),
      content
    );
  }

  test("indexes scenes and returns correct counts", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001");
    writeScene(dir, "sc-002", { chapter: 2, timeline_position: 2 });
    writeCharacter(dir, "elena");
    writePlace(dir, "harbor");

    const result = syncAll(db, dir, { quiet: true });
    assert.equal(result.indexed, 2);
    assert.equal(result.staleMarked, 0);

    const scenes = db.prepare("SELECT * FROM scenes").all();
    assert.equal(scenes.length, 2);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("indexes characters and places", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeCharacter(dir, "elena");
    writePlace(dir, "harbor");
    writeScene(dir, "sc-001");

    syncAll(db, dir, { quiet: true });

    const chars = db.prepare("SELECT * FROM characters").all();
    assert.equal(chars.length, 1);
    assert.equal(chars[0].character_id, "elena");

    const places = db.prepare("SELECT * FROM places").all();
    assert.equal(places.length, 1);
    assert.equal(places[0].place_id, "harbor");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("indexes only canonical files in nested character folders", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const charDir = path.join(dir, "projects", "test-novel", "world", "characters", "elena");
    fs.mkdirSync(charDir, { recursive: true });
    fs.writeFileSync(path.join(charDir, "sheet.md"), "---\ncharacter_id: char-elena\nname: Elena\n---\nCanonical sheet.");
    fs.writeFileSync(path.join(charDir, "arc.md"), "---\ncharacter_id: char-elena-alt\nname: Elena Alt\n---\nSupport note.");
    writeScene(dir, "sc-001", { characters: ["Elena"] });

    syncAll(db, dir, { quiet: true });

    const chars = db.prepare("SELECT character_id, file_path FROM characters").all();
    assert.equal(chars.length, 1);
    assert.equal(chars[0].character_id, "char-elena");
    assert.match(chars[0].file_path, /sheet\.md$/);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("marks scenes stale when prose changes", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001");
    syncAll(db, dir, { quiet: true });

    // Overwrite with different prose
    const scenePath = path.join(dir, "projects", "test-novel", "scenes", "sc-001.md");
    fs.appendFileSync(scenePath, "\n\nExtra prose added.");
    const result2 = syncAll(db, dir, { quiet: true });
    assert.equal(result2.staleMarked, 1);

    const scene = db.prepare("SELECT metadata_stale FROM scenes WHERE scene_id = ?").get("sc-001");
    assert.equal(scene.metadata_stale, 1);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("skips files without scene_id", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    // A file with no scene_id in frontmatter
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "notes.md"),
      "---\ntitle: Just a note\n---\nSome text."
    );
    const result = syncAll(db, dir, { quiet: true });
    assert.equal(result.indexed, 0);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("populates scene_characters join table", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001", { characters: ["elena", "marcus"] });

    syncAll(db, dir, { quiet: true });

    const rows = db.prepare("SELECT * FROM scene_characters WHERE scene_id = 'sc-001'").all();
    assert.equal(rows.length, 2);
    const ids = rows.map(r => r.character_id).sort();
    assert.deepEqual(ids, ["elena", "marcus"]);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("populates FTS table", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001", { logline: "The ship enters the envelope." });

    syncAll(db, dir, { quiet: true });

    const rows = db.prepare("SELECT scene_id FROM scenes_fts WHERE scenes_fts MATCH 'envelope'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scene_id, "sc-001");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("warns on duplicate scene_id within same project", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001");
    // Write a second file with same scene_id
    const header = "---\nscene_id: sc-001\ntitle: Duplicate\npart: 1\nchapter: 2\npov: elena\n---\n";
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001-copy.md"),
      header + "Duplicate prose."
    );
    const result = syncAll(db, dir, { quiet: true });
    assert.ok(result.warnings.some(w => w.includes("Duplicate scene_id")));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("ignores nested mirrored scene paths under scenes/", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001");

    const nestedMirrorDir = path.join(
      dir,
      "projects",
      "test-novel",
      "scenes",
      "universes",
      "universe-1",
      "book-1-the-lamb",
      "scenes"
    );
    fs.mkdirSync(nestedMirrorDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedMirrorDir, "sc-001-duplicate.md"),
      "---\nscene_id: sc-001\ntitle: Mirrored Duplicate\npart: 1\nchapter: 1\npov: elena\n---\nDuplicated prose."
    );

    const result = syncAll(db, dir, { quiet: true });
    assert.equal(result.indexed, 1);
    assert.ok(result.warnings.some(w => w.includes("Ignored nested mirror path")));
    assert.equal(result.warnings.some(w => w.includes("Duplicate scene_id")), false);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("warns on orphaned sidecar (true orphan — not indexed)", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    // Write sidecar with no matching .md and scene_id not indexed elsewhere
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "deleted.meta.yaml"),
      "scene_id: sc-deleted\n"
    );
    const result = syncAll(db, dir, { quiet: true });
    assert.ok(result.warnings.some(w => w.includes("Orphaned sidecar")));
    assert.ok(result.warnings.some(w => w.includes("sc-deleted")));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("warns 'move detected' when orphaned sidecar scene_id was indexed at a new path", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    // Prose at new location (no sidecar there, but has frontmatter with scene_id)
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001-new.md"),
      "---\nscene_id: sc-001\ntitle: Moved Scene\npart: 1\nchapter: 1\npov: elena\n---\nProse at new path."
    );
    // Sidecar left behind at old path (no matching .md beside it)
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001-old.meta.yaml"),
      "scene_id: sc-001\ntitle: Old Sidecar\npart: 1\nchapter: 1\npov: elena\n"
    );

    const result = syncAll(db, dir, { quiet: true });
    assert.ok(result.warnings.some(w => w.includes("Moved scene detected")));
    assert.ok(result.warnings.some(w => w.includes("sc-001")));
    // Scene is still indexed (from the new prose file)
    assert.equal(result.indexed, 1);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("reads metadata from sidecar when present", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    // Write prose file without frontmatter
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001.md"),
      "Prose only, no frontmatter."
    );
    // Write sidecar separately
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001.meta.yaml"),
      "scene_id: sc-001\ntitle: Sidecar Scene\npart: 1\nchapter: 1\npov: elena\nlogline: A sidecar test.\n"
    );
    const result = syncAll(db, dir, { quiet: true });
    assert.equal(result.indexed, 1);
    const scene = db.prepare("SELECT title FROM scenes WHERE scene_id = 'sc-001'").get();
    assert.equal(scene.title, "Sidecar Scene");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("auto-migrates frontmatter to sidecar when writable", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    writeScene(dir, "sc-001");
    const sidecar = path.join(dir, "projects", "test-novel", "scenes", "sc-001.meta.yaml");
    assert.ok(!fs.existsSync(sidecar));

    const result = syncAll(db, dir, { quiet: true, writable: true });
    assert.equal(result.sidecarsMigrated, 1);
    assert.ok(fs.existsSync(sidecar));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("stores path-derived part/chapter when auto-generating a sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const sceneDir = path.join(dir, "projects", "test-novel", "part-1", "chapter-1");
    const scenePath = path.join(sceneDir, "sc-001.md");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-001\npart: 9\nchapter: 8\n---\nProse content."
    );

    const { meta, sidecarGenerated } = readMeta(scenePath, dir, { writable: true });
    const migratedSidecar = scenePath.replace(/\.md$/, ".meta.yaml");
    const sidecarText = fs.readFileSync(migratedSidecar, "utf8");

    assert.equal(sidecarGenerated, true);
    assert.equal(meta.part, 1);
    assert.equal(meta.chapter, 1);
    assert.match(sidecarText, /part: 1/);
    assert.match(sidecarText, /chapter: 1/);

    fs.rmSync(dir, { recursive: true });
  });

  test("warns when scene metadata part/chapter do not match the file path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const sceneDir = path.join(dir, "projects", "test-novel", "part-1", "chapter-1");
    const scenePath = path.join(sceneDir, "sc-001.md");
    const sidecar = scenePath.replace(/\.md$/, ".meta.yaml");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(scenePath, "Prose only.");
    fs.writeFileSync(sidecar, "scene_id: sc-001\ntitle: Mismatch\npart: 9\nchapter: 8\npov: elena\n");

    const result = syncAll(db, dir, { quiet: true });
    const scene = db.prepare("SELECT part, chapter FROM scenes WHERE scene_id = 'sc-001'").get();

    assert.ok(result.warnings.some(w => w.includes("Path/metadata mismatch")));
    assert.equal(scene.part, 1);
    assert.equal(scene.chapter, 1);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// importer path resolution
// ---------------------------------------------------------------------------
describe("importScrivenerSync", () => {
  function createScrivenerDraftFixture() {
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-import-"));
    fs.mkdirSync(path.join(scrivDir, "Draft"), { recursive: true });
    fs.writeFileSync(
      path.join(scrivDir, "Draft", "001 Scene The Arrival [1].txt"),
      "Elena steps out into the rain.",
      "utf8"
    );
    return scrivDir;
  }

  test("writes into existing universe project scenes path when WRITING_SYNC_DIR points there", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedSyncDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb", "scenes");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedSyncDir,
      projectId: "universe-1/book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "universe-1/book-1-the-lamb");
    assert.equal(result.scenesDir, scopedSyncDir);
    assert.ok(fs.existsSync(path.join(scopedSyncDir, "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested universes/<id>/<project>/scenes path is created inside scenes/
    assert.equal(
      fs.existsSync(path.join(scopedSyncDir, "universes", "universe-1", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("infers scoped project_id from WRITING_SYNC_DIR when omitted", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedProjectDir,
      dryRun: true,
    });

    assert.equal(result.projectId, "universe-1/book-1-the-lamb");
    assert.equal(result.scenesDir, path.join(scopedProjectDir, "scenes"));

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("fails when provided project_id conflicts with scoped WRITING_SYNC_DIR", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    assert.throws(
      () => importScrivenerSync({
        scrivenerDir: scrivDir,
        mcpSyncDir: scopedProjectDir,
        projectId: "universe-1/other-book",
        dryRun: true,
      }),
      /does not match WRITING_SYNC_DIR scope/
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("writes into existing project root path when WRITING_SYNC_DIR points to projects/<project>", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "projects", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedProjectDir,
      projectId: "book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "book-1-the-lamb");
    assert.equal(result.scenesDir, path.join(scopedProjectDir, "scenes"));
    assert.ok(fs.existsSync(path.join(scopedProjectDir, "scenes", "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested projects/<project>/scenes path is created inside scoped project path.
    assert.equal(
      fs.existsSync(path.join(scopedProjectDir, "projects", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("writes into existing project scenes path when WRITING_SYNC_DIR points to projects/<project>/scenes", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedScenesDir = path.join(syncRoot, "projects", "book-1-the-lamb", "scenes");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedScenesDir,
      projectId: "book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "book-1-the-lamb");
    assert.equal(result.scenesDir, scopedScenesDir);
    assert.ok(fs.existsSync(path.join(scopedScenesDir, "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested projects/<project>/scenes path is created inside scoped scenes path.
    assert.equal(
      fs.existsSync(path.join(scopedScenesDir, "projects", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// scripts/import.js
// ---------------------------------------------------------------------------
describe("Scrivener importer", () => {
  function makeScrivenerExport() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrivener-export-"));
    fs.mkdirSync(path.join(dir, "Draft"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Notes"), { recursive: true });
    return dir;
  }

  function writeDraftFile(dir, filename, content = "Scene prose.") {
    fs.writeFileSync(path.join(dir, "Draft", filename), content);
  }

  function runImporter(scrivenerDir, targetDir) {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "import.js"), scrivenerDir, targetDir, "--project", "test-import"],
      { encoding: "utf8" }
    );

    if (result.status !== 0) {
      throw new Error(`Importer failed: ${result.stderr || result.stdout}`);
    }

    return result.stdout;
  }

  test("writes stable external identity fields for imported scenes", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    writeDraftFile(scrivenerDir, "011 Scene Sebastian [10].txt", "Sebastian scene prose.");
    runImporter(scrivenerDir, targetDir);

    const sidecarPath = path.join(
      targetDir,
      "projects",
      "test-import",
      "scenes",
      "011 Scene Sebastian [10].meta.yaml"
    );
    const meta = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

    assert.equal(meta.scene_id, "sc-010-sebastian");
    assert.equal(meta.external_source, "scrivener");
    assert.equal(meta.external_id, "10");
    assert.equal(meta.timeline_position, 11);

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test("re-import after Scrivener reorder preserves scene identity and editorial metadata", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    writeDraftFile(scrivenerDir, "011 Scene Sebastian [10].txt", "First export prose.");
    runImporter(scrivenerDir, targetDir);

    const scenesDir = path.join(targetDir, "projects", "test-import", "scenes");
    const originalSidecar = path.join(scenesDir, "011 Scene Sebastian [10].meta.yaml");
    const originalMeta = yaml.load(fs.readFileSync(originalSidecar, "utf8"));
    originalMeta.synopsis = "Keep this editorial synopsis.";
    fs.writeFileSync(originalSidecar, yaml.dump(originalMeta, { lineWidth: 120 }), "utf8");

    fs.rmSync(path.join(scrivenerDir, "Draft", "011 Scene Sebastian [10].txt"));
    writeDraftFile(scrivenerDir, "015 Scene Sebastian [10].txt", "Reordered export prose.");

    runImporter(scrivenerDir, targetDir);

    const sceneFiles = fs.readdirSync(scenesDir).sort();
    assert.deepEqual(sceneFiles, ["015 Scene Sebastian [10].meta.yaml", "015 Scene Sebastian [10].txt"]);

    const reconciledMeta = yaml.load(
      fs.readFileSync(path.join(scenesDir, "015 Scene Sebastian [10].meta.yaml"), "utf8")
    );
    assert.equal(reconciledMeta.scene_id, "sc-010-sebastian");
    assert.equal(reconciledMeta.external_source, "scrivener");
    assert.equal(reconciledMeta.external_id, "10");
    assert.equal(reconciledMeta.timeline_position, 15);
    assert.equal(reconciledMeta.synopsis, "Keep this editorial synopsis.");

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test("ignores Scrivener Notes by default", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    fs.writeFileSync(path.join(scrivenerDir, "Notes", "001 Characters [1].txt"), "");
    fs.writeFileSync(path.join(scrivenerDir, "Notes", "002 Mira Nystrom [2].txt"), "Mira note content.");

    const output = runImporter(scrivenerDir, targetDir);
    const worldDir = path.join(targetDir, "projects", "test-import", "world");

    assert.ok(!fs.existsSync(worldDir));
    assert.ok(output.includes("Non-draft content: manual"));

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// scripts/new-world-entity.js
// ---------------------------------------------------------------------------
describe("world entity scaffold script", () => {
  function runScaffold(args) {
    return spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "new-world-entity.js"), ...args],
      { encoding: "utf8" }
    );
  }

  test("creates universe-scoped character template", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-template-"));

    const result = runScaffold([
      "--sync-dir", syncDir,
      "--kind", "character",
      "--scope", "universe",
      "--universe", "universe-1",
      "--name", "Mira Nystrom",
    ]);

    const entityDir = path.join(syncDir, "universes", "universe-1", "world", "characters", "mira-nystrom");
    const prosePath = path.join(entityDir, "sheet.md");
    const metaPath = path.join(entityDir, "sheet.meta.yaml");
    const arcPath = path.join(entityDir, "arc.md");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(prosePath));
    assert.ok(fs.existsSync(metaPath));
    assert.ok(fs.existsSync(arcPath));
    assert.match(fs.readFileSync(metaPath, "utf8"), /character_id: char-mira-nystrom/);
    assert.match(fs.readFileSync(prosePath, "utf8"), /^# Mira Nystrom\n\n## Core Identity\n\n/m);
    assert.match(fs.readFileSync(arcPath, "utf8"), /^# Mira Nystrom Arc\n\n## Arc Premise\n\n/m);
    assert.match(fs.readFileSync(prosePath, "utf8"), /\n\n$/);
    assert.match(fs.readFileSync(arcPath, "utf8"), /\n\n$/);

    fs.rmSync(syncDir, { recursive: true, force: true });
  });

  test("creates project-scoped place template", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-template-"));

    const result = runScaffold([
      "--sync-dir", syncDir,
      "--kind", "place",
      "--scope", "project",
      "--project", "universe-1/book-1-the-lamb",
      "--name", "University Hospital",
    ]);

    const entityDir = path.join(syncDir, "projects", "universe-1/book-1-the-lamb", "world", "places", "university-hospital");
    const prosePath = path.join(entityDir, "sheet.md");
    const metaPath = path.join(entityDir, "sheet.meta.yaml");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(prosePath));
    assert.ok(fs.existsSync(metaPath));
    assert.match(fs.readFileSync(metaPath, "utf8"), /place_id: place-university-hospital/);
    assert.match(fs.readFileSync(prosePath, "utf8"), /^# University Hospital\n\n## Overview\n\n/m);
    assert.match(fs.readFileSync(prosePath, "utf8"), /\n\n$/);

    fs.rmSync(syncDir, { recursive: true, force: true });
  });

  test("supports dry run without writing files", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-template-"));

    const result = runScaffold([
      "--sync-dir", syncDir,
      "--kind", "character",
      "--scope", "universe",
      "--universe", "universe-1",
      "--name", "Alba Hartmann",
      "--dry-run",
    ]);

    const entityDir = path.join(syncDir, "universes", "universe-1", "world", "characters", "alba-hartmann");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(!fs.existsSync(entityDir));
    assert.match(result.stdout, /Would create:/);
    assert.match(result.stdout, /arc\.md/);

    fs.rmSync(syncDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// metadata-lint
// ---------------------------------------------------------------------------
describe("metadata lint", () => {
  test("validates scene metadata object schema", () => {
    const result = validateMetadataObject({
      scene_id: "sc-001",
      external_source: "scrivener",
      external_id: "10",
      title: "Arrival",
      part: 1,
      chapter: 1,
      characters: ["char-elena"],
      tags: ["setup"],
    });

    assert.equal(result.ok, true);
    assert.equal(result.kind, "scene");
    assert.equal(result.issues.length, 0);
  });

  test("flags schema errors and legacy keys", () => {
    const result = validateMetadataObject({
      scene_id: "sc-001",
      part: "one",
      synopsis: "Legacy field",
    });

    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.code === "SCHEMA_VALIDATION_ERROR"));
    assert.ok(result.issues.some(i => i.code === "LEGACY_SCENE_KEY"));
  });

  test("detects sidecar/frontmatter scene_id mismatch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const scenePath = path.join(dir, "projects", "novel", "part-1", "chapter-1", "scene.md");
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });

    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-frontmatter\ntitle: Scene\npart: 1\nchapter: 1\n---\nProse"
    );
    fs.writeFileSync(
      scenePath.replace(/\.md$/, ".meta.yaml"),
      "scene_id: sc-sidecar\ntitle: Scene\npart: 1\nchapter: 1\n"
    );

    const result = lintMetadataInSyncDir(dir);
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(w => w.code === "SCENE_ID_MISMATCH"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("fails lint when sidecar misses required scene_id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const sidecarPath = path.join(dir, "projects", "novel", "part-1", "chapter-1", "scene.meta.yaml");
    const prosePath = sidecarPath.replace(/\.meta\.yaml$/, ".md");
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(prosePath, "Plain prose");
    fs.writeFileSync(sidecarPath, "title: Missing id\npart: 1\nchapter: 1\n");

    const result = lintMetadataInSyncDir(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "MISSING_SCENE_ID"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("warns on .md files with no sidecar and no frontmatter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const scenePath = path.join(dir, "projects", "novel", "scenes", "blank.md");
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.writeFileSync(scenePath, "Just plain prose, no metadata at all.");

    const result = lintMetadataInSyncDir(dir);
    assert.ok(result.warnings.some(w => w.code === "NO_METADATA"));
    assert.ok(result.warnings.some(w => w.file === scenePath));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not warn on support notes in nested character folders with no metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const notePath = path.join(dir, "projects", "novel", "world", "characters", "elena", "arc.md");
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, "Plain support note.");

    const result = lintMetadataInSyncDir(dir);
    assert.ok(!result.warnings.some(w => w.code === "NO_METADATA" && w.file === notePath));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("warns when canonical character sheet is missing character_id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const sheetPath = path.join(dir, "projects", "novel", "world", "characters", "elena", "sheet.md");
    fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
    fs.writeFileSync(sheetPath, "---\nname: Elena\n---\nCanonical sheet.");

    const result = lintMetadataInSyncDir(dir);
    assert.ok(result.warnings.some(w => w.code === "MISSING_CHARACTER_ID"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("errors on multiple canonical files in one character folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const entityDir = path.join(dir, "projects", "novel", "world", "characters", "elena");
    fs.mkdirSync(entityDir, { recursive: true });
    fs.writeFileSync(path.join(entityDir, "sheet.md"), "---\ncharacter_id: char-elena\nname: Elena\n---\nSheet.");
    fs.writeFileSync(path.join(entityDir, "profile.md"), "---\ncharacter_id: char-elena\ncanonical: true\nname: Elena\n---\nProfile.");

    const result = lintMetadataInSyncDir(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "MULTIPLE_CANONICAL_FILES"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("errors on duplicate character_id across canonical files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const firstDir = path.join(dir, "projects", "novel", "world", "characters", "elena");
    const secondDir = path.join(dir, "projects", "novel", "world", "characters", "elena-copy");
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(firstDir, "sheet.md"), "---\ncharacter_id: char-elena\nname: Elena\n---\nSheet.");
    fs.writeFileSync(path.join(secondDir, "sheet.md"), "---\ncharacter_id: char-elena\nname: Elena Copy\n---\nSheet.");

    const result = lintMetadataInSyncDir(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "DUPLICATE_CHARACTER_ID"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("errors on duplicate scene_id across two files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-meta-"));
    const sceneDir = path.join(dir, "projects", "novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-001.meta.yaml"),
      "scene_id: sc-001\ntitle: First\npart: 1\nchapter: 1\n"
    );
    fs.writeFileSync(path.join(sceneDir, "sc-001.md"), "Prose A.");
    fs.writeFileSync(
      path.join(sceneDir, "sc-001-copy.meta.yaml"),
      "scene_id: sc-001\ntitle: Copy\npart: 1\nchapter: 2\n"
    );
    fs.writeFileSync(path.join(sceneDir, "sc-001-copy.md"), "Prose B.");

    const result = lintMetadataInSyncDir(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "DUPLICATE_SCENE_ID"));
    assert.ok(result.errors.some(e => e.message.includes("sc-001")));

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// walkFiles / walkSidecars — symlink support
// ---------------------------------------------------------------------------
describe("walkFiles symlink support", () => {
  test("follows symlinked subdirectories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-sym-"));
    const real = path.join(dir, "real-subdir");
    const link = path.join(dir, "linked-subdir");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "sc-001.md"), "");
    fs.symlinkSync(real, link, "dir");

    const files = walkFiles(dir);
    // Should find sc-001.md via both real and linked paths
    assert.equal(files.length, 2);

    fs.rmSync(dir, { recursive: true });
  });

  test("skips broken symlinks without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-broken-"));
    const link = path.join(dir, "broken-link");
    fs.symlinkSync("/nonexistent/path", link, "dir");
    fs.writeFileSync(path.join(dir, "sc-001.md"), "");

    assert.doesNotThrow(() => walkFiles(dir));
    const files = walkFiles(dir);
    assert.equal(files.length, 1); // only the real file, broken link silently skipped

    fs.rmSync(dir, { recursive: true });
  });
});
