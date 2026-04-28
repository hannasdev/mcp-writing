import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import PDFDocument from "pdfkit";
import { ReviewBundlePlanError, normalizeRecipientDisplayName } from "./review-bundles-planner.js";

function escapeMarkdown(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_`[\]#])/g, "\\$1");
}

function renderBetaNoticeMarkdown({ projectId, recipientName }) {
  const displayName = normalizeRecipientDisplayName(recipientName);
  return [
    "# Non-Distribution Notice",
    "",
    `This review packet is prepared for ${escapeMarkdown(displayName)} for private beta-reading purposes only.`,
    "",
    "Please do not distribute, repost, or share this material without explicit author permission.",
    "",
    "This notice is informational only and is not legal advice.",
    "",
    `Project: ${escapeMarkdown(projectId)}`,
  ].join("\n") + "\n";
}

function renderBetaFeedbackFormMarkdown({ projectId, recipientName, generatedAt }) {
  const displayName = normalizeRecipientDisplayName(recipientName);
  const feedbackDate = String(generatedAt ?? new Date().toISOString()).slice(0, 10);
  return [
    "# Beta Reader Feedback Form",
    "",
    `- Project: ${escapeMarkdown(projectId)}`,
    `- Reader: ${escapeMarkdown(displayName)}`,
    `- Date: ${feedbackDate}`,
    "",
    "## Big-Picture Questions",
    "",
    "1. Which sections felt most compelling, and why?",
    "2. Where did pacing feel slow, rushed, or unclear?",
    "3. Were any character motivations confusing or unconvincing?",
    "",
    "## Scene-Level Notes",
    "",
    "Use scene IDs when possible.",
    "",
    "- Scene ID:",
    "- Comment:",
    "- Severity (nit / moderate / major):",
    "",
    "## Final Thoughts",
    "",
    "- What should be prioritized in the next revision?",
    "- Any continuity concerns to flag?",
  ].join("\n") + "\n";
}

function loadBundleSceneRows(dbHandle, projectId, sceneIds) {
  if (!Array.isArray(sceneIds) || sceneIds.length === 0) return [];
  const rows = [];
  // 900 is safely below SQLite's per-query bound of 999 host parameters
  // (one slot is used by the project_id binding, leaving 998 for scene_id placeholders;
  // 900 gives extra headroom for any future additions to the query).
  const chunkSize = 900;
  for (let offset = 0; offset < sceneIds.length; offset += chunkSize) {
    const chunk = sceneIds.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const chunkRows = dbHandle.prepare(`
      SELECT
        scene_id,
        project_id,
        title,
        part,
        chapter,
        timeline_position,
        logline,
        pov,
        save_the_cat_beat,
        file_path
      FROM scenes
      WHERE project_id = ? AND scene_id IN (${placeholders})
    `).all(projectId, ...chunk);
    rows.push(...chunkRows);
  }

  const rowMap = new Map(rows.map(row => [row.scene_id, row]));
  const orderedRows = [];
  const missingSceneIds = [];

  for (const sceneId of sceneIds) {
    const row = rowMap.get(sceneId);
    if (row) {
      orderedRows.push(row);
    } else {
      missingSceneIds.push(sceneId);
    }
  }

  if (missingSceneIds.length > 0) {
    throw new ReviewBundlePlanError(
      "MISSING_SCENE_ROWS",
      `Bundle includes ${missingSceneIds.length} scene(s) that could not be loaded from the database.`,
      {
        project_id: projectId,
        missing_scene_ids: missingSceneIds,
        requested_scene_count: sceneIds.length,
        resolved_scene_count: orderedRows.length,
      }
    );
  }

  return orderedRows;
}

function normalizeRelativePath(inputPath) {
  return String(inputPath).replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveSceneFilePath(filePath, { syncDir } = {}) {
  if (!filePath || !syncDir) return null;

  const normalizedSyncDir = path.resolve(syncDir);
  let realSyncDir;
  try {
    realSyncDir = fs.realpathSync.native(normalizedSyncDir);
  } catch {
    return null;
  }

  const rel = normalizeRelativePath(filePath);
  const candidates = [];

  if (path.isAbsolute(filePath)) {
    // Canonicalize the absolute path (resolve symlinks) so the boundary check
    // works correctly even when syncDir itself contains a symlink component
    // (e.g. macOS /var → /private/var or /tmp → /private/tmp).
    const resolvedAbsolute = path.resolve(filePath);
    let canonicalAbsolute;

    if (fs.existsSync(resolvedAbsolute)) {
      try {
        canonicalAbsolute = fs.realpathSync.native(resolvedAbsolute);
      } catch {
        // Cannot canonicalize — skip this candidate.
      }
    } else {
      // File doesn't exist yet; walk up to the nearest existing ancestor,
      // canonicalize that, then reconstruct the full path.
      let ancestor = resolvedAbsolute;
      const segments = [];
      while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) { ancestor = null; break; }
        segments.unshift(path.basename(ancestor));
        ancestor = parent;
      }
      if (ancestor) {
        try {
          const realAncestor = fs.realpathSync.native(ancestor);
          canonicalAbsolute = path.resolve(realAncestor, ...segments);
        } catch {
          // Cannot canonicalize.
        }
      }
    }

    if (canonicalAbsolute) {
      const relFromSync = path.relative(realSyncDir, canonicalAbsolute);
      if (!relFromSync.startsWith("..") && !path.isAbsolute(relFromSync)) {
        candidates.push(canonicalAbsolute);
      }
    }
  } else {
    candidates.push(path.resolve(realSyncDir, rel));
    // Scrivener External Folder Sync sometimes stores paths prefixed with
    // "sync/" (the name of the sync folder itself) relative to the project
    // root. Strip that prefix so we can find the file within realSyncDir.
    if (rel === "sync" || rel.startsWith("sync/")) {
      candidates.push(path.resolve(realSyncDir, rel.replace(/^sync\/?/, "")));
    }
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      // Before returning a non-existent path, verify it is still inside realSyncDir.
      // A relative filePath with .. segments could otherwise escape the boundary.
      const relFromSync = path.relative(realSyncDir, candidate);
      if (!relFromSync.startsWith("..") && !path.isAbsolute(relFromSync)) {
        return candidate;
      }
      continue;
    }

    // File exists: validate realpath stays inside syncDir to catch symlink escapes.
    // (For absolute paths this is already canonicalized; for relative paths, verify.)
    try {
      const realCandidate = fs.realpathSync.native(candidate);
      const relReal = path.relative(realSyncDir, realCandidate);
      if (!relReal.startsWith("..") && !path.isAbsolute(relReal)) {
        return realCandidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readProse(filePath, { syncDir } = {}) {
  const resolvedPath = resolveSceneFilePath(filePath, { syncDir });
  if (!resolvedPath) return null;
  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    return matter(raw).content.trim();
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ReviewBundlePlanError(
      "SCENE_PROSE_READ_FAILED",
      `Failed to read scene prose from ${resolvedPath}.`,
      {
        file_path: filePath,
        resolved_path: resolvedPath,
        error_code: errorCode,
        cause: errorMessage,
      }
    );
  }
}

function renderSceneBlock(scene, options) {
  const {
    profile,
    includeSceneIds,
    includeMetadataSidebar,
    includeParagraphAnchors,
  } = options;

  const title = scene.title || scene.scene_id;
  const sceneHeading = includeSceneIds
    ? `## ${escapeMarkdown(title)} (${escapeMarkdown(scene.scene_id)})`
    : `## ${escapeMarkdown(title)}`;

  const parts = [sceneHeading];

  if (profile === "outline_discussion") {
    const summaryParts = [];
    if (scene.pov) summaryParts.push(`POV: ${scene.pov}`);
    if (scene.save_the_cat_beat) summaryParts.push(`Beat: ${scene.save_the_cat_beat}`);
    if (scene.part != null) summaryParts.push(`Part: ${scene.part}`);
    if (scene.chapter != null) summaryParts.push(`Chapter: ${scene.chapter}`);
    if (summaryParts.length > 0) {
      parts.push(`_${escapeMarkdown(summaryParts.join(" | "))}_`);
    }
    if (scene.logline) {
      parts.push(escapeMarkdown(scene.logline.trim()));
    }
    return parts.join("\n\n");
  }

  if (includeMetadataSidebar) {
    const sidebar = [
      scene.part != null ? `part: ${scene.part}` : null,
      scene.chapter != null ? `chapter: ${scene.chapter}` : null,
      scene.timeline_position != null ? `timeline_position: ${scene.timeline_position}` : null,
      scene.pov ? `pov: ${escapeMarkdown(scene.pov)}` : null,
      scene.save_the_cat_beat ? `beat: ${escapeMarkdown(scene.save_the_cat_beat)}` : null,
    ].filter(Boolean);
    if (sidebar.length > 0) {
      parts.push(`> ${sidebar.join("  \\\n> ")}`);
    }
  }

  const prose = scene.prose ?? "";
  if (!includeParagraphAnchors || prose.length === 0) {
    parts.push(prose);
    return parts.join("\n\n");
  }

  const paragraphs = prose
    .split(/\n\s*\n/g)
    .map(p => p.trim())
    .filter(Boolean);
  // Sanitize scene_id for safe embedding in an HTML comment: restrict to
  // alphanumerics, hyphens, underscores, and dots to prevent "-->" or other
  // sequences from prematurely terminating the comment.
  const safeSceneId = scene.scene_id.replace(/[^a-zA-Z0-9\-_.]/g, "_");
  const anchoredParagraphs = paragraphs.map((paragraph, index) => {
    return `<!-- ${safeSceneId}:p${index + 1} -->\n${paragraph}`;
  });
  parts.push(anchoredParagraphs.join("\n\n"));
  return parts.join("\n\n");
}

