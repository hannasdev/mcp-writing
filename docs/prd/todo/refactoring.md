# Targets for refactoring

## 1. index.js is doing too many jobs — HIGH

At 3371 lines, index.js combines: HTTP server setup, MCP server factory, all 43 tool registrations (schema + implementation + error handling), async job lifecycle, edit proposal state, path safety utilities, runtime diagnostics, and graceful shutdown. None of this is wrong individually, but together it makes the file hard to navigate and means any change to any tool — no matter how isolated — touches this one file.

The actual tool handlers are thin (they delegate to domain modules), so the problem isn't logic complexity. It's routing + validation + error handling for 43 tools all inline.

A practical split: A function like registerEditingTools(server, context) per tool group (sync, editing, styleguide, etc.), where context is a plain object with {db, SYNC_DIR, SYNC_DIR_WRITABLE, GIT_ENABLED, ...}. index.js becomes: assemble context → register all tool groups → start HTTP server. This mirrors what the code already does conceptually, just without the physical grouping.

Tradeoff: More files means you need to know which module owns which tool. For 43 tools across maybe 6-8 groups, that's manageable with clear file names. The overhead is low because the module boundaries map to tool categories that already exist in your mental model (and in PRD.md). Searching for a specific tool gets slightly harder without an IDE, but better for reading any one group.

The counter-argument for leaving it is that the current layout makes grep "s.tool" a complete tool inventory. That's a real convenience worth acknowledging — it can be preserved by keeping a registration summary in index.js even after the handlers move.

## 2. Large domain modules — MEDIUM

review-bundles.js (~34K lines), prose-styleguide.js (~17.6K lines), and scene-character-normalization.js (~5.5K lines) are notably large. Without reading them in full, I can't attribute the size precisely, but based on the feature descriptions the likely contributors are: inline language defaults for 24 languages, PDF template strings, normalization dictionaries, and verbose error-handling branches.

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

## 5. Edit proposal IDs are sequential and reset on restart — LOW

pendingProposals uses IDs like proposal-1, proposal-2, ... generated by a counter that resets on server restart. After a restart, old proposal IDs are stale (the proposals are gone), and new sessions start generating the same IDs. This is a minor hazard rather than a bug — proposals are short-lived — but randomUUID() is already imported and would cost one line to use here instead.

Tradeoff: None worth mentioning. This is a straightforward improvement.

## 6. Test files mirror the source problem — LOW

Two 100KB+ test files (unit.test.mjs, integration.test.mjs) are the test-side equivalent of the index.js problem. Finding tests for a specific module, or running tests for one area while debugging, is harder than it needs to be.

A proportionate split: Mirror the domain module structure — test/sync.test.mjs, test/git.test.mjs, test/review-bundles.test.mjs, etc. Node.js built-in test runner accepts file globs, so node --test 'test/**/*.test.mjs' would still run everything. Individual module tests become easy to run in isolation.

Tradeoff: Splitting tests is mechanical work. The risk is accidentally splitting related tests that share setup code. If there's significant shared test infrastructure (temp directories, test databases), that needs to move to a shared helper first.

## 7. git.js shell-outs and the instruction argument — LOW

All git operations shell out to the git CLI via child_process. This is the right pragmatic choice over a native binding. The one thing worth verifying: createSnapshot takes an instruction argument (AI-generated text from the propose_edit / snapshot_scene tools) and uses it in a commit message. As long as this is passed as a separate array element to execSync rather than string-interpolated into a shell command, there's no injection risk. If it's interpolated, that's a security concern worth fixing even for a personal tool.

## 8. node:sqlite experimental flag — LOW

The --experimental-sqlite flag is required in Node.js 22 but was stabilized in Node.js 23+. This is in the npm start script already. No immediate action needed, but it's worth monitoring and testing on Node 24 to confirm the flag can eventually be dropped. The alternative (switching to better-sqlite3) removes the experimental risk but adds a native build dependency — not worth it right now.
