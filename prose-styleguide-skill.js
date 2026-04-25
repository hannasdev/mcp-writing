export const PROSE_STYLEGUIDE_SKILL_DIRNAME = "skills";
export const PROSE_STYLEGUIDE_SKILL_BASENAME = "prose-styleguide.md";

const LANGUAGE_LABELS = {
  english_us: "English (US)",
  english_uk: "English (UK)",
  english_au: "English (AU)",
  english_ca: "English (CA)",
  swedish: "Swedish",
  norwegian: "Norwegian",
  danish: "Danish",
  finnish: "Finnish",
  french: "French",
  italian: "Italian",
  russian: "Russian",
  portuguese_pt: "Portuguese (PT)",
  portuguese_br: "Portuguese (BR)",
  german: "German",
  dutch: "Dutch",
  polish: "Polish",
  czech: "Czech",
  hungarian: "Hungarian",
  spanish: "Spanish",
  irish: "Irish",
  japanese: "Japanese",
  korean: "Korean",
  chinese_traditional: "Chinese (Traditional)",
  chinese_simplified: "Chinese (Simplified)",
};

const CONFIG_RULE_RENDERERS = {
  language: (value) => `Primary writing language: ${LANGUAGE_LABELS[value] ?? value}.`,
  spelling: (value) => `Spelling variant: ${value.toUpperCase()}.`,
  quotation_style: (value) => {
    const labels = {
      double: "double quotes",
      single: "single quotes",
      guillemets: "guillemets (« »)",
      low9: "low-9 quotation marks",
      dialogue_dash_en: "Scandinavian en-dash dialogue",
      dialogue_dash_em: "Spanish/Irish em-dash dialogue",
      corner_brackets: "corner brackets (「 」)",
    };
    return `Dialogue quotation style: ${labels[value] ?? value}.`;
  },
  quotation_style_nested: (value) => `Nested quotation style: ${value}.`,
  em_dash_spacing: (value) => `Em dash spacing: ${value}.`,
  ellipsis_style: (value) => `Ellipsis style: ${value}.`,
  abbreviation_periods: (value) => `Abbreviation periods: ${value}.`,
  oxford_comma: (value) => `Oxford comma: ${value}.`,
  numbers: (value) => `Number formatting rule: ${value}.`,
  date_format: (value) => `Date format: ${value}.`,
  time_format: (value) => `Time format: ${value}.`,
  tense: (value) => `Default narrative tense: ${value}. Flag deviations as questions, not hard errors.`,
  pov: (value) => `Default POV: ${value}. Flag shifts as intentional-or-drift questions.`,
  dialogue_tags: (value) => `Dialogue tag policy: ${value}.`,
  sentence_fragments: (value) => `Sentence fragments policy: ${value}.`,
};

export function buildProseStyleguideSkill({ resolvedConfig, sources = [], projectId = null }) {
  if (!resolvedConfig || typeof resolvedConfig !== "object") {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_CONFIG",
        message: "Cannot generate prose-styleguide.md without a resolved config object.",
      },
    };
  }

  const injectedRules = [];
  for (const [field, renderRule] of Object.entries(CONFIG_RULE_RENDERERS)) {
    if (resolvedConfig[field] === undefined) continue;
    injectedRules.push(renderRule(resolvedConfig[field]));
  }

  const sourceLines = sources.length
    ? sources.map((source) => `- ${source.scope}: ${source.file_path}`)
    : ["- none"];

  const voiceNotes = typeof resolvedConfig.voice_notes === "string" && resolvedConfig.voice_notes.trim()
    ? resolvedConfig.voice_notes.trim().split("\n").map((line) => `> ${line}`).join("\n")
    : "> None provided.";

  const markdown = [
    "# Prose Styleguide",
    "",
    "## Standing Order",
    "Apply this styleguide by default for prose critique and edits. Preserve author voice over mechanical cleanup.",
    "",
    "## Resolved Scope",
    `- Project scope: ${projectId ?? "sync-root default"}`,
    ...sourceLines,
    "",
    "## Mechanical Conventions",
    "These are injected from prose-styleguide.config.yaml and should be applied consistently:",
    ...injectedRules.map((rule) => `- ${rule}`),
    "",
    "## Universal Craft Rules",
    "- Identify scene purpose before proposing changes.",
    "- Require transformation (emotional, relational, narrative, or thematic).",
    "- Prefer critique before rewrite.",
    "- Preserve cadence and specificity; avoid flattening voice.",
    "- Ask before normalizing intentional instability (flashbacks, POV drift, syntax breaks).",
    "",
    "## Review Posture",
    "- Prioritize structural issues, then convention drift, then line-level polish.",
    "- Treat convention drift as a question when intent may be deliberate.",
    "",
    "## Edit Posture",
    "- Do not shorten unless requested.",
    "- Apply conventions consistently while preserving tone.",
    "- Justify significant rewrites.",
    "",
    "## Voice Notes",
    voiceNotes,
    "",
  ].join("\n");

  return {
    ok: true,
    markdown,
    injected_rules: injectedRules,
  };
}
