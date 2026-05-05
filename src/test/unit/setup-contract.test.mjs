import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStyleguideSetupArtifactPlan,
  deriveStyleguideSetupStatus,
  loadSetupContract,
  resolveStyleguideSetupAnswers,
} from "../../setup/setup-contract.js";
import { STYLEGUIDE_ENUMS } from "../../styleguide/prose-styleguide.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../..");

describe("loadSetupContract", () => {
  test("loads and validates styleguide_setup_v1 contract", () => {
    const result = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(result.ok, true);
    assert.equal(result.contract_id, "styleguide_setup_v1");
    assert.equal(result.contract.schema_version, "1.0.0");
    assert.ok(Array.isArray(result.contract.flows));
    assert.ok(result.contract.flows.some((f) => f.id === "styleguide_setup_v1"));
  });

  test("returns a structured error for unknown contract id", () => {
    const result = loadSetupContract({ rootDir: ROOT_DIR, contractId: "unknown_contract" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SETUP_CONTRACT_NOT_FOUND");
  });

  test("keeps language allowed_values in parity with STYLEGUIDE_ENUMS.language", () => {
    const result = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(result.ok, true);
    const contractLanguages = result.contract.questions.language.allowed_values;
    assert.deepEqual(contractLanguages, STYLEGUIDE_ENUMS.language);
  });
});

describe("deriveStyleguideSetupStatus", () => {
  test("returns advisory missing when no config exists and enforcement is warn", () => {
    const status = deriveStyleguideSetupStatus({
      styleguideExists: { sync_root: false, universe_root: false, project_root: false },
      styleguideValid: true,
      styleguideSkillExists: false,
      styleguideEnforcementMode: "warn",
    });
    assert.equal(status.status, "missing_advisory");
    assert.equal(status.setup_recommended, true);
  });

  test("returns blocking missing when no config exists and enforcement is required", () => {
    const status = deriveStyleguideSetupStatus({
      styleguideExists: { sync_root: false, universe_root: false, project_root: false },
      styleguideValid: true,
      styleguideSkillExists: false,
      styleguideEnforcementMode: "required",
    });
    assert.equal(status.status, "missing_blocking");
    assert.equal(status.setup_recommended, true);
  });

  test("returns advisory invalid when config exists but is invalid in warn mode", () => {
    const status = deriveStyleguideSetupStatus({
      styleguideExists: { sync_root: true, universe_root: false, project_root: false },
      styleguideValid: false,
      styleguideSkillExists: true,
      styleguideEnforcementMode: "warn",
    });
    assert.equal(status.status, "invalid_advisory");
    assert.equal(status.setup_recommended, true);
  });

  test("returns complete when config exists and is valid", () => {
    const status = deriveStyleguideSetupStatus({
      styleguideExists: { sync_root: false, universe_root: false, project_root: true },
      styleguideValid: true,
      styleguideSkillExists: true,
      styleguideEnforcementMode: "required",
    });
    assert.equal(status.status, "complete");
    assert.equal(status.setup_recommended, false);
  });

  test("returns invalid when sync-root skill is missing for sync-root-only setup", () => {
    const status = deriveStyleguideSetupStatus({
      styleguideExists: { sync_root: true, universe_root: false, project_root: false },
      styleguideValid: true,
      styleguideSkillExists: false,
      styleguideEnforcementMode: "warn",
    });
    assert.equal(status.status, "invalid_advisory");
    assert.equal(status.setup_recommended, true);
  });
});

describe("resolveStyleguideSetupAnswers", () => {
  test("rejects invalid scope values", () => {
    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const result = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: { scope: "workspace_root", language: "english_us" },
      inferred: { project_id: "test-novel" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_SETUP_SCOPE");
  });

  test("rejects non-boolean bootstrap_from_scenes", () => {
    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const result = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: { language: "english_us", bootstrap_from_scenes: "false" },
      inferred: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_SETUP_BOOTSTRAP_FLAG");
  });

  test("requires project_id when resolved scope is project_root", () => {
    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const result = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: { scope: "project_root", language: "english_us" },
      inferred: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SETUP_PROJECT_ID_REQUIRED");
  });

  test("resolves defaults and inferred project_id", () => {
    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const result = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: { language: "english_uk" },
      inferred: { project_id: "test-novel" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.resolved_answers.scope, "project_root");
    assert.equal(result.resolved_answers.project_id, "test-novel");
    assert.equal(result.resolved_answers.language, "english_uk");
    assert.equal(result.resolved_answers.bootstrap_from_scenes, true);
  });

  test("defaults to sync_root when project_id cannot be inferred", () => {
    const loaded = loadSetupContract({ rootDir: ROOT_DIR, contractId: "styleguide_setup_v1" });
    assert.equal(loaded.ok, true);
    const result = resolveStyleguideSetupAnswers({
      contract: loaded.contract,
      answers: { language: "english_uk" },
      inferred: {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.resolved_answers.scope, "sync_root");
    assert.equal(result.resolved_answers.project_id, null);
  });
});

describe("buildStyleguideSetupArtifactPlan", () => {
  test("includes sync-root skill setup when scope is sync_root", () => {
    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: {
        scope: "sync_root",
        project_id: null,
        language: "english_us",
        bootstrap_from_scenes: true,
        high_impact_overrides: {},
      },
      sceneCount: 42,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.actions[0].tool, "setup_prose_styleguide_config");
    assert.equal(plan.actions[1].tool, "setup_prose_styleguide_skill");
    assert.equal(plan.actions[0].mode, "write");
    assert.equal(plan.actions[1].mode, "write");
    assert.equal(plan.actions[0].arguments.overwrite, false);
    assert.equal(plan.actions[1].arguments.overwrite, true);
  });

  test("includes bootstrap only when project_id exists", () => {
    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: {
        scope: "sync_root",
        project_id: "test-novel",
        language: "english_us",
        bootstrap_from_scenes: true,
        high_impact_overrides: {},
      },
      sceneCount: 42,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.actions[0].tool, "bootstrap_prose_styleguide_config");
    assert.equal(plan.actions[0].arguments.project_id, "test-novel");
    assert.equal(plan.actions[0].arguments.max_scenes, 42);
    assert.equal(plan.actions[0].mode, "preview_or_confirm");
    assert.equal(typeof plan.actions[0].note, "string");
  });

  test("omits skill setup for project-root scope", () => {
    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: {
        scope: "project_root",
        project_id: "test-novel",
        language: "english_us",
        bootstrap_from_scenes: false,
        high_impact_overrides: { oxford_comma: "yes" },
      },
      sceneCount: 10,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.actions[0].tool, "setup_prose_styleguide_config");
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].arguments.project_id, "test-novel");
    assert.equal(plan.actions[0].arguments.overwrite, false);
  });

  test("sets overwrite=true for invalid setup status to support repair", () => {
    const plan = buildStyleguideSetupArtifactPlan({
      resolvedAnswers: {
        scope: "project_root",
        project_id: "test-novel",
        language: "english_us",
        bootstrap_from_scenes: false,
        high_impact_overrides: {},
      },
      sceneCount: 10,
      setupStatus: "invalid_advisory",
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.actions[0].arguments.overwrite, true);
  });
});
