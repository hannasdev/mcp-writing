import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { checksumProse, walkFiles, inferProjectAndUniverse, isWorldFile, syncAll } from "../sync.js";
import { openDb } from "../db.js";

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
});
