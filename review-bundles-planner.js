const MAX_SORT_VALUE = Number.MAX_SAFE_INTEGER;

export const REVIEW_BUNDLE_PROFILES = ["outline_discussion", "editor_detailed", "beta_reader_personalized"];
export const REVIEW_BUNDLE_STRICTNESS = ["warn", "fail"];
export const REVIEW_BUNDLE_FORMATS = ["pdf", "markdown", "both"];

export class ReviewBundlePlanError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReviewBundlePlanError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeRecipientDisplayName(recipientName) {
  const normalized = String(recipientName ?? "")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return normalized || "Beta Reader";
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
