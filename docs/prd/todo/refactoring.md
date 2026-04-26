# Targets for refactoring

**Status:** 🚧 In Progress — Phases A, B, C, D done; Phase E next

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

### Phase E — Async job state persistence (#3)

Last because it's new behavior (not pure refactor) and a prerequisite for OpenClaw, not the current system. Schema migration infrastructure from Phase D must land first.

### Phase F — Large domain module investigation (#2)

After structural work is stable: read `review-bundles.js`, `prose-styleguide.js`, `scene-character-normalization.js` to determine what drives the size. Data → extract to JSON/YAML. Algorithmic → sub-modules. Don't pre-decide.

---

### Rules across all phases

- Never mix a behavioral fix with a structural rename in the same commit.
- Run the full integration test suite after every extraction.
- After Phase A groundwork lands, keep each PR purely structural (no logic change) **or** purely behavioral (no file moves) — not both.
- Phase C: if a group's tests don't pass in isolation after the move, stop and diagnose before continuing.

---

## 1. index.js is doing too many jobs — HIGH

At ~3.5k lines, index.js combines: HTTP server setup, MCP server factory, all 43 tool registrations (schema + implementation + error handling), async job lifecycle, edit proposal state, path safety utilities, runtime diagnostics, and graceful shutdown. None of this is wrong individually, but together it makes the file hard to navigate and means any change to any tool — no matter how isolated — touches this one file.

The actual tool handlers are thin (they delegate to domain modules), so the problem isn't logic complexity. It's routing + validation + error handling for 43 tools all inline.

A practical split: A function like registerEditingTools(server, context) per tool group (sync, editing, styleguide, etc.), where context is a plain object with {db, SYNC_DIR, SYNC_DIR_WRITABLE, GIT_ENABLED, ...}. index.js becomes: assemble context → register all tool groups → start HTTP server. This mirrors what the code already does conceptually, just without the physical grouping.

Tradeoff: More files means you need to know which module owns which tool. For 43 tools across maybe 6-8 groups, that's manageable with clear file names. The overhead is low because the module boundaries map to tool categories that already exist in your mental model (and in PRD.md). Searching for a specific tool gets slightly harder without an IDE, but better for reading any one group.

The counter-argument for leaving it is that the current layout makes grep "s.tool" a complete tool inventory. That's a real convenience worth acknowledging — it can be preserved by keeping a registration summary in index.js even after the handlers move.

## 2. Large domain modules — MEDIUM

review-bundles.js, prose-styleguide.js, and scene-character-normalization.js are notably large relative to surrounding modules. Without reading them in full, I can't attribute the size precisely, but based on the feature descriptions the likely contributors are: inline language defaults for 24 languages, PDF template strings, normalization dictionaries, and verbose error-handling branches.

If the size is primarily from embedded data (language defaults, normalization lookup tables), extracting those to JSON/YAML data files would reduce the code-to-data ratio and make both easier to reason about. If the size is genuinely algorithmic complexity, splitting into sub-modules (e.g., prose-styleguide-defaults.js, prose-styleguide-cascade.js) might help.

Tradeoff: Extracting data to JSON adds a file read at startup and removes the "everything in one place" advantage. Sub-modules add import chains without necessarily making individual files simpler. This is worth investigating before deciding — the suggestion depends heavily on what's actually driving the size, which I didn't read in full.

## 3. In-memory async job state — MEDIUM (important for OpenClaw)

Async jobs live in a Map in the server process. On restart (crash, deploy, SIGKILL past the timeout), all jobs and their state are gone. A caller polling get_async_job_status after a restart gets job_not_found. This is probably acceptable for the current local single-user use case — jobs complete in minutes — but it becomes a real issue in a service deployment.

A minimal fix: On exit, write live job state to the SQLite database. On startup, read it back and mark any running jobs as failed with error: "server restarted while job was running". This prevents misleading state without adding per-progress-update I/O. It's roughly 30 lines in db.js (one table) plus checkpoint writes at creation and completion.

Tradeoff: Full per-progress-update persistence would add SQLite I/O on every progress event, which is noisy for a batch job processing hundreds of scenes. The checkpoint-only approach (create + complete) avoids that while solving the "silent loss" problem. For OpenClaw, this is probably a prerequisite rather than a nice-to-have.

## 4. Schema migration is accumulating — MEDIUM

The current approach works: CREATE TABLE IF NOT EXISTS for the base schema, then explicit ALTER TABLE ADD COLUMN checks for missing columns, then an FTS rebuild check. But it's already grown to handle two specific migration cases (chapter_title column, FTS keywords column), and with Phase 4 (embeddings, reference docs) and Phase 5 (OpenClaw) both likely requiring schema changes, this pattern will keep growing in place.

The risk is that as migrations accumulate, db.js becomes hard to read and the migration state becomes unclear for databases at different versions.

A proportionate fix: A schema_version table with one integer row. An array of migration functions, each applied only if version < N. This is 40-50 lines of infrastructure, not a full ORM. Existing migrations become migration 1 and migration 2 in the array. New features add new entries without touching old code.

Tradeoff: It's more code upfront, and the current approach isn't broken. The argument for doing it now is that the cost of retrofitting numbered migrations grows with each new ad-hoc check added.

## 5. Edit proposal IDs are sequential and reset on restart — LOW ✅ Done

pendingProposals uses IDs like proposal-1, proposal-2, ... generated by a counter that resets on server restart. After a restart, old proposal IDs are stale (the proposals are gone), and new sessions start generating the same IDs. This is a minor hazard rather than a bug — proposals are short-lived — but randomUUID() is already imported and would cost one line to use here instead.

Tradeoff: None worth mentioning. This is a straightforward improvement.

## 6. Test files mirror the source problem — LOW ✅ Done

Two 100KB+ test files (unit.test.mjs, integration.test.mjs) are the test-side equivalent of the index.js problem. Finding tests for a specific module, or running tests for one area while debugging, is harder than it needs to be.

A proportionate split: Mirror the domain module structure — test/sync.test.mjs, test/git.test.mjs, test/review-bundles.test.mjs, etc. Node.js built-in test runner accepts file globs, so node --test 'test/**/*.test.mjs' would still run everything. Individual module tests become easy to run in isolation.

Tradeoff: Splitting tests is mechanical work. The risk is accidentally splitting related tests that share setup code. If there's significant shared test infrastructure (temp directories, test databases), that needs to move to a shared helper first.

## 7. git.js shell-outs and the instruction argument — LOW ✅ Done

All git operations shell out to the git CLI via child_process. This is the right pragmatic choice over a native binding. The one thing worth verifying: createSnapshot takes an instruction argument (AI-generated text from the propose_edit / snapshot_scene tools) and uses it in a commit message. As long as this is passed as a separate array element to execSync rather than string-interpolated into a shell command, there's no injection risk. If it's interpolated, that's a security concern worth fixing even for a personal tool.

## 8. node:sqlite experimental flag — LOW

The --experimental-sqlite flag is required in Node.js 22 but was stabilized in Node.js 23+. This is in the npm start script already. No immediate action needed, but it's worth monitoring and testing on Node 24 to confirm the flag can eventually be dropped. The alternative (switching to better-sqlite3) removes the experimental risk but adds a native build dependency — not worth it right now.
