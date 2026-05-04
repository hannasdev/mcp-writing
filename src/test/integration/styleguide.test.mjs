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
      confirm_write: true,
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
      confirm_write: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scope, "project_root");
    assert.equal(parsed.config.language, "english_uk");
    assert.equal(parsed.config.tense, "past");
    assert.equal(parsed.config.pov, "first");
    assert.equal(parsed.config.spelling, "uk");
    assert.equal(parsed.path_convention, "standalone_project");
  });

  test("accepts path_convention when it matches a universe/book project ID", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: "aether/book-one",
      path_convention: "universe_book",
      language: "english_uk",
      overwrite: true,
      confirm_write: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.path_convention, "universe_book");
  });

  test("rejects path_convention when it conflicts with project_id shape", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: "styleguide-test-proj",
      path_convention: "universe_book",
      language: "english_uk",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "PATH_CONVENTION_MISMATCH");
  });

  test("returns preview and does not write unless confirm_write=true", async () => {
    const targetPath = path.join(writeSyncDir, "projects", "preview-only-proj", "prose-styleguide.config.yaml");
    fs.rmSync(targetPath, { force: true });

    const previewText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: "preview-only-proj",
      language: "english_us",
    });
    const preview = JSON.parse(previewText);

    assert.equal(preview.ok, true);
    assert.equal(preview.preview_only, true);
    assert.equal(typeof preview.summary_text, "string");
    assert.equal(fs.existsSync(targetPath), false);

    const writeText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: "preview-only-proj",
      language: "english_us",
      confirm_write: true,
    });
    const writeResult = JSON.parse(writeText);

    assert.equal(writeResult.ok, true);
    assert.equal(writeResult.preview_only, false);
    assert.equal(fs.existsSync(targetPath), true);
  });

  test("preview response includes tier_groups with conversational prompts", async () => {
    const previewText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_us",
      overrides: {
        tense: "present",
        pov: "third_omniscient",
      },
    });
    const preview = JSON.parse(previewText);

    assert.equal(preview.ok, true);
    assert.equal(preview.preview_only, true);
    assert(preview.tier_groups, "tier_groups should exist in preview");
    assert.equal(Array.isArray(preview.tier_groups.tier_b), true);
    assert.equal(Array.isArray(preview.tier_groups.tier_c), true);

    // Tier B fields should have prompts
    const tierBFields = preview.tier_groups.tier_b.map(g => g.field);
    assert(tierBFields.includes("language"), "language should be in tier_b");
    assert(tierBFields.includes("tense"), "tense should be in tier_b");
    assert(tierBFields.includes("pov"), "pov should be in tier_b");

    // Verify Tier B prompts mention "Keep or change?"
    for (const group of preview.tier_groups.tier_b) {
      if (group.prompt) {
        assert(group.prompt.includes("Keep or change?"), `Tier B prompt for ${group.field} should mention 'Keep or change?'`);
      }
    }

    // Tier C fields should have prompts too
    const tierCFields = preview.tier_groups.tier_c.map(g => g.field);
    assert(tierCFields.includes("em_dash_spacing"), "em_dash_spacing should be in tier_c");
    assert(tierCFields.includes("oxford_comma"), "oxford_comma should be in tier_c");

    // Verify Tier C prompts mention "Defaulting to" or "Keep or change?"
    for (const group of preview.tier_groups.tier_c) {
      if (group.prompt) {
        assert(
          group.prompt.includes("Defaulting") || group.prompt.includes("Keep or change?"),
          `Tier C prompt for ${group.field} should mention default behavior`
        );
      }
    }
  });

  test("tier_groups indicates which fields are inferred vs explicit", async () => {
    const previewText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_us",
      overrides: {
        spelling: "uk", // explicit override
      },
    });
    const preview = JSON.parse(previewText);

    assert(preview.tier_groups.tier_b, "tier_b should exist");

    // Find the spelling field
    const spellingGroup = preview.tier_groups.tier_b.find(g => g.field === "spelling");
    assert(spellingGroup, "spelling should be in tier_b");
    assert.equal(spellingGroup.is_inferred, false, "explicitly set spelling should not be marked as inferred");

    // Find a field that is inferred (e.g., quotation_style should be inferred for english_us)
    const quotationGroup = preview.tier_groups.tier_b.find(g => g.field === "quotation_style");
    assert(quotationGroup, "quotation_style should be in tier_b");
    assert.equal(quotationGroup.is_inferred, true, "language-derived quotation_style should be marked as inferred");
  });

  test("tier_groups preserved in confirm_write response", async () => {
    const targetPath = path.join(writeSyncDir, "projects", "tier-groups-proj", "prose-styleguide.config.yaml");
    fs.rmSync(targetPath, { force: true });

    const confirmText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: "tier-groups-proj",
      language: "english_uk",
      overrides: {
        tense: "past",
      },
      confirm_write: true,
    });
    const confirmed = JSON.parse(confirmText);

    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.preview_only, false);
    assert(confirmed.tier_groups, "tier_groups should be included in confirm_write response");
    assert(Array.isArray(confirmed.tier_groups.tier_b), "tier_b should exist in confirmed response");
    assert(Array.isArray(confirmed.tier_groups.tier_c), "tier_c should exist in confirmed response");
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
