import { z } from "zod";

const actionSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  mode: z.enum(["preview_or_confirm", "write"]).optional(),
  note: z.string().min(1).optional(),
});

const planPreviewSchema = z.object({
  flow_id: z.literal("styleguide_setup_v1"),
  default_scope: z.enum(["project_root", "sync_root"]),
  actions: z.array(actionSchema),
});

export const setupContractContextSchema = z.union([
  z.object({
    contract_id: z.literal("styleguide_setup_v1"),
    schema_version: z.string().min(1),
    styleguide_setup_status: z.enum([
      "missing_advisory",
      "missing_blocking",
      "invalid_advisory",
      "invalid_blocking",
      "complete",
    ]),
    setup_recommended: z.boolean(),
    plan_preview: planPreviewSchema,
  }),
  z.object({
    contract_id: z.literal("styleguide_setup_v1"),
    status: z.literal("unavailable"),
    error_code: z.string().min(1),
  }),
]);

export function validateSetupContractContext(payload) {
  const parsed = setupContractContextSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SETUP_CONTRACT_CONTEXT",
        message: "describe_workflows produced an invalid setup_contract context payload.",
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
