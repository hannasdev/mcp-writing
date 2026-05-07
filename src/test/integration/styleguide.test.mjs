import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { createTestContext } from "../helpers/server.js";
import {
  loadSetupContract,
  resolveStyleguideSetupAnswers,
  buildStyleguideSetupArtifactPlan,
} from "../../setup/setup-contract.js";

const ctx = createTestContext(3077, 3076);
let writeSyncDir, readSyncDir;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../..");

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

describe("client-agnostic styleguide setup contract flow", () => {
  test("executes planned actions and writes canonical sync-root artifacts", async () => {
    fs.rmSync(path.join(writeSyncDir, "prose-styleguide.config.yaml"), { force: true });
    fs.rmSync(path.join(writeSyncDir, "skills", "prose-styleguide"), { recursive: true, force: true });

    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);

    const resolved = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: {
        scope: "sync_root",
        language: "english_us",
        bootstrap_from_scenes: false,
        voice_notes: "Contract-driven setup flow.",
      },
      inferred: {},
    });
    assert.equal(resolved.ok, true);

    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: resolved.resolved_answers,
      sceneCount: 10,
    });
    assert.equal(plan.ok, true);

    for (const action of plan.actions) {
      const text = await callWriteTool(action.tool, action.arguments);
      const parsed = JSON.parse(text);
      assert.equal(parsed.ok, true, `${action.tool} should succeed`);
    }

    const configPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    const skillPath = path.join(writeSyncDir, "skills", "prose-styleguide", "SKILL.md");
    assert.equal(fs.existsSync(configPath), true);
    assert.equal(fs.existsSync(skillPath), true);

    const config = yaml.load(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.language, "english_us");
    assert.equal(config.voice_notes, "Contract-driven setup flow.");
  });

  test("produces equivalent config output to direct setup tool call for same answers", async () => {
    const directProject = "equivalence-direct";
    const contractProject = "equivalence-contract";
    const overrides = {
      quotation_style: "single",
      tense: "past",
      dialogue_tags: "expressive",
    };

    const directText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: directProject,
      language: "english_uk",
      overrides,
      voice_notes: "Equivalent output check.",
      overwrite: true,
    });
    const directParsed = JSON.parse(directText);
    assert.equal(directParsed.ok, true);

    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const resolved = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: {
        scope: "project_root",
        project_id: contractProject,
        language: "english_uk",
        bootstrap_from_scenes: false,
        high_impact_overrides: overrides,
        voice_notes: "Equivalent output check.",
      },
      inferred: {},
    });
    assert.equal(resolved.ok, true);
    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: resolved.resolved_answers,
      sceneCount: 5,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].tool, "setup_prose_styleguide_config");

    const contractText = await callWriteTool(plan.actions[0].tool, {
      ...plan.actions[0].arguments,
      overwrite: true,
    });
    const contractParsed = JSON.parse(contractText);
    assert.equal(contractParsed.ok, true);

    const directConfigPath = path.join(writeSyncDir, "projects", directProject, "prose-styleguide.config.yaml");
    const contractConfigPath = path.join(writeSyncDir, "projects", contractProject, "prose-styleguide.config.yaml");
    const directConfig = yaml.load(fs.readFileSync(directConfigPath, "utf8"));
    const contractConfig = yaml.load(fs.readFileSync(contractConfigPath, "utf8"));
    assert.deepEqual(contractConfig, directConfig);
  });
});

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

  test("returns STYLEGUIDE_CONFIG_EXISTS when config already exists and overwrite=false", async () => {
    const projectId = `styleguide-exists-${Date.now()}`;
    const configPath = path.join(writeSyncDir, "projects", projectId, "prose-styleguide.config.yaml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "language: english_us\n", "utf8");

    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: projectId,
      language: "english_uk",
      overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "STYLEGUIDE_CONFIG_EXISTS");
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

  test("writes skills/prose-styleguide/SKILL.md from resolved config", async () => {
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
    assert.ok(Array.isArray(parsed.boot_files));
    assert.equal(parsed.boot_files.length, 2);

    const skillPath = path.join(writeSyncDir, "skills", "prose-styleguide", "SKILL.md");
    assert.equal(fs.existsSync(skillPath), true);
    const skillText = fs.readFileSync(skillPath, "utf8");
    assert.match(skillText, /# Prose Styleguide/);
    assert.match(skillText, /Primary writing language: English \(UK\)\./);
    assert.match(skillText, /Dialogue tag policy: minimal\./);
    assert.match(skillText, /> Keep the tone restrained\./);

    const claudePath = path.join(writeSyncDir, "CLAUDE.md");
    assert.equal(fs.existsSync(claudePath), true);
    const claudeText = fs.readFileSync(claudePath, "utf8");
    assert.match(claudeText, /@skills\/prose-styleguide\/SKILL\.md/);

    const copilotPath = path.join(writeSyncDir, ".github", "copilot-instructions.md");
    assert.equal(fs.existsSync(copilotPath), true);
    const copilotText = fs.readFileSync(copilotPath, "utf8");
    assert.match(copilotText, /MCP-WRITING:PROSE-STYLEGUIDE START/);
    assert.match(copilotText, /Since Copilot does not support imports/);
  });

  test("supports publish_boot_files=false", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.rmSync(path.join(writeSyncDir, "CLAUDE.md"), { force: true });
    fs.rmSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), { force: true });

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.boot_files, []);
    assert.equal(fs.existsSync(path.join(writeSyncDir, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(writeSyncDir, ".github", "copilot-instructions.md")), false);
  });

  test("updates existing boot files non-destructively", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_uk",
        "dialogue_tags: expressive",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(writeSyncDir, "CLAUDE.md"),
      "# Existing Claude Notes\n\n@skills/code-review/SKILL.md\n",
      "utf8"
    );
    fs.mkdirSync(path.join(writeSyncDir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(writeSyncDir, ".github", "copilot-instructions.md"),
      [
        "# Existing Copilot Instructions",
        "",
        "Keep this intro.",
        "",
        "<!-- MCP-WRITING:PROSE-STYLEGUIDE START -->",
        "old block",
        "<!-- MCP-WRITING:PROSE-STYLEGUIDE END -->",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.boot_files.length, 2);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "claude" && entry.status === "updated"), true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "copilot" && entry.status === "updated"), true);

    const claudeText = fs.readFileSync(path.join(writeSyncDir, "CLAUDE.md"), "utf8");
    assert.match(claudeText, /@skills\/code-review\/SKILL\.md/);
    assert.match(claudeText, /@skills\/prose-styleguide\/SKILL\.md/);

    const copilotText = fs.readFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "utf8");
    assert.match(copilotText, /# Existing Copilot Instructions/);
    assert.match(copilotText, /MCP-WRITING:PROSE-STYLEGUIDE START/);
    assert.doesNotMatch(copilotText, /old block/);
  });

  test("adds standalone CLAUDE import line when path only appears in prose", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(writeSyncDir, "CLAUDE.md"),
      [
        "# Notes",
        "",
        "Mentioning @skills/prose-styleguide/SKILL.md in prose should not count as an import line.",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "claude" && entry.status === "updated"), true);

    const claudeText = fs.readFileSync(path.join(writeSyncDir, "CLAUDE.md"), "utf8");
    const importLineMatches = claudeText.match(/^@skills\/prose-styleguide\/SKILL\.md$/gm) ?? [];
    assert.equal(importLineMatches.length, 1);
  });

  test("adds CLAUDE import when path appears only inside a fenced code block", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(writeSyncDir, "CLAUDE.md"),
      [
        "# Notes",
        "",
        "```md",
        "@skills/prose-styleguide/SKILL.md",
        "```",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "claude" && entry.status === "updated"), true);

    const claudeText = fs.readFileSync(path.join(writeSyncDir, "CLAUDE.md"), "utf8");
    assert.match(claudeText, /```md\n@skills\/prose-styleguide\/SKILL\.md\n```/);
    assert.match(claudeText, /\n@skills\/prose-styleguide\/SKILL\.md\n$/);
  });

  test("appends managed Copilot block when marker is absent and preserves existing content", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_uk",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.mkdirSync(path.join(writeSyncDir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(writeSyncDir, ".github", "copilot-instructions.md"),
      [
        "# Existing Copilot Instructions",
        "",
        "Keep this intro.",
        "",
        "Keep this footer.",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "copilot" && entry.status === "appended"), true);

    const copilotText = fs.readFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "utf8");
    assert.match(copilotText, /Keep this intro\./);
    assert.match(copilotText, /Keep this footer\./);
    assert.match(copilotText, /MCP-WRITING:PROSE-STYLEGUIDE START/);
  });

  test("supports boot_files_overwrite=true", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(path.join(writeSyncDir, "CLAUDE.md"), "legacy claude content", "utf8");
    fs.mkdirSync(path.join(writeSyncDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "legacy copilot content", "utf8");

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "claude" && entry.status === "overwritten"), true);
    assert.equal(parsed.boot_files.some((entry) => entry.type === "copilot" && entry.status === "overwritten"), true);

    const claudeText = fs.readFileSync(path.join(writeSyncDir, "CLAUDE.md"), "utf8");
    assert.match(claudeText, /# Writing Assistant Boot File/);
    assert.match(claudeText, /@skills\/prose-styleguide\/SKILL\.md/);
    assert.doesNotMatch(claudeText, /legacy claude content/);

    const copilotText = fs.readFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "utf8");
    assert.match(copilotText, /# Copilot Instructions/);
    assert.match(copilotText, /MCP-WRITING:PROSE-STYLEGUIDE START/);
    assert.doesNotMatch(copilotText, /legacy copilot content/);
  });

  test("rejects project-scoped setup to avoid shared SKILL.md collisions", async () => {
    const projectId = "boot-file-project-scope";
    const projectDir = path.join(writeSyncDir, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      project_id: projectId,
      overwrite: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "PROJECT_SCOPED_SKILL_UNSUPPORTED");
  });

  test("project-scoped setup with publish_boot_files=true is rejected and leaves boot files unchanged", async () => {
    const projectId = "boot-file-project-scope-explicit";
    const projectDir = path.join(writeSyncDir, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "prose-styleguide.config.yaml"),
      [
        "language: english_uk",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(path.join(writeSyncDir, "CLAUDE.md"), "sentinel claude", "utf8");
    fs.mkdirSync(path.join(writeSyncDir, ".github"), { recursive: true });
    fs.writeFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "sentinel copilot", "utf8");

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      project_id: projectId,
      overwrite: true,
      publish_boot_files: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "PROJECT_SCOPED_SKILL_UNSUPPORTED");
    assert.equal(fs.readFileSync(path.join(writeSyncDir, "CLAUDE.md"), "utf8"), "sentinel claude");
    assert.equal(fs.readFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "utf8"), "sentinel copilot");
  });

  test("fails cleanly when .github exists as a file and leaves existing SKILL.md unchanged", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
      ].join("\n"),
      "utf8"
    );

    const skillPath = path.join(writeSyncDir, "skills", "prose-styleguide", "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "sentinel skill content", "utf8");

    const githubPath = path.join(writeSyncDir, ".github");
    fs.rmSync(githubPath, { recursive: true, force: true });
    fs.writeFileSync(githubPath, "not a directory", "utf8");

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_TARGET_PARENT");

    const persistedSkillText = fs.readFileSync(skillPath, "utf8");
    assert.equal(persistedSkillText, "sentinel skill content");

    fs.rmSync(githubPath, { force: true });
    fs.mkdirSync(githubPath, { recursive: true });
  });

  test("renders copilot snapshot with a safe fence when skill markdown contains triple backticks", async () => {
    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      [
        "language: english_us",
        "dialogue_tags: minimal",
        "voice_notes: |",
        "  Preserve fenced examples like ```example``` without corruption.",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("setup_prose_styleguide_skill", {
      overwrite: true,
      publish_boot_files: true,
      boot_files_overwrite: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    const copilotText = fs.readFileSync(path.join(writeSyncDir, ".github", "copilot-instructions.md"), "utf8");
    assert.match(copilotText, /````markdown/);
    assert.match(copilotText, /Preserve fenced examples like ```example``` without corruption\./);
  });
});
