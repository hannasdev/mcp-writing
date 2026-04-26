import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lintMetadataInSyncDir, validateMetadataObject } from "../../metadata-lint.js";

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

  test("warns on mixed canonical and non-canonical scene character references", () => {
    const result = validateMetadataObject({
      scene_id: "sc-001",
      title: "Arrival",
      part: 1,
      chapter: 1,
      characters: ["char-elena", "Victor Sidorin"],
    });

    assert.equal(result.ok, true);
    assert.ok(result.issues.some(i => i.code === "MIXED_CHARACTER_REFERENCE_STYLE"));
  });

  test("does not warn when scene character references are canonical only", () => {
    const result = validateMetadataObject({
      scene_id: "sc-001",
      title: "Arrival",
      part: 1,
      chapter: 1,
      characters: ["char-elena", "char-marcus"],
    });

    assert.equal(result.ok, true);
    assert.ok(!result.issues.some(i => i.code === "MIXED_CHARACTER_REFERENCE_STYLE"));
  });

  test("does not warn when scene character references are non-canonical only", () => {
    const result = validateMetadataObject({
      scene_id: "sc-001",
      title: "Arrival",
      part: 1,
      chapter: 1,
      characters: ["Victor Sidorin", "Sebastian"],
    });

    assert.equal(result.ok, true);
    assert.ok(!result.issues.some(i => i.code === "MIXED_CHARACTER_REFERENCE_STYLE"));
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
