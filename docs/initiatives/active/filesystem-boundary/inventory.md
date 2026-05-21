# Filesystem Boundary Inventory

This inventory characterizes direct filesystem mutations for Filesystem Boundary
Hardening Milestone 1.

Scope:

- production application modules under `src/`;
- support scripts under `src/scripts/`;
- tests are excluded from the raw-call-site inventory but are referenced in the
  coverage section;
- Git and SQLite file mutations remain excluded from this boundary initiative.

This inventory was taken after the initial generated-output helper extraction,
so review bundle and structure export writes already show the intended helper
shape.

## Policy Summary

Expected containment by artifact class:

| Artifact class | Boundary | Symlink policy | Mutation policy |
| --- | --- | --- | --- |
| Authored prose | `WRITING_SYNC_DIR` | Revalidate before write; reject symlink targets for writes unless a workflow explicitly opts in. | Preserve snapshot/read-only diagnostics; write only sanctioned prose paths. |
| Sidecars | `WRITING_SYNC_DIR` | Revalidate candidate path and existing ancestors; reject symlink targets for writes. | Write only metadata sidecars derived from validated prose/managed paths. |
| Generated exports | Output dir inside `WRITING_SYNC_DIR` | Existing output dir and ancestors must resolve inside sync root; target symlink files rejected. | Generated filenames cannot traverse; overwrite behavior remains explicit in helper. |
| Styleguide config | `WRITING_SYNC_DIR` | Revalidate path and parent directory; reject symlink targets for writes. | Treat as configuration, not prose or generated output. |
| AI boot/instruction files | `WRITING_SYNC_DIR` | High-risk surface; revalidate parent and target, reject symlink targets, preserve rollback semantics. | Separate helper or explicit artifact option; do not share generic prose-write path silently. |
| World entity files | `WRITING_SYNC_DIR` | Revalidate entity directory and target files; reject symlink targets for writes. | Directory creation plus prose/meta/arc writes should be one bounded workflow. |
| Import sources | External read-only source path | May be outside sync root; source symlinks can be followed only as documented import input. | No mutation of source tree. |
| Import destinations | `WRITING_SYNC_DIR` project/universe scenes subtree | Destination path and ancestors must remain inside expected sync boundary; reject symlink targets. | Copy prose and write sidecar as bounded import transaction. |
| Scrivener relocation | `WRITING_SYNC_DIR` | Source and destination must resolve inside sync root; reject destination symlink targets. | Move/rename with explicit cross-device copy fallback and cleanup behavior. |
| Runtime temp | Runtime-owned temp dir under `os.tmpdir()` | Cleanup constrained to temp dir created by job manager; request/result paths must stay inside it. | Best-effort request/result writes and cleanup only for app-owned job files. |
| Support scripts | Repo or explicit operator-provided path | Script-specific. | Raw mutations may remain when scripts are intentionally outside runtime policy. |

TOCTOU/race-window posture:

- reduce avoidable race windows around overwrite, delete, move, and rollback
  flows where the code can do so clearly;
- do not treat this as adversarial same-user sandboxing for the local app;
- prefer immediate revalidation and target-type checks over broad hardening that
  obscures workflow intent.

## Production Call Sites

