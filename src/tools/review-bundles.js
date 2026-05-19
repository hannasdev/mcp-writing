import { z } from "zod";
import path from "node:path";
import {
  REVIEW_BUNDLE_PROFILES,
  REVIEW_BUNDLE_STRICTNESS,
  ReviewBundlePlanError,
  buildReviewBundlePlan,
  createReviewBundleArtifacts,
} from "../review-bundles/review-bundles.js";
import { validateProjectId } from "../sync/importer.js";
import { getHeadCommitHash } from "../core/git.js";

export function registerReviewBundleTools(s, {
  db,
  SYNC_DIR,
  SYNC_DIR_ABS,
  GIT_ENABLED,
  errorResponse,
  jsonResponse,
  resolveOutputDirWithinSync,
}) {
  // ---- preview_review_bundle ----------------------------------------------
  s.tool(
    "preview_review_bundle",
    "Dry-run planning tool for review bundles. Resolves scene scope, deterministic ordering, warnings, and planned output filenames without writing files. Rendering options are accepted for API consistency and reflected in resolved_scope.options, but do not change planning output.",
    {
      project_id: z.string().describe("Project ID to scope the review bundle (e.g. 'test-novel')."),
      profile: z.enum(REVIEW_BUNDLE_PROFILES).describe("Bundle profile: outline_discussion, editor_detailed, or beta_reader_personalized."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional read-scope compatibility alias resolved through canonical chapter identity. Not a structural mutation target."),
      chapter_id: z.string().optional().describe("Optional canonical chapter identifier."),
      chapters: z.array(z.number().int()).min(1).optional().describe("Optional read-scope compatibility chapter-set alias resolved through canonical chapter identities. Use this for one/few specific chapters. Do not combine with chapter or chapter_id."),
      tag: z.string().optional().describe("Optional tag filter (exact match)."),
      scene_ids: z.array(z.string()).optional().describe("Optional explicit scene_id allowlist. Intersects with other filters."),
      strictness: z.enum(REVIEW_BUNDLE_STRICTNESS).optional().describe("Strictness mode: warn (default) or fail."),
      include_scene_ids: z.boolean().optional().describe("Rendering option (default true for editor_detailed; false for outline_discussion). beta_reader_personalized always resolves this to false, even when true is passed. Echoed in resolved_scope.options for downstream rendering; does not change planning results."),
      include_metadata_sidebar: z.boolean().optional().describe("Rendering option (default false). Echoed in resolved_scope.options for downstream rendering; does not change planning results."),
      include_paragraph_anchors: z.boolean().optional().describe("Rendering option (default false). Echoed in resolved_scope.options for downstream rendering; does not change planning results."),
      recipient_name: z.string().optional().describe("Optional recipient display name for beta_reader_personalized profile."),
      beta_accountability: z.boolean().optional().describe("Enable accountability footer + fingerprint metadata for beta_reader_personalized output (default true for beta profile)."),
      bundle_name: z.string().optional().describe("Optional output bundle base name override (slugified in planned outputs)."),
      bundle_title: z.string().optional().describe("Optional book or document title for the cover page (outline_discussion PDF only)."),
      author_name: z.string().optional().describe("Optional author name for the cover page (outline_discussion PDF only)."),
      format: z.enum(["pdf", "markdown", "both"]).optional().describe("Planned output format: pdf (default), markdown, or both. Affects planned_outputs filenames only; preview_review_bundle does not render artifacts."),
    },
    async ({
      project_id,
      profile,
      part,
      chapter,
      chapter_id,
      chapters,
      tag,
      scene_ids,
      strictness = "warn",
      include_scene_ids,
      include_metadata_sidebar = false,
      include_paragraph_anchors = false,
      recipient_name,
      beta_accountability,
      bundle_name,
      bundle_title,
      author_name,
      format = "pdf",
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      try {
        const plan = buildReviewBundlePlan(db, {
          project_id,
          profile,
          part,
          chapter,
          chapter_id,
          chapters,
          tag,
          scene_ids,
          strictness,
          include_scene_ids,
          include_metadata_sidebar,
          include_paragraph_anchors,
          recipient_name,
          beta_accountability,
          bundle_name,
          bundle_title,
          author_name,
          format,
        });
        return jsonResponse({
          ...plan,
          next_step: plan.strictness_result?.can_proceed
            ? "Preview complete. Review warnings and planned_outputs, then call create_review_bundle with the same scope and output_dir."
            : "Preview complete, but strictness blockers are present. Resolve blockers (for example stale metadata) or switch to strictness='warn' before create_review_bundle.",
        });
      } catch (error) {
        if (error instanceof ReviewBundlePlanError) {
          return errorResponse(error.code, error.message, error.details);
        }
        if (
          error &&
          typeof error === "object" &&
          error.name === "CoreValidationError" &&
          typeof error.code === "string"
        ) {
          return errorResponse(error.code, error.message ?? "Request failed.", error.details);
        }
        return errorResponse(
          "PREVIEW_FAILED",
          error instanceof Error ? error.message : "Failed to generate review bundle preview."
        );
      }
    }
  );

  // ---- create_review_bundle -----------------------------------------------
  s.tool(
    "create_review_bundle",
    "Generate review bundle artifacts (PDF/markdown) from planned scene scope. Writes files only under output_dir and returns manifest/provenance details.",
    {
      project_id: z.string().describe("Project ID to scope the review bundle (e.g. 'test-novel')."),
      profile: z.enum(REVIEW_BUNDLE_PROFILES).describe("Bundle profile: outline_discussion, editor_detailed, or beta_reader_personalized."),
      output_dir: z.string().describe("Directory path to write bundle artifacts into."),
      part: z.number().int().optional().describe("Optional part filter."),
      chapter: z.number().int().optional().describe("Optional read-scope compatibility alias resolved through canonical chapter identity. Not a structural mutation target."),
      chapter_id: z.string().optional().describe("Optional canonical chapter identifier."),
      chapters: z.array(z.number().int()).min(1).optional().describe("Optional read-scope compatibility chapter-set alias resolved through canonical chapter identities. Use this for one/few specific chapters. Do not combine with chapter or chapter_id."),
      tag: z.string().optional().describe("Optional tag filter (exact match)."),
      scene_ids: z.array(z.string()).optional().describe("Optional explicit scene_id allowlist. Intersects with other filters."),
      strictness: z.enum(REVIEW_BUNDLE_STRICTNESS).optional().describe("Strictness mode: warn (default) or fail."),
      include_scene_ids: z.boolean().optional().describe("Include scene IDs in headings (default true for editor_detailed; false for outline_discussion). beta_reader_personalized always resolves this to false, even when true is passed. Applies to both PDF and markdown."),
      include_metadata_sidebar: z.boolean().optional().describe("Include metadata sidebar in markdown output (default false). Markdown only — no effect on PDF."),
      include_paragraph_anchors: z.boolean().optional().describe("Include paragraph anchors in markdown output (default false). Markdown only — no effect on PDF."),
      recipient_name: z.string().optional().describe("Optional recipient display name for beta_reader_personalized profile."),
      beta_accountability: z.boolean().optional().describe("Enable accountability footer + fingerprint metadata for beta_reader_personalized output (default true for beta profile)."),
      bundle_name: z.string().optional().describe("Optional output bundle base name override (slugified in filenames)."),
      bundle_title: z.string().optional().describe("Optional book or document title for the cover page (outline_discussion PDF only)."),
      author_name: z.string().optional().describe("Optional author name for the cover page (outline_discussion PDF only)."),
      source_commit: z.string().optional().describe("Optional explicit source commit for provenance. Defaults to current HEAD when available."),
      format: z.enum(["pdf", "markdown", "both"]).optional().describe("Output format: pdf (default), markdown, or both."),
    },
    async ({
      project_id,
      profile,
      output_dir,
      part,
      chapter,
      chapter_id,
      chapters,
      tag,
      scene_ids,
      strictness = "warn",
      include_scene_ids,
      include_metadata_sidebar = false,
      include_paragraph_anchors = false,
      recipient_name,
      beta_accountability,
      bundle_name,
      bundle_title,
      author_name,
      source_commit,
      format = "pdf",
    }) => {
      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      try {
        const { resolvedOutputDir, relativeToSyncDir } = resolveOutputDirWithinSync(output_dir);
        const outputDirSegments = relativeToSyncDir
          .split(path.sep)
          .filter(Boolean)
          .map(segment => segment.toLowerCase());
        if (outputDirSegments.includes("scenes")) {
          return errorResponse(
            "INVALID_OUTPUT_DIR",
            "output_dir cannot be inside a scenes directory. Choose a dedicated export folder under WRITING_SYNC_DIR.",
            { output_dir: resolvedOutputDir }
          );
        }

        const plan = buildReviewBundlePlan(db, {
          project_id,
          profile,
          part,
          chapter,
          chapter_id,
          chapters,
          tag,
          scene_ids,
          strictness,
          include_scene_ids,
          include_metadata_sidebar,
          include_paragraph_anchors,
          recipient_name,
          beta_accountability,
          bundle_name,
          bundle_title,
          author_name,
          format,
        });

        if (!plan.strictness_result.can_proceed) {
          return errorResponse(
            "STRICTNESS_BLOCKED",
            "Bundle generation blocked by strictness policy.",
            {
              strictness_result: plan.strictness_result,
              warning_summary: plan.warning_summary,
              next_step: "Resolve blockers from strictness_result (for example by running enrich_scene on stale scenes), then re-run create_review_bundle.",
            }
          );
        }

        const provenanceCommit = source_commit ?? (GIT_ENABLED ? getHeadCommitHash(SYNC_DIR) : null);
        const artifacts = await createReviewBundleArtifacts(db, {
          plan,
          output_dir: resolvedOutputDir,
          source_commit: provenanceCommit,
          syncDir: SYNC_DIR_ABS,
        });

        return jsonResponse({
          ok: true,
          bundle_id: artifacts.bundle_id,
          output_paths: artifacts.output_paths,
          summary: {
            scene_count: plan.summary.scene_count,
            profile: plan.profile,
            applied_filters: plan.resolved_scope.filters,
          },
          warnings: plan.warnings,
          warning_summary: plan.warning_summary,
          provenance: {
            source_commit: provenanceCommit,
            generated_at: artifacts.generated_at,
            project_id: plan.resolved_scope.project_id,
          },
          next_step: "Bundle created. Share output_paths with reviewers, or run preview_review_bundle again to adjust scope/profile before regenerating.",
        });
      } catch (error) {
        if (error instanceof ReviewBundlePlanError) {
          return errorResponse(error.code, error.message, error.details);
        }
        if (
          error &&
          typeof error === "object" &&
          error.name === "CoreValidationError" &&
          typeof error.code === "string"
        ) {
          return errorResponse(error.code, error.message ?? "Request failed.", error.details);
        }
        return errorResponse(
          "CREATE_BUNDLE_FAILED",
          error instanceof Error ? error.message : "Failed to create review bundle artifacts."
        );
      }
    }
  );
}
