# Root Structure Reorganization

**Status:** 📥 Inbox

## Motivation

The repository root is becoming crowded with runtime modules, orchestration files, and domain logic. This increases cognitive overhead for contributors, makes ownership boundaries less obvious, and raises refactor risk because related code is spread across many top-level files.

Current structure quality is still acceptable, but drift has reached a point where a lightweight reorganization will improve maintainability without changing product behavior.

## Problem Statement

The root currently mixes:
- app startup and runtime wiring;
- domain modules for sync, review bundles, styleguide, and scene-character processing;
- cross-cutting helpers and diagnostics.

This makes navigation slower and increases the chance of accidental coupling during edits.

## Goals

1. Consolidate runtime code under a clear `src/` source root.
2. Preserve behavior and public tool contracts (no MCP API changes in this effort).
3. Keep migration incremental, test-gated, and rollback-safe.
4. Improve discoverability by aligning file location with domain boundaries.
5. Establish a durable placement pattern so new modules do not reintroduce ambiguity under `src/`.
6. Make the intended public JavaScript/package surface explicit via `package.json` `exports`, not just by shipping files in the package tarball.

## Non-Goals

1. No behavior fixes or feature additions.
2. No protocol/tool schema changes.
3. No release process redesign.
4. No broad renaming of user-facing identifiers.

## Design Principles

1. Structural-only changes per commit (no mixed behavior work).
2. Small, reversible moves with passing tests after each step.
3. Prefer a single compatibility boundary over many temporary wrappers.
4. Explicit ownership boundaries: core, runtime, sync, review bundles, styleguide, world, tools, scripts, tests.
5. No catch-all `misc` or `utils` namespace for modules that lack a clear home; if placement is unclear, resolve the boundary before moving the file.

## Proposed Target Layout

```text
.
├─ index.js                      # thin package/bootstrap shim
├─ src/
│  ├─ index.js                   # real startup/server entrypoint
│  ├─ core/
│  │  ├─ db.js
│  │  ├─ git.js
│  │  └─ helpers.js
│  ├─ runtime/
│  │  ├─ async-jobs.js
│  │  ├─ async-progress.js
│  │  └─ runtime-diagnostics.js
│  ├─ sync/
│  │  ├─ sync.js
│  │  ├─ importer.js
│  │  ├─ scrivener-direct.js
│  │  ├─ scene-character-batch.js
│  │  ├─ scene-character-normalization.js
│  │  └─ metadata-lint.js
│  ├─ review-bundles/
│  │  ├─ review-bundles.js
│  │  ├─ review-bundles-planner.js
│  │  ├─ review-bundles-renderer.js
│  │  └─ review-bundles-writer.js
│  ├─ styleguide/
│  │  ├─ prose-styleguide.js
│  │  ├─ prose-styleguide-skill.js
│  │  └─ prose-styleguide-drift.js
│  ├─ world/
│  │  └─ world-entity-templates.js
│  ├─ tools/                     # MCP tool surface
│  ├─ scripts/                   # CLI/manual scripts
│  ├─ test/                      # tests
│  └─ workflows/
│     └─ workflow-catalogue.js
└─ docs/                         # docs structure (kept)
```

## Conventions and Boundaries

### Package Surface

1. Treat `files` and `exports` as separate concerns:
- `files` controls what is shipped in the npm package.
- `exports` defines the supported public JavaScript entrypoints.
2. Include `exports` as part of this reorganization so package consumers have an explicit supported surface.
3. Prefer keeping the supported public JS surface minimal. Shipping an internal file does not, by itself, make it a supported import path.
4. Keep exactly one root compatibility shim unless a stronger packaging reason emerges: `index.js`.

### Domain Ownership

1. A module should live in the domain it is primarily about, even if another domain also reuses it.
2. `src/core/` is for domain-neutral infrastructure and foundational primitives only.
3. A module belongs in `src/core/` only if all of the following are true:
- it is domain-neutral;
- it provides infrastructure or foundational primitives rather than product policy;
- it is plausibly shared across multiple domains;
- it does not more naturally belong to one feature area;
- it does not import from feature domains such as `sync`, `review-bundles`, or `styleguide`.
4. `metadata-lint.js` belongs in `src/sync/` under the current design because it validates sync-folder metadata structure and is used by repository tooling, not as a separate MCP feature domain.
5. No `misc`, `shared`, or vague `utils` namespace should be introduced unless its scope and rules are explicitly documented first.

