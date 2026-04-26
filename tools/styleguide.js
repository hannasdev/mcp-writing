import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import {
  STYLEGUIDE_CONFIG_BASENAME,
  STYLEGUIDE_ENUMS,
  buildStyleguideConfigDraft,
  previewStyleguideConfigUpdate,
  resolveStyleguideConfig,
  summarizeStyleguideConfig,
  updateStyleguideConfig,
} from "../prose-styleguide.js";
import {
  detectStyleguideSignals,
  analyzeSceneStyleguideDrift,
  suggestStyleguideUpdatesFromScenes,
} from "../prose-styleguide-drift.js";
import {
  PROSE_STYLEGUIDE_SKILL_BASENAME,
  PROSE_STYLEGUIDE_SKILL_DIRNAME,
  buildProseStyleguideSkill,
} from "../prose-styleguide-skill.js";
import { validateProjectId } from "../importer.js";

export function registerStyleguideTools(s, {
  db,
  SYNC_DIR,
  SYNC_DIR_ABS,
  SYNC_DIR_WRITABLE,
  errorResponse,
  jsonResponse,
  resolveProjectRoot,
  resolveBatchTargetScenes,
  maxScenesNextStep,
  isPathCandidateInsideSyncDir,
}) {
  s.tool(
    "setup_prose_styleguide_config",
    "Create prose-styleguide.config.yaml at sync root or project root using language defaults plus optional explicit overrides.",
    {
      scope: z.enum(["sync_root", "project_root"]).optional().describe("Config write target scope. Defaults to project_root when project_id is supplied, otherwise sync_root."),
      project_id: z.string().optional().describe("Project ID when writing project_root config (e.g. 'the-lamb' or 'universe-1/book-1')."),
      language: z.enum(STYLEGUIDE_ENUMS.language).describe("Primary writing language. Seeds language-specific defaults."),
      overrides: z.object({
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
      }).optional().describe("Optional overrides layered on top of language defaults."),
      voice_notes: z.string().optional().describe("Optional freeform voice notes to include in config."),
      overwrite: z.boolean().optional().describe("If true, replaces an existing config file at the target location."),
    },
    async ({ scope, project_id, language, overrides = {}, voice_notes, overwrite = false }) => {
      const resolvedScope = scope ?? (project_id ? "project_root" : "sync_root");

      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (resolvedScope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot write styleguide config because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const targetPath = resolvedScope === "sync_root"
        ? path.join(SYNC_DIR, STYLEGUIDE_CONFIG_BASENAME)
        : path.join(resolveProjectRoot(project_id), STYLEGUIDE_CONFIG_BASENAME);

      if (!isPathCandidateInsideSyncDir(targetPath)) {
        return errorResponse(
          "INVALID_CONFIG_PATH",
          "Resolved styleguide config path must be inside WRITING_SYNC_DIR.",
          { target_path: path.resolve(targetPath), sync_dir: SYNC_DIR_ABS }
        );
      }

      if (fs.existsSync(targetPath) && !overwrite) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_EXISTS",
          "Styleguide config already exists at target path. Set overwrite=true to replace it.",
          { target_path: path.resolve(targetPath) }
        );
      }

      const draft = buildStyleguideConfigDraft({
        language,
        overrides,
        voice_notes,
      });
      if (!draft.ok) {
        return errorResponse(
          draft.error.code,
          draft.error.message,
          draft.error.details
        );
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, yaml.dump(draft.config, { lineWidth: 120 }), "utf8");

      return jsonResponse({
        ok: true,
        scope: resolvedScope,
        file_path: path.resolve(targetPath),
        config: draft.config,
        inferred_defaults: draft.inferred_defaults,
        warnings: draft.warnings,
        next_step: "Config created. Call update_prose_styleguide_config to apply field updates.",
      });
    }
  );

  s.tool(
    "get_prose_styleguide_config",
    "Resolve prose-styleguide.config.yaml with cascading precedence (sync root, then universe root, then project root). Applies language-derived defaults and nested quotation defaults when omitted.",
    {
      project_id: z.string().optional().describe("Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
    },
    async ({ project_id }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });

      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }

      return jsonResponse({
        ok: true,
        styleguide: resolved,
        next_step: resolved.setup_required
          ? "No prose-styleguide.config.yaml was found. Call setup_prose_styleguide_config (with language e.g. 'en') to create one at sync root or project root."
          : "Config resolved successfully.",
      });
    }
  );

  s.tool(
    "summarize_prose_styleguide_config",
    "Summarize the currently resolved prose styleguide config in plain language for review or confirmation.",
    {
      project_id: z.string().optional().describe("Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
    },
    async ({ project_id }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot summarize prose styleguide config before prose-styleguide.config.yaml is set up.",
          {
            project_id: project_id ?? null,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config.",
          }
        );
      }

      const summary = summarizeStyleguideConfig({
        resolvedConfig: resolved.resolved_config,
        inferredDefaults: resolved.inferred_defaults,
      });
      if (!summary.ok) {
        return errorResponse(summary.error.code, summary.error.message);
      }

      return jsonResponse({
        ok: true,
        project_id: project_id ?? null,
        summary_text: summary.summary_text,
        summary_lines: summary.summary_lines,
        styleguide: resolved,
      });
    }
  );

  s.tool(
    "bootstrap_prose_styleguide_config",
    "Detect dominant prose conventions from existing scenes and suggest initial prose-styleguide config values.",
    {
      project_id: z.string().describe("Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1')."),
      scene_ids: z.array(z.string()).optional().describe("Optional scene_id allowlist to analyze."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional chapter filter."),
      max_scenes: z.number().int().positive().optional().describe("Maximum number of scenes to analyze (default: 50)."),
      min_agreement: z.number().min(0).max(1).optional().describe("Minimum agreement ratio for suggested fields (default: 0.6)."),
      min_evidence: z.number().int().positive().optional().describe("Minimum number of observed scenes per field before suggesting it (default: 3)."),
      include_scene_signals: z.boolean().optional().describe("If true, include per-scene detected signals in the response."),
    },
    async ({
      project_id,
      scene_ids,
      part,
      chapter,
      max_scenes = 50,
      min_agreement = 0.6,
      min_evidence = 3,
      include_scene_signals = false,
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const targetResolution = resolveBatchTargetScenes(db, {
        projectId: project_id,
        sceneIds: scene_ids,
        part,
        chapter,
        onlyStale: false,
      });
      if (!targetResolution.ok) {
        return errorResponse(targetResolution.code, targetResolution.message, targetResolution.details);
      }

      const targetScenes = targetResolution.rows;
      if (targetScenes.length === 0) {
        return errorResponse(
          "NOT_FOUND",
          `No scenes were found for project '${project_id}' with the requested filters.`,
          { project_id, scene_ids: scene_ids ?? null, part: part ?? null, chapter: chapter ?? null }
        );
      }

      if (targetScenes.length > max_scenes) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Matched ${targetScenes.length} scenes, which exceeds max_scenes=${max_scenes}.`,
          {
            matched_scenes: targetScenes.length,
            max_scenes,
            project_id,
            next_step: maxScenesNextStep(targetScenes.length),
          }
        );
      }

      const sceneSignals = [];
      let unreadableScenes = 0;

      for (const scene of targetScenes) {
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          const prose = matter(raw).content;
          sceneSignals.push({
            scene_id: scene.scene_id,
            observed: detectStyleguideSignals(prose),
          });
        } catch {
          unreadableScenes += 1;
          sceneSignals.push({
            scene_id: scene.scene_id,
            observed: {},
          });
        }
      }

      const suggestedConfig = suggestStyleguideUpdatesFromScenes({
        sceneAnalyses: sceneSignals,
        resolvedConfig: null,
        minAgreement: min_agreement,
        minEvidence: min_evidence,
      });

      return jsonResponse({
        ok: true,
        project_id,
        checked_scenes: sceneSignals.length,
        unreadable_scenes: unreadableScenes,
        suggested_config: suggestedConfig,
        next_step: `To apply: (1) If no project-scoped config exists yet, call setup_prose_styleguide_config first with scope=project_root, project_id=${project_id}, and language (e.g. 'en'). (2) Then call update_prose_styleguide_config with the fields from suggested_config you want to apply.`,
        scene_signals: include_scene_signals ? sceneSignals : undefined,
      });
    }
  );

  s.tool(
    "update_prose_styleguide_config",
    "Update an existing prose-styleguide.config.yaml at sync-root or project-root scope by writing only explicit field changes.",
    {
      scope: z.enum(["sync_root", "project_root"]).describe("Config scope to update."),
      project_id: z.string().optional().describe("Project ID when updating project_root config (e.g. 'the-lamb' or 'universe-1/book-1')."),
      updates: z.object({
        language: z.enum(STYLEGUIDE_ENUMS.language).optional(),
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
        voice_notes: z.string().optional(),
      }).strict().describe("Explicit config field changes to write at the selected scope."),
    },
    async ({ scope, project_id, updates }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (scope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot update styleguide config because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const updated = updateStyleguideConfig({
        syncDir: SYNC_DIR,
        scope,
        projectId: project_id,
        updates,
      });
      if (!updated.ok) {
        return errorResponse(
          updated.error.code,
          updated.error.message,
          updated.error.details
        );
      }

      return jsonResponse({
        ok: true,
        scope: updated.scope,
        project_id: updated.project_id,
        file_path: path.resolve(updated.file_path),
        config: updated.config,
        changed_fields: updated.changed_fields,
        noop: Boolean(updated.noop),
        message: updated.message,
        warnings: updated.warnings,
      });
    }
  );

  s.tool(
    "preview_prose_styleguide_config_update",
    "Preview how explicit updates would change an existing prose-styleguide.config.yaml without writing any files.",
    {
      scope: z.enum(["sync_root", "project_root"]).describe("Config scope to preview updates for."),
      project_id: z.string().optional().describe("Project ID when previewing project_root config updates (e.g. 'the-lamb' or 'universe-1/book-1')."),
      updates: z.object({
        language: z.enum(STYLEGUIDE_ENUMS.language).optional(),
        spelling: z.enum(STYLEGUIDE_ENUMS.spelling).optional(),
        quotation_style: z.enum(STYLEGUIDE_ENUMS.quotation_style).optional(),
        quotation_style_nested: z.enum(STYLEGUIDE_ENUMS.quotation_style_nested).optional(),
        em_dash_spacing: z.enum(STYLEGUIDE_ENUMS.em_dash_spacing).optional(),
        ellipsis_style: z.enum(STYLEGUIDE_ENUMS.ellipsis_style).optional(),
        abbreviation_periods: z.enum(STYLEGUIDE_ENUMS.abbreviation_periods).optional(),
        oxford_comma: z.enum(STYLEGUIDE_ENUMS.oxford_comma).optional(),
        numbers: z.enum(STYLEGUIDE_ENUMS.numbers).optional(),
        date_format: z.enum(STYLEGUIDE_ENUMS.date_format).optional(),
        time_format: z.enum(STYLEGUIDE_ENUMS.time_format).optional(),
        tense: z.string().optional(),
        pov: z.enum(STYLEGUIDE_ENUMS.pov).optional(),
        dialogue_tags: z.enum(STYLEGUIDE_ENUMS.dialogue_tags).optional(),
        sentence_fragments: z.enum(STYLEGUIDE_ENUMS.sentence_fragments).optional(),
        voice_notes: z.string().optional(),
      }).strict().describe("Explicit config field changes to preview at the selected scope."),
    },
    async ({ scope, project_id, updates }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (scope === "project_root" && !project_id) {
        return errorResponse(
          "PROJECT_ID_REQUIRED",
          "project_id is required when scope=project_root."
        );
      }

      const preview = previewStyleguideConfigUpdate({
        syncDir: SYNC_DIR,
        scope,
        projectId: project_id,
        updates,
      });
      if (!preview.ok) {
        return errorResponse(
          preview.error.code,
          preview.error.message,
          preview.error.details
        );
      }

      return jsonResponse({
        ok: true,
        scope: preview.scope,
        project_id: preview.project_id,
        file_path: path.resolve(preview.file_path),
        current_config: preview.current_config,
        next_config: preview.config,
        changed_fields: preview.changed_fields,
        noop: preview.changed_fields.length === 0,
        message: preview.changed_fields.length === 0
          ? "No changes detected for requested styleguide updates."
          : "Preview generated.",
        warnings: preview.warnings,
      });
    }
  );

  s.tool(
    "check_prose_styleguide_drift",
    "Detect styleguide drift by comparing declared config conventions against observed signals in scene prose.",
    {
      project_id: z.string().describe("Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1')."),
      scene_ids: z.array(z.string()).optional().describe("Optional scene_id allowlist to analyze."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional chapter filter."),
      max_scenes: z.number().int().positive().optional().describe("Maximum number of scenes to analyze (default: 50)."),
      min_agreement: z.number().min(0).max(1).optional().describe("Minimum agreement ratio for suggested updates (default: 0.6)."),
      include_clean_scenes: z.boolean().optional().describe("If true, include scenes with no detected drift in scene_results."),
    },
    async ({
      project_id,
      scene_ids,
      part,
      chapter,
      max_scenes = 50,
      min_agreement = 0.6,
      include_clean_scenes = false,
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot check prose styleguide drift before prose-styleguide.config.yaml is set up.",
          {
            project_id,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config.",
          }
        );
      }

      const targetResolution = resolveBatchTargetScenes(db, {
        projectId: project_id,
        sceneIds: scene_ids,
        part,
        chapter,
        onlyStale: false,
      });
      if (!targetResolution.ok) {
        return errorResponse(targetResolution.code, targetResolution.message, targetResolution.details);
      }

      const targetScenes = targetResolution.rows;
      if (targetScenes.length > max_scenes) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Matched ${targetScenes.length} scenes, which exceeds max_scenes=${max_scenes}.`,
          {
            matched_scenes: targetScenes.length,
            max_scenes,
            project_id,
            next_step: maxScenesNextStep(targetScenes.length),
          }
        );
      }

      const sceneAnalyses = [];
      for (const scene of targetScenes) {
        let prose;
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          prose = matter(raw).content;
        } catch {
          sceneAnalyses.push({
            scene_id: scene.scene_id,
            observed: {},
            drift: [{ field: "scene_file", declared: "readable", observed: "unreadable" }],
          });
          continue;
        }

        const analysis = analyzeSceneStyleguideDrift({
          prose,
          resolvedConfig: resolved.resolved_config,
        });
        sceneAnalyses.push({
          scene_id: scene.scene_id,
          observed: analysis.observed,
          drift: analysis.drift,
        });
      }

      const suggestedUpdates = suggestStyleguideUpdatesFromScenes({
        sceneAnalyses,
        resolvedConfig: resolved.resolved_config,
        minAgreement: min_agreement,
      });

      const filteredScenes = include_clean_scenes
        ? sceneAnalyses
        : sceneAnalyses.filter((scene) => scene.drift.length > 0);

      const driftByField = {};
      for (const scene of sceneAnalyses) {
        for (const entry of scene.drift) {
          driftByField[entry.field] = (driftByField[entry.field] ?? 0) + 1;
        }
      }

      return jsonResponse({
        ok: true,
        project_id,
        checked_scenes: sceneAnalyses.length,
        scenes_with_drift: sceneAnalyses.filter((scene) => scene.drift.length > 0).length,
        drift_by_field: driftByField,
        scene_results: filteredScenes,
        suggested_updates: suggestedUpdates,
      });
    }
  );

  s.tool(
    "setup_prose_styleguide_skill",
    "Generate skills/prose-styleguide.md from the resolved prose styleguide config and universal craft rules.",
    {
      project_id: z.string().optional().describe("Optional project ID for scoped config resolution (e.g. 'the-lamb' or 'universe-1/book-1')."),
      overwrite: z.boolean().optional().describe("If true, replaces an existing skills/prose-styleguide.md file."),
    },
    async ({ project_id, overwrite = false }) => {
      if (project_id !== undefined) {
        const projectIdCheck = validateProjectId(project_id);
        if (!projectIdCheck.ok) {
          return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
        }
      }

      if (!SYNC_DIR_WRITABLE) {
        return errorResponse(
          "SYNC_DIR_NOT_WRITABLE",
          "Cannot write prose styleguide skill because WRITING_SYNC_DIR is not writable in this runtime.",
          { sync_dir: SYNC_DIR_ABS }
        );
      }

      const resolved = resolveStyleguideConfig({
        syncDir: SYNC_DIR,
        projectId: project_id,
      });
      if (!resolved.ok) {
        return errorResponse(
          resolved.error.code,
          resolved.error.message,
          resolved.error.details
        );
      }
      if (resolved.setup_required || !resolved.resolved_config) {
        return errorResponse(
          "STYLEGUIDE_CONFIG_REQUIRED",
          "Cannot generate prose-styleguide.md before prose-styleguide.config.yaml is set up.",
          {
            project_id: project_id ?? null,
            next_step: "Run setup_prose_styleguide_config or bootstrap_prose_styleguide_config first.",
          }
        );
      }

      const skillPath = path.join(SYNC_DIR, PROSE_STYLEGUIDE_SKILL_DIRNAME, PROSE_STYLEGUIDE_SKILL_BASENAME);
      if (!isPathCandidateInsideSyncDir(skillPath)) {
        return errorResponse(
          "INVALID_SKILL_PATH",
          "Resolved prose styleguide skill path must be inside WRITING_SYNC_DIR.",
          { target_path: path.resolve(skillPath), sync_dir: SYNC_DIR_ABS }
        );
      }

      if (fs.existsSync(skillPath) && !overwrite) {
        return errorResponse(
          "STYLEGUIDE_SKILL_EXISTS",
          "skills/prose-styleguide.md already exists. Set overwrite=true to replace it.",
          { target_path: path.resolve(skillPath) }
        );
      }

      const generated = buildProseStyleguideSkill({
        resolvedConfig: resolved.resolved_config,
        sources: resolved.sources,
        projectId: project_id ?? null,
      });
      if (!generated.ok) {
        return errorResponse(generated.error.code, generated.error.message);
      }

      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, generated.markdown, "utf8");

      return jsonResponse({
        ok: true,
        file_path: path.resolve(skillPath),
        project_id: project_id ?? null,
        injected_rules: generated.injected_rules,
        source_count: resolved.sources.length,
      });
    }
  );
}
