import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  checksumProse, inferProjectAndUniverse, inferScenePositionFromPath,
  inferChapterStructureFromPath,
  inferReferenceDocType, isReferenceFile, deriveReferenceDocId,
  deriveReferenceSummary, deriveReferenceTitle, normalizeReferenceTags,
  normalizeReferenceIdList,
  isCanonicalWorldEntityFile, getSyncOwnershipDiagnostics, getFileWriteDiagnostics,
  isWorldFile, readMeta, isSyncDirWritable, sidecarPath, syncAll,
  walkFiles, walkSidecars, worldEntityFolderKey, worldEntityKindForPath,
} from "../../sync/sync.js";
import { openDb } from "../../core/db.js";

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

describe("inferChapterStructureFromPath", () => {
  const syncDir = "/sync";

  test("detects v1 chapter folders with ordered prefix and title", () => {
    const result = inferChapterStructureFromPath(syncDir, "/sync/projects/novel/Draft/01-The perfect chapter/sc-001.md");
    assert.equal(result.chapter.sort_index, 1);
    assert.equal(result.chapter.title, "The Perfect Chapter");
    assert.equal(result.chapter.chapter_id, "ch-01-the-perfect-chapter");
  });

  test("detects explicit prologue folder outside chapters", () => {
    const result = inferChapterStructureFromPath(syncDir, "/sync/projects/novel/Draft/prologue/sc-000.md");
    assert.equal(result.role, "prologue");
    assert.equal(result.chapter, null);
  });

  test("does not treat non-draft numeric slug ancestors as chapter folders", () => {
    const result = inferChapterStructureFromPath(syncDir, "/sync/projects/novel/2026-novel/scenes/sc-001.md");
    assert.equal(result.chapter, null);
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

describe("reference docs", () => {
  const syncDir = "/sync";

  test("detects reference files in world/reference paths", () => {
    assert.equal(isReferenceFile(syncDir, "/sync/projects/novel/world/reference/vampirism.md"), true);
  });

  test("detects reference files in project-root world/reference paths", () => {
    assert.equal(isReferenceFile("/sync/projects/novel", "/sync/projects/novel/world/reference/vampirism.md"), true);
  });

  test("detects reference files in Notes paths", () => {
    assert.equal(isReferenceFile(syncDir, "/sync/projects/novel/Notes/continuity/blood.md"), true);
  });

  test("infers reference doc types from path", () => {
    assert.equal(inferReferenceDocType(syncDir, "/sync/projects/novel/world/reference/vampirism.md"), "world");
    assert.equal(inferReferenceDocType(syncDir, "/sync/projects/novel/Notes/continuity/blood.md"), "continuity");
    assert.equal(inferReferenceDocType(syncDir, "/sync/projects/novel/Notes/research/boats.md"), "research");
  });

  test("infers reference doc types for project-root sync layouts", () => {
    assert.equal(inferReferenceDocType("/sync/projects/novel", "/sync/projects/novel/world/reference/vampirism.md"), "world");
    assert.equal(inferReferenceDocType("/sync/projects/novel", "/sync/projects/novel/Notes/continuity/blood.md"), "continuity");
  });

  test("derives stable doc ids from relative path when doc_id is missing", () => {
    assert.equal(
      deriveReferenceDocId(syncDir, "/sync/projects/novel/world/reference/vampirism.md", {}),
      "ref-projects-novel-world-reference-vampirism"
    );
  });

  test("prefers explicit title and summary when provided", () => {
    assert.equal(
      deriveReferenceTitle("/sync/projects/novel/world/reference/vampirism.md", { title: "Custom Title" }, "# Ignored"),
      "Custom Title"
    );
    assert.equal(
      deriveReferenceSummary({ summary: "Custom summary" }, "Ignored body"),
      "Custom summary"
    );
  });

  test("normalizes tags from strings and removes duplicates", () => {
    assert.deepEqual(
      normalizeReferenceTags(["blood", " blood ", "lore"]),
      ["blood", "lore"]
    );
  });

  test("normalizes reference ids from strings and removes duplicates", () => {
    assert.deepEqual(
      normalizeReferenceIdList("ref-vampirism, ref-blood, ref-vampirism"),
      ["ref-vampirism", "ref-blood"]
    );
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

  test("indexes reference docs with inferred type, summary, and tags", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "reference"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "Notes", "continuity"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md"),
      "---\ntitle: Vampirism in this universe\nsummary: Rules of vampirism.\ntags:\n  - vampirism\n  - lore\n---\nReference body."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "Notes", "continuity", "blood-replacement.md"),
      "---\ntitle: Sebastian's struggle for blood replacement\ntags:\n  - continuity\n  - blood\n---\nSebastian catalogues failed inventions."
    );

    syncAll(db, dir, { quiet: true });

    const docs = db.prepare(`
      SELECT doc_id, type, title, summary
      FROM reference_docs
      ORDER BY doc_id
    `).all();
    assert.equal(docs.length, 2);
    assert.equal(docs[0].type, "continuity");
    assert.equal(docs[1].type, "world");
    assert.equal(docs[1].summary, "Rules of vampirism.");

    const tags = db.prepare(`
      SELECT tag
      FROM reference_doc_tags
      WHERE doc_id = ?
      ORDER BY tag
    `).all("ref-projects-test-novel-world-reference-vampirism").map(row => row.tag);
    assert.deepEqual(tags, ["lore", "vampirism"]);

    const matches = db.prepare(`
      SELECT doc_id
      FROM reference_docs_fts
      WHERE reference_docs_fts MATCH 'vampirism'
    `).all();
    assert.equal(matches.length, 1);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("indexes scene->reference and reference->reference links from metadata", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "reference"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "Notes", "continuity"), { recursive: true });

    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md"),
      "---\ndoc_id: ref-vampirism\ntitle: Vampirism in this universe\nrelated_reference_ids:\n  - ref-blood-replacement\n  - ref-vampirism\n---\nReference body."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "Notes", "continuity", "blood-replacement.md"),
      "---\ndoc_id: ref-blood-replacement\ntitle: Sebastian's struggle for blood replacement\n---\nReference body."
    );

    writeScene(dir, "sc-001", {
      reference_ids: ["ref-vampirism", "ref-blood-replacement"],
    });

    syncAll(db, dir, { quiet: true });

    const sceneLinks = db.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation
      FROM reference_links
      WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-001'
      ORDER BY target_doc_id
    `).all().map(row => ({ ...row }));
    assert.deepEqual(sceneLinks, [
      { source_kind: "scene", source_project_id: "test-novel", source_id: "sc-001", target_doc_id: "ref-blood-replacement", relation: "informs" },
      { source_kind: "scene", source_project_id: "test-novel", source_id: "sc-001", target_doc_id: "ref-vampirism", relation: "informs" },
    ]);

    const referenceLinks = db.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation
      FROM reference_links
      WHERE source_kind = 'reference' AND source_project_id = 'test-novel' AND source_id = 'ref-vampirism'
      ORDER BY target_doc_id
    `).all().map(row => ({ ...row }));
    assert.deepEqual(referenceLinks, [
      { source_kind: "reference", source_project_id: "test-novel", source_id: "ref-vampirism", target_doc_id: "ref-blood-replacement", relation: "related" },
    ]);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("prunes deleted reference docs from search tables on re-sync", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const refPath = path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ntitle: Vampirism in this universe\ntags:\n  - vampirism\n---\nReference body."
    );

    syncAll(db, dir, { quiet: true });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs`).get().count, 1);

    fs.rmSync(refPath);
    syncAll(db, dir, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs`).get().count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_doc_tags`).get().count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs_fts`).get().count, 0);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("prunes reference_links that target deleted reference docs on re-sync", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const targetPath = path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md");
    const sourcePath = path.join(dir, "projects", "test-novel", "Notes", "continuity", "blood-replacement.md");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });

    fs.writeFileSync(
      targetPath,
      "---\ndoc_id: ref-vampirism\ntitle: Vampirism in this universe\n---\nReference body."
    );
    fs.writeFileSync(
      sourcePath,
      "---\ndoc_id: ref-blood\ntitle: Blood replacement notes\nrelated_reference_ids:\n  - ref-vampirism\n---\nReference body."
    );

    syncAll(db, dir, { quiet: true });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_links`).get().count, 1);

    fs.rmSync(targetPath);
    syncAll(db, dir, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs WHERE doc_id = 'ref-vampirism'`).get().count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_links`).get().count, 0);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("keeps scene->reference links isolated when the same scene_id exists in multiple projects", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "alpha-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "alpha-novel", "world", "reference"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "beta-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "beta-novel", "world", "reference"), { recursive: true });

    fs.writeFileSync(
      path.join(dir, "projects", "alpha-novel", "scenes", "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Alpha Scene\nreference_ids:\n  - ref-alpha\n---\nAlpha prose."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "beta-novel", "scenes", "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Beta Scene\nreference_ids:\n  - ref-beta\n---\nBeta prose."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "alpha-novel", "world", "reference", "alpha.md"),
      "---\ndoc_id: ref-alpha\ntitle: Alpha reference\n---\nAlpha reference body."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "beta-novel", "world", "reference", "beta.md"),
      "---\ndoc_id: ref-beta\ntitle: Beta reference\n---\nBeta reference body."
    );

    syncAll(db, dir, { quiet: true });

    const sceneLinks = db.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation
      FROM reference_links
      WHERE source_kind = 'scene' AND source_id = 'sc-001'
      ORDER BY source_project_id, target_doc_id
    `).all().map(row => ({ ...row }));

    assert.deepEqual(sceneLinks, [
      { source_kind: "scene", source_project_id: "alpha-novel", source_id: "sc-001", target_doc_id: "ref-alpha", relation: "informs" },
      { source_kind: "scene", source_project_id: "beta-novel", source_id: "sc-001", target_doc_id: "ref-beta", relation: "informs" },
    ]);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("indexes explicit links from metadata fields and skips inferred overwrite for the same target", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "test-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "reference"), { recursive: true });

    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Scene\ntags: [test]\nreference_ids:\n  - ref-vamp\nreference_links:\n  - target_doc_id: ref-vamp\n    relation: see_also\n---\nScene prose."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "reference", "vamp.md"),
      "---\ndoc_id: ref-vamp\ntitle: Vamp\n---\nReference body."
    );

    syncAll(db, dir, { quiet: true });
    syncAll(db, dir, { quiet: true });

    const links = db.prepare(`
      SELECT relation, origin
      FROM reference_links
      WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-001' AND target_doc_id = 'ref-vamp'
      ORDER BY relation
    `).all().map(row => ({ ...row }));
    assert.deepEqual(links, [
      { relation: "see_also", origin: "explicit" },
    ]);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("single sync pass prefers explicit relation when inferred and explicit target overlap", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "test-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "reference", "vamp.md"),
      "---\ndoc_id: ref-vamp\ntitle: Vamp\nrelated_reference_ids:\n  - ref-vamp\nreference_links:\n  - target_doc_id: ref-vamp\n    relation: history_of\n---\nReference body."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Scene\nreference_ids:\n  - ref-vamp\nreference_links:\n  - target_doc_id: ref-vamp\n    relation: see_also\n---\nScene prose."
    );

    syncAll(db, dir, { quiet: true });

    const sceneLinks = db.prepare(`
      SELECT relation, origin
      FROM reference_links
      WHERE source_kind = 'scene' AND source_project_id = 'test-novel' AND source_id = 'sc-001' AND target_doc_id = 'ref-vamp'
      ORDER BY relation
    `).all().map((row) => ({ ...row }));
    assert.deepEqual(sceneLinks, [{ relation: "see_also", origin: "explicit" }]);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("rebuilds explicit links from source metadata after DB reset", () => {
    const dir = makeTempSync();
    const scenePath = path.join(dir, "projects", "test-novel", "scenes", "sc-001.md");
    const sourceRefPath = path.join(dir, "projects", "test-novel", "world", "reference", "source.md");
    const targetRefPath = path.join(dir, "projects", "test-novel", "world", "reference", "target.md");

    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.mkdirSync(path.dirname(sourceRefPath), { recursive: true });

    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-001\ntitle: Scene\nreference_links:\n  - target_doc_id: ref-target\n    relation: history_of\n---\nScene prose."
    );
    fs.writeFileSync(
      sourceRefPath,
      "---\ndoc_id: ref-source\ntitle: Source\nreference_links:\n  - target_doc_id: ref-target\n    relation: depends_on\n---\nSource body."
    );
    fs.writeFileSync(
      targetRefPath,
      "---\ndoc_id: ref-target\ntitle: Target\n---\nTarget body."
    );

    const db1 = openDb(":memory:");
    syncAll(db1, dir, { quiet: true });

    const linksAfterFirstSync = db1.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation, origin
      FROM reference_links
      ORDER BY source_kind, source_id, relation
    `).all().map(row => ({ ...row }));
    assert.deepEqual(linksAfterFirstSync, [
      {
        source_kind: "reference",
        source_project_id: "test-novel",
        source_id: "ref-source",
        target_doc_id: "ref-target",
        relation: "depends_on",
        origin: "explicit",
      },
      {
        source_kind: "scene",
        source_project_id: "test-novel",
        source_id: "sc-001",
        target_doc_id: "ref-target",
        relation: "history_of",
        origin: "explicit",
      },
    ]);
    db1.close();

    const db2 = openDb(":memory:");
    syncAll(db2, dir, { quiet: true });

    const linksAfterRebuild = db2.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation, origin
      FROM reference_links
      ORDER BY source_kind, source_id, relation
    `).all().map(row => ({ ...row }));
    assert.deepEqual(linksAfterRebuild, linksAfterFirstSync);

    db2.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("keeps one FTS row per reference doc across repeated sync runs", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const refPath = path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ntitle: Vampirism in this universe\ntags:\n  - vampirism\n---\nReference body."
    );

    syncAll(db, dir, { quiet: true });
    syncAll(db, dir, { quiet: true });

    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM reference_docs_fts WHERE doc_id = ?`).get("ref-projects-test-novel-world-reference-vampirism").count,
      1
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("indexes reference docs with correct project metadata from a project-root sync dir", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-project-root-"));
    const projectRoot = path.join(syncRoot, "projects", "project-root-novel");
    const db = openDb(":memory:");
    fs.mkdirSync(path.join(projectRoot, "world", "reference"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "Notes", "continuity"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "world", "reference", "vampirism.md"),
      "---\ntitle: Vampirism in this universe\n---\nReference body."
    );
    fs.writeFileSync(
      path.join(projectRoot, "Notes", "continuity", "blood-replacement.md"),
      "---\ntitle: Sebastian's struggle for blood replacement\n---\nReference body."
    );

    syncAll(db, projectRoot, { quiet: true });

    const docs = db.prepare(`
      SELECT doc_id, project_id, type
      FROM reference_docs
      ORDER BY doc_id
    `).all().map(row => ({ ...row }));
    assert.deepEqual(docs, [
      {
        doc_id: "ref-notes-continuity-blood-replacement",
        project_id: "project-root-novel",
        type: "continuity",
      },
      {
        doc_id: "ref-world-reference-vampirism",
        project_id: "project-root-novel",
        type: "world",
      },
    ]);

    db.close();
    fs.rmSync(syncRoot, { recursive: true });
  });

  test("indexes universe-root reference docs with correct universe metadata", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-universe-root-"));
    const universeRoot = path.join(syncRoot, "universes", "aether");
    const db = openDb(":memory:");
    fs.mkdirSync(path.join(universeRoot, "world", "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(universeRoot, "world", "reference", "vampirism.md"),
      "---\ntitle: Vampirism in this universe\n---\nReference body."
    );

    syncAll(db, universeRoot, { quiet: true });

    const docs = db.prepare(`
      SELECT doc_id, project_id, universe_id, type
      FROM reference_docs
      ORDER BY doc_id
    `).all().map(row => ({ ...row }));
    assert.deepEqual(docs, [
      {
        doc_id: "ref-world-reference-vampirism",
        project_id: null,
        universe_id: "aether",
        type: "world",
      },
    ]);

    db.close();
    fs.rmSync(syncRoot, { recursive: true });
  });

  test("does not prune reference docs when sync root is narrowed to scenes", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const refPath = path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ntitle: Vampirism in this universe\ntags:\n  - vampirism\n---\nReference body."
    );
    writeScene(dir, "sc-001");

    syncAll(db, dir, { quiet: true });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs`).get().count, 1);

    const scenesRoot = path.join(dir, "projects", "test-novel", "scenes");
    syncAll(db, scenesRoot, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs`).get().count, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM reference_docs_fts WHERE reference_docs_fts MATCH 'vampirism'`).get().count,
      1
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not prune reference docs when sync root is a deeper scenes subtree", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");
    const refPath = path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ntitle: Vampirism in this universe\ntags:\n  - vampirism\n---\nReference body."
    );
    const chapterDir = path.join(dir, "projects", "test-novel", "scenes", "chapter-1");
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(chapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Scene sc-001\npart: 1\nchapter: 1\npov: elena\n---\nProse content for scene sc-001."
    );

    syncAll(db, dir, { quiet: true });
    syncAll(db, chapterDir, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reference_docs`).get().count, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM reference_docs_fts WHERE reference_docs_fts MATCH 'vampirism'`).get().count,
      1
    );

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

  test("prunes deleted scenes and related scene links on re-sync", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "test-novel", "world", "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "world", "reference", "vampirism.md"),
      "---\ndoc_id: ref-vampirism\ntitle: Vampirism in this universe\n---\nReference body."
    );

    writeScene(dir, "sc-001", { reference_ids: ["ref-vampirism"] });
    syncAll(db, dir, { quiet: true });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-001'`).get().count, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM reference_links WHERE source_kind = 'scene' AND source_id = 'sc-001'`).get().count,
      1
    );

    fs.rmSync(path.join(dir, "projects", "test-novel", "scenes", "sc-001.md"));
    syncAll(db, dir, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-001'`).get().count, 0);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM reference_links WHERE source_kind = 'scene' AND source_id = 'sc-001'`).get().count,
      0
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("pruning one project does not clear scene metadata for same scene_id in another project", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "alpha-novel", "scenes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "projects", "beta-novel", "scenes"), { recursive: true });

    fs.writeFileSync(
      path.join(dir, "projects", "alpha-novel", "scenes", "sc-shared.md"),
      "---\nscene_id: sc-shared\ntitle: Alpha Scene\ncharacters:\n  - alpha-hero\n---\nAlpha prose."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "beta-novel", "scenes", "sc-shared.md"),
      "---\nscene_id: sc-shared\ntitle: Beta Scene\ncharacters:\n  - beta-hero\n---\nBeta prose."
    );

    syncAll(db, dir, { quiet: true });

    fs.rmSync(path.join(dir, "projects", "alpha-novel", "scenes", "sc-shared.md"));
    syncAll(db, dir, { quiet: true });

    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-shared' AND project_id = 'alpha-novel'`).get().count,
      0
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-shared' AND project_id = 'beta-novel'`).get().count,
      1
    );
    assert.deepEqual(
      db.prepare(`SELECT character_id FROM scene_characters WHERE scene_id = 'sc-shared' AND project_id = 'beta-novel' ORDER BY character_id`)
        .all()
        .map(row => row.character_id),
      ["beta-hero"]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not prune existing scenes when scene indexing fails", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    writeScene(dir, "sc-001");
    syncAll(db, dir, { quiet: true });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-001'`).get().count, 1);

    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-001.meta.yaml"),
      "scene_id: [invalid"
    );
    syncAll(db, dir, { quiet: true });

    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE scene_id = 'sc-001'`).get().count, 1);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not prune scenes when sync root is a deeper scenes subtree", () => {
    const dir = makeTempSync();
    const db = openDb(":memory:");

    fs.mkdirSync(path.join(dir, "projects", "test-novel", "scenes", "chapter-1"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "chapter-1", "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Scene one\n---\nScene prose."
    );
    fs.writeFileSync(
      path.join(dir, "projects", "test-novel", "scenes", "sc-002.md"),
      "---\nscene_id: sc-002\ntitle: Scene two\n---\nScene prose."
    );

    syncAll(db, dir, { quiet: true });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE project_id = 'test-novel'`).get().count,
      2
    );

    const chapterRoot = path.join(dir, "projects", "test-novel", "scenes", "chapter-1");
    syncAll(db, chapterRoot, { quiet: true });

    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scenes WHERE project_id = 'test-novel'`).get().count,
      2
    );

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

    const rows = db.prepare("SELECT * FROM scene_characters WHERE scene_id = 'sc-001' AND project_id = 'test-novel'").all();
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

  test("indexes canonical chapters and epigraphs from explicit chapter folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const chapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-The perfect chapter");
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(chapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Arrival\nchapter_title: The Perfect Chapter\n---\nScene prose."
    );
    fs.writeFileSync(
      path.join(chapterDir, "epigraph.md"),
      "---\nepigraph_id: epi-001\ncharacters:\n  - elena\n---\nA quiet line before the chapter."
    );

    const result = syncAll(db, dir, { quiet: true });
    assert.equal(result.indexed, 1);
    assert.equal(result.epigraphsIndexed, 1);

    const chapter = db.prepare(`SELECT chapter_id, title, sort_index FROM chapters WHERE project_id = 'test-novel'`).get();
    assert.equal(chapter.chapter_id, "ch-01-the-perfect-chapter");
    assert.equal(chapter.title, "The Perfect Chapter");
    assert.equal(chapter.sort_index, 1);

    const scene = db.prepare(`SELECT chapter_id, chapter, chapter_title FROM scenes WHERE scene_id = 'sc-001' AND project_id = 'test-novel'`).get();
    assert.equal(scene.chapter_id, "ch-01-the-perfect-chapter");
    assert.equal(scene.chapter, 1);
    assert.equal(scene.chapter_title, "The Perfect Chapter");

    const epigraph = db.prepare(`SELECT epigraph_id, chapter_id, body FROM epigraphs WHERE project_id = 'test-novel'`).get();
    assert.equal(epigraph.epigraph_id, "epi-001");
    assert.equal(epigraph.chapter_id, "ch-01-the-perfect-chapter");
    assert.match(epigraph.body, /quiet line/);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("preserves canonical chapter identity when a chapter folder is renamed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const initialChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-Old chapter title");
    fs.mkdirSync(initialChapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(initialChapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Arrival\nchapter_title: Old Chapter Title\nchapter_logline: Before the rename\n---\nScene prose."
    );

    syncAll(db, dir, { quiet: true });

    const originalChapter = db.prepare(`
      SELECT chapter_id, title, sort_index
      FROM chapters
      WHERE project_id = 'test-novel'
    `).get();
    assert.equal(originalChapter.chapter_id, "ch-01-old-chapter-title");

    const renamedChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-Renamed chapter title");
    fs.renameSync(initialChapterDir, renamedChapterDir);
    fs.writeFileSync(
      path.join(renamedChapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Arrival\nchapter_title: Old Chapter Title\nchapter_logline: Before the rename\n---\nScene prose."
    );

    syncAll(db, dir, { quiet: true });

    const chapters = db.prepare(`
      SELECT chapter_id, title, sort_index
      FROM chapters
      WHERE project_id = 'test-novel'
      ORDER BY sort_index
    `).all();
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].chapter_id, "ch-01-old-chapter-title");
    assert.equal(chapters[0].title, "Renamed Chapter Title");

    const scene = db.prepare(`
      SELECT chapter_id, chapter_title
      FROM scenes
      WHERE scene_id = 'sc-001' AND project_id = 'test-novel'
    `).get();
    assert.equal(scene.chapter_id, "ch-01-old-chapter-title");
    assert.equal(scene.chapter_title, "Renamed Chapter Title");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not merge scenes from duplicate chapter-order folders into one canonical chapter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const firstChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-First chapter");
    const secondChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-Second chapter");
    fs.mkdirSync(firstChapterDir, { recursive: true });
    fs.mkdirSync(secondChapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(firstChapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Arrival\n---\nScene prose."
    );
    fs.writeFileSync(
      path.join(secondChapterDir, "sc-002.md"),
      "---\nscene_id: sc-002\ntitle: Collision\n---\nOther scene prose."
    );

    const result = syncAll(db, dir, { quiet: true });

    const chapters = db.prepare(`
      SELECT chapter_id, title, sort_index
      FROM chapters
      WHERE project_id = 'test-novel'
      ORDER BY sort_index, chapter_id
    `).all();
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].title, "First Chapter");

    const firstScene = db.prepare(`
      SELECT chapter_id, chapter_title
      FROM scenes
      WHERE scene_id = 'sc-001' AND project_id = 'test-novel'
    `).get();
    const secondScene = db.prepare(`
      SELECT chapter_id, chapter_title
      FROM scenes
      WHERE scene_id = 'sc-002' AND project_id = 'test-novel'
    `).get();
    assert.equal(firstScene.chapter_id, "ch-01-first-chapter");
    assert.equal(secondScene.chapter_id, null);
    assert.equal(secondScene.chapter_title, "Second Chapter");
    assert.ok(result.warnings.some((warning) => warning.includes("duplicate chapter order 1")));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("preserves canonical chapter identities across chapter reorder renames", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const oldDir = path.join(dir, "projects", "test-novel", "Draft", "01-Old chapter");
    const newDir = path.join(dir, "projects", "test-novel", "Draft", "02-New chapter");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "sc-001.md"), "---\nscene_id: sc-001\ntitle: Old Scene\n---\nOld prose.");
    fs.writeFileSync(path.join(newDir, "sc-002.md"), "---\nscene_id: sc-002\ntitle: New Scene\n---\nNew prose.");

    syncAll(db, dir, { quiet: true });

    fs.renameSync(oldDir, path.join(dir, "projects", "test-novel", "Draft", "tmp-old"));
    fs.renameSync(newDir, path.join(dir, "projects", "test-novel", "Draft", "01-New chapter"));
    fs.renameSync(path.join(dir, "projects", "test-novel", "Draft", "tmp-old"), path.join(dir, "projects", "test-novel", "Draft", "02-Old chapter"));

    syncAll(db, dir, { quiet: true });

    const scenes = db.prepare(`
      SELECT scene_id, chapter_id, chapter, chapter_title
      FROM scenes
      WHERE project_id = 'test-novel'
      ORDER BY scene_id
    `).all();
    assert.deepEqual(
      scenes.map((row) => [row.scene_id, row.chapter_id, row.chapter, row.chapter_title]),
      [
        ["sc-001", "ch-01-old-chapter", 2, "Old Chapter"],
        ["sc-002", "ch-02-new-chapter", 1, "New Chapter"],
      ]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not merge distinct chapter folders that share the same title", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const firstChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-Interlude");
    const secondChapterDir = path.join(dir, "projects", "test-novel", "Draft", "02-Interlude");
    fs.mkdirSync(firstChapterDir, { recursive: true });
    fs.mkdirSync(secondChapterDir, { recursive: true });
    fs.writeFileSync(path.join(firstChapterDir, "sc-001.md"), "---\nscene_id: sc-001\ntitle: First\n---\nFirst prose.");
    fs.writeFileSync(path.join(secondChapterDir, "sc-002.md"), "---\nscene_id: sc-002\ntitle: Second\n---\nSecond prose.");

    syncAll(db, dir, { quiet: true });

    const chapters = db.prepare(`
      SELECT chapter_id, title, sort_index, source_path
      FROM chapters
      WHERE project_id = 'test-novel'
      ORDER BY sort_index, chapter_id
    `).all();
    const scenes = db.prepare(`
      SELECT scene_id, chapter_id, chapter
      FROM scenes
      WHERE project_id = 'test-novel'
      ORDER BY scene_id
    `).all();

    assert.deepEqual(
      chapters.map((row) => [row.chapter_id, row.title, row.sort_index, row.source_path]),
      [
        ["ch-01-interlude", "Interlude", 1, "projects/test-novel/Draft/01-Interlude"],
        ["ch-02-interlude", "Interlude", 2, "projects/test-novel/Draft/02-Interlude"],
      ]
    );
    assert.deepEqual(
      scenes.map((row) => [row.scene_id, row.chapter_id, row.chapter]),
      [
        ["sc-001", "ch-01-interlude", 1],
        ["sc-002", "ch-02-interlude", 2],
      ]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not merge flat legacy chapters that share the same title", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const scenesDir = path.join(dir, "projects", "test-novel", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: First Legacy Scene\nchapter: 1\nchapter_title: Interlude\n---\nFirst prose."
    );
    fs.writeFileSync(
      path.join(scenesDir, "sc-002.md"),
      "---\nscene_id: sc-002\ntitle: Second Legacy Scene\nchapter: 2\nchapter_title: Interlude\n---\nSecond prose."
    );

    syncAll(db, dir, { quiet: true });

    const chapters = db.prepare(`
      SELECT chapter_id, title, sort_index, source_path
      FROM chapters
      WHERE project_id = 'test-novel'
      ORDER BY sort_index, chapter_id
    `).all();
    const scenes = db.prepare(`
      SELECT scene_id, chapter_id, chapter, chapter_title
      FROM scenes
      WHERE project_id = 'test-novel'
      ORDER BY scene_id
    `).all();

    assert.deepEqual(
      chapters.map((row) => [row.chapter_id, row.title, row.sort_index, row.source_path]),
      [
        ["ch-01-interlude", "Interlude", 1, scenesDir],
        ["ch-02-interlude", "Interlude", 2, scenesDir],
      ]
    );
    assert.deepEqual(
      scenes.map((row) => [row.scene_id, row.chapter_id, row.chapter, row.chapter_title]),
      [
        ["sc-001", "ch-01-interlude", 1, "Interlude"],
        ["sc-002", "ch-02-interlude", 2, "Interlude"],
      ]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("retains canonical chapter linkage for flat scenes with legacy chapter metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const scenePath = path.join(dir, "projects", "test-novel", "scenes", "sc-legacy.md");
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-legacy\ntitle: Legacy Scene\nchapter: 3\nchapter_title: A New Dawn\n---\nLegacy prose."
    );

    syncAll(db, dir, { quiet: true });
    syncAll(db, dir, { quiet: true });

    const scene = db.prepare(`
      SELECT chapter_id, chapter, chapter_title
      FROM scenes
      WHERE scene_id = 'sc-legacy' AND project_id = 'test-novel'
    `).get();
    const chapter = db.prepare(`
      SELECT chapter_id, title, sort_index
      FROM chapters
      WHERE project_id = 'test-novel'
    `).get();

    assert.equal(chapter.chapter_id, "ch-03-a-new-dawn");
    assert.equal(scene.chapter_id, "ch-03-a-new-dawn");
    assert.equal(scene.chapter, 3);
    assert.equal(scene.chapter_title, "A New Dawn");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("defaults canonical chapter title for legacy numeric-only chapter metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const scenePath = path.join(dir, "projects", "test-novel", "scenes", "sc-number-only.md");
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-number-only\ntitle: Numbered Legacy Scene\nchapter: 4\n---\nLegacy prose."
    );

    syncAll(db, dir, { quiet: true });
    syncAll(db, dir, { quiet: true });

    const scene = db.prepare(`
      SELECT chapter_id, chapter, chapter_title
      FROM scenes
      WHERE scene_id = 'sc-number-only' AND project_id = 'test-novel'
    `).get();
    const chapter = db.prepare(`
      SELECT chapter_id, title, sort_index
      FROM chapters
      WHERE project_id = 'test-novel'
    `).get();

    assert.equal(chapter.chapter_id, "ch-04-chapter-4");
    assert.equal(chapter.title, "Chapter 4");
    assert.equal(scene.chapter_id, "ch-04-chapter-4");
    assert.equal(scene.chapter, 4);
    assert.equal(scene.chapter_title, "Chapter 4");

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not reuse canonical chapter rows by shared source path in flat legacy layouts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const scenesDir = path.join(dir, "projects", "test-novel", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: First Legacy Scene\nchapter: 1\nchapter_title: One Dawn\n---\nFirst prose."
    );
    fs.writeFileSync(
      path.join(scenesDir, "sc-002.md"),
      "---\nscene_id: sc-002\ntitle: Second Legacy Scene\nchapter: 2\nchapter_title: Two Dusk\n---\nSecond prose."
    );

    syncAll(db, dir, { quiet: true });

    const chapters = db.prepare(`
      SELECT chapter_id, title, sort_index, source_path
      FROM chapters
      WHERE project_id = 'test-novel'
      ORDER BY sort_index
    `).all();
    const scenes = db.prepare(`
      SELECT scene_id, chapter_id, chapter, chapter_title
      FROM scenes
      WHERE project_id = 'test-novel'
      ORDER BY scene_id
    `).all();

    assert.deepEqual(
      chapters.map((row) => [row.chapter_id, row.title, row.sort_index, row.source_path]),
      [
        ["ch-01-one-dawn", "One Dawn", 1, scenesDir],
        ["ch-02-two-dusk", "Two Dusk", 2, scenesDir],
      ]
    );
    assert.deepEqual(
      scenes.map((row) => [row.scene_id, row.chapter_id, row.chapter, row.chapter_title]),
      [
        ["sc-001", "ch-01-one-dawn", 1, "One Dawn"],
        ["sc-002", "ch-02-two-dusk", 2, "Two Dusk"],
      ]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("does not count unlinked epigraph warnings as indexed epigraphs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const epigraphPath = path.join(dir, "projects", "test-novel", "Draft", "epigraph.md");
    fs.mkdirSync(path.dirname(epigraphPath), { recursive: true });
    fs.writeFileSync(epigraphPath, "---\nkind: epigraph\n---\nLoose epigraph prose.");

    const result = syncAll(db, dir, { quiet: true });

    assert.equal(result.epigraphsIndexed, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM epigraphs WHERE project_id = 'test-novel'`).get().count, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("Epigraph requires explicit chapter linkage")));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("skips epigraphs whose explicit chapter_id does not resolve to a canonical chapter row", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const epigraphPath = path.join(dir, "projects", "test-novel", "Draft", "epigraph.md");
    fs.mkdirSync(path.dirname(epigraphPath), { recursive: true });
    fs.writeFileSync(
      epigraphPath,
      "---\nkind: epigraph\nchapter_id: ch-99-missing\nepigraph_id: epi-missing\n---\nLoose epigraph prose."
    );

    const result = syncAll(db, dir, { quiet: true });

    assert.equal(result.epigraphsIndexed, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM epigraphs WHERE project_id = 'test-novel'`).get().count, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("unknown chapter_id 'ch-99-missing'")));

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("updates an existing chapter epigraph when its explicit epigraph_id changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const chapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-The perfect chapter");
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(chapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: Arrival\nchapter_title: The Perfect Chapter\n---\nScene prose."
    );
    const epigraphPath = path.join(chapterDir, "epigraph.md");
    fs.writeFileSync(
      epigraphPath,
      "---\nepigraph_id: epi-001\ncharacters:\n  - elena\n---\nA quiet line before the chapter."
    );

    syncAll(db, dir, { quiet: true });

    fs.writeFileSync(
      epigraphPath,
      "---\nepigraph_id: epi-renamed\ncharacters:\n  - elena\n---\nA quiet line before the chapter."
    );

    const result = syncAll(db, dir, { quiet: true });
    const epigraphs = db.prepare(`
      SELECT epigraph_id, chapter_id, body
      FROM epigraphs
      WHERE project_id = 'test-novel'
      ORDER BY epigraph_id
    `).all();

    assert.equal(result.epigraphsIndexed, 1);
    assert.deepEqual(
      epigraphs.map((row) => [row.epigraph_id, row.chapter_id, row.body]),
      [["epi-renamed", "ch-01-the-perfect-chapter", "A quiet line before the chapter."]]
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM epigraph_characters WHERE project_id = 'test-novel' AND epigraph_id = 'epi-renamed'`).get().count,
      1
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM epigraph_characters WHERE project_id = 'test-novel' AND epigraph_id = 'epi-001'`).get().count,
      0
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("preserves an existing chapter logline when later files in the chapter omit it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const chapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-Only chapter");
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(chapterDir, "sc-001.md"),
      "---\nscene_id: sc-001\ntitle: First Scene\nchapter_logline: Stable chapter note\n---\nFirst prose."
    );
    fs.writeFileSync(
      path.join(chapterDir, "sc-002.md"),
      "---\nscene_id: sc-002\ntitle: Second Scene\n---\nSecond prose."
    );

    syncAll(db, dir, { quiet: true });

    const chapter = db.prepare(`
      SELECT title, sort_index, logline, metadata_stale
      FROM chapters
      WHERE project_id = 'test-novel'
    `).get();

    assert.equal(chapter.title, "Only Chapter");
    assert.equal(chapter.sort_index, 1);
    assert.equal(chapter.logline, "Stable chapter note");
    assert.equal(chapter.metadata_stale, 0);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("warns instead of reassigning an epigraph_id that already belongs to another chapter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const firstChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-First chapter");
    const secondChapterDir = path.join(dir, "projects", "test-novel", "Draft", "02-Second chapter");
    fs.mkdirSync(firstChapterDir, { recursive: true });
    fs.mkdirSync(secondChapterDir, { recursive: true });
    fs.writeFileSync(path.join(firstChapterDir, "sc-001.md"), "---\nscene_id: sc-001\ntitle: First\n---\nFirst prose.");
    fs.writeFileSync(path.join(secondChapterDir, "sc-002.md"), "---\nscene_id: sc-002\ntitle: Second\n---\nSecond prose.");
    fs.writeFileSync(path.join(firstChapterDir, "epigraph.md"), "---\nepigraph_id: epi-shared\n---\nFirst epigraph.");

    syncAll(db, dir, { quiet: true });

    fs.writeFileSync(path.join(secondChapterDir, "epigraph.md"), "---\nepigraph_id: epi-shared\n---\nSecond epigraph.");
    const result = syncAll(db, dir, { quiet: true });

    const epigraphs = db.prepare(`
      SELECT epigraph_id, chapter_id, body
      FROM epigraphs
      WHERE project_id = 'test-novel'
      ORDER BY chapter_id
    `).all();

    assert.equal(result.epigraphsIndexed, 1);
    assert.ok(result.warnings.some((warning) => warning.includes("Epigraph identity conflict")));
    assert.deepEqual(
      epigraphs.map((row) => [row.epigraph_id, row.chapter_id, row.body]),
      [["epi-shared", "ch-01-first-chapter", "First epigraph."]]
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("classifies unknown epigraph chapter warnings as chapter structure warnings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const epigraphPath = path.join(dir, "projects", "test-novel", "Draft", "epigraph.md");
    fs.mkdirSync(path.dirname(epigraphPath), { recursive: true });
    fs.writeFileSync(
      epigraphPath,
      "---\nkind: epigraph\nchapter_id: ch-99-missing\nepigraph_id: epi-missing\n---\nLoose epigraph prose."
    );

    const result = syncAll(db, dir, { quiet: true });

    assert.equal(result.warningSummary.chapter_structure.count, 1);
    assert.equal(result.warningSummary.chapter_structure.examples[0], "Epigraph references unknown chapter_id 'ch-99-missing': projects/test-novel/Draft/epigraph.md");
    assert.equal(result.warningSummary.other, undefined);

    db.close();
    fs.rmSync(dir, { recursive: true });
  });

  test("classifies epigraph identity conflicts as chapter structure warnings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
    const db = openDb(":memory:");
    const firstChapterDir = path.join(dir, "projects", "test-novel", "Draft", "01-First chapter");
    const secondChapterDir = path.join(dir, "projects", "test-novel", "Draft", "02-Second chapter");
    fs.mkdirSync(firstChapterDir, { recursive: true });
    fs.mkdirSync(secondChapterDir, { recursive: true });
    fs.writeFileSync(path.join(firstChapterDir, "sc-001.md"), "---\nscene_id: sc-001\ntitle: First\n---\nFirst prose.");
    fs.writeFileSync(path.join(secondChapterDir, "sc-002.md"), "---\nscene_id: sc-002\ntitle: Second\n---\nSecond prose.");
    fs.writeFileSync(path.join(firstChapterDir, "epigraph.md"), "---\nepigraph_id: epi-shared\n---\nFirst epigraph.");

    syncAll(db, dir, { quiet: true });

    fs.writeFileSync(path.join(secondChapterDir, "epigraph.md"), "---\nepigraph_id: epi-shared\n---\nSecond epigraph.");
    const result = syncAll(db, dir, { quiet: true });

    assert.equal(result.warningSummary.chapter_structure.count, 1);
    assert.equal(
      result.warningSummary.chapter_structure.examples[0],
      "Epigraph identity conflict for chapter 'ch-02-second-chapter': requested epigraph_id 'epi-shared' already belongs to another chapter in project 'test-novel'."
    );

    db.close();
    fs.rmSync(dir, { recursive: true });
  });
});

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