### Dependency Direction

1. `src/tools/` may depend on domain modules; domain modules must not depend on `src/tools/`.
2. `src/scripts/` may depend on domain modules; domain modules must not depend on `src/scripts/`.
3. `src/test/` may depend on anything under `src/`; runtime code must not depend on tests.
4. `src/core/` must not import from feature domains.
5. New top-level domains under `src/` require an explicit reason and should not appear ad hoc during the migration.

### Guard Rails

1. Start with a simple CI grep/check that forbids newly introduced legacy root imports after a module has moved.
2. A stricter custom lint rule can be added later if the lighter guard proves too weak or noisy.
3. We do not need to decide on the stricter rule up front; the lightweight CI guard is sufficient for this migration.

## Migration Strategy

### Compatibility Pattern

During migration, keep the compatibility surface as small as possible:

```js
// index.js (thin bootstrap shim)
export * from "./src/index.js";
```

The preferred approach is to update internal imports directly to `src/**` paths during the move. Avoid keeping many temporary root-level module wrappers unless a published package entrypoint truly requires one for compatibility.

### File Move Map (Initial)

- `db.js` -> `src/core/db.js`
- `git.js` -> `src/core/git.js`
- `helpers.js` -> `src/core/helpers.js`
- `async-jobs.js` -> `src/runtime/async-jobs.js`
- `async-progress.js` -> `src/runtime/async-progress.js`
- `runtime-diagnostics.js` -> `src/runtime/runtime-diagnostics.js`
- `importer.js` -> `src/sync/importer.js`
- `sync.js` -> `src/sync/sync.js`
- `scrivener-direct.js` -> `src/sync/scrivener-direct.js`
- `scene-character-batch.js` -> `src/sync/scene-character-batch.js`
- `scene-character-normalization.js` -> `src/sync/scene-character-normalization.js`
- `metadata-lint.js` -> `src/sync/metadata-lint.js`
- `review-bundles.js` -> `src/review-bundles/review-bundles.js`
- `review-bundles-planner.js` -> `src/review-bundles/review-bundles-planner.js`
- `review-bundles-renderer.js` -> `src/review-bundles/review-bundles-renderer.js`
- `review-bundles-writer.js` -> `src/review-bundles/review-bundles-writer.js`
- `prose-styleguide.js` -> `src/styleguide/prose-styleguide.js`
- `prose-styleguide-skill.js` -> `src/styleguide/prose-styleguide-skill.js`
- `prose-styleguide-drift.js` -> `src/styleguide/prose-styleguide-drift.js`
- `world-entity-templates.js` -> `src/world/world-entity-templates.js`
- `workflow-catalogue.js` -> `src/workflows/workflow-catalogue.js`
- `tools/` -> `src/tools/`
- `scripts/` -> `src/scripts/`
- `test/` -> `src/test/`

## Phased Rollout

### Phase 0: Baseline and Safety Net

1. Freeze behavior scope (refactor-only label).
2. Capture baseline test pass.
3. Add import smoke checks for key modules.
4. Update lint/package checks so `src/**` is covered before or alongside the move.
5. Add or update `package.json` `exports` so the intended supported JS surface is explicit before broad path churn begins.

Gate:
- `npm run lint` passes on baseline branch.
- `npm test` passes on baseline branch.

### Phase 1: Establish `src/` as the Code Root

1. Create `src/` and move the real server entrypoint to `src/index.js`.
2. Move `core`, `runtime`, `tools`, `scripts`, and `test` under `src/`.
3. Keep a thin root `index.js` shim only if needed for package/bootstrap compatibility.
4. Update internal imports to use `src/**` paths directly.
5. Introduce the initial `exports` map and align `main`/entrypoint behavior with the new structure.

Gate:
- Lint passes with `src/**` included in coverage.
- Unit tests pass.
- Integration tests pass.
- No MCP tool signature changes.
- Package entrypoints resolve through the intended `exports` surface.

### Phase 2: Move Sync Domain

