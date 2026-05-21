# Filesystem Boundary Milestones

This document tracks implementation sequencing for Filesystem Boundary Hardening.
Use [prd.md](prd.md) for product framing and [architecture.md](architecture.md) for technical design.

## Initial High-Risk Surfaces

Prioritize write/delete/move workflows before broad read-only migration:

- Scrivener direct merge relocation in `src/sync/scrivener-direct.js`;
- import file writes and cleanup in `src/sync/importer.js`;
- sidecar migration and generated sidecar writes in `src/sync/sync.js`;
- review bundle output writes in `src/review-bundles/review-bundles-writer.js`;
- prose edit commits in `src/tools/editing.js`;
- metadata and styleguide config writes in `src/tools/metadata.js` and `src/tools/styleguide.js`;
- world-entity file creation in `src/core/helpers.js`;
- styleguide configuration writes in `src/styleguide/prose-styleguide.js`;
- AI boot and instruction file writes in `src/tools/styleguide.js`, including `skills/prose-styleguide/SKILL.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`;
- structure export and restore file validation in `src/structure/structure-export.js` and `src/structure/structure-restore.js`;
- async job request/result file cleanup in `src/runtime/async-jobs.js`.

## Milestone 1: Boundary Inventory and Characterization

Functional requirements:

1. Generate and review an inventory of raw filesystem mutation call sites.
2. Categorize each call site by path boundary and artifact class: sync-root write, generated output write, runtime-temp write/cleanup, import/source read, authored prose, sidecar, styleguide config, AI boot/instruction file, directory creation, copy, cleanup/delete, move/rename, or support script.
3. Document the expected containment and symlink behavior for each category.
4. Add or identify tests covering current behavior for the highest-risk categories.

Acceptance criteria:

1. A maintainer can see, in a checked-in inventory table or equivalent initiative artifact, which call sites remain raw and why.
2. Existing behavior is characterized before shared helpers change it.
3. No behavior changes are made in this milestone unless explicitly documented.

## Milestone 2: Shared Boundary Helpers

Functional requirements:

1. Extract existing sync-root containment logic into a reusable core module.
2. Add helpers for candidate paths whose target file may not exist yet.
3. Add runtime-temp boundary helpers for async request/result files and cleanup.
4. Add generated output path validation that prevents filename traversal.
5. Add guarded directory creation for workflow-owned output paths.
6. Add artifact-class-aware helper entry points or options for authored prose, sidecars, generated exports, styleguide config, AI boot/instruction files, import sources, runtime temp files, and support scripts.
7. Add guarded copy and move helpers, including an explicit cross-device move fallback policy.
8. Add regular-file and symlink checks for workflows that trust file contents.
9. Preserve existing error codes, read-only runtime checks, and user-facing guidance where possible.

Acceptance criteria:

1. Existing output directory validation still rejects paths outside `WRITING_SYNC_DIR`.
2. Existing symlink escape tests continue to pass.
3. Helper tests cover existing paths, missing target paths, symlink ancestors, traversal attempts, guarded directory creation, guarded copy/move behavior, cross-device move fallback decisions, runtime-temp cleanup, partial-write cleanup, and non-regular files.

## Milestone 3: Migrate High-Risk Mutation Surfaces

Functional requirements:

1. Move review bundle outputs to generated-output helpers.
2. Move structure export and restore checks to shared boundary helpers.
3. Move prose edit and metadata write paths to sync-root mutation helpers.
4. Move world-entity and styleguide configuration writes to the appropriate sync-root or generated-output helpers.
5. Move async request/result cleanup to runtime-temp helpers.
6. Move import and Scrivener relocation paths only after characterization tests are in place.
7. Keep workflow outputs, diagnostics, and side effects equivalent unless a behavior change is intentionally accepted.

Acceptance criteria:

1. Raw directory-create/write/copy/delete/move calls are removed from high-risk feature modules or isolated behind approved wrappers.
2. Existing integration tests for sync, import, editing, review bundles, and structure restore pass.
3. Reviewers can verify path safety by checking helper choice rather than re-deriving path logic at every call site.

## Milestone 4: Application-Aware Lint Enforcement

Functional requirements:

1. Add a local lint rule or `no-restricted-syntax` configuration for raw filesystem mutation calls.
2. Allow raw mutation only inside the filesystem boundary module and intentionally scoped support scripts.
3. Keep generic `security/detect-non-literal-fs-filename` disabled in normal PR linting.
4. Cover common bypass forms, including destructured `node:fs` imports, `fs.promises`, aliased imports, directory-creation calls, and copy calls.
5. Document how to add a new filesystem workflow safely.

Acceptance criteria:

1. New direct uses of `fs.writeFileSync`, `fs.copyFileSync`, `fs.unlinkSync`, `fs.renameSync`, `fs.rmSync`, `fs.mkdirSync`, equivalent `fs.promises` mutations, or destructured/aliased mutation imports in feature modules fail lint.
2. Existing legitimate filesystem operations pass through approved helpers.
3. Lint tests or fixture checks prove the restricted forms fail in feature modules while approved boundary modules and support scripts remain exempt.
4. Lint output remains actionable and low-noise.

## Test Strategy

Unit tests:

- path resolution inside and outside sync root;
- runtime-temp path resolution and cleanup containment;
- import/source path classification;
- artifact-class-specific helper behavior;
- missing target paths with safe and unsafe existing ancestors;
- symlinked ancestors and symlinked files;
- generated filename traversal attempts;
- guarded directory creation;
- overwrite, copy, delete, and move helper behavior;
- cross-device move fallback policy and partial-write cleanup;
- practical race-window reduction for sensitive overwrite or destructive helpers, without asserting adversarial same-user protection;
- read-only runtime and permission error mapping;
- error envelope mapping for invalid paths.

Integration tests:

- review bundle output rejects symlink escape and traversal filenames;
- structure restore refuses exports and referenced files outside sync root;
- prose edit commit refuses stale or invalid prose paths;
- Scrivener merge relocation preserves current behavior while using shared helpers;
- Scrivener relocation copy fallback preserves current behavior while constraining both source and destination boundaries;
- import cleanup does not delete outside the expected import target boundary;
- AI boot/instruction file writes remain explicit, bounded, and rollback-safe;
- async job cleanup does not remove paths outside the runtime-owned temporary directory.

Manual verification:

- run `npm run check:pr`;
- run representative import, review-bundle, edit, structure export, and restore workflows on a fixture sync directory;
- inspect lint output after intentionally adding raw filesystem mutations, destructured mutation imports, `fs.promises` mutations, copy operations, and directory creation in a feature module.

## Related

- [prd.md](prd.md)
- [architecture.md](architecture.md)
