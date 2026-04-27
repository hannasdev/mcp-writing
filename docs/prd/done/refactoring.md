# Targets for refactoring

**Status:** ✅ Done — All structural refactors complete. #10 (node:sqlite flag) is a passive monitoring note, not a work item.

---

## Phasing Plan

The eight items below have different risk profiles. This plan sequences them to minimize regression at each step.

### Phase A — Groundwork, no behavior change ✅

Zero-risk fixes and test infrastructure hardening. Do this before any structural work so every subsequent phase has a solid foundation.

1. ✅ **#5** Proposal ID → `randomUUID()`. One line, confirms the pattern works.
2. ✅ **#7** Audit `git.js` for instruction argument interpolation. Fix if needed, document if clean. *(Fixed: `getSceneProseAtCommit` and `listSnapshots` converted to `execFileSync`. Remaining 6 `execSync` calls use static strings only — confirmed safe.)*
3. ✅ **#6 (first half)** Extract shared test helpers (temp dirs, test databases) into `test/helpers/` without splitting test files yet. This is the prerequisite for Phase B.

### Phase B — Test file split (before touching source) ✅

Split test files *before* splitting source files. Gives isolated runners to verify each module as it's extracted.

- `test/sync.test.mjs`, `test/editing.test.mjs`, `test/review-bundles.test.mjs`, etc.
- Gate: `node --test 'test/**/*.test.mjs'` must pass with equivalent coverage.

### Phase C — `index.js` extraction, one group per PR ✅

Highest-risk work. One tool group per PR, full integration suite after each. Never mix a structural move with a behavioral fix.

Extraction order (simplest first, highest-risk last):

1. ✅ `registerSyncTools`
2. ✅ `registerSearchTools` — read-only, no side effects
3. ✅ `registerMetadataTools` — sidecar writes, low interaction surface
4. ✅ `registerReviewBundleTools`
5. ✅ `registerStyleguideTools`
6. ✅ `registerEditingTools` — last; stateful, git-backed

Keep a registration summary in `index.js` so grep still gives a full tool inventory.

**Main failure mode:** context values (`db`, `SYNC_DIR`, etc.) not threading into extracted handlers. Define the context object shape explicitly before starting.

### Phase D — Schema migration infrastructure (#4) ✅

After `index.js` is split. Touches `db.js` which all modules depend on.

1. ✅ Add `schema_version` table with a single integer row.
2. ✅ Convert existing `ALTER TABLE` checks to `migration 1` and `migration 2`.
3. ✅ Gate: test against a clean database (version 0) and an existing production database.

### Phase E — Async job state persistence (#3) ✅

Last because it's new behavior (not pure refactor) and a prerequisite for OpenClaw, not the current system. Schema migration infrastructure from Phase D must land first.

### Phase F — Module extraction (investigation complete) ✅

Investigation read all three large domain modules plus the remaining `index.js` surface. Findings:

**`scene-character-normalization.js` (198 lines):** No action. Purely algorithmic, well-structured, size is proportionate.

**`prose-styleguide.js` (684 lines):** No action. ~26% is data (`ENUMS` + `LANGUAGE_DEFAULTS`), rest is algorithmic. Extracting the data to JSON would save ~180 lines but couples tightly-related data away from the validation code that uses it. Not worth it.

**`review-bundles.js` (997 lines):** Split warranted. Three distinct algorithmic concerns — plan, render, write — with clean seams. `normalizeRecipientDisplayName` is the one cross-cutting helper (used by planner and renderers); it moves with the planner and gets imported by the renderers.
- `review-bundles-planner.js` — `buildReviewBundlePlan` + its helpers (`sceneSort`, `buildWarningSummary`, `resolveRequestedSceneIds`, `assertProfile/Strictness/Format`, `slugifyBundleName`, `normalizeRecipientDisplayName`)
- `review-bundles-renderer.js` — `renderReviewBundleMarkdown`, `renderReviewBundlePdf`, and their helpers (`loadBundleSceneRows`, `resolveSceneFilePath`, `readProse`, `renderSceneBlock`, `renderBetaNoticeMarkdown`, `renderBetaFeedbackFormMarkdown`, `escapeMarkdown`)
- `review-bundles-writer.js` — `createReviewBundleArtifacts` + `resolveOutputFilePath`
- `review-bundles.js` — kept as re-export façade so the `tools/review-bundles.js` import surface is unchanged
- **Do not fix** the known logline bug (renders in all profiles; should be `outline_discussion` only) in this phase — behavioral fix belongs in a separate PR.

**`index.js` (1164 lines after Phase E):** Two extractions warranted. Everything else (startup sequencing, server factory, transport, two inline tools, graceful shutdown) is appropriately in index.js.
- `async-jobs.js` (~207 lines): `startAsyncJob`, `pruneAsyncJobs`, `toPublicJob`, `readJsonIfExists`. Pattern: export a factory `createAsyncJobManager({ db, asyncJobs, ttlMs, runnerDir })` returning the functions, keeping coupled state encapsulated. Already threaded through `toolContext`.
- `helpers.js` (~240 lines): `deriveLoglineFromProse`, `inferCharacterIdsFromProse`, `readSupportingNotesForEntity`, `readEntityMetadata`, `resolveProjectRoot`, `resolveWorldEntityDir`, `resolveBatchTargetScenes`, `createCanonicalWorldEntity`. Most already take explicit parameters; the ones that reference `SYNC_DIR` take it as a parameter. All already in `toolContext` — move is clean.
- Path safety utilities (`isPathInsideSyncDir`, `isPathCandidateInsideSyncDir`, `resolveOutputDirWithinSync`, ~90 lines) — fold into `helpers.js`.
- After both extractions `index.js` lands at ~500 lines, proportionate to its actual job.

