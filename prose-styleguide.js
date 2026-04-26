import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export const STYLEGUIDE_CONFIG_BASENAME = "prose-styleguide.config.yaml";

const ENUMS = {
  language: [
    "english_us",
    "english_uk",
    "english_au",
    "english_ca",
    "swedish",
    "norwegian",
    "danish",
    "finnish",
    "french",
    "italian",
    "russian",
    "portuguese_pt",
    "portuguese_br",
    "german",
    "dutch",
    "polish",
    "czech",
    "hungarian",
    "spanish",
    "irish",
    "japanese",
    "korean",
    "chinese_traditional",
    "chinese_simplified",
  ],
  spelling: ["uk", "us", "au", "ca"],
  quotation_style: [
    "double",
    "single",
    "guillemets",
    "low9",
    "dialogue_dash_en",
    "dialogue_dash_em",
    "corner_brackets",
  ],
  quotation_style_nested: [
    "double",
    "single",
    "guillemets_single",
    "low9_single",
    "corner_brackets_double",
  ],
  em_dash_spacing: ["closed", "spaced"],
  ellipsis_style: ["three_periods", "ellipsis_char", "spaced"],
  abbreviation_periods: ["with", "without"],
  oxford_comma: ["yes", "no"],
  numbers: ["spell_under_10", "spell_under_100", "always_spell", "numerals"],
  date_format: ["mdy", "dmy"],
  time_format: ["12h", "24h"],
  tense: ["present", "past"],
  pov: ["first", "third_limited", "third_omniscient"],
  dialogue_tags: ["minimal", "expressive"],
  sentence_fragments: ["disallow", "intentional"],
};

export const STYLEGUIDE_ENUMS = Object.freeze(
  Object.fromEntries(
    Object.entries(ENUMS).map(([key, values]) => [key, [...values]])
  )
);

const STYLEGUIDE_FIELD_ORDER = [
  "language",
  "spelling",
  "quotation_style",
  "quotation_style_nested",
  "em_dash_spacing",
  "ellipsis_style",
  "abbreviation_periods",
  "oxford_comma",
  "numbers",
  "date_format",
  "time_format",
  "tense",
  "pov",
  "dialogue_tags",
  "sentence_fragments",
  "voice_notes",
];

// Fields that are valid in a config but are not enum-constrained.
const SPECIAL_FIELDS = new Set(["voice_notes"]);