| Area | Call sites | Artifact class | Current behavior | Expected boundary/helper | Coverage status |
| --- | --- | --- | --- | --- | --- |
| Generated output boundary | `src/core/filesystem-boundary.js:106`, `src/core/filesystem-boundary.js:168` | Boundary module | Owns guarded directory creation and generated-output writes. | Raw `fs` mutation is allowed here; helper should grow copy/move/delete/runtime variants. | `src/test/unit/filesystem-boundary.test.mjs` covers generated output dir containment, symlink ancestor escape, filename traversal, guarded create/write, and symlink target rejection. |
| Review bundle artifacts | `src/review-bundles/review-bundles-writer.js:21`, `src/review-bundles/review-bundles-writer.js:47`, `src/review-bundles/review-bundles-writer.js:91` | Generated exports | Already routed through generated-output helpers. | Keep helper usage; add integration tests for traversal and symlink target behavior if not already covered by current outside/symlink output-dir tests. | Unit and integration review-bundle tests cover output generation and outside/symlink output dirs. |
| Structure export | `src/structure/structure-export.js:215`, `src/structure/structure-export.js:217` | Generated exports | Already routed through generated-output helpers. | Keep helper usage; restore path validation remains a separate read/validation surface. | `src/test/unit/structure-export.test.mjs`; structure restore coverage in `src/test/unit/structure-restore.test.mjs`. |
| Async jobs | `src/runtime/async-jobs.js:27`, `src/runtime/async-jobs.js:29`, `src/runtime/async-jobs.js:30`, `src/runtime/async-jobs.js:64`, `src/runtime/async-jobs.js:68` | Runtime temp write/cleanup | Creates a temp dir with `mkdtempSync`, writes request JSON, then best-effort removes temp dir or request/result paths after TTL. | Add runtime-temp helpers that remember the created temp root and constrain request/result cleanup to that root. | `src/test/integration/runtime.test.mjs` covers async job behavior; missing focused boundary cleanup tests for hostile/stale paths. |
| Import cleanup | `src/sync/importer.js:169` | Cleanup/delete | Deletes an old existing prose or sidecar file during Scrivener import reconciliation. | Destination cleanup helper scoped to the resolved import target boundary. | `src/test/unit/importer.test.mjs` covers import behavior; missing focused cleanup escape test. |
| Import destination writes | `src/sync/importer.js:327`, `src/sync/importer.js:399`, `src/sync/importer.js:400`, `src/sync/importer.js:401` | Import destination prose/sidecar | Validates project-id path containment with `path.relative`, creates scenes dirs, copies source prose, writes sidecar. | Destination helpers for bounded create/copy/write; import source remains read-only and may be outside sync root. | `src/test/unit/importer.test.mjs`; missing symlink ancestor and destination-target tests. |
| Scrivener relocation move | `src/sync/scrivener-direct.js:78`, `src/sync/scrivener-direct.js:92`, `src/sync/scrivener-direct.js:99`, `src/sync/scrivener-direct.js:113`, `src/sync/scrivener-direct.js:117`, `src/sync/scrivener-direct.js:136` | Move/rename/copy/delete | Creates destination parent, renames prose, falls back to copy/unlink on `EXDEV`, and cleans up best effort on failures. | Guarded move helper scoped to sync root with explicit cross-device fallback policy and partial failure cleanup. | `src/test/unit/sync.test.mjs` covers Scrivener direct behavior; missing explicit boundary/symlink tests for relocation. |
| Scrivener sidecar relocation | `src/sync/scrivener-direct.js:768`, `src/sync/scrivener-direct.js:769`, `src/sync/scrivener-direct.js:775` | Sidecar write/delete | Writes final sidecar and removes old sidecar after relocation. | Sync-root sidecar write/delete helpers tied to relocation validation. | `src/test/unit/sync.test.mjs`; missing explicit sidecar delete escape test. |
| Sidecar migration/readMeta | `src/sync/sync.js` | Sidecar writes | `readMeta(..., { writable: true })` and `writeMeta(...)` now route sidecar writes through sync-root sidecar validation. Production callers pass `syncDir` explicitly; unscoped `writeMeta` is rejected. | Keep helper usage; continue migrating delete/move sidecar operations separately. | `src/test/unit/sync.test.mjs` covers sidecar generation and symlink target rejection; broad sync tests cover sidecar generation behavior. |
| Sync-dir writability probe | `src/sync/sync.js:534`, `src/sync/sync.js:535` | Probe write/delete | Writes and unlinks `.mcp-write-check` under sync root to detect read-only runtime. | Keep as low-level sync-root utility or move into boundary helper preserving read-only diagnostics. | Covered indirectly by integration server helpers. |
| Prose edit commit | `src/tools/editing.js` | Authored prose | Routed through authored-prose sync-root validation before reading, snapshotting, and writing accepted proposal content. | Keep helper usage; broader stale-path diagnostics still run before boundary rejection. | `src/test/integration/editing.test.mjs` covers stale path, directory target, and symlink escape rejection. |
| Metadata reference updates | `src/tools/metadata.js` | Metadata/frontmatter write | Reference-doc frontmatter writes are routed through metadata sync-root validation before read/write. Character/place sidecar writes still route through `writeMeta`. | Continue migrating sidecar writes through sidecar helpers. | `src/test/integration/search.test.mjs` covers reference metadata symlink escape rejection; character/place sidecar focused tests remain pending. |
| World entity creation | `src/core/helpers.js` | World entity prose/meta/arc | Routed through world-entity sync-root validation for directory creation, sheet writes, character arc writes, and metadata writes. Existing sheet/meta/arc files are regular-file checked before reuse. | Keep helper usage; partial-write rollback is still future hardening if workflow atomicity becomes necessary. | `src/test/integration/metadata.test.mjs` covers create/reuse/backfill and symlink directory escape rejection. |
| Styleguide config update | `src/styleguide/prose-styleguide.js:615`, `src/styleguide/prose-styleguide.js:616` | Styleguide config | Writes prepared styleguide config path after preparation logic. | Styleguide-config helper scoped to sync root/project root; reject symlink target. | `src/test/unit/styleguide.test.mjs` and `src/test/integration/styleguide.test.mjs`; missing focused symlink-target tests. |
| Styleguide config setup | `src/tools/styleguide.js:272`, `src/tools/styleguide.js:273` | Styleguide config | Creates parent and writes setup config draft. | Same styleguide-config helper as prose-styleguide update path. | Styleguide unit/integration tests cover setup behavior. |
| Claude boot file | `src/tools/styleguide.js:87`, `src/tools/styleguide.js:100`, `src/tools/styleguide.js:101` | AI boot/instruction file | Appends import or creates/overwrites `CLAUDE.md`. | High-risk AI boot helper scoped to sync root; preserve append/overwrite semantics and reject symlink target. | Styleguide integration tests cover create/overwrite/rollback paths; missing symlink-target test. |
| Copilot instruction file | `src/tools/styleguide.js:136`, `src/tools/styleguide.js:137`, `src/tools/styleguide.js:151` | AI boot/instruction file | Creates, overwrites, appends, or replaces managed block in `.github/copilot-instructions.md`. | High-risk AI boot helper scoped to sync root and `.github` parent handling. | Styleguide integration tests cover file-vs-dir and rollback behavior; missing symlink-target test. |
| Styleguide rollback and skill file | `src/tools/styleguide.js:906`, `src/tools/styleguide.js:907`, `src/tools/styleguide.js:910`, `src/tools/styleguide.js:937`, `src/tools/styleguide.js:938` | AI boot file, generated skill file, rollback cleanup | Restores backups, removes newly-created files, then writes `skills/prose-styleguide/SKILL.md`. | Dedicated styleguide publish helper with bounded rollback that cannot remove outside sync root. | Styleguide integration tests cover rollback failure and sentinel preservation; missing explicit rollback escape test. |

