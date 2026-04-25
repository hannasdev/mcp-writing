const NON_DISTINCTIVE_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "over",
  "under",
  "after",
  "before",
  "about",
  "around",
]);

function isDistinctiveToken(token) {
  return Boolean(token) && token.length >= 3 && !NON_DISTINCTIVE_TOKENS.has(token);
}

function normalizeRawCharacterValues(values) {
  const raw = Array.isArray(values) ? values : [];
  const seen = new Set();
  const normalized = [];

  for (const value of raw) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }

  return normalized;
}

export function buildCharacterNormalizationContext(rows) {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter(row => row?.character_id && row?.name)
    .map(row => {
      const character_id = String(row.character_id).trim();
      const name = String(row.name).trim();
      const tokens = [...new Set(name.toLowerCase().split(/\s+/).filter(Boolean))];
      return {
        character_id,
        name,
        tokens,
        informative_tokens: tokens.filter(isDistinctiveToken),
      };
    })
    .filter(row => row.character_id.length > 0 && row.name.length > 0);

  const byId = new Map();
  const nameMap = new Map();
  for (const row of clean) {
    byId.set(row.character_id, row);
    const normalizedName = row.name.toLowerCase();
    const ids = nameMap.get(normalizedName) ?? [];
    ids.push(row.character_id);
    nameMap.set(normalizedName, ids);
  }

  return { clean, byId, nameMap };
}

export function resolveCharacterReference(value, context) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (context.byId.has(text)) {
    return text;
  }

  const exactNameIds = context.nameMap.get(text.toLowerCase());
  if (exactNameIds?.length === 1) {
    return exactNameIds[0];
  }

  const words = text.toLowerCase().split(/\s+/).filter(isDistinctiveToken);
  if (words.length === 0) {
    return text;
  }

  const matches = context.clean.filter(row =>
    words.every(word => row.informative_tokens.includes(word))
  );

  if (matches.length === 1) {
    return matches[0].character_id;
  }

  return text;
}

export function pruneDominatedCharacterIds(values, context) {
  const kept = [...values];

  for (const candidateId of values) {
    const candidate = context.byId.get(candidateId);
    if (!candidate || candidate.informative_tokens.length < 2) continue;

    for (const dominantId of values) {
      if (dominantId === candidateId) continue;
      const dominant = context.byId.get(dominantId);
      if (!dominant) continue;
      if (candidate.informative_tokens.length >= dominant.informative_tokens.length) continue;

      const isSubset = candidate.informative_tokens.every(token => dominant.informative_tokens.includes(token));
      if (isSubset) {
        const idx = kept.indexOf(candidateId);
        if (idx !== -1) kept.splice(idx, 1);
        break;
      }
    }
  }

  return kept;
}

export function normalizeSceneCharacters(values, context) {
  const before = normalizeRawCharacterValues(values);
  const resolved = [];
  const seen = new Set();

  for (const value of before) {
    const normalized = resolveCharacterReference(value, context);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    resolved.push(normalized);
  }

  const after = pruneDominatedCharacterIds(resolved, context);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  return {
    before,
    after,
    changed: before.length !== after.length || before.some((value, idx) => after[idx] !== value),
    added: after.filter(value => !beforeSet.has(value)),
    removed: before.filter(value => !afterSet.has(value)),
  };
}