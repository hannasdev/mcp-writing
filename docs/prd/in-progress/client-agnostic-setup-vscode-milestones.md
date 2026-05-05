# Client-Agnostic Setup — VS Code First Milestones

Status: Draft for review  
Owner: MCP Writing  
Date: 2026-05-05

## Objective

Implement the first production slice of the client-agnostic setup contract using a VS Code-native setup flow for prose styleguide configuration, while keeping MCP focused on durable capabilities.

## Scope

In scope:
- Versioned shared setup contract for `styleguide_setup_v1`
- Shared contract runtime/evaluation helpers in MCP Writing
- `describe_workflows` setup-status recommendation integration
- VS Code adapter flow as first client implementation
- Unit + integration coverage for contract behavior and parity

Out of scope:
- OpenClaw setup adapter implementation (follow-on phase)
- New onboarding-only MCP tool family
- Expansion to additional setup domains beyond prose styleguide

## Guardrails

- Preserve existing styleguide behavior and tool contracts.
- Canonical output files remain the source of truth.
- Setup completion is derived from actual filesystem/config state.
- Keep the implementation as a single focused concern.

## Milestones

## M1 — Contract Artifact and Schema

Deliverables:
- Add a versioned setup contract artifact for `styleguide_setup_v1`.
- Add schema validation for contract structure and required sections:
  - `schema_version`
  - `flows`
  - `questions`
  - `defaults`
  - `validation_rules`
  - `artifact_targets`
  - `completion_rules`

Acceptance criteria:
- Invalid contracts fail with clear validation errors.
- Contract content is sufficient to drive the styleguide flow without client-specific assumptions.

## M2 — Shared Contract Runtime

Deliverables:
- Load and validate contract at runtime.
- Resolve question ordering and default derivation.
- Map accepted answers to canonical styleguide artifact targets.
- Add completion-state derivation from real files/config validity.

Acceptance criteria:
- Runtime produces deterministic setup plans from the same inputs.
- Completion state reflects artifact reality, not transient wizard state.

## M3 — Workflow Integration Boundary

Deliverables:
- Integrate completion checks into setup recommendations surfaced by `describe_workflows`.
- Maintain recommendation-only behavior (no wizard transport logic added to MCP workflows).

Acceptance criteria:
- Missing/invalid setup is surfaced correctly as advisory or blocking per existing mode semantics.
- `describe_workflows` remains a navigator, not a setup engine.

## M4 — VS Code Adapter (First Client)

Deliverables:
- VS Code command entry point for styleguide setup.
- Native prompt flow that renders contract questions and confirms planned output.
- Validation error presentation and safe re-run behavior.
- Write canonical output files through the shared mapping/runtime path.

Acceptance criteria:
- A user can complete styleguide setup end-to-end from VS Code.
- Outputs are equivalent to canonical server-side expectations.

## M5 — Regression and Parity Test Coverage

Unit tests:
- Contract schema/version validation
- Question ordering/default derivation
- Answer-to-artifact mapping
- Completion-rule evaluation

Integration tests:
- Contract-driven setup writes expected canonical files
- `describe_workflows` setup recommendation behavior
- Existing styleguide setup/bootstrap/update/drift tool paths remain functional
- Equivalent answers produce equivalent final config between setup paths

Acceptance criteria:
- New tests pass.
- No behavior regressions in existing styleguide capabilities.

## M6 — Documentation and Rollout Notes

Deliverables:
- Document contract lifecycle and update policy.
- Document VS Code adapter usage and expected behavior.
- Record deferred OpenClaw adapter as next phase.

Acceptance criteria:
- Maintainers can update contract/version intentionally.
- Users have a clear VS Code-first path without protocol expansion.

## Test Strategy Summary

Unit + integration are mandatory for each milestone that changes behavior.
Manual verification before sign-off:
- Complete setup from VS Code in a clean project.
- Re-run flow with existing valid config and confirm expected reconfigure behavior.
- Confirm output file equivalence against existing canonical setup expectations.

## Definition of Done

This implementation is complete when:
1. VS Code-first flow is contract-driven and production-usable.
2. Canonical output files are unchanged in role and consistent in content.
3. `describe_workflows` setup recommendation is accurate and bounded.
4. Test coverage demonstrates contract correctness and regression safety.
5. OpenClaw remains explicitly deferred, not partially implemented.