export function renderReviewBundleMarkdown(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  const profile = plan.profile;
  const includeSceneIds = Boolean(plan.resolved_scope?.options?.include_scene_ids);
  const includeMetadataSidebar = Boolean(plan.resolved_scope?.options?.include_metadata_sidebar);
  const includeParagraphAnchors = Boolean(plan.resolved_scope?.options?.include_paragraph_anchors);
  // Prefer explicitly threaded syncDir; fall back to env.
  // No further fallback: if syncDir is null, resolveSceneFilePath returns null
  // and SCENE_PROSE_READ_FAILED is thrown, making misconfiguration explicit.
  const syncDir = syncDirOpt ?? process.env.WRITING_SYNC_DIR ?? null;

  const sceneIds = plan.ordering.map(row => row.scene_id);
  const rows = loadBundleSceneRows(dbHandle, plan.resolved_scope.project_id, sceneIds);
  const sections = [];
  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const recipientDisplayName = normalizeRecipientDisplayName(recipientName);

  const headerLines = [
    `# Review Bundle: ${escapeMarkdown(plan.resolved_scope.project_id)}`,
    "",
    `- Profile: ${profile}`,
    ...(profile === "beta_reader_personalized"
      ? [`- Recipient: ${escapeMarkdown(recipientDisplayName)}`]
      : []),
    `- Generated at: ${generatedAt ?? new Date().toISOString()}`,
    `- Scene count: ${plan.summary.scene_count}`,
  ];
  sections.push(headerLines.join("\n"));

  if (profile === "beta_reader_personalized") {
    sections.push(
      [
        "## Usage Notice",
        "",
        "This beta-reader draft is intended for private review and feedback.",
        "Please do not redistribute without explicit author permission.",
      ].join("\n")
    );
  }

  for (const scene of rows) {
    let prose = "";
    if (profile === "editor_detailed" || profile === "beta_reader_personalized") {
      const resolved = readProse(scene.file_path, { syncDir });
      if (resolved === null) {
        throw new ReviewBundlePlanError(
          "SCENE_PROSE_READ_FAILED",
          `Scene prose is unavailable for scene ${scene.scene_id}: file_path is null or could not be resolved within syncDir.`,
          {
            scene_id: scene.scene_id,
            file_path: scene.file_path ?? null,
            sync_dir: syncDir,
          }
        );
      }
      prose = resolved;
    }
    const withProse = { ...scene, prose };
    sections.push(renderSceneBlock(withProse, {
      profile,
      includeSceneIds,
      includeMetadataSidebar,
      includeParagraphAnchors,
    }));
  }

  return sections.join("\n\n---\n\n").trim() + "\n";
}