const LANGUAGE_DEFAULTS = {
  english_us: {
    spelling: "us",
    quotation_style: "double",
    em_dash_spacing: "closed",
    abbreviation_periods: "with",
    oxford_comma: "yes",
    date_format: "mdy",
  },
  english_uk: {
    spelling: "uk",
    quotation_style: "single",
    em_dash_spacing: "spaced",
    abbreviation_periods: "without",
    oxford_comma: "no",
    date_format: "dmy",
  },
  english_au: {
    spelling: "au",
    quotation_style: "double",
    em_dash_spacing: "closed",
    abbreviation_periods: "without",
    oxford_comma: "yes",
    date_format: "dmy",
  },
  english_ca: {
    spelling: "ca",
    quotation_style: "double",
    em_dash_spacing: "spaced",
    abbreviation_periods: "without",
    oxford_comma: "yes",
    date_format: "dmy",
  },
  swedish: {
    quotation_style: "dialogue_dash_en",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  norwegian: {
    quotation_style: "dialogue_dash_en",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  danish: {
    quotation_style: "dialogue_dash_en",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  finnish: {
    quotation_style: "guillemets",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  french: {
    quotation_style: "guillemets",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  italian: {
    quotation_style: "guillemets",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  russian: {
    quotation_style: "guillemets",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  portuguese_pt: {
    quotation_style: "guillemets",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  portuguese_br: {
    quotation_style: "double",
    em_dash_spacing: "closed",
    date_format: "dmy",
  },
  german: {
    quotation_style: "low9",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  dutch: {
    quotation_style: "low9",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  polish: {
    quotation_style: "low9",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  czech: {
    quotation_style: "low9",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  hungarian: {
    quotation_style: "low9",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  spanish: {
    quotation_style: "dialogue_dash_em",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  irish: {
    quotation_style: "dialogue_dash_em",
    em_dash_spacing: "spaced",
    date_format: "dmy",
  },
  japanese: {
    quotation_style: "corner_brackets",
  },
  korean: {
    quotation_style: "corner_brackets",
  },
  chinese_traditional: {
    quotation_style: "corner_brackets",
  },
  chinese_simplified: {
    quotation_style: "double",
  },
};

function projectRootFromId(syncDir, projectId) {
  if (!projectId.includes("/")) {
    return path.join(syncDir, "projects", projectId);
  }
  const [universeId, projectSlug] = projectId.split("/");
  return path.join(syncDir, "universes", universeId, projectSlug);
}

function inferNestedQuotationStyle(quotationStyle) {
  if (quotationStyle === "double") return "single";
  if (quotationStyle === "single") return "double";
  if (quotationStyle === "guillemets") return "guillemets_single";
  if (quotationStyle === "low9") return "low9_single";
  if (quotationStyle === "corner_brackets") return "corner_brackets_double";
  return null;
}

function normalizeTense(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("present")) return "present";
  if (trimmed.startsWith("past")) return "past";
  return trimmed;
}

function normalizeConfigShape(rawConfig) {
  const normalized = Object.create(null);
  for (const [key, value] of Object.entries(rawConfig ?? {})) {
    // Skip null/undefined — treat as unset, same as a missing key.
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        normalized[key] = trimmed;
      }
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function validateConfig(config, sourcePath) {
  const normalized = normalizeConfigShape(config);
  const sanitized = Object.create(null);
  const errors = [];
  const unknownFields = [];

  for (const [key, value] of Object.entries(normalized)) {
    if (!Object.hasOwn(ENUMS, key) && !SPECIAL_FIELDS.has(key)) {
      unknownFields.push(key);
      continue;
    }

    if (SPECIAL_FIELDS.has(key)) {
      if (typeof value !== "string") {
        errors.push({
          code: "INVALID_TYPE",
          field: key,
          message: `${key} must be a string.`,
          source: sourcePath,
        });
      }
      if (typeof value === "string") {
        sanitized[key] = value;
      }
      continue;
    }

    if (typeof value !== "string") {
      errors.push({
        code: "INVALID_TYPE",
        field: key,
        message: `${key} must be a string enum value.`,
        source: sourcePath,
      });
      continue;
    }

    const valueToCheck = key === "tense" ? normalizeTense(value) : value;
    if (!ENUMS[key].includes(valueToCheck)) {
      errors.push({
        code: "INVALID_ENUM",
        field: key,
        message: `${key} must be one of: ${ENUMS[key].join(", ")}.`,
        source: sourcePath,
        received: value,
      });
      continue;
    }

    sanitized[key] = value;
  }

  return {
    normalized: sanitized,
    errors,
    unknownFields,
  };
}

function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: "INVALID_YAML",
        message: error instanceof Error ? error.message : "Invalid YAML.",
        source: filePath,
      }],
    };
  }

  if (parsed === null || parsed === undefined) {
    return { ok: true, config: {} };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [{
        code: "INVALID_CONFIG",
        message: "Config file must parse to an object.",
        source: filePath,
      }],
    };
  }

  const { normalized, errors, unknownFields } = validateConfig(parsed, filePath);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: normalized,
    unknown_fields: unknownFields,
  };
}

function configPathForScope(syncDir, scope, projectId) {
  if (scope === "sync_root") {
    return path.join(syncDir, STYLEGUIDE_CONFIG_BASENAME);
  }
  return path.join(projectRootFromId(syncDir, projectId), STYLEGUIDE_CONFIG_BASENAME);
}

function prepareStyleguideConfigUpdate({ syncDir, scope, projectId, updates = {} }) {
  if (scope === "project_root" && !projectId) {
    return {
      ok: false,
      error: {
        code: "PROJECT_ID_REQUIRED",
        message: "project_id is required when scope=project_root.",
        details: { scope, project_id: projectId ?? null },
      },
    };
  }

  const filePath = configPathForScope(syncDir, scope, projectId);
  const current = readConfigFile(filePath);

  if (current === null) {
    return {
      ok: false,
      error: {
        code: "STYLEGUIDE_CONFIG_NOT_FOUND",
        message: "Cannot update styleguide config because no config exists at the requested scope.",
        details: { file_path: filePath, scope, project_id: projectId ?? null },
      },
    };
  }

  if (!current.ok) {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_CONFIG",
        message: "Styleguide config validation failed.",
        details: { file_path: filePath, issues: current.errors },
      },
    };
  }

  const validatedUpdates = validateConfig(updates, "<updates>");
  if (validatedUpdates.errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_UPDATE",
        message: "Requested styleguide updates failed validation.",
        details: validatedUpdates.errors,
      },
    };
  }

  const merged = Object.create(null);
  Object.assign(merged, current.config, validatedUpdates.normalized);

  const ordered = Object.create(null);
  for (const key of STYLEGUIDE_FIELD_ORDER) {
    if (merged[key] !== undefined) {
      ordered[key] = merged[key];
    }
  }

  const changedFields = [];
  const allKeys = new Set([...Object.keys(current.config ?? {}), ...Object.keys(ordered)]);
  for (const key of allKeys) {
    if (current.config?.[key] !== ordered[key]) {
      changedFields.push({
        field: key,
        before: current.config?.[key],
        after: ordered[key],
      });
    }
  }

  return {
    ok: true,
    file_path: filePath,
    scope,
    project_id: projectId ?? null,
    current_config: current.config,
    config: ordered,
    changed_fields: changedFields,
    warnings: {
      unknown_fields: validatedUpdates.unknownFields,
    },
  };
}

function getConfigCandidates(syncDir, projectId) {
  const candidates = [
    {
      scope: "sync_root",
      file_path: path.join(syncDir, STYLEGUIDE_CONFIG_BASENAME),
    },
  ];

  if (!projectId) return candidates;

  if (projectId.includes("/")) {
    const [universeId] = projectId.split("/");
    candidates.push({
      scope: "universe_root",
      file_path: path.join(syncDir, "universes", universeId, STYLEGUIDE_CONFIG_BASENAME),
    });
  }

  candidates.push({
    scope: "project_root",
    file_path: path.join(projectRootFromId(syncDir, projectId), STYLEGUIDE_CONFIG_BASENAME),
  });

  return candidates;
}

function applyDerivedDefaults(config) {
  const resolved = { ...config };
  const inferred_defaults = {};

  if (resolved.language && LANGUAGE_DEFAULTS[resolved.language]) {
    const defaults = LANGUAGE_DEFAULTS[resolved.language];
    for (const [key, value] of Object.entries(defaults)) {
      if (resolved[key] === undefined) {
        resolved[key] = value;
        inferred_defaults[key] = value;
      }
    }
  }

  if (!resolved.quotation_style_nested && resolved.quotation_style) {
    const nested = inferNestedQuotationStyle(resolved.quotation_style);
    if (nested) {
      resolved.quotation_style_nested = nested;
      inferred_defaults.quotation_style_nested = nested;
    }
  }

  if (resolved.tense) {
    resolved.tense = normalizeTense(resolved.tense);
  }

  return { resolved, inferred_defaults };
}

export function buildStyleguideConfigDraft({ language, overrides = {}, voice_notes }) {
  const overrideValidation = validateConfig(overrides, "<overrides>");
  if (overrideValidation.errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_OVERRIDE",
        message: "Requested styleguide overrides failed validation.",
        details: overrideValidation.errors,
      },
    };
  }

  if (!ENUMS.language.includes(language)) {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_LANGUAGE",
        message: `language must be one of: ${ENUMS.language.join(", ")}.`,
      },
    };
  }

  const merged = {
    ...overrideValidation.normalized,
    language,
  };

  if (typeof voice_notes === "string" && voice_notes.trim()) {
    merged.voice_notes = voice_notes.trim();
  }

  const { resolved, inferred_defaults } = applyDerivedDefaults(merged);
  return {
    ok: true,
    config: resolved,
    inferred_defaults,
    warnings: {
      unknown_fields: overrideValidation.unknownFields,
    },
  };
}

