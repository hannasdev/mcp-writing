const DEFAULT_VOCABULARY_CANDIDATE_LIMIT = 5;
const HARD_VOCABULARY_CANDIDATE_LIMIT = 10;

function normalizeVocabularyValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clampCandidateLimit(candidateLimit) {
  if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) {
    return DEFAULT_VOCABULARY_CANDIDATE_LIMIT;
  }
  return Math.min(candidateLimit, HARD_VOCABULARY_CANDIDATE_LIMIT);
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function isNearVocabularyMatch(input, value) {
  const normalizedInput = normalizeVocabularyValue(input);
  const normalizedValue = normalizeVocabularyValue(value);
  if (!normalizedInput || !normalizedValue) return false;
  if (normalizedInput.length < 3 || normalizedValue.length < 3) return false;
  if (normalizedValue.includes(normalizedInput) || normalizedInput.includes(normalizedValue)) return true;

  const distance = levenshteinDistance(normalizedInput, normalizedValue);
  const threshold = Math.max(1, Math.floor(Math.max(normalizedInput.length, normalizedValue.length) / 4));
  return distance <= threshold;
}

function cleanVocabularyValues(values) {
  const seen = new Set();
  const cleaned = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const normalized = normalizeVocabularyValue(value);
    if (!normalized) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
  }
  return cleaned.sort((left, right) => (
    normalizeVocabularyValue(left).localeCompare(normalizeVocabularyValue(right)) || left.localeCompare(right)
  ));
}

function formatVocabularyCandidate({ targetKind, value, matchedField, matchType }) {
  return {
    target_kind: targetKind,
    id: value,
    value,
    label: value,
    matched_field: matchedField,
    match_type: matchType,
  };
}

function capVocabularyCandidates(candidates, candidateLimit) {
  return candidates
    .sort((left, right) => (
      normalizeVocabularyValue(left.label).localeCompare(normalizeVocabularyValue(right.label)) ||
      left.id.localeCompare(right.id)
    ))
    .slice(0, clampCandidateLimit(candidateLimit));
}

export function resolveVocabularyValue({
  input,
  values,
  targetKind,
  matchedField = "value",
  candidateLimit = DEFAULT_VOCABULARY_CANDIDATE_LIMIT,
} = {}) {
  const normalizedInput = normalizeVocabularyValue(input);
  const vocabularyValues = cleanVocabularyValues(values);
  if (!normalizedInput) {
    return {
      ok: false,
      input,
      target_kind: targetKind,
      candidate_matches: [],
    };
  }

  const caseInsensitiveMatches = vocabularyValues.filter(value => normalizeVocabularyValue(value) === normalizedInput);
  if (caseInsensitiveMatches.length === 1) {
    const canonicalValue = caseInsensitiveMatches[0];
    return {
      ok: true,
      input,
      target_kind: targetKind,
      value: canonicalValue,
      canonical: canonicalValue === input,
      ...(canonicalValue === input ? {} : {
        resolved_from: {
          input,
          matched_field: matchedField,
          match_type: "case_insensitive_value",
          value: canonicalValue,
        },
      }),
    };
  }
  if (caseInsensitiveMatches.length > 1) {
    return {
      ok: true,
      input,
      target_kind: targetKind,
      value: input,
      canonical: false,
      case_variants: caseInsensitiveMatches.map(value => formatVocabularyCandidate({
        targetKind,
        value,
        matchedField,
        matchType: "case_insensitive_value",
      })),
    };
  }

  const suggestions = vocabularyValues
    .filter(value => isNearVocabularyMatch(input, value))
    .map(value => formatVocabularyCandidate({
      targetKind,
      value,
      matchedField,
      matchType: "near_match_suggestion",
    }));

  return {
    ok: false,
    input,
    target_kind: targetKind,
    candidate_matches: capVocabularyCandidates(suggestions, candidateLimit),
  };
}

export function buildVocabularyNoResultsDetails({
  filters,
  resolvedFilters,
  suggestions = [],
  nextStep = "Broaden filters, choose a candidate value, or call search_metadata with exact metadata keywords.",
} = {}) {
  return {
    lookup_kind: "scene_metadata_filters",
    filters,
    ...(resolvedFilters ? { resolved_filters: resolvedFilters } : {}),
    candidate_matches: suggestions.flatMap(suggestion => suggestion.candidate_matches ?? []),
    filter_suggestions: suggestions,
    next_step: nextStep,
  };
}

export function buildFreeformFieldSuggestions({
  fields,
  vocabulary,
} = {}) {
  const suggestions = {};
  if (Array.isArray(fields?.tags) && Array.isArray(vocabulary?.tags)) {
    const tagSuggestions = fields.tags
      .map(tag => resolveVocabularyValue({
        input: tag,
        values: vocabulary.tags,
        targetKind: "tag",
        matchedField: "tag",
      }))
      .filter(result => result.ok && result.resolved_from)
      .map(result => ({
        field: "tags",
        input: result.input,
        existing_value: result.value,
        match_type: result.resolved_from.match_type,
        note: "Existing tag differs only by case; supplied casing was preserved because tags remain freeform metadata.",
      }));
    if (tagSuggestions.length > 0) suggestions.tags = tagSuggestions;
  }

  if (typeof fields?.save_the_cat_beat === "string" && Array.isArray(vocabulary?.beats)) {
    const beatSuggestion = resolveVocabularyValue({
      input: fields.save_the_cat_beat,
      values: vocabulary.beats,
      targetKind: "beat",
      matchedField: "save_the_cat_beat",
    });
    if (beatSuggestion.ok && beatSuggestion.resolved_from) {
      suggestions.save_the_cat_beat = [{
        field: "save_the_cat_beat",
        input: beatSuggestion.input,
        existing_value: beatSuggestion.value,
        match_type: beatSuggestion.resolved_from.match_type,
        note: "Existing beat differs only by case; supplied value was preserved because Save the Cat beat remains freeform metadata.",
      }];
    } else if (!beatSuggestion.ok && beatSuggestion.candidate_matches.length > 0) {
      suggestions.save_the_cat_beat = beatSuggestion.candidate_matches.map(candidate => ({
        field: "save_the_cat_beat",
        input: fields.save_the_cat_beat,
        suggested_value: candidate.value,
        match_type: candidate.match_type,
        note: "Beat remains freeform; choose an existing value only if it matches author intent.",
      }));
    }
  }

  return Object.keys(suggestions).length > 0 ? suggestions : undefined;
}

export const VOCABULARY_CANDIDATE_LIMITS = {
  default: DEFAULT_VOCABULARY_CANDIDATE_LIMIT,
  hard: HARD_VOCABULARY_CANDIDATE_LIMIT,
};
