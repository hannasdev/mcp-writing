import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateSetupContractContext } from "../../setup/setup-contract-response-schema.js";

describe("validateSetupContractContext", () => {
  test("accepts available payload shape", () => {
    const result = validateSetupContractContext({
      contract_id: "styleguide_setup_v1",
      schema_version: "1.0.0",
      styleguide_setup_status: "missing_advisory",
      setup_recommended: true,
      plan_preview: {
        flow_id: "styleguide_setup_v1",
        default_scope: "sync_root",
        actions: [
          {
            tool: "setup_prose_styleguide_config",
            arguments: { scope: "sync_root", language: "english_us", overwrite: false },
            mode: "write",
          },
        ],
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.plan_preview.actions[0].mode, "write");
  });

  test("accepts unavailable payload shape", () => {
    const result = validateSetupContractContext({
      contract_id: "styleguide_setup_v1",
      status: "unavailable",
      error_code: "SETUP_CONTRACT_FILE_MISSING",
    });
    assert.equal(result.ok, true);
  });

  test("rejects payload missing plan_preview in available shape", () => {
    const result = validateSetupContractContext({
      contract_id: "styleguide_setup_v1",
      schema_version: "1.0.0",
      styleguide_setup_status: "missing_advisory",
      setup_recommended: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_SETUP_CONTRACT_CONTEXT");
  });
});
