import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

function loadBundleSceneRowsWithTags(dbHandle, projectId, sceneIds) {
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
        chapter_title,
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

  const orderedRows = [];
  const missingSceneIds = [];

  // Load tags in batches to avoid N+1 queries for large bundles.
  const tagsBySceneId = new Map(rows.map(row => [row.scene_id, []]));
  const tagChunkSize = 900;
  for (let offset = 0; offset < rows.length; offset += tagChunkSize) {
    const chunk = rows.slice(offset, offset + tagChunkSize);
    const chunkSceneIds = chunk.map(row => row.scene_id);
    if (chunkSceneIds.length === 0) continue;
    const placeholders = chunkSceneIds.map(() => "?").join(",");
    const tagRows = dbHandle.prepare(`
      SELECT scene_id, tag
      FROM scene_tags
      WHERE project_id = ? AND scene_id IN (${placeholders})
    `).all(projectId, ...chunkSceneIds);
    for (const tagRow of tagRows) {
      const tags = tagsBySceneId.get(tagRow.scene_id);
      if (tags) tags.push(tagRow.tag);
    }
  }

  const rowsWithTags = rows.map(row => ({
    ...row,
    tags: tagsBySceneId.get(row.scene_id) ?? [],
  }));
  const rowMapWithTags = new Map(rowsWithTags.map(row => [row.scene_id, row]));

  for (const sceneId of sceneIds) {
    const row = rowMapWithTags.get(sceneId);
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

function normalizeHardWrappedProse(rawProse) {
  const prose = String(rawProse ?? "").replace(/\r\n?/g, "\n").trim();
  if (!prose) return "";
  const paragraphs = prose
    .split(/\n\s*\n/g)
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return paragraphs.join("\n\n");
}

function extractSceneDateline(prose) {
  const normalized = String(prose ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return { dateline: null, body: "" };
  }

  const lines = normalized
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { dateline: null, body: "" };
  }

  const firstParagraph = lines[0];
  const dashMatch = firstParagraph.match(/^(.+?)\s*[–-]\s*(.+)$/);
  const left = dashMatch?.[1]?.trim() ?? "";
  const right = dashMatch?.[2]?.trim() ?? "";
  const totalWords = firstParagraph.split(/\s+/).filter(Boolean).length;
  const looksLikeDateline = (
    firstParagraph.length >= 6
    && firstParagraph.length <= 90
    && Boolean(dashMatch)
    && left.length >= 2
    && right.length >= 2
    && totalWords <= 14
    && !/[!?]/.test(firstParagraph)
    && !/[“”"']/.test(firstParagraph)
  );

  if (!looksLikeDateline) {
    return { dateline: null, body: normalized };
  }

  return {
    dateline: firstParagraph,
    body: lines.slice(1).join("\n"),
  };
}

function normalizeBetaProseFlow(prose) {
  const normalized = String(prose ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map(paragraph => paragraph
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .join("\n"))
    .filter(Boolean);
  // For beta exports, convert paragraph blocks into regular line breaks so the
  // reading flow stays continuous without large section gaps.
  return paragraphs.join("\n");
}

function normalizeBetaTypography(prose) {
  return String(prose ?? "")
    .replace(/(^|\s)--(\s|$)/g, "$1—$2");
}

function renderProseWithInlineEmphasis(doc, prose, {
  bodyFont,
  italicFont,
  fontSize,
  width,
  align = "left",
  lineGap = 0,
  paragraphGap = 0,
  blankLineMoveDown = 0.15,
}) {
  const lines = String(prose ?? "").split("\n");
  for (const line of lines) {
    if (line.length === 0) {
      doc.moveDown(blankLineMoveDown);
      continue;
    }

    if (line.trim() === "***") {
      doc.moveDown(0.5);
      doc.fontSize(fontSize).font(bodyFont);
      doc.text("***", { align: "center", width, lineGap, paragraphGap: 0 });
      doc.moveDown(0.5);
      continue;
    }

    const segments = line.split(/(\*[^*\n]+\*)/g).filter(Boolean);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isItalic = /^\*[^*\n]+\*$/.test(segment);
      const text = isItalic ? segment.slice(1, -1) : segment;
      if (!text) continue;
      doc.fontSize(fontSize).font(isItalic ? italicFont : bodyFont);
      doc.text(text, {
        align,
        width,
        lineGap,
        paragraphGap,
        continued: index < segments.length - 1,
      });
    }
  }
  doc.font(bodyFont).fontSize(fontSize);
}

function renderSceneBlock(scene, options) {
  const {
    profile,
    includeSceneIds,
    includeMetadataSidebar,
    includeParagraphAnchors,
    showChapterHeading,
  } = options;

  const isBetaProfile = profile === "beta_reader_personalized";
  const isEpigraph = isBetaProfile && scene.tags?.includes("epigraph");

  const parts = [];

  // Render chapter heading only when the caller detects a chapter transition.
  if (isBetaProfile && scene.chapter_title && showChapterHeading) {
    parts.push(`## ${escapeMarkdown(scene.chapter_title)}`);
  }

  // Only render heading if not an epigraph
  if (!isEpigraph) {
    const title = scene.title || scene.scene_id;
    const sceneHeading = includeSceneIds
      ? `## ${escapeMarkdown(title)} (${escapeMarkdown(scene.scene_id)})`
      : `## ${escapeMarkdown(title)}`;
    parts.push(sceneHeading);
  }

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
    parts.push(normalizeHardWrappedProse(prose));
    return parts.join("\n\n");
  }

  const paragraphs = normalizeHardWrappedProse(prose)
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

function normalizeFingerprintFilters(filters) {
  const normalized = { ...(filters ?? {}) };
  if (Array.isArray(normalized.scene_ids)) {
    normalized.scene_ids = [...new Set(normalized.scene_ids.map(sceneId => String(sceneId)))].sort();
  }
  return normalized;
}

function stableSerializeForFingerprint(value) {
  if (Array.isArray(value)) {
    return value.map(item => stableSerializeForFingerprint(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableSerializeForFingerprint(value[key]);
        return result;
      }, {});
  }
  return value;
}

function buildFingerprintSeed(plan, generatedAt, recipientDisplayName) {
  const base = {
    project_id: plan.resolved_scope?.project_id ?? "",
    profile: plan.profile ?? "",
    recipient_name: recipientDisplayName ?? "",
    filters: normalizeFingerprintFilters(plan.resolved_scope?.filters),
    scene_ids: (plan.ordering ?? []).map(row => row.scene_id),
    generated_at: generatedAt ?? "",
  };
  return JSON.stringify(stableSerializeForFingerprint(base));
}

function buildFingerprintSeedHash(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}

function buildPageFingerprintToken({ seedHash, pageNumber }) {
  const digest = crypto
    .createHash("sha256")
    .update(`${seedHash}|page:${pageNumber}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `BR-${digest}-P${String(pageNumber).padStart(3, "0")}`;
}

function sanitizeFooterRecipientDisplayName(recipientDisplayName) {
  return String(recipientDisplayName ?? "").replaceAll("|", "/");
}

export function renderReviewBundleMarkdown(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  const profile = plan.profile;
  const isBetaProfile = profile === "beta_reader_personalized";
  const includeSceneIds = isBetaProfile ? false : Boolean(plan.resolved_scope?.options?.include_scene_ids);
  const includeMetadataSidebar = isBetaProfile ? false : Boolean(plan.resolved_scope?.options?.include_metadata_sidebar);
  const includeParagraphAnchors = isBetaProfile ? false : Boolean(plan.resolved_scope?.options?.include_paragraph_anchors);
  // Prefer explicitly threaded syncDir; fall back to env.
  // No further fallback: if syncDir is null, resolveSceneFilePath returns null
  // and SCENE_PROSE_READ_FAILED is thrown, making misconfiguration explicit.
  const syncDir = syncDirOpt ?? process.env.WRITING_SYNC_DIR ?? null;

  const sceneIds = plan.ordering.map(row => row.scene_id);
  const rows = loadBundleSceneRowsWithTags(dbHandle, plan.resolved_scope.project_id, sceneIds);
  const sections = [];
  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const recipientDisplayName = normalizeRecipientDisplayName(recipientName);

  const headerLines = [
    `# Review Bundle: ${escapeMarkdown(plan.resolved_scope.project_id)}`,
    "",
    ...(profile !== "beta_reader_personalized" ? [`- Profile: ${profile}`] : []),
    ...(profile === "beta_reader_personalized"
      ? [`- Recipient: ${escapeMarkdown(recipientDisplayName)}`]
      : []),
    ...(profile !== "beta_reader_personalized"
      ? [`- Generated at: ${generatedAt ?? new Date().toISOString()}`, `- Scene count: ${plan.summary.scene_count}`]
      : []),
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

  for (let sceneIndex = 0; sceneIndex < rows.length; sceneIndex += 1) {
    const scene = rows[sceneIndex];
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
    const prevScene = sceneIndex > 0 ? rows[sceneIndex - 1] : null;
    const showChapterHeading = isBetaProfile
      && Boolean(scene.chapter_title)
      && (!prevScene || prevScene.chapter !== scene.chapter);
    sections.push(renderSceneBlock(withProse, {
      profile,
      includeSceneIds,
      includeMetadataSidebar,
      includeParagraphAnchors,
      showChapterHeading,
    }));
  }

  return sections.join("\n\n---\n\n").trim() + "\n";
}

export function renderReviewBundlePdf(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  return renderReviewBundlePdfWithMetadata(dbHandle, plan, { generatedAt, syncDir: syncDirOpt })
    .then(result => result.pdf_buffer);
}

export function renderReviewBundlePdfWithMetadata(dbHandle, plan, { generatedAt, syncDir: syncDirOpt } = {}) {
  const profile = plan.profile;
  const includeSceneIds = profile === "beta_reader_personalized"
    ? false
    : Boolean(plan.resolved_scope?.options?.include_scene_ids);
  const syncDir = syncDirOpt ?? process.env.WRITING_SYNC_DIR ?? null;
  const isBetaProfile = profile === "beta_reader_personalized";
  const proseFontSize = isBetaProfile ? 8 : 10;
  const proseLineGap = isBetaProfile ? 1.6 : 3;
  const bodyFont = profile === "beta_reader_personalized" ? "Times-Roman" : "Helvetica";
  const coverHeadingFont = profile === "beta_reader_personalized" ? "Times-Bold" : "Helvetica-Bold";
  // Beta scene headings intentionally use body font (non-bold) per product direction.
  const sceneHeadingFont = isBetaProfile ? bodyFont : coverHeadingFont;
  const italicFont = profile === "beta_reader_personalized" ? "Times-Italic" : "Helvetica-Oblique";
  const metaFont = italicFont;

  const sceneIds = plan.ordering.map(row => row.scene_id);
  const rows = loadBundleSceneRowsWithTags(dbHandle, plan.resolved_scope.project_id, sceneIds);
  const recipientName = plan.resolved_scope?.options?.recipient_name;
  const recipientDisplayName = normalizeRecipientDisplayName(recipientName);
  const footerRecipientDisplayName = sanitizeFooterRecipientDisplayName(recipientDisplayName);
  const betaAccountabilityEnabled = profile === "beta_reader_personalized"
    && Boolean(plan.resolved_scope?.options?.beta_accountability);
  const effectiveGeneratedAt = generatedAt ?? new Date().toISOString();
  const fingerprintSeed = betaAccountabilityEnabled
    ? buildFingerprintSeed(plan, effectiveGeneratedAt, recipientDisplayName)
    : null;
  const fingerprintSeedHash = fingerprintSeed ? buildFingerprintSeedHash(fingerprintSeed) : null;
  const pageTokens = [];
  let pageNumber = 0;

  const pdfOptions = profile === "beta_reader_personalized"
    ? {
        size: [432, 648], // 6x9in in PDF points
        // Extra bottom margin reserves clear space above the accountability footer.
        margins: { top: 64, right: 58, bottom: 96, left: 58 },
        autoFirstPage: false,
      }
    : {
        size: "Letter",
        margin: 50,
        autoFirstPage: false,
      };
  const doc = new PDFDocument({
    ...pdfOptions,
  });

  const drawAccountabilityFooter = () => {
    if (!betaAccountabilityEnabled || !fingerprintSeedHash) return;
    const previousX = doc.x;
    const previousY = doc.y;
    pageNumber += 1;
    const token = buildPageFingerprintToken({
      seedHash: fingerprintSeedHash,
      pageNumber,
    });
    pageTokens.push({ page: pageNumber, token });
    const footerY = doc.page.height - 42;
    const footerText = `For: ${footerRecipientDisplayName} | Fingerprint: ${token}`;
    const pageNumberText = String(pageNumber);
    doc.save();
    doc.font("Times-Roman").fontSize(8).fillColor("#555555");
    // Draw footer in no-wrap mode to avoid layout flow side effects.
    doc.text(footerText, doc.page.margins.left, footerY, { lineBreak: false });
    const pageNumberWidth = doc.widthOfString(pageNumberText);
    const pageNumberX = (doc.page.width - pageNumberWidth) / 2;
    doc.text(pageNumberText, pageNumberX, doc.page.height - 24, { lineBreak: false });
    doc.restore();
    // Restore prose style so auto-flowed text keeps consistent typography
    // on pages added during long text rendering.
    doc.font(bodyFont).fontSize(proseFontSize).fillColor("#000000");
    doc.x = previousX;
    doc.y = previousY;
  };
  doc.on("pageAdded", drawAccountabilityFooter);

  // Register listeners before any content is written so render-time errors
  // always reject the returned Promise.
  return new Promise((resolve, reject) => {
    const chunks = [];
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
      resolve({
        pdf_buffer: Buffer.concat(chunks),
        fingerprint: betaAccountabilityEnabled
          ? {
              mode: "visible_footer",
              recipient_display_name: recipientDisplayName,
              page_tokens: pageTokens,
            }
          : null,
      });
    });

    try {
      doc.addPage();
      const coverLabel = `Review Bundle: ${plan.resolved_scope.project_id}`;
      doc.fontSize(isBetaProfile ? 11 : 24).font(coverHeadingFont).text(coverLabel, { align: "left" });
      doc.moveDown(isBetaProfile ? 0.2 : 0.5);
      doc.fontSize(11).font(bodyFont);
      if (profile !== "beta_reader_personalized") {
        doc.text(`Profile: ${profile}`, { align: "left" });
      }
      if (profile === "beta_reader_personalized") {
        doc.text(`Recipient: ${recipientDisplayName}`, { align: "left" });
      } else {
        doc.text(`Generated: ${effectiveGeneratedAt}`, { align: "left" });
        doc.text(`Scenes: ${plan.summary.scene_count}`, { align: "left" });
      }
      doc.moveDown();

      if (profile === "beta_reader_personalized") {
        doc.fontSize(12).font("Times-Bold").text("Usage Notice", { align: "left" });
        doc.moveDown(0.3);
        const noticeWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.fontSize(10).font("Times-Roman");
        doc.text("This beta-reader draft is intended for private review and feedback. Please do not redistribute without explicit author permission.", {
          align: "left",
          width: noticeWidth,
        });
        doc.moveDown();
      }

      for (let sceneIndex = 0; sceneIndex < rows.length; sceneIndex += 1) {
        const scene = rows[sceneIndex];
        const prevScene = sceneIndex > 0 ? rows[sceneIndex - 1] : null;
        if (isBetaProfile) {
          // Give chapter titles generous vertical breathing room for a
          // print-like opening feel before prose begins.
          doc.moveDown(2.0);
        }
        if (isBetaProfile && scene.chapter_title && (!prevScene || prevScene.chapter !== scene.chapter)) {
          doc.fontSize(16).font(coverHeadingFont);
          doc.text(scene.chapter_title, { align: "center" });
          doc.moveDown(1.0);
        }

        // Skip title rendering for epigraphs in beta profile
        const isEpigraph = isBetaProfile && scene.tags?.includes("epigraph");
        if (!isEpigraph) {
          doc.fontSize(isBetaProfile ? 13 : 14).font(sceneHeadingFont);
          let heading = scene.title || scene.scene_id;
          if (includeSceneIds) {
            heading += ` [${scene.scene_id}]`;
          }
          doc.text(heading, { align: isBetaProfile ? "center" : "left" });
          doc.moveDown(isBetaProfile ? 1.6 : 0.2);
        }

        const metaParts = [];
        if (profile !== "beta_reader_personalized") {
          if (scene.pov) metaParts.push(`POV: ${scene.pov}`);
          if (scene.save_the_cat_beat) metaParts.push(`Beat: ${scene.save_the_cat_beat}`);
        }
        if (metaParts.length > 0) {
          const metaWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.fontSize(9).font(metaFont);
          doc.text(metaParts.join(" • "), { align: "left", width: metaWidth });
          doc.font(bodyFont);
          doc.moveDown(0.2);
        }

        if (profile === "outline_discussion" && scene.logline) {
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
          let sceneDateline = null;
          if (isBetaProfile) {
            prose = normalizeBetaProseFlow(resolved);
            const extracted = extractSceneDateline(prose);
            sceneDateline = extracted.dateline ? normalizeBetaTypography(extracted.dateline) : null;
            prose = normalizeBetaTypography(extracted.body);
          } else {
            prose = normalizeHardWrappedProse(resolved);
          }

          if (sceneDateline) {
            doc.fontSize(10).font(metaFont);
            doc.text(sceneDateline, {
              align: "center",
              width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            });
            doc.moveDown(1.0);
          }

          const textWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          renderProseWithInlineEmphasis(doc, prose, {
            bodyFont,
            italicFont,
            fontSize: proseFontSize,
            align: "left",
            width: textWidth,
            lineGap: proseLineGap,
            paragraphGap: 0,
            blankLineMoveDown: isBetaProfile ? 0.15 : 0.65,
          });
        }

        doc.moveDown(0.5);
        // Add page break between scenes only for prose-including profiles where
        // clear scene separation matters. For outline_discussion, let content flow.
        const includesProse = profile === "editor_detailed" || profile === "beta_reader_personalized";
        if (includesProse && sceneIndex < rows.length - 1) {
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

export {
  renderBetaNoticeMarkdown,
  renderBetaFeedbackFormMarkdown,
  buildPageFingerprintToken,
  buildFingerprintSeed,
  buildFingerprintSeedHash,
  extractSceneDateline,
};
