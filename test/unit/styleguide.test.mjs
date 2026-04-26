import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { buildStyleguideConfigDraft, previewStyleguideConfigUpdate, resolveStyleguideConfig, summarizeStyleguideConfig, updateStyleguideConfig } from "../../prose-styleguide.js";
import { buildProseStyleguideSkill } from "../../prose-styleguide-skill.js";
import { analyzeSceneStyleguideDrift, suggestStyleguideUpdatesFromScenes } from "../../prose-styleguide-drift.js";

describe("resolveStyleguideConfig", () => {
  test("returns setup_required when no config files are present", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-empty-"));
    try {
      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, true);
      assert.equal(result.setup_required, true);
      assert.equal(result.config_found, false);
      assert.equal(result.resolved_config, null);
      assert.deepEqual(result.sources, []);
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("applies cascading precedence and language-derived defaults", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-cascade-"));
    try {
      fs.mkdirSync(path.join(syncDir, "universes", "aether", "book-one"), { recursive: true });

      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        [
          "language: english_uk",
          "voice_notes: |",
          "  Root voice",
        ].join("\n"),
        "utf8"
      );

      fs.writeFileSync(
        path.join(syncDir, "universes", "aether", "prose-styleguide.config.yaml"),
        [
          "dialogue_tags: expressive",
          "pov: third_limited",
        ].join("\n"),
        "utf8"
      );

      fs.writeFileSync(
        path.join(syncDir, "universes", "aether", "book-one", "prose-styleguide.config.yaml"),
        [
          "dialogue_tags: minimal",
          "sentence_fragments: intentional",
          "voice_notes: |",
          "  Project voice",
        ].join("\n"),
        "utf8"
      );

      const result = resolveStyleguideConfig({
        syncDir,
        projectId: "aether/book-one",
      });

      assert.equal(result.ok, true);
      assert.equal(result.setup_required, false);
      assert.equal(result.config_found, true);
      assert.equal(result.sources.length, 3);
      assert.equal(result.resolved_config.language, "english_uk");
      assert.equal(result.resolved_config.spelling, "uk");
      assert.equal(result.resolved_config.quotation_style, "single");
      assert.equal(result.resolved_config.quotation_style_nested, "double");
      assert.equal(result.resolved_config.em_dash_spacing, "spaced");
      assert.equal(result.resolved_config.abbreviation_periods, "without");
      assert.equal(result.resolved_config.oxford_comma, "no");
      assert.equal(result.resolved_config.date_format, "dmy");
      assert.equal(result.resolved_config.dialogue_tags, "minimal");
      assert.equal(result.resolved_config.pov, "third_limited");
      assert.equal(result.resolved_config.sentence_fragments, "intentional");
      assert.equal(result.resolved_config.voice_notes, "Project voice");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("returns validation failure when config contains invalid enum value", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-invalid-"));
    try {
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "quotation_style: invalid_style\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "INVALID_STYLEGUIDE_CONFIG");
      assert.equal(result.error.details.issues[0].field, "quotation_style");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("resolves a simple (non-universe) project ID to projects/ path", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-simple-proj-"));
    try {
      const projectDir = path.join(syncDir, "projects", "the-lamb");
      fs.mkdirSync(projectDir, { recursive: true });

      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "language: english_us\n",
        "utf8"
      );
      fs.writeFileSync(
        path.join(projectDir, "prose-styleguide.config.yaml"),
        "tense: past\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir, projectId: "the-lamb" });
      assert.equal(result.ok, true);
      assert.equal(result.sources.length, 2);
      assert.equal(result.sources[0].scope, "sync_root");
      assert.equal(result.sources[1].scope, "project_root");
      assert.equal(result.resolved_config.language, "english_us");
      assert.equal(result.resolved_config.tense, "past");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("accepts escape-valve tense notation and normalizes to canonical value", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-tense-escape-"));
    try {
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "tense: 'present (past for flashbacks)'\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, true);
      // Escape-valve annotation is stripped; resolved tense is the canonical enum value.
      assert.equal(result.resolved_config.tense, "present");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("skips null/undefined values in config without error", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-null-"));
    try {
      // YAML null value: 'tense:' or 'tense: ~'
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "language: english_uk\ntense: ~\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, true);
      assert.equal(result.resolved_config.language, "english_uk");
      // null tense is treated as unset and absent from resolved_config
      assert.equal(result.resolved_config.tense, undefined);
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("reports unknown fields but does not include them in resolved_config", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-unknown-field-"));
    try {
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "language: english_us\nnonexistent_setting: yes\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, true);
      assert.equal(result.resolved_config.language, "english_us");
      assert.equal(result.warnings.unknown_fields.length, 1);
      assert.equal(result.warnings.unknown_fields[0].field, "nonexistent_setting");
      assert.equal(result.resolved_config.nonexistent_setting, undefined);
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});

describe("buildStyleguideConfigDraft", () => {
  test("builds a valid config from language defaults", () => {
    const draft = buildStyleguideConfigDraft({ language: "english_us" });
    assert.equal(draft.ok, true);
    assert.equal(draft.config.language, "english_us");
    assert.equal(draft.config.spelling, "us");
    assert.equal(draft.config.quotation_style, "double");
    assert.equal(draft.config.quotation_style_nested, "single");
  });

  test("accepts overrides and voice notes", () => {
    const draft = buildStyleguideConfigDraft({
      language: "english_uk",
      overrides: {
        quotation_style: "guillemets",
        dialogue_tags: "expressive",
      },
      voice_notes: "Understated interiority.",
    });

    assert.equal(draft.ok, true);
    assert.equal(draft.config.quotation_style, "guillemets");
    assert.equal(draft.config.quotation_style_nested, "guillemets_single");
    assert.equal(draft.config.dialogue_tags, "expressive");
    assert.equal(draft.config.voice_notes, "Understated interiority.");
  });

  test("explicit language wins over any language field present in overrides", () => {
    const draft = buildStyleguideConfigDraft({
      language: "english_uk",
      overrides: {
        language: "english_us",
        dialogue_tags: "expressive",
      },
    });

    assert.equal(draft.ok, true);
    assert.equal(draft.config.language, "english_uk");
    assert.equal(draft.config.spelling, "uk");
    assert.equal(draft.config.dialogue_tags, "expressive");
  });

  test("fails on invalid language", () => {
    const draft = buildStyleguideConfigDraft({ language: "klingon" });
    assert.equal(draft.ok, false);
    assert.equal(draft.error.code, "INVALID_STYLEGUIDE_LANGUAGE");
  });
});

describe("styleguide config hardening", () => {
  test("treats __proto__ as an unknown field instead of mutating object prototypes", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-proto-"));
    try {
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "__proto__:\n  polluted: yes\nlanguage: english_us\n",
        "utf8"
      );

      const result = resolveStyleguideConfig({ syncDir });
      assert.equal(result.ok, true);
      assert.equal(result.resolved_config.language, "english_us");
      assert.equal(result.warnings.unknown_fields.length, 1);
      assert.equal(result.warnings.unknown_fields[0].field, "__proto__");
      assert.equal({}.polluted, undefined);
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});

describe("summarizeStyleguideConfig", () => {
  test("renders plain-language summary lines", () => {
    const result = summarizeStyleguideConfig({
      resolvedConfig: {
        language: "english_uk",
        spelling: "uk",
        quotation_style: "single",
        tense: "present",
        dialogue_tags: "minimal",
        voice_notes: "Restrained and precise.",
      },
      inferredDefaults: { spelling: "uk", quotation_style: "single" },
    });

    assert.equal(result.ok, true);
    assert.match(result.summary_text, /Writing language: english_uk\./);
    assert.match(result.summary_text, /Spelling variant: uk\./);
    assert.match(result.summary_text, /Dialogue punctuation uses single\./);
    assert.match(result.summary_text, /Voice notes: Restrained and precise\./);
    assert.match(result.summary_text, /Inferred defaults currently fill: spelling, quotation_style\./);
  });
});

describe("updateStyleguideConfig", () => {
  test("updates explicit fields on an existing config layer without expanding defaults", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-update-"));
    try {
      fs.writeFileSync(
        path.join(syncDir, "prose-styleguide.config.yaml"),
        "language: english_us\ndialogue_tags: minimal\n",
        "utf8"
      );

      const result = updateStyleguideConfig({
        syncDir,
        scope: "sync_root",
        updates: {
          dialogue_tags: "expressive",
          voice_notes: "Sharper interiority.",
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.config.language, "english_us");
      assert.equal(result.config.dialogue_tags, "expressive");
      assert.equal(result.config.voice_notes, "Sharper interiority.");

      const persisted = yaml.load(fs.readFileSync(path.join(syncDir, "prose-styleguide.config.yaml"), "utf8"));
      assert.equal(persisted.language, "english_us");
      assert.equal(persisted.dialogue_tags, "expressive");
      assert.equal(persisted.voice_notes, "Sharper interiority.");
      assert.equal(persisted.spelling, undefined);
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("fails when the target scope has no config file yet", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-update-missing-"));
    try {
      const result = updateStyleguideConfig({
        syncDir,
        scope: "sync_root",
        updates: { dialogue_tags: "expressive" },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "STYLEGUIDE_CONFIG_NOT_FOUND");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("fails with PROJECT_ID_REQUIRED when scope is project_root without projectId", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-update-project-guard-"));
    try {
      const result = updateStyleguideConfig({
        syncDir,
        scope: "project_root",
        updates: { dialogue_tags: "expressive" },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "PROJECT_ID_REQUIRED");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});

describe("previewStyleguideConfigUpdate", () => {
  test("returns before/after and changed fields without writing", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "styleguide-preview-update-"));
    try {
      const filePath = path.join(syncDir, "prose-styleguide.config.yaml");
      fs.writeFileSync(filePath, "language: english_us\ndialogue_tags: minimal\n", "utf8");

      const preview = previewStyleguideConfigUpdate({
        syncDir,
        scope: "sync_root",
        updates: { dialogue_tags: "expressive" },
      });

      assert.equal(preview.ok, true);
      assert.equal(preview.current_config.dialogue_tags, "minimal");
      assert.equal(preview.config.dialogue_tags, "expressive");
      assert.equal(preview.changed_fields.length, 1);
      assert.equal(preview.changed_fields[0].field, "dialogue_tags");

      const persisted = yaml.load(fs.readFileSync(filePath, "utf8"));
      assert.equal(persisted.dialogue_tags, "minimal");
    } finally {
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});

describe("styleguide drift analysis", () => {
  test("detects scene-level drift from declared quotation style and tense", () => {
    const analysis = analyzeSceneStyleguideDrift({
      prose: '"I go now," she says. "I do what I must."',
      resolvedConfig: {
        quotation_style: "single",
        tense: "past",
      },
    });

    assert.equal(analysis.observed.quotation_style, "double");
    assert.equal(analysis.observed.tense, "present");
    assert.equal(analysis.drift.length >= 1, true);
  });

  test("suggests updates when observed convention agreement is strong", () => {
    const suggestions = suggestStyleguideUpdatesFromScenes({
      sceneAnalyses: [
        { observed: { quotation_style: "double", tense: "present" }, drift: [] },
        { observed: { quotation_style: "double", tense: "present" }, drift: [] },
        { observed: { quotation_style: "double", tense: "past" }, drift: [] },
      ],
      resolvedConfig: { quotation_style: "single", tense: "past" },
      minAgreement: 0.6,
    });

    assert.equal(Object.hasOwn(suggestions, "quotation_style"), true);
    assert.equal(suggestions.quotation_style.suggested_value, "double");
    assert.equal(Object.hasOwn(suggestions, "tense"), false);
  });

  test("requires minimum evidence before emitting suggestion", () => {
    const suggestions = suggestStyleguideUpdatesFromScenes({
      sceneAnalyses: [
        { observed: { quotation_style: "double" }, drift: [] },
        { observed: { quotation_style: "double" }, drift: [] },
      ],
      resolvedConfig: { quotation_style: "single" },
      minAgreement: 0.6,
      minEvidence: 3,
    });

    assert.equal(Object.hasOwn(suggestions, "quotation_style"), false);
  });

  test("can suggest initial config values without an existing resolved config", () => {
    const suggestions = suggestStyleguideUpdatesFromScenes({
      sceneAnalyses: [
        { observed: { quotation_style: "double", spelling: "us" }, drift: [] },
        { observed: { quotation_style: "double", spelling: "us" }, drift: [] },
        { observed: { quotation_style: "double", spelling: "us" }, drift: [] },
      ],
      resolvedConfig: null,
      minAgreement: 0.6,
      minEvidence: 3,
    });

    assert.equal(Object.hasOwn(suggestions, "quotation_style"), true);
    assert.equal(suggestions.quotation_style.suggested_value, "double");
    assert.equal(Object.hasOwn(suggestions, "spelling"), true);
    assert.equal(suggestions.spelling.suggested_value, "us");
  });
});

describe("buildProseStyleguideSkill", () => {
  test("renders markdown with injected rules and voice notes", () => {
    const result = buildProseStyleguideSkill({
      resolvedConfig: {
        language: "english_uk",
        quotation_style: "single",
        tense: "present",
        voice_notes: "Keep subtext strong.\nAvoid over-explaining emotions.",
      },
      sources: [{ scope: "sync_root", file_path: "/tmp/prose-styleguide.config.yaml" }],
      projectId: "test-novel",
    });

    assert.equal(result.ok, true);
    assert.match(result.markdown, /# Prose Styleguide/);
    assert.match(result.markdown, /Project scope: test-novel/);
    assert.match(result.markdown, /Primary writing language: English \(UK\)\./);
    assert.match(result.markdown, /Dialogue quotation style: single quotes\./);
    assert.match(result.markdown, /Default narrative tense: present\./);
    assert.match(result.markdown, /> Keep subtext strong\./);
    assert.match(result.markdown, /> Avoid over-explaining emotions\./);
  });

  test("fails when resolved config is missing", () => {
    const result = buildProseStyleguideSkill({ resolvedConfig: null });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_STYLEGUIDE_CONFIG");
  });
});