## Support Script Call Sites

Support scripts are not runtime MCP workflow surfaces. They may keep raw
filesystem mutation when the script is explicitly operator-facing or repo-local,
but Milestone 4 linting should make that allowance visible.

| Script | Call sites | Classification | Current/expected handling |
| --- | --- | --- | --- |
| `src/scripts/async-job-runner.mjs` | `mkdirSync`, `writeFileSync` | Runtime child process result write | Pair with async job runtime-temp helper or validate request/result paths before runner writes. |
| `src/scripts/generate-tool-docs.mjs` | `mkdirSync`, `writeFileSync` | Repo docs generation | Repo-local support script; raw writes acceptable with lint exemption. |
| `src/scripts/manual-validation.mjs` | `rmSync` | Manual fixture cleanup | Manual support script; raw cleanup acceptable with lint exemption. |
| `src/scripts/manual-scrivener-realtest.mjs` | `rmSync`, `mkdirSync` | Manual fixture setup/cleanup | Manual support script; raw mutation acceptable with lint exemption. |
| `src/scripts/new-world-entity.js` | `mkdirSync`, `writeFileSync` | Legacy/support world entity creation | Either migrate to shared helper or classify as support script if no longer a runtime path. |
| `src/scripts/profile-review-bundles.mjs` | `mkdtempSync`, `rmSync` | Benchmark temp setup/cleanup | Support script temp lifecycle; raw mutation acceptable with lint exemption. |
| `src/scripts/split-versions.js` | `writeFileSync` | Repo maintenance | Repo-local support script; raw write acceptable with lint exemption. |
| `src/scripts/sync-server-json-version.mjs` | `writeFileSync` | Repo maintenance | Repo-local support script; raw write acceptable with lint exemption. |

## Coverage Notes

Existing tests that characterize current behavior:

- `src/test/unit/filesystem-boundary.test.mjs` covers the generated-output
  helper behavior already extracted.
- `src/test/unit/review-bundles.test.mjs` and
  `src/test/integration/review-bundles.test.mjs` cover generated review bundle
  planning/writing, outside output dirs, and symlink output dirs.
- `src/test/unit/structure-export.test.mjs` and
  `src/test/unit/structure-restore.test.mjs` cover structure export/restore
  validation surfaces.
- `src/test/unit/importer.test.mjs` covers Scrivener import behavior before
  destination write helpers are introduced.
- `src/test/unit/sync.test.mjs` and `src/test/integration/sync.test.mjs` cover
  sidecar migration, Scrivener direct merge, and structural sync behavior.
- `src/test/integration/editing.test.mjs` covers prose edit proposal/commit
  behavior.
- `src/test/unit/styleguide.test.mjs` and
  `src/test/integration/styleguide.test.mjs` cover styleguide config, generated
  skill files, AI boot files, and rollback behavior.
- `src/test/integration/runtime.test.mjs` covers async job behavior.

Highest-value gaps before broad migration:

- runtime temp helpers should get focused path-containment and cleanup tests;
- Scrivener relocation should get source/destination boundary and symlink tests
  before replacing move/copy/delete logic;
- import cleanup should get a regression test proving stale destination cleanup
  cannot delete outside the import target boundary;
- styleguide config and AI boot writes should each get at least one
  symlink-target rejection test when moved to artifact-aware helpers;
- styleguide rollback should get a bounded-cleanup test before raw rollback
  removal is replaced.
