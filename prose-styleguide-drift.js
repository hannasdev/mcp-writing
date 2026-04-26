function detectQuotationStyle(prose) {
  const counts = {
    double: (prose.match(/"[^"]{2,}"/g) ?? []).length,
    guillemets: (prose.match(/«[^»]{2,}»/g) ?? []).length,
    low9: (prose.match(/„[^“]{2,}“/g) ?? []).length,
    corner_brackets: (prose.match(/「[^」]{2,}」/g) ?? []).length,
    dialogue_dash_en: (prose.match(/^\s*–\s/mg) ?? []).length,
    dialogue_dash_em: (prose.match(/^\s*—\s/mg) ?? []).length,
    single: (prose.match(/'[^'\n]{2,}'/g) ?? []).length,
  };

  let best = null;
  let bestCount = 0;
  for (const [style, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

function detectEmDashSpacing(prose) {
  const spaced = (prose.match(/\s—\s/g) ?? []).length;
  const closed = (prose.match(/\S—\S/g) ?? []).length;
  if (spaced === 0 && closed === 0) return null;
  return spaced >= closed ? "spaced" : "closed";
}

function detectSpellingVariant(prose) {
  const lower = prose.toLowerCase();
  const ukSignals = ["colour", "realise", "centre", "honour", "travelling"];
  const usSignals = ["color", "realize", "center", "honor", "traveling"];

  const countHits = (signals) => signals.reduce((sum, word) => {
    const re = new RegExp(`\\b${word}\\b`, "g");
    return sum + (lower.match(re) ?? []).length;
  }, 0);

  const uk = countHits(ukSignals);
  const us = countHits(usSignals);
  if (uk === 0 && us === 0) return null;
  return uk >= us ? "uk" : "us";
}

function detectTenseHint(prose) {
  const lower = prose.toLowerCase();
  const past = (lower.match(/\b(was|were|had|did)\b/g) ?? []).length;
  const present = (lower.match(/\b(is|are|has|do)\b/g) ?? []).length;
  if (past === 0 && present === 0) return null;
  return present >= past ? "present" : "past";
}

function mostCommonValue(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestValue = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return { value: bestValue, count: bestCount, total: values.filter(Boolean).length };
}

export function detectStyleguideSignals(prose) {
  return {
    quotation_style: detectQuotationStyle(prose),
    em_dash_spacing: detectEmDashSpacing(prose),
    spelling: detectSpellingVariant(prose),
    tense: detectTenseHint(prose),
  };
}

export function analyzeSceneStyleguideDrift({ prose, resolvedConfig }) {
  const observed = detectStyleguideSignals(prose);
  const drift = [];

  for (const field of ["quotation_style", "em_dash_spacing", "spelling", "tense"]) {
    const declared = resolvedConfig?.[field];
    const seen = observed[field];
    if (!declared || !seen) continue;
    if (declared !== seen) {
      drift.push({ field, declared, observed: seen });
    }
  }

  return { observed, drift };
}

export function suggestStyleguideUpdatesFromScenes({ sceneAnalyses, resolvedConfig, minAgreement = 0.6 }) {
  const suggestions = {};

  for (const field of ["quotation_style", "em_dash_spacing", "spelling", "tense"]) {
    const values = sceneAnalyses.map((scene) => scene.observed?.[field] ?? null);
    const common = mostCommonValue(values);
    if (!common) continue;

    const agreement = common.total > 0 ? common.count / common.total : 0;
    const fieldThreshold = field === "tense" ? Math.max(minAgreement, 0.75) : minAgreement;
    if (agreement < fieldThreshold) continue;
    if (resolvedConfig?.[field] === common.value) continue;

    suggestions[field] = {
      suggested_value: common.value,
      agreement,
      based_on_scenes: common.total,
    };
  }

  return suggestions;
}
