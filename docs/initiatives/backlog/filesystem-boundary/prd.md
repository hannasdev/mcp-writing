# PRD: Filesystem Boundary Hardening

**Status:** 📋 Deferred backlog (not active)

This initiative captures follow-up work discovered while adding security linting to the development workflow.
It is not part of the current ESLint plugin setup branch unless explicitly selected as active implementation scope.

## Goal

Centralize filesystem access rules so features can read, write, move, and delete manuscript artifacts through application-aware helpers instead of repeating path-safety logic in each workflow.

The product goal is:

- fewer review-missable filesystem safety checks;
- one clear place for sync-root containment, symlink, overwrite, and deletion policy;
- security linting that warns about application-relevant risks rather than core product concepts;
- simpler feature code when adding new file-backed workflows.

## Problem

Writing MCP intentionally works with local manuscript files.
Generic security lint rules such as "non-literal filesystem path" produce broad warnings because dynamic file paths are central to the product.
Those warnings are too noisy to enforce directly, but the underlying risk is real:

- write, delete, and move operations appear in multiple feature modules;
- each module must remember sync-root containment, project ID validation, symlink behavior, and output filename safety;
- reviewers have to reconstruct the path-safety story from local code instead of recognizing a shared boundary API;
- future workflows could introduce raw filesystem mutation that bypasses existing guard patterns.

The current codebase already has several good guard patterns, including sync-root output validation and structure restore path checks.
The issue is distribution, not absence of care.

## Product Boundary

This initiative is about hardening local filesystem boundaries for existing file-backed workflows.
It should preserve current product behavior unless a later implementation PR explicitly calls out a behavior change.

In scope:

- shared helpers for resolving paths inside `WRITING_SYNC_DIR`;
- shared helpers for output directories and generated filenames;
- shared wrappers or guard functions for text writes, deletes, moves, and regular-file checks;
- clear symlink policy per operation type;
- migration of high-risk call sites to the shared boundary;
- project-specific linting to discourage new raw filesystem mutation outside approved modules;
- characterization tests around existing behavior before refactoring risky paths.

Out of scope:

- changing authored prose storage away from files;
- replacing SQLite or sidecar metadata architecture;
- changing Scrivener import semantics;
- introducing remote filesystem or cloud storage support;
- making every read operation go through a heavy abstraction when simple reads are already constrained by indexed paths;
- enabling generic `security/detect-non-literal-fs-filename` warnings as a PR gate.

## Design Principles

1. **Filesystem access is a product feature, not a smell**
   Dynamic paths are expected. Warnings should focus on unsafe mutation or missing boundary checks, not on the existence of file IO.

2. **Centralize policy, keep intent local**
   Feature code should still make workflow intent obvious, but containment and symlink rules should live in one place.

3. **Prefer explicit trust boundaries**
   Helpers should distinguish sync-root paths, generated output paths, existing indexed file paths, and import/source paths.

4. **Make destructive actions recognizable**
   Writes, deletes, moves, and removals should be easy to search, review, and lint.

5. **Refactor before enforcement**
   Add lint restrictions only after approved safe paths exist, so the rule guides future code instead of creating migration noise.

## Proposed Architecture

Add a small filesystem boundary module under `src/core/`, with naming to be decided during implementation.
Candidate responsibilities:

- resolve a candidate path against `WRITING_SYNC_DIR`;
- resolve paths that may not exist yet by canonicalizing the nearest existing ancestor;
- validate output directories and generated filenames;
- assert regular files and reject or explicitly handle symlinks;
- provide guarded write, delete, and move operations;
- return consistent validation errors and diagnostic details.

Candidate helper shape:

```js
resolveInsideSyncDir(candidatePath)
resolveCandidateInsideSyncDir(candidatePath)
resolveOutputDirWithinSync(outputDir)
resolveGeneratedOutputPath(outputDir, fileName)
assertRegularFile(path)
writeTextInsideSync(path, content)
deleteInsideSync(path)
moveInsideSync(fromPath, toPath)
```

The exact names can change.
The important contract is that callers use helpers that encode the filesystem boundary being trusted.

## Filesystem Policy Questions

Implementation should answer these explicitly before broad migration:

- Which operations follow symlinks, and which reject them?
- Should generated output writes overwrite existing files, fail, or require an explicit option?
- Which paths may exist outside `WRITING_SYNC_DIR` during import or setup, and are they read-only?
- Should indexed `scene.file_path` values be revalidated before every write, or only when stale/path diagnostics are present?
- How should helper errors map to existing MCP error envelopes?
- Which low-level modules are allowed to perform raw filesystem mutation after the migration?