**Sequencing (completed):**
1. ✅ `review-bundles.js` split (planner / renderer / writer façade)
2. ✅ `async-jobs.js` extraction from `index.js`
3. ✅ `helpers.js` extraction from `index.js`
4. ✅ Path safety folded into `helpers.js`
5. ✅ `workflow-catalogue.js` extracted from `index.js`

---

### Rules across all phases

- Never mix a behavioral fix with a structural rename in the same commit.
- Run the full integration test suite after every extraction.
- After Phase A groundwork lands, keep each PR purely structural (no logic change) **or** purely behavioral (no file moves) — not both.
- Phase C: if a group's tests don't pass in isolation after the move, stop and diagnose before continuing.

---

## 1. index.js is doing too many jobs — HIGH ✅ Done

Completed via extraction of tool registration modules plus focused utility modules (`async-jobs.js`, `helpers.js`, and `workflow-catalogue.js`). `index.js` now primarily handles startup, transport wiring, context assembly, and registration orchestration instead of carrying large inline data and helper implementations.

## 2. Large domain modules — MEDIUM ✅ Done

Resolved by splitting `review-bundles.js` into planner/renderer/writer modules while intentionally leaving `prose-styleguide.js` and `scene-character-normalization.js` intact based on investigation outcomes (size judged proportionate and/or data tightly coupled to logic).

## 3. In-memory async job state — MEDIUM (important for OpenClaw) ✅ Done

Implemented with checkpoint persistence and restart recovery behavior. Runtime async state still uses an in-memory map for active process handles, while persisted job records prevent silent loss on restart and provide deterministic status semantics.

## 4. Schema migration is accumulating — MEDIUM ✅ Done

Implemented with a `schema_version` table and a numbered migration pipeline in `db.js`, replacing ad-hoc migration drift and making future schema evolution predictable.

## 5. Edit proposal IDs are sequential and reset on restart — LOW ✅ Done

pendingProposals uses IDs like proposal-1, proposal-2, ... generated by a counter that resets on server restart. After a restart, old proposal IDs are stale (the proposals are gone), and new sessions start generating the same IDs. This is a minor hazard rather than a bug — proposals are short-lived — but randomUUID() is already imported and would cost one line to use here instead.

Tradeoff: None worth mentioning. This is a straightforward improvement.

## 6. Test files mirror the source problem — LOW ✅ Done

Two 100KB+ test files (unit.test.mjs, integration.test.mjs) are the test-side equivalent of the index.js problem. Finding tests for a specific module, or running tests for one area while debugging, is harder than it needs to be.

A proportionate split: Mirror the domain module structure — test/sync.test.mjs, test/git.test.mjs, test/review-bundles.test.mjs, etc. Node.js built-in test runner accepts file globs, so node --test 'test/**/*.test.mjs' would still run everything. Individual module tests become easy to run in isolation.

Tradeoff: Splitting tests is mechanical work. The risk is accidentally splitting related tests that share setup code. If there's significant shared test infrastructure (temp directories, test databases), that needs to move to a shared helper first.

## 7. git.js shell-outs and the instruction argument — LOW ✅ Done

All git operations shell out to the git CLI via child_process. This is the right pragmatic choice over a native binding. The one thing worth verifying: createSnapshot takes an instruction argument (AI-generated text from the propose_edit / snapshot_scene tools) and uses it in a commit message. As long as this is passed as a separate array element to execSync rather than string-interpolated into a shell command, there's no injection risk. If it's interpolated, that's a security concern worth fixing even for a personal tool.

## 9. SQLite 999-parameter limit in review bundle queries — LOW ✅ Done

Surfaced during the Phase F review-bundles split (PR #105). Two places in `review-bundles-planner.js` had unbounded `IN (...)` clauses that could exceed SQLite's host-parameter limit for large `scene_ids` arrays.

Fixed by:

- chunking `resolveRequestedSceneIds` at 900 IDs per query;
- adding an explicit guard in `buildReviewBundlePlan` that throws `ReviewBundlePlanError(code: "SCENE_IDS_TOO_LARGE")` when `scene_ids.length > 900`.

This keeps planner behavior deterministic and fails fast with a clear user-facing error code instead of a low-level SQLite binding error.

## 10. node:sqlite experimental flag — LOW

The --experimental-sqlite flag is required in Node.js 22 but was stabilized in Node.js 23+. This is in the npm start script already. No immediate action needed, but it's worth monitoring and testing on Node 24 to confirm the flag can eventually be dropped. The alternative (switching to better-sqlite3) removes the experimental risk but adds a native build dependency — not worth it right now.