export function renderReviewBundlePdf(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  const profile = plan.profile;
  const includeSceneIds = Boolean(plan.resolved_scope?.options?.include_scene_ids);
  const syncDir = syncDirOpt ?? process.env.WRITING_SYNC_DIR ?? null;

  const sceneIds = plan.ordering.map(row => row.scene_id);
  const rows = loadBundleSceneRows(dbHandle, plan.resolved_scope.project_id, sceneIds);
  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const recipientDisplayName = normalizeRecipientDisplayName(recipientName);

  const doc = new PDFDocument({
    size: "Letter",
    margin: 50,
  });

  // Register listeners before any content is written so render-time errors
  // always reject the returned Promise.
  const chunks = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", fail);
    doc.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    try {
      doc.fontSize(24).font("Helvetica-Bold").text(`Review Bundle: ${plan.resolved_scope.project_id}`, { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica");
      doc.text(`Profile: ${profile}`, { align: "left" });
      if (profile === "beta_reader_personalized") {
        doc.text(`Recipient: ${recipientDisplayName}`, { align: "left" });
      }
      doc.text(`Generated: ${generatedAt ?? new Date().toISOString()}`, { align: "left" });
      doc.text(`Scenes: ${plan.summary.scene_count}`, { align: "left" });
      doc.moveDown();

      if (profile === "beta_reader_personalized") {
        doc.fontSize(12).font("Helvetica-Bold").text("Usage Notice", { align: "left" });
        doc.moveDown(0.3);
        const noticeWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.fontSize(10).font("Helvetica");
        doc.text("This beta-reader draft is intended for private review and feedback. Please do not redistribute without explicit author permission.", {
          align: "left",
          width: noticeWidth,
        });
        doc.moveDown();
      }

      for (const scene of rows) {
        doc.fontSize(14).font("Helvetica-Bold");
        let heading = scene.title || scene.scene_id;
        if (includeSceneIds) {
          heading += ` [${scene.scene_id}]`;
        }
        doc.text(heading, { align: "left" });
        doc.moveDown(0.2);

        const metaParts = [];
        if (scene.pov) metaParts.push(`POV: ${scene.pov}`);
        if (scene.save_the_cat_beat) metaParts.push(`Beat: ${scene.save_the_cat_beat}`);
        if (metaParts.length > 0) {
          const metaWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.fontSize(9).font("Helvetica-Oblique");
          doc.text(metaParts.join(" • "), { align: "left", width: metaWidth });
          doc.font("Helvetica");
          doc.moveDown(0.2);
        }

        if (scene.logline) {
          doc.fontSize(10).font("Helvetica-Oblique");
          const textWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.text(`"${scene.logline}"`, { align: "left", width: textWidth });
          doc.moveDown(0.3);
        }

        if (profile === "editor_detailed" || profile === "beta_reader_personalized") {
          let prose = "";
          const resolved = readProse(scene.file_path, { syncDir });
          if (resolved === null) {
            throw new ReviewBundlePlanError(
              "SCENE_PROSE_READ_FAILED",
              `Scene prose is unavailable for scene ${scene.scene_id}: file_path is null or could not be resolved within syncDir.`,
              {
                scene_id: scene.scene_id,
                file_path: scene.file_path ?? null,
                sync_dir: syncDir,
              }
            );
          }
          prose = resolved;

          const textWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.fontSize(10).font("Helvetica");
          doc.text(prose, {
            align: "left",
            width: textWidth,
            lineGap: 3,
          });
        }

        doc.moveDown(0.5);
        // Add page break between scenes only for prose-including profiles where
        // clear scene separation matters. For outline_discussion, let content flow.
        const includesProse = profile === "editor_detailed" || profile === "beta_reader_personalized";
        if (includesProse && scene !== rows[rows.length - 1]) {
          doc.addPage();
        }
      }

      doc.end();
    } catch (error) {
      fail(error);
      try {
        doc.end();
      } catch {
        // Ignore errors from end() during failure cleanup.
      }
    }
  });
}

export { renderBetaNoticeMarkdown, renderBetaFeedbackFormMarkdown };