## Initial High-Risk Surfaces

Prioritize write/delete/move workflows before broad read-only migration:

- Scrivener direct merge relocation in `src/sync/scrivener-direct.js`;
- import file writes and cleanup in `src/sync/importer.js`;
- sidecar migration and generated sidecar writes in `src/sync/sync.js`;
- review bundle output writes in `src/review-bundles/review-bundles-writer.js`;
- prose edit commits in `src/tools/editing.js`;
- metadata and styleguide config writes in `src/tools/metadata.js` and `src/tools/styleguide.js`;
- structure export and restore file validation in `src/structure/structure-export.js` and `src/structure/structure-restore.js`;
- async job request/result file cleanup in `src/runtime/async-jobs.js`.

## Milestone 1: Boundary Inventory and Characterization

Functional requirements:

1. Inventory raw filesystem mutation call sites.
2. Categorize each call site as sync-root write, generated output write, import/source read, cleanup/delete, move/rename, or support script.
3. Document the expected containment and symlink behavior for each category.
4. Add or identify tests covering current behavior for the highest-risk categories.

Acceptance criteria:

1. A maintainer can see which call sites remain raw and why.
2. Existing behavior is characterized before shared helpers change it.
3. No behavior changes are made in this milestone unless explicitly documented.

## Milestone 2: Shared Boundary Helpers

Functional requirements:

1. Extract existing sync-root containment logic into a reusable core module.
2. Add helpers for candidate paths whose target file may not exist yet.
3. Add generated output path validation that prevents filename traversal.
4. Add regular-file and symlink checks for workflows that trust file contents.
5. Preserve existing error codes and user-facing guidance where possible.

Acceptance criteria:

1. Existing output directory validation still rejects paths outside `WRITING_SYNC_DIR`.
2. Existing symlink escape tests continue to pass.
3. Helper tests cover existing paths, missing target paths, symlink ancestors, traversal attempts, and non-regular files.

## Milestone 3: Migrate High-Risk Mutation Surfaces

Functional requirements:

1. Move review bundle outputs to generated-output helpers.
2. Move structure export and restore checks to shared boundary helpers.
3. Move prose edit and metadata write paths to sync-root mutation helpers.
4. Move import and Scrivener relocation paths only after characterization tests are in place.
5. Keep workflow outputs, diagnostics, and side effects equivalent unless a behavior change is intentionally accepted.

Acceptance criteria:

1. Raw write/delete/move calls are removed from high-risk feature modules or isolated behind approved wrappers.
2. Existing integration tests for sync, import, editing, review bundles, and structure restore pass.
3. Reviewers can verify path safety by checking helper choice rather than re-deriving path logic at every call site.

## Milestone 4: Application-Aware Lint Enforcement

Functional requirements:

1. Add a local lint rule or `no-restricted-syntax` configuration for raw filesystem mutation calls.
2. Allow raw mutation only inside the filesystem boundary module and intentionally scoped support scripts.
3. Keep generic `security/detect-non-literal-fs-filename` disabled in normal PR linting.
4. Document how to add a new filesystem workflow safely.

Acceptance criteria:

1. New direct uses of `fs.writeFileSync`, `fs.unlinkSync`, `fs.renameSync`, or `fs.rmSync` in feature modules fail lint.
2. Existing legitimate filesystem operations pass through approved helpers.
3. Lint output remains actionable and low-noise.

## Test Strategy

Unit tests:

- path resolution inside and outside sync root;
- missing target paths with safe and unsafe existing ancestors;
- symlinked ancestors and symlinked files;
- generated filename traversal attempts;
- overwrite, delete, and move helper behavior;
- error envelope mapping for invalid paths.

Integration tests:

- review bundle output rejects symlink escape and traversal filenames;
- structure restore refuses exports and referenced files outside sync root;
- prose edit commit refuses stale or invalid prose paths;
- Scrivener merge relocation preserves current behavior while using shared helpers;
- import cleanup does not delete outside the expected import target boundary.

Manual verification:

- run `npm run check:pr`;
- run representative import, review-bundle, edit, structure export, and restore workflows on a fixture sync directory;
- inspect lint output after intentionally adding a raw filesystem mutation in a feature module.

## Related

- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Structural Authority Hardening](../../done/structural-authority-hardening/prd.md)
- [Target Architecture Migration](../../done/target-architecture-migration/prd.md)
