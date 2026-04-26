import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3077, 3076);
let writeSyncDir, readSyncDir;

before(async () => {
  await ctx.setup();
  writeSyncDir = ctx.writeSyncDir;
  readSyncDir = ctx.readSyncDir;
});

after(async () => {
  await ctx.teardown();
});

const callTool = (n, a) => ctx.callTool(n, a);
const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
const waitForAsyncJob = (id, t) => ctx.waitForAsyncJob(id, t);
describe("setup_prose_styleguide_config tool", () => {
  test("writes a sync-root styleguide config from language defaults", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_us",
      voice_notes: "Fast-paced thriller voice.",
      overwrite: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scope, "sync_root");
    assert.equal(parsed.config.language, "english_us");
    assert.equal(parsed.config.spelling, "us");
    assert.equal(parsed.config.voice_notes, "Fast-paced thriller voice.");

    assert.equal(typeof parsed.file_path, "string");
    assert.equal(parsed.file_path.length > 0, true);
  });

  test("requires project_id for project_root scope", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      language: "english_uk",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "PROJECT_ID_REQUIRED");
  });

  test("writes a project-root config for a simple project ID", async () => {
    const projectId = "styleguide-test-proj";

    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: projectId,
      language: "english_uk",
      overrides: { tense: "past", pov: "first" },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scope, "project_root");
    assert.equal(parsed.config.language, "english_uk");
    assert.equal(parsed.config.tense, "past");
    assert.equal(parsed.config.pov, "first");
    assert.equal(parsed.config.spelling, "uk");
  });
});

describe("get_prose_styleguide_config tool", () => {
  test("returns setup_required when no styleguide config exists", async () => {
    const rootConfigPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    fs.rmSync(rootConfigPath, { force: true });

    const text = await callWriteTool("get_prose_styleguide_config");
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.styleguide.setup_required, true);
    assert.equal(parsed.styleguide.config_found, false);
    assert.equal(parsed.styleguide.resolved_config, null);
  });

  test("resolves root, universe, and project config precedence", async () => {
    const projectId = "aether/book-one";
    const universeDir = path.join(writeSyncDir, "universes", "aether");
    const projectDir = path.join(universeDir, "book-one");
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      "language: english_uk\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(universeDir, "prose-styleguide.config.yaml"),
      "dialogue_tags: expressive\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(projectDir, "prose-styleguide.config.yaml"),
      [
        "dialogue_tags: minimal",
        "sentence_fragments: intentional",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("get_prose_styleguide_config", { project_id: projectId });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.styleguide.setup_required, false);
    assert.equal(parsed.styleguide.sources.length, 3);
    assert.equal(parsed.styleguide.resolved_config.language, "english_uk");
    assert.equal(parsed.styleguide.resolved_config.quotation_style, "single");
    assert.equal(parsed.styleguide.resolved_config.quotation_style_nested, "double");
    assert.equal(parsed.styleguide.resolved_config.dialogue_tags, "minimal");
    assert.equal(parsed.styleguide.resolved_config.sentence_fragments, "intentional");
  });
});

describe("summarize_prose_styleguide_config tool", () => {
  test("returns a plain-language summary of the resolved config", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_uk",
        "dialogue_tags: minimal",
        "voice_notes: |",
        "  Quietly intense.",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("summarize_prose_styleguide_config");
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.match(parsed.summary_text, /Writing language: english_uk\./);
    assert.match(parsed.summary_text, /Dialogue tag policy: minimal\./);
    assert.match(parsed.summary_text, /Voice notes: Quietly intense\./);
    assert.ok(Array.isArray(parsed.summary_lines));
  });

  test("returns setup guidance when no config exists", async () => {
    fs.rmSync(path.join(writeSyncDir, "prose-styleguide.config.yaml"), { force: true });

    const text = await callWriteTool("summarize_prose_styleguide_config");
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "STYLEGUIDE_CONFIG_REQUIRED");
    assert.match(parsed.error.details.next_step, /bootstrap_prose_styleguide_config/);
  });
});

describe("update_prose_styleguide_config tool", () => {
  test("updates an existing sync-root config", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      "language: english_us\ndialogue_tags: minimal\n",
      "utf8"
    );

    const text = await callWriteTool("update_prose_styleguide_config", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "expressive",
        voice_notes: "Leaner and colder.",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.config.language, "english_us");
    assert.equal(parsed.config.dialogue_tags, "expressive");
    assert.equal(parsed.config.voice_notes, "Leaner and colder.");

    const persisted = yaml.load(fs.readFileSync(path.join(writeSyncDir, "prose-styleguide.config.yaml"), "utf8"));
    assert.equal(persisted.dialogue_tags, "expressive");
    assert.equal(persisted.voice_notes, "Leaner and colder.");
  });

  test("returns noop when requested values are unchanged", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      "language: english_us\ndialogue_tags: minimal\n",
      "utf8"
    );

    const text = await callWriteTool("update_prose_styleguide_config", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "minimal",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.noop, true);
    assert.equal(parsed.changed_fields.length, 0);
  });

  test("rejects unknown update fields at schema boundary", async () => {
    const text = await callWriteTool("update_prose_styleguide_config", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "expressive",
        dialog_tags_typo: "minimal",
      },
    });
    assert.match(text, /Unrecognized key|unrecognized_keys|invalid/i);
  });

  test("requires an existing config at the selected scope", async () => {
    fs.rmSync(path.join(writeSyncDir, "prose-styleguide.config.yaml"), { force: true });

    const text = await callWriteTool("update_prose_styleguide_config", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "expressive",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "STYLEGUIDE_CONFIG_NOT_FOUND");
  });
});