export function summarizeStyleguideConfig({ resolvedConfig, inferredDefaults = {} }) {
  if (!resolvedConfig || typeof resolvedConfig !== "object") {
    return {
      ok: false,
      error: {
        code: "INVALID_STYLEGUIDE_CONFIG",
        message: "Cannot summarize styleguide config without a resolved config object.",
      },
    };
  }

  const lines = [];
  if (resolvedConfig.language) lines.push(`Writing language: ${resolvedConfig.language}.`);
  if (resolvedConfig.spelling) lines.push(`Spelling variant: ${resolvedConfig.spelling}.`);
  if (resolvedConfig.quotation_style) lines.push(`Dialogue punctuation uses ${resolvedConfig.quotation_style}.`);
  if (resolvedConfig.quotation_style_nested) lines.push(`Nested quotations use ${resolvedConfig.quotation_style_nested}.`);
  if (resolvedConfig.tense) lines.push(`Default narrative tense: ${resolvedConfig.tense}.`);
  if (resolvedConfig.pov) lines.push(`Default POV: ${resolvedConfig.pov}.`);
  if (resolvedConfig.dialogue_tags) lines.push(`Dialogue tag policy: ${resolvedConfig.dialogue_tags}.`);
  if (resolvedConfig.sentence_fragments) lines.push(`Sentence fragments: ${resolvedConfig.sentence_fragments}.`);
  if (resolvedConfig.date_format) lines.push(`Date format: ${resolvedConfig.date_format}.`);
  if (resolvedConfig.time_format) lines.push(`Time format: ${resolvedConfig.time_format}.`);
  if (resolvedConfig.voice_notes) lines.push(`Voice notes: ${resolvedConfig.voice_notes}`);

  const inferred = Object.keys(inferredDefaults);
  if (inferred.length > 0) {
    lines.push(`Inferred defaults currently fill: ${inferred.join(", ")}.`);
  }

  return {
    ok: true,
    summary_text: lines.join(" "),
    summary_lines: lines,
  };
}

