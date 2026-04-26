import fs from "node:fs";
import path from "node:path";
import { ReviewBundlePlanError } from "./review-bundles-planner.js";
import { renderReviewBundleMarkdown, renderReviewBundlePdf, renderBetaNoticeMarkdown, renderBetaFeedbackFormMarkdown } from "./review-bundles-renderer.js";

function resolveOutputFilePath(outputDir, fileName) {
  const normalizedOutputDir = path.resolve(outputDir);
  const target = path.resolve(normalizedOutputDir, fileName);
  const rel = path.relative(normalizedOutputDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ReviewBundlePlanError(
      "INVALID_OUTPUT_PATH",
      `Output file '${fileName}' resolves outside output_dir.`,
      { output_dir: normalizedOutputDir, file_name: fileName }
    );
  }
  return target;
}

export async function createReviewBundleArtifacts(dbHandle, {
  plan,
  output_dir,
  source_commit = null,
  syncDir,
}) {
  if (!output_dir) {
    throw new ReviewBundlePlanError("INVALID_OUTPUT_DIR", "output_dir is required.");
  }

  const normalizedOutputDir = path.resolve(output_dir);
  if (fs.existsSync(normalizedOutputDir)) {
    if (!fs.statSync(normalizedOutputDir).isDirectory()) {
      throw new ReviewBundlePlanError(
        "INVALID_OUTPUT_DIR",
        `output_dir exists but is not a directory: ${normalizedOutputDir}`
      );
    }
  } else {
    fs.mkdirSync(normalizedOutputDir, { recursive: true });
  }
  try {
    fs.accessSync(normalizedOutputDir, fs.constants.W_OK);
  } catch {
    throw new ReviewBundlePlanError(
      "INVALID_OUTPUT_DIR",
      `output_dir is not writable: ${normalizedOutputDir}`
    );
  }

  const noticeFileName = plan.planned_outputs.find(name => name.endsWith(".notice.md")) ?? null;
  const feedbackFileName = plan.planned_outputs.find(name => name.endsWith(".feedback-form.md")) ?? null;
  // Derive which outputs to write from the plan itself, not from the format param,
  // so plan and artifacts always stay in sync.
  const markdownFileName = plan.planned_outputs.find(
    name => name.endsWith(".md") && !name.endsWith(".notice.md") && !name.endsWith(".feedback-form.md")
  ) ?? null;
  const pdfFileName = plan.planned_outputs.find(name => name.endsWith(".pdf")) ?? null;
  const manifestFileName = plan.planned_outputs.find(name => name.endsWith(".manifest.json"));

  if (!manifestFileName) {
    throw new ReviewBundlePlanError(
      "INVALID_PLAN_OUTPUTS",
      "Plan is missing expected manifest filename."
    );
  }

  if (!markdownFileName && !pdfFileName) {
    throw new ReviewBundlePlanError(
      "INVALID_PLAN_OUTPUTS",
      "Plan has no primary bundle output (neither .md nor .pdf) in planned_outputs."
    );
  }

  const markdownPath = markdownFileName ? resolveOutputFilePath(normalizedOutputDir, markdownFileName) : null;
  const pdfPath = pdfFileName ? resolveOutputFilePath(normalizedOutputDir, pdfFileName) : null;
  const manifestPath = resolveOutputFilePath(normalizedOutputDir, manifestFileName);
  const noticePath = noticeFileName ? resolveOutputFilePath(normalizedOutputDir, noticeFileName) : null;
  const feedbackPath = feedbackFileName ? resolveOutputFilePath(normalizedOutputDir, feedbackFileName) : null;

  const generatedAt = new Date().toISOString();

  const markdown = markdownPath ? renderReviewBundleMarkdown(dbHandle, plan, { generatedAt, syncDir }) : null;

  let pdfBuffer = null;
  if (pdfPath) {
    pdfBuffer = await renderReviewBundlePdf(dbHandle, plan, { generatedAt, syncDir });
  }

  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const betaNotice = plan.profile === "beta_reader_personalized"
    ? renderBetaNoticeMarkdown({ projectId: plan.resolved_scope.project_id, recipientName })
    : null;
  const betaFeedbackForm = plan.profile === "beta_reader_personalized"
    ? renderBetaFeedbackFormMarkdown({ projectId: plan.resolved_scope.project_id, recipientName, generatedAt })
    : null;

  const bundleIdFileName = markdownFileName || pdfFileName;
  const manifest = {
    bundle_id: path.basename(bundleIdFileName, path.extname(bundleIdFileName)),
    profile: plan.profile,
    generated_at: generatedAt,
    provenance: {
      source_commit: source_commit ?? null,
      project_id: plan.resolved_scope.project_id,
    },
    summary: plan.summary,
    warning_summary: plan.warning_summary,
    warnings: plan.warnings,
    resolved_scope: plan.resolved_scope,
    scene_ids: plan.ordering.map(row => row.scene_id),
  };

  for (const outputPath of [markdownPath, pdfPath, manifestPath, noticePath, feedbackPath].filter(Boolean)) {
    try {
      const stat = fs.lstatSync(outputPath);
      if (stat.isSymbolicLink()) {
        throw new ReviewBundlePlanError(
          "INVALID_OUTPUT_PATH",
          `Refusing to write: target path is a symlink: ${outputPath}`
        );
      }
      if (!stat.isFile()) {
        throw new ReviewBundlePlanError(
          "INVALID_OUTPUT_PATH",
          `Refusing to write: target path exists but is not a regular file: ${outputPath}`
        );
      }
    } catch (error) {
      if (error instanceof ReviewBundlePlanError) throw error;
      if (error?.code !== "ENOENT") throw error;
      // ENOENT — file doesn't exist yet, which is the expected case.
      // Note: there is an inherent TOCTOU window between this lstat check and the
      // writeFileSync below. This is acceptable for a local tool where the caller
      // controls the output directory.
    }
  }

  if (markdownPath && markdown != null) {
    fs.writeFileSync(markdownPath, markdown, "utf8");
  }
  if (pdfPath && pdfBuffer != null) {
    fs.writeFileSync(pdfPath, pdfBuffer);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (noticePath && betaNotice != null) {
    fs.writeFileSync(noticePath, betaNotice, "utf8");
  }
  if (feedbackPath && betaFeedbackForm != null) {
    fs.writeFileSync(feedbackPath, betaFeedbackForm, "utf8");
  }

  return {
    bundle_id: manifest.bundle_id,
    output_paths: {
      ...(markdownPath ? { bundle_markdown: markdownPath } : {}),
      ...(pdfPath ? { bundle_pdf: pdfPath } : {}),
      manifest_json: manifestPath,
      ...(noticePath ? { notice_md: noticePath } : {}),
      ...(feedbackPath ? { feedback_form_md: feedbackPath } : {}),
    },
    generated_at: generatedAt,
  };
}
