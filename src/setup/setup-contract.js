import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const questionSchema = z.object({
  label: z.string().min(1),
  help_text: z.string().min(1),
  blocking: z.boolean(),
  ask_mode: z.enum(["always", "inferred_with_confirmation", "low_risk_keep_change"]),
  input_type: z.enum(["enum", "string", "boolean", "object"]),
  allowed_values: z.array(z.string()).optional(),
  write_target: z.string().min(1),
});

const flowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  questions: z.array(z.string()).min(1),
  artifact_targets: z.array(z.string()).min(1),
  completion_rules: z.array(z.string()).min(1),
});

export const setupContractSchema = z.object({
  schema_version: z.string().min(1),
  flows: z.array(flowSchema).min(1),
  questions: z.record(z.string(), questionSchema),
  defaults: z.record(z.string(), z.union([z.string(), z.boolean()])),
  validation_rules: z.array(z.object({
    id: z.string().min(1),
    when: z.record(z.string(), z.string()).optional(),
    rule: z.string().min(1),
  })),
  artifact_targets: z.record(z.string(), z.object({
    path: z.string().min(1),
    owner: z.string().min(1),
    condition: z.string().optional(),
  })),
  completion_rules: z.record(z.string(), z.object({
    derived_from: z.enum(["filesystem", "config_validation", "filesystem_conditional"]),
  })),
});

const CONTRACT_RELATIVE_PATHS = {
  styleguide_setup_v1: path.join("src", "setup", "contracts", "styleguide_setup_v1.json"),
};

function getFlowById(contract, flowId) {
  return contract.flows.find((flow) => flow.id === flowId) ?? null;
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

export function loadSetupContract({ rootDir, contractId = "styleguide_setup_v1" }) {
  const relativePath = CONTRACT_RELATIVE_PATHS[contractId];
  if (!relativePath) {
    return {
      ok: false,
      error: {
        code: "SETUP_CONTRACT_NOT_FOUND",
        message: `Unknown setup contract id: ${contractId}`,
        details: { contract_id: contractId },
      },
    };
  }

  const contractPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(contractPath)) {
    return {
      ok: false,
      error: {
        code: "SETUP_CONTRACT_FILE_MISSING",
        message: `Setup contract file not found: ${path.resolve(contractPath)}`,
        details: { contract_id: contractId, contract_path: path.resolve(contractPath) },
      },
    };
  }

  let parsed;
  try {
    parsed = parseJsonFile(contractPath);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "SETUP_CONTRACT_INVALID_JSON",
        message: `Failed to parse setup contract JSON: ${error instanceof Error ? error.message : String(error)}`,
        details: { contract_id: contractId, contract_path: path.resolve(contractPath) },
      },
    };
  }

  const validated = setupContractSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: {
        code: "SETUP_CONTRACT_SCHEMA_INVALID",
        message: "Setup contract does not match required schema.",
        details: {
          contract_id: contractId,
          contract_path: path.resolve(contractPath),
          issues: validated.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  return {
    ok: true,
    contract_id: contractId,
    contract_path: path.resolve(contractPath),
    contract: validated.data,
  };
}

export function resolveStyleguideSetupAnswers({
  contract,
  flowId = "styleguide_setup_v1",
  answers = {},
  inferred = {},
}) {
  const flow = getFlowById(contract, flowId);
  if (!flow) {
    return {
      ok: false,
      error: {
        code: "SETUP_FLOW_NOT_FOUND",
        message: `Flow not found in setup contract: ${flowId}`,
        details: { flow_id: flowId },
      },
    };
  }

  const scope = answers.scope ?? contract.defaults.scope ?? "project_root";
  const language = answers.language ?? contract.defaults.language;
  const bootstrapFromScenes = answers.bootstrap_from_scenes ?? contract.defaults.bootstrap_from_scenes;
  const projectId = answers.project_id ?? inferred.project_id ?? null;
  const overrides = answers.high_impact_overrides ?? {};
  const voiceNotes = answers.voice_notes;

  const languageQuestion = contract.questions.language;
  if (!languageQuestion.allowed_values?.includes(language)) {
    return {
      ok: false,
      error: {
        code: "INVALID_SETUP_LANGUAGE",
        message: "language must be one of the setup contract allowed_values.",
        details: {
          language,
          allowed_values: languageQuestion.allowed_values ?? [],
        },
      },
    };
  }

  if (scope === "project_root" && !projectId) {
    return {
      ok: false,
      error: {
        code: "SETUP_PROJECT_ID_REQUIRED",
        message: "project_id is required when scope is project_root.",
        details: { scope, project_id: projectId },
      },
    };
  }

  return {
    ok: true,
    flow,
    resolved_answers: {
      scope,
      project_id: projectId,
      language,
      bootstrap_from_scenes: Boolean(bootstrapFromScenes),
      high_impact_overrides: overrides,
      voice_notes: typeof voiceNotes === "string" && voiceNotes.trim().length > 0
        ? voiceNotes
        : undefined,
    },
  };
}

export function buildStyleguideSetupArtifactPlan({ resolvedAnswers, sceneCount = 0 }) {
  const configAction = {
    tool: "setup_prose_styleguide_config",
    arguments: {
      scope: resolvedAnswers.scope,
      language: resolvedAnswers.language,
      ...(resolvedAnswers.project_id ? { project_id: resolvedAnswers.project_id } : {}),
      ...(Object.keys(resolvedAnswers.high_impact_overrides ?? {}).length > 0
        ? { overrides: resolvedAnswers.high_impact_overrides }
        : {}),
      ...(resolvedAnswers.voice_notes ? { voice_notes: resolvedAnswers.voice_notes } : {}),
    },
  };

  const actions = [];
  if (resolvedAnswers.bootstrap_from_scenes) {
    actions.push({
      tool: "bootstrap_prose_styleguide_config",
      arguments: {
        ...(resolvedAnswers.project_id ? { project_id: resolvedAnswers.project_id } : {}),
        max_scenes: Math.max(1, sceneCount || 1),
      },
      mode: "preview_or_confirm",
    });
  }

  actions.push(configAction);

  if (resolvedAnswers.scope === "sync_root") {
    actions.push({
      tool: "setup_prose_styleguide_skill",
      arguments: { overwrite: false },
    });
  }

  return {
    ok: true,
    artifact_targets: [
      "prose-styleguide.config.yaml",
      ...(resolvedAnswers.scope === "sync_root" ? ["skills/prose-styleguide/SKILL.md"] : []),
    ],
    actions,
  };
}

export function deriveStyleguideSetupStatus({
  styleguideExists,
  styleguideValid,
  styleguideEnforcementMode,
}) {
  const anyStyleguideExists = Boolean(
    styleguideExists?.sync_root
    || styleguideExists?.universe_root
    || styleguideExists?.project_root
  );
  const isBlockingMode = styleguideEnforcementMode === "required";

  if (!anyStyleguideExists) {
    return {
      status: isBlockingMode ? "missing_blocking" : "missing_advisory",
      setup_recommended: true,
    };
  }

  if (!styleguideValid) {
    return {
      status: isBlockingMode ? "invalid_blocking" : "invalid_advisory",
      setup_recommended: true,
    };
  }

  return {
    status: "complete",
    setup_recommended: false,
  };
}
