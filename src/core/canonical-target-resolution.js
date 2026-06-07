import { isNearMatch, normalizeMatchValue } from "./match-utils.js";

const DEFAULT_CANDIDATE_LIMIT = 5;
const HARD_CANDIDATE_LIMIT = 10;

const MATCH_GROUP_ORDER = new Map([
  ["exact_id", 0],
  ["case_insensitive_id", 1],
  ["case_insensitive_name", 2],
  ["case_insensitive_title", 2],
  ["near_match_suggestion", 3],
]);

function clampCandidateLimit(candidateLimit) {
  if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) {
    return DEFAULT_CANDIDATE_LIMIT;
  }
  return Math.min(candidateLimit, HARD_CANDIDATE_LIMIT);
}

function getProjectUniverseId(db, projectId) {
  return db.prepare(`SELECT universe_id FROM projects WHERE project_id = ?`).get(projectId)?.universe_id ?? null;
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const groupDelta = (MATCH_GROUP_ORDER.get(left.match_type) ?? 99) - (MATCH_GROUP_ORDER.get(right.match_type) ?? 99);
    if (groupDelta !== 0) return groupDelta;

    const labelDelta = normalizeMatchValue(left.label).localeCompare(normalizeMatchValue(right.label));
    if (labelDelta !== 0) return labelDelta;

    return left.id.localeCompare(right.id);
  });
}

function capCandidates(candidates, candidateLimit) {
  return sortCandidates(candidates).slice(0, clampCandidateLimit(candidateLimit));
}

function formatSceneCandidate(row, { matchedField, matchType }) {
  return {
    target_kind: "scene",
    id: row.scene_id,
    label: row.title || row.scene_id,
    matched_field: matchedField,
    match_type: matchType,
    project_id: row.project_id,
    context: {
      project_id: row.project_id,
      title: row.title ?? null,
      chapter_id: row.chapter_id ?? null,
      chapter_title: row.chapter_title ?? null,
      timeline_position: row.timeline_position ?? null,
    },
  };
}

function formatCharacterCandidate(row, { matchedField, matchType }) {
  return {
    target_kind: "character",
    id: row.character_id,
    label: row.name || row.character_id,
    matched_field: matchedField,
    match_type: matchType,
    project_id: row.project_id ?? null,
    universe_id: row.universe_id ?? null,
    context: {
      role: row.role ?? null,
      first_appearance: row.first_appearance ?? null,
    },
  };
}

function formatPlaceCandidate(row, { matchedField, matchType }) {
  return {
    target_kind: "place",
    id: row.place_id,
    label: row.name || row.place_id,
    matched_field: matchedField,
    match_type: matchType,
    project_id: row.project_id ?? null,
    universe_id: row.universe_id ?? null,
  };
}

function buildResolvedFrom(argumentName, input, candidate) {
  if (candidate.match_type === "exact_id") return undefined;
  return {
    [argumentName]: {
      input,
      matched_field: candidate.matched_field,
      match_type: candidate.match_type,
      id: candidate.id,
    },
  };
}

function nextStepForTargetKind(targetKind) {
  if (targetKind === "scene") {
    return "Use find_scenes with project_id to identify the canonical scene_id, then retry with the stable ID.";
  }
  if (targetKind === "character") {
    return "Use list_characters to inspect candidate character_id values for this project or universe, then retry with the stable ID.";
  }
  return "Use list_places to inspect candidate place_id values for this project or universe, then retry with the stable ID.";
}