describe("preview_prose_styleguide_config_update tool", () => {
  test("returns before/after config and changed fields without persisting", async () => {
    const configPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    fs.writeFileSync(configPath, "language: english_us\ndialogue_tags: minimal\n", "utf8");

    const text = await callWriteTool("preview_prose_styleguide_config_update", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "expressive",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.current_config.dialogue_tags, "minimal");
    assert.equal(parsed.next_config.dialogue_tags, "expressive");
    assert.equal(parsed.changed_fields.length, 1);
    assert.equal(parsed.changed_fields[0].field, "dialogue_tags");

    const persisted = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.equal(persisted.dialogue_tags, "minimal");
  });

  test("returns noop when requested preview does not change values", async () => {
    const configPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    fs.writeFileSync(configPath, "language: english_us\ndialogue_tags: minimal\n", "utf8");

    const text = await callWriteTool("preview_prose_styleguide_config_update", {
      scope: "sync_root",
      updates: {
        dialogue_tags: "minimal",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.noop, true);
    assert.equal(parsed.changed_fields.length, 0);
  });
});

describe("check_prose_styleguide_drift tool", () => {
  test("returns scene drift signals and suggested updates", async () => {
    const projectId = "drift-demo";
    const sceneDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });

    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      "language: english_uk\nquotation_style: single\ntense: past\n",
      "utf8"
    );

    fs.writeFileSync(
      path.join(sceneDir, "sc-001.md"),
      [
        "---",
        "scene_id: drift-sc-001",
        "project_id: drift-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 1",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(sceneDir, "sc-002.md"),
      [
        "---",
        "scene_id: drift-sc-002",
        "project_id: drift-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 2",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(sceneDir, "sc-003.md"),
      [
        "---",
        "scene_id: drift-sc-003",
        "project_id: drift-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 3",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    const syncText = await callWriteTool("sync");
    assert.match(syncText, /scenes indexed/);

    const text = await callWriteTool("check_prose_styleguide_drift", {
      project_id: projectId,
      max_scenes: 10,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.checked_scenes >= 1, true);
    assert.equal(parsed.scenes_with_drift >= 1, true);
    assert.equal(Array.isArray(parsed.scene_results), true);
    assert.equal(Object.hasOwn(parsed.suggested_updates, "quotation_style"), true);
  });
});

describe("bootstrap_prose_styleguide_config tool", () => {
  test("suggests initial config values from scene corpus", async () => {
    const projectId = "bootstrap-demo";
    const sceneDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });

    fs.writeFileSync(
      path.join(sceneDir, "sc-001.md"),
      [
        "---",
        "scene_id: boot-sc-001",
        "project_id: bootstrap-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 1",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(sceneDir, "sc-002.md"),
      [
        "---",
        "scene_id: boot-sc-002",
        "project_id: bootstrap-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 2",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(sceneDir, "sc-003.md"),
      [
        "---",
        "scene_id: boot-sc-003",
        "project_id: bootstrap-demo",
        "part: 1",
        "chapter: 1",
        "timeline_position: 3",
        "---",
        "\"I go now,\" she says. \"I do what I must.\"",
      ].join("\n"),
      "utf8"
    );

    const syncText = await callWriteTool("sync");
    assert.match(syncText, /scenes indexed/);

    const text = await callWriteTool("bootstrap_prose_styleguide_config", {
      project_id: projectId,
      max_scenes: 10,
      min_evidence: 3,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.checked_scenes, 3);
    assert.equal(Object.hasOwn(parsed.suggested_config, "quotation_style"), true);
    assert.equal(parsed.suggested_config.quotation_style.suggested_value, "double");
    assert.equal(Object.hasOwn(parsed.suggested_config, "tense"), true);
    assert.equal(parsed.suggested_config.tense.suggested_value, "present");
  });
});

describe("setup_prose_styleguide_skill tool", () => {
  test("requires a styleguide config before skill generation", async () => {
    const rootConfigPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    fs.rmSync(rootConfigPath, { force: true });

    const text = await callWriteTool("setup_prose_styleguide_skill", { overwrite: true });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "STYLEGUIDE_CONFIG_REQUIRED");
    assert.match(parsed.error.details.next_step, /bootstrap_prose_styleguide_config/);
  });

  test("writes skills/prose-styleguide.md from resolved config", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_uk",
        "dialogue_tags: minimal",
        "voice_notes: |",
        "  Keep the tone restrained.",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", { overwrite: true });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.file_path, "string");
    assert.equal(parsed.file_path.length > 0, true);
    assert.ok(Array.isArray(parsed.injected_rules));
    assert.equal(parsed.injected_rules.length > 0, true);

    const skillPath = path.join(writeSyncDir, "skills", "prose-styleguide.md");
    assert.equal(fs.existsSync(skillPath), true);
    const skillText = fs.readFileSync(skillPath, "utf8");
    assert.match(skillText, /# Prose Styleguide/);
    assert.match(skillText, /Primary writing language: English \(UK\)\./);
    assert.match(skillText, /Dialogue tag policy: minimal\./);
    assert.match(skillText, /> Keep the tone restrained\./);
  });
});