export function updateStyleguideConfig({ syncDir, scope, projectId, updates = {} }) {
  const prepared = prepareStyleguideConfigUpdate({ syncDir, scope, projectId, updates });
  if (!prepared.ok) return prepared;

  if (prepared.changed_fields.length === 0) {
    return {
      ok: true,
      file_path: prepared.file_path,
      scope: prepared.scope,
      project_id: prepared.project_id,
      config: prepared.config,
      changed_fields: prepared.changed_fields,
      warnings: prepared.warnings,
      noop: true,
      message: "No changes detected for requested styleguide updates.",
    };
  }

  fs.mkdirSync(path.dirname(prepared.file_path), { recursive: true });
  fs.writeFileSync(prepared.file_path, yaml.dump(prepared.config, { lineWidth: 120 }), "utf8");

  return {
    ok: true,
    file_path: prepared.file_path,
    scope: prepared.scope,
    project_id: prepared.project_id,
    config: prepared.config,
    changed_fields: prepared.changed_fields,
    warnings: prepared.warnings,
    noop: false,
    message: "Styleguide config updated.",
  };
}

export function previewStyleguideConfigUpdate({ syncDir, scope, projectId, updates = {} }) {
  return prepareStyleguideConfigUpdate({ syncDir, scope, projectId, updates });
}

export function resolveStyleguideConfig({ syncDir, projectId }) {
  const candidates = getConfigCandidates(syncDir, projectId);
  const sources = [];
  const unknownFields = [];
  const merged = Object.create(null);

  for (const candidate of candidates) {
    const loaded = readConfigFile(candidate.file_path);
    if (loaded === null) continue;

    if (!loaded.ok) {
      return {
        ok: false,
        error: {
          code: "INVALID_STYLEGUIDE_CONFIG",
          message: "Styleguide config validation failed.",
          details: {
            file_path: candidate.file_path,
            issues: loaded.errors,
          },
        },
      };
    }

    Object.assign(merged, loaded.config);
    if (loaded.unknown_fields?.length) {
      for (const field of loaded.unknown_fields) {
        unknownFields.push({ scope: candidate.scope, field, source: candidate.file_path });
      }
    }

    sources.push({
      scope: candidate.scope,
      file_path: candidate.file_path,
    });
  }

  const { resolved, inferred_defaults } = applyDerivedDefaults(merged);
  return {
    ok: true,
    config_found: sources.length > 0,
    setup_required: sources.length === 0,
    resolved_config: sources.length > 0 ? resolved : null,
    inferred_defaults,
    sources,
    warnings: {
      unknown_fields: unknownFields,
    },
  };
}
