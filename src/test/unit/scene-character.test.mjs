import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { runSceneCharacterBatch } from "../../sync/scene-character-batch.js";
import { buildCharacterNormalizationContext, isDistinctiveToken, normalizeSceneCharacters } from "../../sync/scene-character-normalization.js";
import { openDb } from "../../core/db.js";
import { insertTestScene } from "../helpers/db.js";
import { createTestSyncFixture } from "../helpers/fixtures.js";

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
    const filePath = writeBatchScene(dir, "sc-001", "Luna Luna appears in the doorway.", []);

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

  test("does not infer repeated-token names from a single token mention", async () => {
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
    assert.deepEqual(result.results[0].inferred_characters, []);
    assert.deepEqual(result.results[0].match_details.ambiguous_tokens, []);
    assert.equal(result.results[0].status, "unchanged");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not infer multi-token names from a non-distinctive token", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "The airport crowd surges toward the gate.", []);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        include_match_details: true,
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "char-the-swarm", name: "The Swarm" },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results[0].inferred_characters, []);
    assert.deepEqual(result.results[0].match_details.ambiguous_tokens, []);
    assert.equal(result.results[0].status, "unchanged");

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

  test("merge mode normalizes legacy plain-name entries to canonical ids", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "No named character appears here.", ["Elena Vasquez"]);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "char-elena-vasquez", name: "Elena Vasquez" },
        ],
      },
    });

    assert.deepEqual(result.results[0].before_characters, ["Elena Vasquez"]);
    assert.deepEqual(result.results[0].after_characters, ["char-elena-vasquez"]);
    assert.deepEqual(result.results[0].added, ["char-elena-vasquez"]);
    assert.deepEqual(result.results[0].removed, ["Elena Vasquez"]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("merge mode accepts scalar legacy character compatibility metadata", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "No named character appears here.", "Elena Vasquez");

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "char-elena-vasquez", name: "Elena Vasquez" },
        ],
      },
    });

    assert.equal(result.failed_scenes, 0);
    assert.deepEqual(result.results[0].before_characters, ["Elena Vasquez"]);
    assert.deepEqual(result.results[0].after_characters, ["char-elena-vasquez"]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("removes a less specific existing id when a more specific full-name match is inferred", async () => {
    const { dir } = makeBatchFixture();
    const filePath = writeBatchScene(dir, "sc-001", "Victor Alexeyevich Sidorin studies the report.", ["char-victor-sidorin"]);

    const result = await runSceneCharacterBatch({
      syncDir: dir,
      args: {
        project_id: "test-novel",
        dry_run: true,
        replace_mode: "merge",
        target_scenes: [{ scene_id: "sc-001", project_id: "test-novel", file_path: filePath }],
        character_rows: [
          { character_id: "char-victor-sidorin", name: "Victor Sidorin" },
          { character_id: "char-victor-alexeyevich-sidorin", name: "Victor Alexeyevich Sidorin" },
        ],
      },
    });

    assert.deepEqual(result.results[0].before_characters, ["char-victor-sidorin"]);
    assert.deepEqual(result.results[0].after_characters, ["char-victor-alexeyevich-sidorin"]);
    assert.deepEqual(result.results[0].added, ["char-victor-alexeyevich-sidorin"]);
    assert.deepEqual(result.results[0].removed, ["char-victor-sidorin"]);

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

  test("write mode preserves path-conflicting structural sidecar fields", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "batch-scenes-"));
    const sceneDir = path.join(dir, "projects", "test-novel", "part-7", "chapter-8");
    fs.mkdirSync(sceneDir, { recursive: true });
    const filePath = path.join(sceneDir, "sc-structural-preserve.md");
    const sidecarPath = path.join(sceneDir, "sc-structural-preserve.meta.yaml");
    fs.writeFileSync(filePath, "Elena Vasquez waits by the harbor.", "utf8");
    fs.writeFileSync(
      sidecarPath,
      yaml.dump({
        scene_id: "sc-structural-preserve",
        title: "Structural Preserve",
        part: 3,
        chapter: 4,
        chapter_id: "ch-preserved",
        chapter_title: "Preserved Chapter",
        timeline_position: 17,
        characters: ["marcus"],
      }),
      "utf8"
    );

    try {
      const result = await runSceneCharacterBatch({
        syncDir: dir,
        args: {
          project_id: "test-novel",
          dry_run: false,
          replace_mode: "merge",
          target_scenes: [{ scene_id: "sc-structural-preserve", project_id: "test-novel", file_path: filePath }],
          character_rows: [
            { character_id: "elena", name: "Elena Vasquez" },
            { character_id: "marcus", name: "Marcus Hale" },
          ],
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.scenes_changed, 1);

      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
      assert.equal(sidecar.part, 3);
      assert.equal(sidecar.chapter, 4);
      assert.equal(sidecar.chapter_id, "ch-preserved");
      assert.equal(sidecar.chapter_title, "Preserved Chapter");
      assert.equal(sidecar.timeline_position, 17);
      assert.deepEqual(sidecar.characters.sort(), ["elena", "marcus"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scene character normalization", () => {
  test("treats exported distinctive-token helper as case-insensitive", () => {
    assert.equal(isDistinctiveToken("The"), false);
    assert.equal(isDistinctiveToken(" Victor "), true);
  });

  test("normalizes plain-name references to canonical ids", () => {
    const context = buildCharacterNormalizationContext([
      { character_id: "char-elena-vasquez", name: "Elena Vasquez" },
      { character_id: "char-marcus-hale", name: "Marcus Hale" },
    ]);

    const result = normalizeSceneCharacters(["Elena Vasquez", "char-marcus-hale"], context);

    assert.equal(result.changed, true);
    assert.deepEqual(result.after, ["char-elena-vasquez", "char-marcus-hale"]);
    assert.deepEqual(result.added, ["char-elena-vasquez"]);
    assert.deepEqual(result.removed, ["Elena Vasquez"]);
  });

  test("prunes less-specific canonical ids when stronger non-canonical evidence resolves to a more specific id", () => {
    const context = buildCharacterNormalizationContext([
      { character_id: "char-victor-sidorin", name: "Victor Sidorin" },
      { character_id: "char-victor-alexeyevich-sidorin", name: "Victor Alexeyevich Sidorin" },
    ]);

    const result = normalizeSceneCharacters(
      ["char-victor-sidorin", "Victor Alexeyevich Sidorin"],
      context
    );

    assert.equal(result.changed, true);
    assert.deepEqual(result.after, ["char-victor-alexeyevich-sidorin"]);
    assert.deepEqual(result.added, ["char-victor-alexeyevich-sidorin"]);
    assert.deepEqual(result.removed, ["char-victor-sidorin", "Victor Alexeyevich Sidorin"]);
  });

  test("preserves co-occurring canonical ids without stronger evidence", () => {
    const context = buildCharacterNormalizationContext([
      { character_id: "char-victor-sidorin", name: "Victor Sidorin" },
      { character_id: "char-victor-alexeyevich-sidorin", name: "Victor Alexeyevich Sidorin" },
    ]);

    const result = normalizeSceneCharacters(
      ["char-victor-sidorin", "char-victor-alexeyevich-sidorin"],
      context
    );

    assert.equal(result.changed, false);
    assert.deepEqual(result.after, ["char-victor-sidorin", "char-victor-alexeyevich-sidorin"]);
    assert.deepEqual(result.removed, []);
  });

  test("does not prune one-token overlap canonical ids", () => {
    const context = buildCharacterNormalizationContext([
      { character_id: "char-victor", name: "Victor" },
      { character_id: "char-victor-sidorin", name: "Victor Sidorin" },
    ]);

    const result = normalizeSceneCharacters(
      ["char-victor", "char-victor-sidorin"],
      context
    );

    assert.equal(result.changed, false);
    assert.deepEqual(result.after, ["char-victor", "char-victor-sidorin"]);
    assert.deepEqual(result.removed, []);
  });

  test("keeps unresolved values unchanged when mapping is ambiguous", () => {
    const context = buildCharacterNormalizationContext([
      { character_id: "char-victor-sidorin", name: "Victor Sidorin" },
      { character_id: "char-victor-ivanov", name: "Victor Ivanov" },
    ]);

    const result = normalizeSceneCharacters(["Victor"], context);

    assert.equal(result.changed, false);
    assert.deepEqual(result.after, ["Victor"]);
  });

  test("normalize-scene-characters CLI reports missing option values clearly", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-sqlite", "src/scripts/normalize-scene-characters.mjs", "--limit"],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--limit requires a value\./);
  });

  test("normalize-scene-characters CLI write mode preserves structural sidecar fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-scene-characters-"));
    createTestSyncFixture(dir);

    const sceneDir = path.join(dir, "projects", "test-novel", "part-7", "chapter-8");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-cli-structural-preserve.md");
    const sidecarPath = path.join(sceneDir, "sc-cli-structural-preserve.meta.yaml");
    fs.writeFileSync(scenePath, "CLI normalization prose.", "utf8");
    fs.writeFileSync(
      sidecarPath,
      yaml.dump({
        scene_id: "sc-cli-structural-preserve",
        title: "CLI Structural Preserve",
        part: 3,
        chapter: 4,
        chapter_id: "ch-cli-preserved",
        chapter_title: "CLI Preserved Chapter",
        timeline_position: 23,
        characters: ["Elena Voss"],
      }),
      "utf8"
    );

    try {
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-sqlite",
          "src/scripts/normalize-scene-characters.mjs",
          "--sync-dir",
          dir,
          "--project-id",
          "test-novel",
          "--write",
          "--json",
        ],
        {
          cwd: path.resolve("."),
          encoding: "utf8",
        }
      );

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.scenes_changed >= 1, true);

      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
      assert.equal(sidecar.part, 3);
      assert.equal(sidecar.chapter, 4);
      assert.equal(sidecar.chapter_id, "ch-cli-preserved");
      assert.equal(sidecar.chapter_title, "CLI Preserved Chapter");
      assert.equal(sidecar.timeline_position, 23);
      assert.deepEqual(sidecar.characters, ["elena"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// importer path resolution
// ---------------------------------------------------------------------------
