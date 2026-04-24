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
import {
  IMPORTER_AUTHORITATIVE_FIELDS,
  loadScrivenerProjectData,
  mergeScrivenerProjectMetadata,
  mergeSidecarData,
} from "../scrivener-direct.js";
import { runSceneCharacterBatch } from "../scene-character-batch.js";

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

  test("extracts chapter numbers from named chapter directories", () => {
    const result = inferScenePositionFromPath(syncDir, "/sync/projects/novel/scenes/part-2/chapter-7-the-harbor/scene.md");
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

  test("projects/ single-segment layout is unaffected", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/projects/my-novel/world/characters/elena.md");
    assert.deepEqual(result, { universe_id: null, project_id: "my-novel" });
  });

  test("projects/ single-segment world path remains single-segment project", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/projects/my-novel/World/characters/elena.md");
    assert.deepEqual(result, { universe_id: null, project_id: "my-novel" });
  });

  test("projects/ nested custom layout is not misclassified as universe-scoped", () => {
    const result = inferProjectAndUniverse(syncDir, "/sync/projects/my-novel/notes/scenes/sc-001.md");
    assert.deepEqual(result, { universe_id: null, project_id: "my-novel" });
  });

  test("projects/ two-segment layout requires matching universes root on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-two-segment-"));
    try {
      fs.mkdirSync(path.join(dir, "universes", "universe-1", "book-1-the-lamb", "scenes"), { recursive: true });
      const result = inferProjectAndUniverse(dir, path.join(dir, "projects", "universe-1", "book-1-the-lamb", "scenes", "sc-001.txt"));
      assert.deepEqual(result, { universe_id: "universe-1", project_id: "universe-1/book-1-the-lamb" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects/ two-segment layout supports non-numeric book slugs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-book-slug-"));
    try {
      fs.mkdirSync(path.join(dir, "universes", "universe-1", "book-one", "scenes"), { recursive: true });
      const result = inferProjectAndUniverse(dir, path.join(dir, "projects", "universe-1", "book-one", "scenes", "sc-001.txt"));
      assert.deepEqual(result, { universe_id: "universe-1", project_id: "universe-1/book-one" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects/ nested book-* folder under standalone project is not misclassified", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-no-universe-"));
    try {
      const result = inferProjectAndUniverse(dir, path.join(dir, "projects", "my-novel", "book-1", "scenes", "sc-001.txt"));
      assert.deepEqual(result, { universe_id: null, project_id: "my-novel" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects/ two-segment candidate with case-variant structural dir is supported", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-structural-case-"));
    try {
      fs.mkdirSync(path.join(dir, "universes", "universe-1", "book-1", "World", "characters"), { recursive: true });
      const result = inferProjectAndUniverse(dir, path.join(dir, "projects", "universe-1", "book-1", "World", "characters", "elena.md"));
      assert.deepEqual(result, { universe_id: "universe-1", project_id: "universe-1/book-1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects/ two-segment layout supports named part/chapter structural dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-structural-named-"));
    try {
      fs.mkdirSync(path.join(dir, "universes", "universe-1", "book-1", "chapter-1-arrival"), { recursive: true });
      const result = inferProjectAndUniverse(
        dir,
        path.join(dir, "projects", "universe-1", "book-1", "chapter-1-arrival", "sc-001.txt")
      );
      assert.deepEqual(result, { universe_id: "universe-1", project_id: "universe-1/book-1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

describe("runSceneCharacterBatch", () => {
  function makeBatchFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-scenes-"));
    const scenesDir = path.join(dir, "projects", "test-novel", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    return { dir, scenesDir };
  }

  function writeBatchScene(dir, id, prose, sidecarCharacters = []) {
    const filePath = path.join(dir, "projects", "test-novel", "scenes", `${id}.md`);
    fs.writeFileSync(filePath, `---\nscene_id: ${id}\ntitle: ${id}\npart: 1\nchapter: 1\n---\n${prose}\n`, "utf8");
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", `${id}.meta.yaml`),
      yaml.dump({ scene_id: id, title: id, part: 1, chapter: 1, characters: sidecarCharacters }),
      "utf8"
    );
    return filePath;
  }

  test("infers canonical full-name matches in dry-run mode", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Elena Vasquez waits by the harbor.", []);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "elena", name: "Elena Vasquez" },
          { character_id: "marcus", name: "Marcus Hale" },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0].inferred_characters, ["elena"]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("marks ambiguous token matches as skipped_ambiguous", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Elena arrives after dark.", []);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        include_match_details: true,
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "elena-v", name: "Elena Vasquez" },
          { character_id: "elena-h", name: "Elena Hart" },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results[0].inferred_characters, []);
    assert.equal(result.results[0].status, "skipped_ambiguous");
    assert.deepEqual(result.results[0].match_details.ambiguous_tokens, ["elena"]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not treat duplicate tokens in one name as ambiguous", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Luna appears in the doorway.", []);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        include_match_details: true,
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "luna", name: "Luna Luna" },
          { character_id: "marcus", name: "Marcus Hale" },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results[0].inferred_characters, ["luna"]);
    assert.deepEqual(result.results[0].match_details.ambiguous_tokens, []);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("keeps status unchanged when inferred matches coexist with ambiguous tokens", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Elena Vasquez arrives after dark.", ["elena-v"]);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        include_match_details: true,
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "elena-v", name: "Elena Vasquez" },
          { character_id: "elena-h", name: "Elena Hart" },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results[0].inferred_characters, ["elena-v"]);
    assert.deepEqual(result.results[0].match_details.ambiguous_tokens, ["elena"]);
    assert.equal(result.results[0].status, "unchanged");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("merge mode preserves existing links and adds inferred ones", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Elena Vasquez waits by the harbor.", ["marcus"]);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "elena", name: "Elena Vasquez" },
          { character_id: "marcus", name: "Marcus Hale" },
        ],
      },
    });

    assert.deepEqual(result.results[0].before_characters, ["marcus"]);
    assert.deepEqual(result.results[0].after_characters.sort(), ["elena", "marcus"]);
    assert.deepEqual(result.results[0].added, ["elena"]);
    assert.deepEqual(result.results[0].removed, []);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("replace mode overwrites existing links with inferred ones", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Elena Vasquez waits by the harbor.", ["marcus"]);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "replace",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "elena", name: "Elena Vasquez" },
          { character_id: "marcus", name: "Marcus Hale" },
        ],
      },
    });

    assert.deepEqual(result.results[0].before_characters, ["marcus"]);
    assert.deepEqual(result.results[0].after_characters, ["elena"]);
    assert.deepEqual(result.results[0].added, ["elena"]);
    assert.deepEqual(result.results[0].removed, ["marcus"]);

    fs.rmSync(dir, { recursive: true, force: true });
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
// scripts/merge-scrivx.js and scrivener-direct.js
// ---------------------------------------------------------------------------
describe("Scrivener direct metadata merge", () => {
  function createScrivenerProjectFixture(options = {}) {
    const {
      extraMetaDataItems = "",
      synopsisText = "Elena returns to the harbor.",
      includeSynopsis = true,
      chapterTitle = "Arrival",
    } = options;
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrivener-project-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-1">1</SyncItem>
  </ExternalSyncMap>
  <Keywords>
    <Keyword ID="kw-character"><Title>Elena Voss</Title></Keyword>
    <Keyword ID="kw-version"><Title>v1.2</Title></Keyword>
  </Keywords>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-1">
              <Title>${chapterTitle}</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-1">
                  <Keywords>
                    <KeywordID>kw-character</KeywordID>
                    <KeywordID>kw-version</KeywordID>
                  </Keywords>
                  <MetaData>
                    <MetaDataItem><FieldID>savethecat!</FieldID><Value>Setup</Value></MetaDataItem>
                    <MetaDataItem><FieldID>causality</FieldID><Value>2</Value></MetaDataItem>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>3</Value></MetaDataItem>
                    <MetaDataItem><FieldID>change</FieldID><Value>Escalates conflict</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:character</FieldID><Value>Yes</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:mood</FieldID><Value>Yes</Value></MetaDataItem>
                    ${extraMetaDataItems}
                  </MetaData>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

    fs.writeFileSync(scrivxPath, xml, "utf8");
    fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-1"), { recursive: true });
    if (includeSynopsis) {
      fs.writeFileSync(
        path.join(scrivDir, "Files", "Data", "UUID-1", "synopsis.txt"),
        synopsisText,
        "utf8"
      );
    }

    return scrivDir;
  }

  function createSyncSidecarFixture(projectId = "test-import", extraSidecars = []) {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-merge-sync-"));
    const scenesDir = path.join(syncRoot, "projects", projectId, "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "001 Scene Arrival [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-001-arrival", logline: "Preserve this existing value." }),
      "utf8"
    );

    for (const extraSidecar of extraSidecars) {
      fs.writeFileSync(path.join(scenesDir, extraSidecar.name), yaml.dump(extraSidecar.data), "utf8");
    }

    return { syncRoot, scenesDir };
  }

  test("mergeSidecarData only adds missing fields", () => {
    const existing = { scene_id: "sc-001", title: "Keep title" };
    const mergeData = { title: "New title", chapter: 2, characters: ["Elena"] };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["chapter", "characters"]);
    assert.equal(result.merged.title, "Keep title");
    assert.equal(result.merged.chapter, 2);
  });

  test("mergeSidecarData blocks importer-authoritative fields and reports them", () => {
    const existing = {};
    const mergeData = {
      scene_id: "sc-should-not-write",
      external_source: "scrivener",
      external_id: "42",
      title: "Should not write",
      timeline_position: 5,
      chapter: 2,
    };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["chapter"]);
    assert.deepEqual(result.blockedKeys.sort(), ["external_id", "external_source", "scene_id", "timeline_position", "title"]);
    assert.equal("scene_id" in result.merged, false);
    assert.equal("external_source" in result.merged, false);
    assert.equal("external_id" in result.merged, false);
    assert.equal("title" in result.merged, false);
    assert.equal("timeline_position" in result.merged, false);
    assert.equal(result.merged.chapter, 2);
  });

  test("mergeSidecarData returns empty blockedKeys when no authoritative fields attempted", () => {
    const existing = { chapter: 1 };
    const mergeData = { synopsis: "A new synopsis", tags: ["action"] };

    const result = mergeSidecarData(existing, mergeData);

    assert.deepEqual(result.blockedKeys, []);
    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["synopsis", "tags"]);
  });

  test("mergeSidecarData no-op when all fields already present and none blocked", () => {
    const existing = { chapter: 1, synopsis: "Keep this" };
    const mergeData = { chapter: 99, synopsis: "New synopsis" };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, false);
    assert.deepEqual(result.newKeys, []);
    assert.deepEqual(result.blockedKeys, []);
    assert.equal(result.merged.chapter, 1);
    assert.equal(result.merged.synopsis, "Keep this");
  });

  test("IMPORTER_AUTHORITATIVE_FIELDS contains expected identity fields", () => {
    for (const field of ["scene_id", "external_source", "external_id", "title", "timeline_position"]) {
      assert.ok(IMPORTER_AUTHORITATIVE_FIELDS.includes(field), `Expected ${field} to be authoritative`);
    }
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("chapter"), "chapter should not be authoritative");
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("synopsis"), "synopsis should not be authoritative");
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("save_the_cat_beat"), "save_the_cat_beat should not be authoritative");
    assert.ok(Object.isFrozen(IMPORTER_AUTHORITATIVE_FIELDS), "authoritative field list should be immutable");
  });

  test("walkYamls skips projects/ and universes/ mirror subdirectories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "walkyamls-mirror-"));
    try {
      // Real sidecar in scenes/
      fs.writeFileSync(path.join(root, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");

      // Mirror subdirectories that should be skipped
      const projectsMirror = path.join(root, "projects", "my-novel", "scenes");
      const universesMirror = path.join(root, "universes", "aether", "book-one", "scenes");
      fs.mkdirSync(projectsMirror, { recursive: true });
      fs.mkdirSync(universesMirror, { recursive: true });
      fs.writeFileSync(path.join(projectsMirror, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");
      fs.writeFileSync(path.join(universesMirror, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");

      // mergeScrivenerProjectMetadata reports sidecarFiles: the count of files walkYamls found.
      // If mirror dirs leaked through, sidecarFiles would be 3 instead of 1.
      const scrivDir = createScrivenerProjectFixture();
      try {
        const result = mergeScrivenerProjectMetadata({
          scrivPath: scrivDir,
          mcpSyncDir: root,
          projectId: "my-novel",
          scenesDir: root,
          dryRun: true,
        });

        // Only the single real sidecar should be seen (no bracket → skippedNoBracketId=1).
        // If mirror dirs leaked through, sidecarFiles would be 3 instead of 1.
        assert.equal(result.sidecarFiles, 1, "Mirror subdirectory sidecars must not be visited by walkYamls");
        assert.equal(result.skippedNoBracketId, 1, "The one sidecar with no bracket ID should be reported");
      } finally {
        fs.rmSync(scrivDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadScrivenerProjectData parses sync map and metadata", () => {
    const scrivDir = createScrivenerProjectFixture();
    try {
      const data = loadScrivenerProjectData(scrivDir);
      assert.equal(data.syncNumToUUID["1"], "UUID-1");
      assert.equal(data.keywordMap["kw-character"], "Elena Voss");
      assert.equal(data.metaByUUID["UUID-1"].synopsis, "Elena returns to the harbor.");
      assert.deepEqual(data.metaByUUID["UUID-1"].tags, ["Elena Voss", "v1.2"]);
      assert.equal(data.chapterByUUID["UUID-1"], 1);
      assert.equal(data.partByUUID["UUID-1"], 1);
      assert.equal(data.chapterTitleByUUID["UUID-1"], "Arrival");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata relocates scene files into named chapter folders", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const prosePath = path.join(scenesDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(prosePath, "Scene prose.\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: true,
      });

      const targetDir = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival");
      const relocatedSidecar = path.join(targetDir, "001 Scene Arrival [1].meta.yaml");
      const relocatedProse = path.join(targetDir, "001 Scene Arrival [1].txt");
      const sidecar = yaml.load(fs.readFileSync(relocatedSidecar, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 1);
      assert.equal(fs.existsSync(relocatedSidecar), true);
      assert.equal(fs.existsSync(relocatedProse), true);
      assert.equal(fs.existsSync(path.join(scenesDir, "001 Scene Arrival [1].meta.yaml")), false);
      assert.equal(fs.existsSync(prosePath), false);
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Harbor Arrival");
      assert.deepEqual(sidecar.tags, ["Elena Voss", "v1.2"]);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata with organize_by_chapters: false keeps scenes in place and only updates sidecar metadata", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const prosePath = path.join(scenesDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(prosePath, "Scene prose.\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: false,
      });

      const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const relocatedSidecar = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival", "001 Scene Arrival [1].meta.yaml");
      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 0, "No files should be relocated when organize_by_chapters is false");
      assert.equal(fs.existsSync(sidecarPath), true, "Sidecar should remain in original location");
      assert.equal(fs.existsSync(prosePath), true, "Prose should remain in original location");
      assert.equal(fs.existsSync(relocatedSidecar), false, "No relocated sidecar should exist");
      assert.equal(sidecar.chapter, 1, "Chapter metadata should still be added to sidecar");
      assert.equal(sidecar.chapter_title, "Harbor Arrival", "Chapter title should still be added to sidecar");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata with organize_by_chapters: false does not flatten nested scene paths", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();

    const nestedDir = path.join(scenesDir, "legacy", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });

    const originalSidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
    const nestedSidecarPath = path.join(nestedDir, "001 Scene Arrival [1].meta.yaml");
    fs.renameSync(originalSidecarPath, nestedSidecarPath);

    const nestedProsePath = path.join(nestedDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(nestedProsePath, "Scene prose.\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: false,
      });

      const sidecar = yaml.load(fs.readFileSync(nestedSidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 0, "No relocation should occur when organize_by_chapters is false");
      assert.equal(fs.existsSync(nestedSidecarPath), true, "Nested sidecar should remain in place");
      assert.equal(fs.existsSync(nestedProsePath), true, "Nested prose should remain in place");
      assert.equal(fs.existsSync(path.join(scenesDir, "001 Scene Arrival [1].meta.yaml")), false, "Sidecar should not be flattened back to scenes root");
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Harbor Arrival");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata keeps sidecar in place when relocation destination exists", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const prosePath = path.join(scenesDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(prosePath, "Scene prose.\n", "utf8");

    const targetDir = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival");
    fs.mkdirSync(targetDir, { recursive: true });
    const targetSidecarPath = path.join(targetDir, "001 Scene Arrival [1].meta.yaml");
    fs.writeFileSync(targetSidecarPath, yaml.dump({ scene_id: "sc-existing-target", title: "Existing" }), "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: true,
      });

      const originalSidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const originalSidecar = yaml.load(fs.readFileSync(originalSidecarPath, "utf8"));
      const targetSidecar = yaml.load(fs.readFileSync(targetSidecarPath, "utf8"));

      assert.ok(result.updated >= 1, "At least one sidecar should be updated");
      assert.equal(result.relocated, 0, "Sidecar should not relocate when destination exists");
      assert.equal(fs.existsSync(originalSidecarPath), true, "Original sidecar should be kept in place");
      assert.equal(fs.existsSync(prosePath), true, "Original prose should be kept in place");
      assert.equal(result.warningSummary.relocate_sidecar_destination_exists.count, 1);
      const relocateExample = result.warningSummary.relocate_sidecar_destination_exists.examples[0];
      assert.equal(relocateExample.from_path, originalSidecarPath);
      assert.equal(relocateExample.to_path, targetSidecarPath);
      assert.equal(originalSidecar.chapter, 1);
      assert.equal(originalSidecar.chapter_title, "Harbor Arrival");
      assert.equal(targetSidecar.scene_id, "sc-existing-target", "Existing destination sidecar must not be overwritten");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata dry run reports updates without writing", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();

    try {
      const logs = [];
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
        logger: line => logs.push(line),
      });

      const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.ok(logs.some(line => line.includes("DRY   001 Scene Arrival [1].meta.yaml")));
      assert.equal(sidecar.chapter, undefined);
      assert.equal(sidecar.synopsis, undefined);
      assert.equal(sidecar.logline, "Preserve this existing value.");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata returns structured warnings for skipped and normalized inputs", () => {
    const scrivDir = createScrivenerProjectFixture({
      extraMetaDataItems: [
        "<MetaDataItem><FieldID>mood-color</FieldID><Value>Blue</Value></MetaDataItem>",
        "<MetaDataItem><FieldID>stakes</FieldID><Value>high</Value></MetaDataItem>",
      ].join(""),
      includeSynopsis: false,
    });
    const { syncRoot } = createSyncSidecarFixture("test-import", [
      { name: "002 Missing Mapping [99].meta.yaml", data: { scene_id: "sc-099" } },
      { name: "Loose Scene.meta.yaml", data: { scene_id: "sc-loose" } },
    ]);

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.missing_uuid_mapping.count, 1);
      assert.equal(result.warningSummary.missing_bracket_id.count, 1);
      assert.equal(result.warningSummary.ignored_custom_field.count, 1);
      assert.equal(result.warningSummary.invalid_custom_field_value.count, 1);
      assert.ok(result.warnings.some(w => w.code === "ignored_custom_field" && w.field_id === "mood-color"));
      assert.ok(result.warnings.some(w => w.code === "invalid_custom_field_value" && w.field_id === "stakes"));
      assert.ok(!("missing_synopsis" in result.warningSummary));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata emits deterministic ambiguity warning codes", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
    const existing = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
    fs.writeFileSync(
      sidecarPath,
      yaml.dump(
        {
          ...existing,
          chapter: 9,
          synopsis: "Conflicting synopsis from sidecar.",
          external_source: "manual",
        },
        { lineWidth: 120 }
      ),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.ambiguous_identity_tie.count, 1);
      assert.equal(result.warningSummary.ambiguous_structure_mapping.count, 1);
      assert.equal(result.warningSummary.ambiguous_metadata_mapping.count, 1);

      const identityWarning = result.warnings.find(w => w.code === "ambiguous_identity_tie");
      assert.equal(identityWarning.reason, "external_source_conflict");
      assert.equal(identityWarning.external_source, "manual");

      const structureWarning = result.warnings.find(w => w.code === "ambiguous_structure_mapping");
      assert.equal(structureWarning.field, "chapter");
      assert.equal(structureWarning.existing_value, 9);
      assert.equal(structureWarning.scrivener_value, 1);

      const metadataWarning = result.warnings.find(w => w.code === "ambiguous_metadata_mapping");
      assert.equal(metadataWarning.field, "synopsis");
      assert.equal(metadataWarning.existing_value, "Conflicting synopsis from sidecar.");
      assert.equal(metadataWarning.scrivener_value, "Elena returns to the harbor.");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata caps returned warnings but keeps full summary counts", () => {
    const scrivDir = createScrivenerProjectFixture();
    const extraSidecars = Array.from({ length: 30 }, (_, index) => ({
      name: `${String(index + 2).padStart(3, "0")} Missing Mapping [${index + 100}].meta.yaml`,
      data: { scene_id: `sc-${index + 100}` },
    }));
    const { syncRoot } = createSyncSidecarFixture("test-import", extraSidecars);

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.missing_uuid_mapping.count, 30);
      assert.equal(result.warnings.length, 25);
      assert.equal(result.warningsTruncated, true);
      assert.ok(result.warnings.every(w => w.code === "missing_uuid_mapping"));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata skips nested projects/universes mirror directories", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const mirrorProjectsDir = path.join(scenesDir, "projects", "mirror", "scenes");
    const mirrorUniversesDir = path.join(scenesDir, "universes", "mirror", "book", "scenes");
    fs.mkdirSync(mirrorProjectsDir, { recursive: true });
    fs.mkdirSync(mirrorUniversesDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorProjectsDir, "Loose Mirror.meta.yaml"), "scene_id: sc-mirror-1\n", "utf8");
    fs.writeFileSync(path.join(mirrorUniversesDir, "999 Mirror Missing [999].meta.yaml"), "scene_id: sc-mirror-2\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.updated, 1);
      assert.ok(!("missing_bracket_id" in result.warningSummary));
      assert.ok(!("missing_uuid_mapping" in result.warningSummary));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata rejects invalid project_id shape", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot } = createSyncSidecarFixture();

    try {
      assert.throws(
        () => mergeScrivenerProjectMetadata({
          scrivPath: scrivDir,
          mcpSyncDir: syncRoot,
          projectId: "universe/a/b",
          dryRun: true,
        }),
        /Invalid project_id/
      );
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("scripts/merge-scrivx.js remains runnable and writes merged metadata", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();

    try {
      const result = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "scripts", "merge-scrivx.js"), scrivDir, syncRoot, "--project", "test-import", "--organize-by-chapters"],
        { encoding: "utf8" }
      );

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const sidecar = yaml.load(
        fs.readFileSync(path.join(scenesDir, "part-1", "chapter-1-arrival", "001 Scene Arrival [1].meta.yaml"), "utf8")
      );

      assert.equal(sidecar.scene_id, "sc-001-arrival");
      assert.equal(sidecar.logline, "Preserve this existing value.");
      assert.equal(sidecar.part, 1);
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Arrival");
      assert.equal(sidecar.synopsis, "Elena returns to the harbor.");
      assert.deepEqual(sidecar.tags, ["Elena Voss", "v1.2"]);
      assert.equal(sidecar.save_the_cat_beat, "Setup");
      assert.equal(sidecar.causality, 2);
      assert.equal(sidecar.stakes, 3);
      assert.equal(sidecar.scene_change, "Escalates conflict");
      assert.deepEqual(sidecar.scene_functions, ["character", "mood"]);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// package.json files allowlist — regression guard
// ---------------------------------------------------------------------------
describe("package.json files allowlist", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const allowlist = pkg.files ?? [];

  test("every file listed in files exists on disk", () => {
    for (const entry of allowlist) {
      const full = path.join(root, entry);
      assert.ok(
        fs.existsSync(full),
        `package.json files entry "${entry}" does not exist on disk`
      );
    }
  });

  test("every local JS module imported by index.js is in the files allowlist", () => {
    const indexSrc = fs.readFileSync(path.join(root, "index.js"), "utf8");
    const localImports = [...indexSrc.matchAll(/^import\s+.+?\s+from\s+["'](\.\/[^"']+)["']/gm)]
      .map((m) => m[1].replace(/^\.\//, ""));

    for (const file of localImports) {
      assert.ok(
        allowlist.includes(file),
        `"${file}" is imported by index.js but missing from package.json files allowlist`
      );
    }
  });
});