function buildResolutionFailure({ targetKind, input, projectId, universeId, candidates, candidateLimit }) {
  const cappedCandidates = capCandidates(candidates, candidateLimit);
  const details = {
    lookup_kind: targetKind,
    target_kind: targetKind,
    input,
    project_id: projectId,
    ...(universeId !== undefined ? { universe_id: universeId } : {}),
    candidate_matches: cappedCandidates,
    next_step: nextStepForTargetKind(targetKind),
  };

  if (candidates.some(candidate => candidate.match_type !== "near_match_suggestion")) {
    return {
      ok: false,
      error: {
        code: "AMBIGUOUS_TARGET",
        message: `${targetKind} '${input}' resolves to multiple canonical targets. Use a stable canonical ID.`,
        details,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: `${targetKind} '${input}' was not found in the provided scope.`,
      details,
    },
  };
}

function buildSuccess({ targetKind, input, argumentName, row, candidate, idField, rowField }) {
  const resolvedFrom = buildResolvedFrom(argumentName, input, candidate);
  return {
    ok: true,
    target_kind: targetKind,
    id: candidate.id,
    [idField]: candidate.id,
    [rowField]: row,
    canonical: candidate.match_type === "exact_id",
    match: {
      matched_field: candidate.matched_field,
      match_type: candidate.match_type,
      id: candidate.id,
    },
    ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
  };
}

function resolveFromRows({
  rows,
  input,
  targetKind,
  idField,
  nameField,
  nameMatchType,
  argumentName,
  projectId,
  universeId,
  candidateLimit,
  formatCandidate,
}) {
  const normalizedInput = normalizeMatchValue(input);
  if (!normalizedInput) {
    return buildResolutionFailure({
      targetKind,
      input,
      projectId,
      universeId,
      candidateLimit,
      candidates: [],
    });
  }

  const exactIdRows = rows.filter(row => row[idField] === input);
  if (exactIdRows.length === 1) {
    const candidate = formatCandidate(exactIdRows[0], { matchedField: idField, matchType: "exact_id" });
    return buildSuccess({
      targetKind,
      input,
      argumentName,
      row: exactIdRows[0],
      candidate,
      idField,
      rowField: targetKind,
    });
  }

  const caseInsensitiveIdRows = rows.filter(row => normalizeMatchValue(row[idField]) === normalizedInput);
  if (caseInsensitiveIdRows.length === 1) {
    const candidate = formatCandidate(caseInsensitiveIdRows[0], { matchedField: idField, matchType: "case_insensitive_id" });
    return buildSuccess({
      targetKind,
      input,
      argumentName,
      row: caseInsensitiveIdRows[0],
      candidate,
      idField,
      rowField: targetKind,
    });
  }
  if (caseInsensitiveIdRows.length > 1) {
    return buildResolutionFailure({
      targetKind,
      input,
      projectId,
      universeId,
      candidateLimit,
      candidates: caseInsensitiveIdRows.map(row => formatCandidate(row, {
        matchedField: idField,
        matchType: "case_insensitive_id",
      })),
    });
  }

  const caseInsensitiveNameRows = rows.filter(row => normalizeMatchValue(row[nameField]) === normalizedInput);
  if (caseInsensitiveNameRows.length === 1) {
    const candidate = formatCandidate(caseInsensitiveNameRows[0], { matchedField: nameField, matchType: nameMatchType });
    return buildSuccess({
      targetKind,
      input,
      argumentName,
      row: caseInsensitiveNameRows[0],
      candidate,
      idField,
      rowField: targetKind,
    });
  }
  if (caseInsensitiveNameRows.length > 1) {
    return buildResolutionFailure({
      targetKind,
      input,
      projectId,
      universeId,
      candidateLimit,
      candidates: caseInsensitiveNameRows.map(row => formatCandidate(row, {
        matchedField: nameField,
        matchType: nameMatchType,
      })),
    });
  }

  const suggestionsById = rows
    .filter(row => isNearMatch(input, row[idField]))
    .map(row => formatCandidate(row, { matchedField: idField, matchType: "near_match_suggestion" }));
  const suggestedIds = new Set(suggestionsById.map(candidate => candidate.id));
  const suggestionsByName = rows
    .filter(row => !suggestedIds.has(row[idField]) && isNearMatch(input, row[nameField]))
    .map(row => formatCandidate(row, { matchedField: nameField, matchType: "near_match_suggestion" }));

  return buildResolutionFailure({
    targetKind,
    input,
    projectId,
    universeId,
    candidateLimit,
    candidates: [...suggestionsById, ...suggestionsByName],
  });
}

export function resolveSceneTarget(db, {
  projectId,
  input,
  argumentName = "scene_id",
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
} = {}) {
  const rows = db.prepare(`
    SELECT scene_id, project_id, title, chapter_id, chapter_title, timeline_position
    FROM scenes
    WHERE project_id = ?
    ORDER BY title COLLATE NOCASE, scene_id
  `).all(projectId);

  return resolveFromRows({
    rows,
    input,
    targetKind: "scene",
    idField: "scene_id",
    nameField: "title",
    nameMatchType: "case_insensitive_title",
    argumentName,
    projectId,
    universeId: undefined,
    candidateLimit,
    formatCandidate: formatSceneCandidate,
  });
}

function selectRelationshipScopedCharacters(db, { projectId }) {
  const universeId = getProjectUniverseId(db, projectId);
  return {
    universeId,
    rows: db.prepare(`
      SELECT character_id, project_id, universe_id, name, role, first_appearance
      FROM characters
      WHERE project_id = ?
        OR (universe_id IS NOT NULL AND universe_id = ?)
        OR (project_id IS NULL AND universe_id IS NULL)
      ORDER BY name COLLATE NOCASE, character_id
    `).all(projectId, universeId),
  };
}

function selectRelationshipScopedPlaces(db, { projectId }) {
  const universeId = getProjectUniverseId(db, projectId);
  return {
    universeId,
    rows: db.prepare(`
      SELECT place_id, project_id, universe_id, name
      FROM places
      WHERE project_id = ?
        OR (universe_id IS NOT NULL AND universe_id = ?)
        OR (project_id IS NULL AND universe_id IS NULL)
      ORDER BY name COLLATE NOCASE, place_id
    `).all(projectId, universeId),
  };
}

export function resolveCharacterTargetForProject(db, {
  projectId,
  input,
  argumentName = "character_id",
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
} = {}) {
  const { universeId, rows } = selectRelationshipScopedCharacters(db, { projectId });
  return resolveFromRows({
    rows,
    input,
    targetKind: "character",
    idField: "character_id",
    nameField: "name",
    nameMatchType: "case_insensitive_name",
    argumentName,
    projectId,
    universeId,
    candidateLimit,
    formatCandidate: formatCharacterCandidate,
  });
}

export function resolvePlaceTargetForProject(db, {
  projectId,
  input,
  argumentName = "place_id",
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
} = {}) {
  const { universeId, rows } = selectRelationshipScopedPlaces(db, { projectId });
  return resolveFromRows({
    rows,
    input,
    targetKind: "place",
    idField: "place_id",
    nameField: "name",
    nameMatchType: "case_insensitive_name",
    argumentName,
    projectId,
    universeId,
    candidateLimit,
    formatCandidate: formatPlaceCandidate,
  });
}

export const CANONICAL_TARGET_CANDIDATE_LIMITS = {
  default: DEFAULT_CANDIDATE_LIMIT,
  hard: HARD_CANDIDATE_LIMIT,
};