1. Move sync/import/scene-character modules.
2. Move world-entity helpers into the chosen world namespace.
3. Update imports in tool handlers and scripts in the same change set.
4. Validate Scrivener and sync flows via integration suite.

Gate:
- Lint passes.
- Sync and metadata integration tests pass.
- Manual smoke: server start, `sync`, `find_scenes`.

### Phase 3: Move Review Bundles and Styleguide Domain

1. Move review bundle and styleguide files.
2. Update remaining imports and package metadata (`files`, `main`, and `exports`).
3. Validate bundle generation and style checks.

Gate:
- Lint passes.
- Review bundles unit+integration tests pass.
- Styleguide tests pass.

### Phase 4: Cleanup and Guard Rails

1. Search for legacy root-level imports still in use.
2. Remove temporary compatibility shims once no internal imports remain.
3. Add a guardrail that forbids introducing new root-level imports after a module has moved.
4. Update docs that reference old paths.

Gate:
- Lint passes.
- `npm test` pass.
- No references to deprecated root module paths.

## Regression Risk Matrix

1. Import path regressions:
- Risk: high
- Mitigation: thin compatibility shim + direct internal import updates + CI checks

2. Circular dependency introduction:
- Risk: medium
- Mitigation: run static import checks and keep domain boundaries strict

3. Script/tooling path assumptions:
- Risk: medium
- Mitigation: move scripts with the same phase as their dependencies; run script smoke tests; verify package.json script paths

4. Hidden runtime startup breakage:
- Risk: medium
- Mitigation: startup smoke test in CI (`/healthz`, `/sse`)

5. Lint or packaging coverage drift:
- Risk: medium
- Mitigation: update lint globs, package allowlists, and `exports` at the same time as file moves; keep tests that validate published file coverage and supported package entrypoints

## Test Strategy

### Unit Tests

Run all unit tests after each phase:
- `npm run lint`
- `npm run test:unit`

Focus assertions:
- exports still available at expected module boundaries;
- package `exports` resolve only the intended public entrypoints;
- moved modules preserve behavior and side effects;
- lint still traverses the moved source tree;
- review bundle planners/renderers unchanged.

### Integration Tests

Run full integration after each domain phase:
- `npm test`

Focus assertions:
- server startup still succeeds;
- MCP tools still return expected shapes;
- sync/import/editing/review-bundle flows remain stable.

### Additional Guard Rails

1. Add a temporary test that imports the root bootstrap shim and `src/index.js` and confirms equivalent startup/export behavior during migration.
2. Add a startup smoke check in CI to catch missing module paths early.
3. Add a temporary guardrail that fails CI if newly moved modules are imported from legacy root paths. A simple CI grep/check is the default first implementation.
4. Keep `package.json` `files` coverage in sync with the source layout so published artifacts remain intentional.
5. Add a package smoke test using `npm pack` to verify the tarball contents and exported entrypoints after the move.

## Acceptance Criteria

1. Repository root contains only package/bootstrap/config/docs and stable top-level folders.
2. Runtime code, tools, scripts, and tests live under `src/` by capability.
3. All tests pass with no behavior deltas.
4. No MCP tool contract changes.
5. Lint still covers the moved code after the reorganization.
6. No catch-all namespace is introduced under `src/`; every moved module has an intentional domain home.
7. `package.json` `exports` explicitly describes the supported public JS surface after the move.
8. Temporary wrappers removed before completion.

## Rollback Plan

If regressions appear in any phase:
1. Revert only that phase commit(s).
2. Keep prior successful phase intact.
3. Re-run unit and integration tests to verify recovery.

Because phases are incremental and behavior-neutral, rollback should be low-cost and localized.

## Open Questions

1. What is the smallest useful `exports` surface for the package after the move: only the main server entrypoint, or a small set of explicitly supported helpers/scripts?
2. Should compatibility cleanup happen in the same PR as the final move or in one dedicated follow-up PR for easier review?
3. Are there any remaining modules whose ownership should be clarified before implementation starts, so we avoid inventing a catch-all bucket mid-migration? Current expectation: decide case-by-case if any such files are discovered.

## Related

- [../done/refactoring.md](../done/refactoring.md)
- [../../development.md](../../development.md)
- [../../../AGENTS.md](../../../AGENTS.md)
