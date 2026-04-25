import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import PDFDocument from "pdfkit";

const MAX_SORT_VALUE = Number.MAX_SAFE_INTEGER;

export const REVIEW_BUNDLE_PROFILES = ["outline_discussion", "editor_detailed", "beta_reader_personalized"];
export const REVIEW_BUNDLE_STRICTNESS = ["warn", "fail"];

export class ReviewBundlePlanError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReviewBundlePlanError";
    this.code = code;
    this.details = details;
  }
}

function normalizeSortNumber(value) {
  return Number.isInteger(value) ? value : MAX_SORT_VALUE;
}

function sceneSort(a, b) {
  const partDiff = normalizeSortNumber(a.part) - normalizeSortNumber(b.part);
  if (partDiff !== 0) return partDiff;

  const chapterDiff = normalizeSortNumber(a.chapter) - normalizeSortNumber(b.chapter);
  if (chapterDiff !== 0) return chapterDiff;

  const timelineDiff = normalizeSortNumber(a.timeline_position) - normalizeSortNumber(b.timeline_position);
  if (timelineDiff !== 0) return timelineDiff;

  return String(a.scene_id).localeCompare(String(b.scene_id));
}

function buildWarningSummary(warnings) {
  const summary = {};
  for (const warning of warnings) {
    const type = warning.type ?? "unknown";
    if (!summary[type]) {
      summary[type] = { count: 0, examples: [] };
    }
    summary[type].count += 1;
    if (summary[type].examples.length < 5) {
      summary[type].examples.push(warning.message);
    }
  }
  return summary;
}

function slugifyBundleName(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "review-bundle";
}

function escapeMarkdown(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_`\[\]#])/g, "\\$1");
}

function normalizeRecipientDisplayName(recipientName) {
  const normalized = String(recipientName ?? "")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return normalized || "Beta Reader";
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

function assertProfile(profile) {
  if (!REVIEW_BUNDLE_PROFILES.includes(profile)) {
    throw new ReviewBundlePlanError(
      "INVALID_PROFILE",
      `Unsupported review bundle profile '${profile}'.`,
      { supported_profiles: REVIEW_BUNDLE_PROFILES }
    );
  }
}

function assertStrictness(strictness) {
  if (!REVIEW_BUNDLE_STRICTNESS.includes(strictness)) {
    throw new ReviewBundlePlanError(
      "INVALID_STRICTNESS",
      `Unsupported strictness '${strictness}'.`,
      { supported_strictness: REVIEW_BUNDLE_STRICTNESS }
    );
  }
}

export const REVIEW_BUNDLE_FORMATS = ["pdf", "markdown", "both"];

function assertFormat(format) {
  if (!REVIEW_BUNDLE_FORMATS.includes(format)) {
    throw new ReviewBundlePlanError(
      "INVALID_FORMAT",
      `Unsupported format '${format}'.`,
      { supported_formats: REVIEW_BUNDLE_FORMATS }
    );
  }
}

function resolveRequestedSceneIds(dbHandle, projectId, sceneIds) {
  if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
    return { requested: [], existing: new Set() };
  }

  const placeholders = sceneIds.map(() => "?").join(",");
  const rows = dbHandle.prepare(
    `SELECT scene_id FROM scenes WHERE project_id = ? AND scene_id IN (${placeholders})`
  ).all(projectId, ...sceneIds);

  return {
    requested: sceneIds,
    existing: new Set(rows.map(row => row.scene_id)),
  };
}

export function buildReviewBundlePlan(dbHandle, {
  project_id,
  profile,
  part,
  chapter,
  tag,
  scene_ids,
  strictness = "warn",
  include_scene_ids = true,
  include_metadata_sidebar = false,
  include_paragraph_anchors = false,
  bundle_name,
  recipient_name,
  format = "pdf",
} = {}) {
  if (!project_id) {
    throw new ReviewBundlePlanError("INVALID_PROJECT_ID", "project_id is required.");
  }

  assertProfile(profile);
  assertStrictness(strictness);
  assertFormat(format);

  const projectRow = dbHandle.prepare(`SELECT project_id FROM projects WHERE project_id = ?`).get(project_id);
  if (!projectRow) {
    throw new ReviewBundlePlanError("NOT_FOUND", `Project '${project_id}' not found.`);
  }

  const requestedSceneIds = resolveRequestedSceneIds(dbHandle, project_id, scene_ids);
  const conditions = ["s.project_id = ?"];
  const params = [project_id];
  const joins = [];

  if (tag) {
    joins.push("JOIN scene_tags st ON st.scene_id = s.scene_id AND st.tag = ?");
    params.push(tag);
  }
  if (Array.isArray(scene_ids) && scene_ids.length > 0) {
    const placeholders = scene_ids.map(() => "?").join(",");
    conditions.push(`s.scene_id IN (${placeholders})`);
    params.push(...scene_ids);
  }
  if (part !== undefined) {
    conditions.push("s.part = ?");
    params.push(part);
  }
  if (chapter !== undefined) {
    conditions.push("s.chapter = ?");
    params.push(chapter);
  }

  let query = `
    SELECT DISTINCT
      s.scene_id,
      s.project_id,
      s.title,
      s.part,
      s.chapter,
      s.timeline_position,
      s.word_count,
      s.logline,
      s.pov,
      s.save_the_cat_beat,
      s.metadata_stale
    FROM scenes s
  `;

  if (joins.length > 0) {
    query += ` ${joins.join(" ")}`;
  }
  query += ` WHERE ${conditions.join(" AND ")}`;

  const rows = dbHandle.prepare(query).all(...params).sort(sceneSort);
  if (rows.length === 0) {
    throw new ReviewBundlePlanError(
      "NO_RESULTS",
      "No scenes matched the requested review bundle scope.",
      {
        project_id,
        filters: {
          ...(part !== undefined ? { part } : {}),
          ...(chapter !== undefined ? { chapter } : {}),
          ...(tag ? { tag } : {}),
          ...(Array.isArray(scene_ids) ? { scene_ids } : {}),
        },
      }
    );
  }

  const includedSceneIds = new Set(rows.map(row => row.scene_id));
  const excludedSceneIds = requestedSceneIds.requested.filter(sceneId => !includedSceneIds.has(sceneId));
  const notFoundSceneIds = requestedSceneIds.requested.filter(sceneId => !requestedSceneIds.existing.has(sceneId));
  const filteredOutSceneIds = excludedSceneIds.filter(sceneId => requestedSceneIds.existing.has(sceneId));

  const warnings = [];

  if (notFoundSceneIds.length > 0) {
    warnings.push({
      type: "requested_scene_ids_not_found",
      message: `${notFoundSceneIds.length} requested scene_id value(s) do not exist in project '${project_id}'.`,
      scene_ids: notFoundSceneIds,
    });
  }

  if (filteredOutSceneIds.length > 0) {
    warnings.push({
      type: "requested_scene_ids_filtered_out",
      message: `${filteredOutSceneIds.length} requested scene_id value(s) were excluded by additional filters.`,
      scene_ids: filteredOutSceneIds,
    });
  }

  const staleRows = rows.filter(row => Number(row.metadata_stale) === 1);
  if (staleRows.length > 0) {
    warnings.push({
      type: "metadata_stale",
      message: `${staleRows.length} scene(s) have stale metadata and may need re-enrichment before editorial use.`,
      count: staleRows.length,
    });
  }

  const missingOrderingRows = rows.filter(
    row => row.part == null || row.chapter == null || row.timeline_position == null
  );
  if (missingOrderingRows.length > 0) {
    warnings.push({
      type: "missing_ordering_fields",
      message: `${missingOrderingRows.length} scene(s) are missing part/chapter/timeline_position metadata; fallback ordering was applied.`,
      count: missingOrderingRows.length,
    });
  }

  const missingWordCountRows = rows.filter(row => row.word_count == null);
  if (missingWordCountRows.length > 0) {
    warnings.push({
      type: "missing_word_count",
      message: `${missingWordCountRows.length} scene(s) are missing word_count; estimated_word_count may be low.`,
      count: missingWordCountRows.length,
    });
  }

  const blockers = [];
  if (strictness === "fail" && staleRows.length > 0) {
    blockers.push({
      code: "STALE_METADATA",
      message: `${staleRows.length} scene(s) are marked metadata_stale.`,
      scene_ids: staleRows.map(row => row.scene_id),
    });
  }

  const estimatedWordCount = rows.reduce((sum, row) => {
    const count = Number(row.word_count);
    return sum + (Number.isFinite(count) ? count : 0);
  }, 0);
  const resolvedRecipientName = profile === "beta_reader_personalized"
    ? normalizeRecipientDisplayName(recipient_name)
    : undefined;

  const safeBundleName = slugifyBundleName(bundle_name || `${project_id}-${profile}`);
  const appliedFilters = {
    ...(part !== undefined ? { part } : {}),
    ...(chapter !== undefined ? { chapter } : {}),
    ...(tag ? { tag } : {}),
    ...(Array.isArray(scene_ids) ? { scene_ids } : {}),
  };

  return {
    ok: true,
    profile,
    resolved_scope: {
      project_id,
      filters: appliedFilters,
      options: {
        include_scene_ids: Boolean(include_scene_ids),
        include_metadata_sidebar: Boolean(include_metadata_sidebar),
        include_paragraph_anchors: Boolean(include_paragraph_anchors),
        ...(resolvedRecipientName ? { recipient_name: resolvedRecipientName } : {}),
      },
    },
    ordering: rows.map(row => ({
      scene_id: row.scene_id,
      project_id: row.project_id,
      title: row.title,
      part: row.part,
      chapter: row.chapter,
      timeline_position: row.timeline_position,
      metadata_stale: Number(row.metadata_stale) === 1,
    })),
    summary: {
      scene_count: rows.length,
      estimated_word_count: estimatedWordCount,
      excluded_scene_ids: excludedSceneIds,
    },
    warnings,
    warning_summary: buildWarningSummary(warnings),
    strictness_result: {
      strictness,
      can_proceed: blockers.length === 0,
      blockers,
    },
    planned_outputs: [
      ...(format === "markdown" || format === "both" ? [`${safeBundleName}.md`] : []),
      ...(format === "pdf" || format === "both" ? [`${safeBundleName}.pdf`] : []),
      ...(profile === "beta_reader_personalized"
        ? [
            `${safeBundleName}.notice.md`,
            `${safeBundleName}.feedback-form.md`,
          ]
        : []),
      `${safeBundleName}.manifest.json`,
    ],
  };
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
  // Prefer explicitly threaded syncDir; fall back to env (with "./sync" default matching index.js).
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

/**
 * Render a review bundle plan to PDF format using pdfkit.
 * Returns a buffer containing the PDF document.
 */
export function renderReviewBundlePdf(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  const profile = plan.profile;
  const includeSceneIds = Boolean(plan.resolved_scope?.options?.include_scene_ids);
  const syncDir = syncDirOpt ?? process.env.WRITING_SYNC_DIR ?? null;

  const sceneIds = plan.ordering.map(row => row.scene_id);
  const rows = loadBundleSceneRows(dbHandle, plan.resolved_scope.project_id, sceneIds);
  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const recipientDisplayName = normalizeRecipientDisplayName(recipientName);

  // Create PDF document in memory (we'll pipe to buffer)
  const doc = new PDFDocument({
    size: "Letter",
    margin: 50,
    bufferPages: true,
  });

  // Collect all pages in a buffer
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));

  // Title and metadata
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

  // Usage notice for beta profile
  if (profile === "beta_reader_personalized") {
    doc.fontSize(12).font("Helvetica-Bold").text("Usage Notice", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    doc.text("This beta-reader draft is intended for private review and feedback. Please do not redistribute without explicit author permission.", {
      align: "left",
      width: 495,
    });
    doc.moveDown();
  }

  // Render scenes
  for (const scene of rows) {
    // Scene heading
    doc.fontSize(14).font("Helvetica-Bold");
    let heading = scene.title || scene.scene_id;
    if (includeSceneIds) {
      heading += ` [${scene.scene_id}]`;
    }
    doc.text(heading, { align: "left" });
    doc.moveDown(0.2);

    // Scene metadata (one-liner)
    const metaParts = [];
    if (scene.pov) metaParts.push(`POV: ${scene.pov}`);
    if (scene.save_the_cat_beat) metaParts.push(`Beat: ${scene.save_the_cat_beat}`);
    if (metaParts.length > 0) {
      doc.fontSize(9).font("Helvetica-Oblique");
      doc.text(metaParts.join(" • "), { align: "left" });
      doc.font("Helvetica");
      doc.moveDown(0.2);
    }

    // Logline
    if (scene.logline) {
      doc.fontSize(10).font("Helvetica-Oblique");
      doc.text(`"${scene.logline}"`, { align: "left", width: 495 });
      doc.moveDown(0.3);
    }

    // Prose (only for detailed/beta profiles)
    if (profile === "editor_detailed" || profile === "beta_reader_personalized") {
      let prose = "";
      const resolved = readProse(scene.file_path, { syncDir });
      if (resolved === null) {
        prose = "[Scene prose unavailable]";
      } else {
        prose = resolved;
      }

      doc.fontSize(10).font("Helvetica");
      doc.text(prose, {
        align: "left",
        width: 495,
        lineGap: 3,
      });
    }

    doc.moveDown(0.5);
    // Add page break if not on last scene
    if (scene !== rows[rows.length - 1]) {
      doc.addPage();
    }
  }

  // Attach listeners before doc.end() to avoid missing early events
  return new Promise((resolve, reject) => {
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);
    doc.end();
  });
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
  
  // Render markdown if needed
  const markdown = markdownPath ? renderReviewBundleMarkdown(dbHandle, plan, { generatedAt, syncDir }) : null;
  
  // Render PDF if needed
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
  
  // Use the bundle ID from whichever primary file exists
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