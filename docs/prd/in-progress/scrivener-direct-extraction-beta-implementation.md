# Scrivener Direct Extraction (Beta) — Implementation Checklist

**Status:** 🚧 In Progress

This document translates the beta PRD into execution-ready tasks. It is intentionally checklist-first to limit scope creep.

## Milestones

- M1: Parser and merge core extracted from legacy script ✅
- M2: Official beta entrypoints (MCP + CLI) ✅
- M2.5: Large-project UX (async jobs, warning aggregation, scoped parsing) ✅
- M3: Safety and parity hardening
- M4: Docs, compatibility posture, and beta operations

## Recommended Execution Order

Use focused PRs with one concern each. Do not combine milestones unless explicitly required.

1. PR-1: Parser core extraction (foundation) ✅
2. PR-2: MCP beta entrypoint and dry-run payloads ✅
3. PR-2.5: Large-project UX hardening ✅
4. PR-3: Ownership and parity hardening
5. PR-4: Docs, compatibility matrix, and beta operational guidance

---

## Phase A — Parser Core Extraction (M1) ✅

### Tasks

- [x] Extract `.scrivx` parsing and Scrivener data reads from `scripts/merge-scrivx.js` into reusable module(s)
- [x] Define typed internal model for:
  - [x] binder items
  - [x] sync number to UUID mapping
  - [x] keyword map
  - [x] per-scene extracted metadata
- [x] Define deterministic merge contract (input scene sidecar + extracted data -> merged sidecar)
- [x] Preserve current script behavior while moving logic out of script wrapper

### Deliverables

- [x] `scrivener-direct.js` — parser/merge module with `loadScrivenerProjectData`, `mergeSidecarData`, `mergeScrivenerProjectMetadata` exports
- [x] `scripts/merge-scrivx.js` — thinned to ~15-line arg-parsing wrapper

---

## Phase B — Official Beta Entry Points (M2) ✅

### Tasks

- [x] Add MCP beta tool for direct Scrivener extraction (`merge_scrivener_project_beta`)
- [x] Keep stable `import_scrivener_sync` unchanged and documented as default
- [x] Add explicit beta wording in tool/CLI descriptions and responses
- [x] Add `dry_run` summary with field-level change preview counts
- [x] Add `scenes_dir` override parameter for non-standard sync layouts
- [x] Universe-scoped `project_id` (`universe/project`) resolves to correct `universes/` path

### Deliverables

- [x] MCP tool in `index.js` with structured success/error payloads
- [x] `SCRIVENER_DIRECT_BETA_FAILED` error code with `details.fallback` guidance
- [x] Integration tests: dry-run stats, failure fallback, `scenes_dir` override, priority over `project_id`

---

## Phase B.5 — Large-Project UX Hardening (M2.5) ✅

This phase was identified during manual testing against a real 430+ file project where blocking MCP calls timed out.

### Tasks

- [x] Async job infrastructure: `startAsyncJob`, `toPublicJob`, TTL-based pruning
- [x] `import_scrivener_sync_async` — non-blocking import, returns `job_id` immediately
- [x] `merge_scrivener_project_beta_async` — non-blocking merge, returns `job_id` immediately
- [x] `get_async_job_status` — poll job by ID, returns status + result payload
- [x] `list_async_jobs` — list all known jobs with optional result payloads
- [x] `cancel_async_job` — SIGTERM worker process, marks job cancelled
- [x] `scripts/async-job-runner.mjs` — isolated worker process for both import and merge kinds
- [x] Warning aggregation in `sync.js`: `buildWarningSummary` buckets warnings by type with `count` + up to 5 `examples`; all sync responses return `warning_summary` instead of raw flat list
- [x] `import_scrivener_sync` and `import_scrivener_sync_async`: `preflight` mode (scan without writing, returns `file_previews`, `files_to_process`, `existing_sidecars`)
- [x] `import_scrivener_sync` and `import_scrivener_sync_async`: `ignore_patterns` (array of regex strings matched against filenames)
- [x] `MCP_TRANSPORT=stdio` env var: starts server in stdio mode, no HTTP listener, no port conflicts for local tooling and debug scripts

### Warning types tracked

| Type | Trigger |
|---|---|
| `no_scene_id` | File has no `scene_id` in metadata |
| `duplicate_scene_id` | Same `scene_id` in two files under same project |
| `path_metadata_mismatch` | Part/chapter in sidecar doesn't match filesystem path |
| `orphaned_sidecar` | `.meta.yaml` has no matching prose file |
| `moved_scene` | Sidecar exists at stale path (prose moved) |
| `nested_mirror` | Path is inside a nested mirror directory |

### Acceptance Criteria

- [x] Large imports don't block MCP; clients poll status until completion
- [x] Async jobs retain result for TTL window (default 24h, configurable via `ASYNC_JOB_TTL_MS`)
- [x] Warning flood on large trees is summarised, not raw-listed
- [x] `preflight` answers "what would this import do?" before any disk writes
- [x] `ignore_patterns` excludes noise files (fragments, beat sheets) from import scope
- [x] `MCP_TRANSPORT=stdio` allows local debug scripts without port conflicts

### Deliverables

- [x] `scripts/async-job-runner.mjs` — worker process
- [x] 5 new MCP tools: `import_scrivener_sync_async`, `merge_scrivener_project_beta_async`, `get_async_job_status`, `list_async_jobs`, `cancel_async_job`
- [x] Integration tests: async import completes, async merge completes, preflight no-write, `ignore_patterns` count

---

## Phase C — Safety and Parity Hardening (M3)

### Tasks

- [ ] Enforce importer-authoritative field boundaries during merge
- [ ] Ensure non-authoritative sidecar fields are preserved
- [ ] Normalize handling for:
  - [ ] missing UUID mappings
  - [ ] missing synopsis files
  - [ ] unknown custom fields
  - [ ] malformed metadata values
- [ ] Add conflict/warning reporting for ambiguous mappings
- [ ] Preserve scene identity and reconciliation assumptions from current importer model

### Acceptance Criteria

- [ ] No duplicate logical scenes created due to ordering or path changes in source
- [ ] No silent overwrite of agent-authoritative fields
- [ ] Warning taxonomy is stable and documented

### Deliverables

- [ ] Ownership-safe merge policy implementation
- [ ] Structured warnings and error codes

---

## Phase D — Docs and Beta Ops (M4)

### Tasks

- [ ] Update setup docs with two-path guidance (stable vs beta)
- [ ] Add "tested versions" compatibility section for beta path
- [ ] Add troubleshooting section for parser/schema mismatch failures
- [ ] Add tool reference updates and explicit stability tier labeling

### Acceptance Criteria

- [ ] Users can clearly distinguish stable default from beta option
- [ ] Docs provide a clear fallback path when beta ingestion fails
- [ ] Beta caveats appear in all relevant surfaces (setup, tools, runtime)

### Deliverables

- [ ] Documentation updates across setup and tool reference docs
- [ ] Compatibility notes and operational troubleshooting guidance

---

## Test Plan

### Unit Tests

- [x] Parser reads `.scrivx` maps correctly (sync map, keyword map, binder traversal)
- [x] Metadata extraction handles absent optional files without crash
- [x] Merge contract preserves non-authoritative fields
- [ ] Custom-field mapping allowlist behavior is deterministic

### Integration Tests

- [x] MCP beta tool dry-run against fixture `.scriv` bundle
- [x] MCP beta tool write mode updates sidecars as expected
- [ ] Re-run idempotency: second run does not produce unintended drift
- [x] Fallback messaging on incompatible or malformed source structure
- [x] `scenes_dir` override and priority over `project_id`
- [x] Async import and merge jobs complete successfully
- [x] Preflight returns scan results without writing files
- [x] `ignore_patterns` reduces `created` count correctly

### Regression Coverage

- [x] Existing `import_scrivener_sync` integration tests remain green
- [x] Stable sync-folder import behavior unchanged

---

## Compatibility Matrix (Initial)

Track explicitly as fixtures are added.

- [x] Scrivener fixture A: baseline project structure (UUID-10/13, keywords, custom fields, synopsis)
- [ ] Scrivener fixture B: missing optional metadata files
- [ ] Scrivener fixture C: custom metadata-heavy project
- [ ] Scrivener fixture D: reordered binder hierarchy

For each fixture:

- [ ] parse success
- [ ] merge success
- [ ] warning profile reviewed
- [ ] sidecar preservation checks pass

---

## Exit Criteria For Beta Graduation Review

All must be true before proposing graduation from beta status.

- [ ] Milestones M1-M4 complete
- [ ] No unresolved high-severity data loss issues
- [ ] Compatibility matrix has representative coverage and documented tested versions
- [ ] Fallback path to stable importer validated in automated tests

## Non-Goals Reminder

- Replacing stable sync-folder importer in this initiative
- Supporting every historical Scrivener version on day one
- Expanding into unrelated metadata model changes not required for parity or beta value

## Related

- [scrivener-direct-extraction-beta.md](scrivener-direct-extraction-beta.md)
- [../done/import-sync.md](../done/import-sync.md)
- [../done/metadata.md](../done/metadata.md)


## First PR Scope (PR-1)

Goal: establish reusable parser/merge internals without changing product behavior.

### In Scope

- Extract reusable parser and merge modules from `scripts/merge-scrivx.js`
- Keep the existing script as a thin wrapper
- Add unit tests for parser + merge contract
- Preserve current script outputs for existing fixture data

### Out of Scope

- No MCP tool additions
- No docs/tool-surface labeling changes
- No ownership policy expansion beyond preserving current behavior
- No migration or deprecation messaging

### PR-1 Acceptance Criteria

- Existing script remains runnable with same CLI inputs
- Shared module API is stable enough for later MCP integration
- Unit tests cover success and malformed-input paths
- No changes to stable `import_scrivener_sync` behavior

## Phase A — Parser Core Extraction (M1)

### Tasks

- [ ] Extract `.scrivx` parsing and Scrivener data reads from `scripts/merge-scrivx.js` into reusable module(s)
- [ ] Define typed internal model for:
  - [ ] binder items
  - [ ] sync number to UUID mapping
  - [ ] keyword map
  - [ ] per-scene extracted metadata
- [ ] Define deterministic merge contract (input scene sidecar + extracted data -> merged sidecar)
- [ ] Preserve current script behavior while moving logic out of script wrapper

### Acceptance Criteria

- [ ] Existing script behavior remains functionally equivalent for current supported fixture
- [ ] Core parser/merge logic can be called by both CLI and MCP surfaces
- [ ] Merge function is pure and unit-testable

### Deliverables

- [ ] New parser/merge module(s) under source root
- [ ] Thin `scripts/merge-scrivx.js` wrapper using shared module

## Phase B — Official Beta Entry Points (M2)

### Tasks

- [ ] Add MCP beta tool for direct Scrivener extraction
- [ ] Keep stable `import_scrivener_sync` unchanged and documented as default
- [ ] Add CLI command alias for beta flow (or formalize existing script usage)
- [ ] Add explicit beta wording in tool/CLI descriptions and responses
- [ ] Add `dry_run` summary with field-level change preview counts

### Acceptance Criteria

- [ ] Beta entrypoint is opt-in and never auto-invoked by stable import path
- [ ] On parser/schema failure, output includes actionable fallback to stable import path
- [ ] `dry_run` output gives enough detail for user trust before writes

### Deliverables

- [ ] MCP tool in `index.js` with structured success/error payloads
- [ ] CLI behavior documented and consistent with MCP payload semantics

## Phase C — Safety and Parity Hardening (M3)

### Tasks

- [ ] Enforce importer-authoritative field boundaries during merge
- [ ] Ensure non-authoritative sidecar fields are preserved
- [ ] Normalize handling for:
  - [ ] missing UUID mappings
  - [ ] missing synopsis files
  - [ ] unknown custom fields
  - [ ] malformed metadata values
- [ ] Add conflict/warning reporting for ambiguous mappings
- [ ] Preserve scene identity and reconciliation assumptions from current importer model

### Acceptance Criteria

- [ ] No duplicate logical scenes created due to ordering or path changes in source
- [ ] No silent overwrite of agent-authoritative fields
- [ ] Warning taxonomy is stable and documented

### Deliverables

- [ ] Ownership-safe merge policy implementation
- [ ] Structured warnings and error codes

## Phase D — Docs and Beta Ops (M4)

### Tasks

- [ ] Update setup docs with two-path guidance (stable vs beta)
- [ ] Add "tested versions" compatibility section for beta path
- [ ] Add troubleshooting section for parser/schema mismatch failures
- [ ] Add tool reference updates and explicit stability tier labeling

### Acceptance Criteria

- [ ] Users can clearly distinguish stable default from beta option
- [ ] Docs provide a clear fallback path when beta ingestion fails
- [ ] Beta caveats appear in all relevant surfaces (setup, tools, runtime)

### Deliverables

- [ ] Documentation updates across setup and tool reference docs
- [ ] Compatibility notes and operational troubleshooting guidance

## Test Plan

## Unit Tests

- [ ] Parser reads `.scrivx` maps correctly (sync map, keyword map, binder traversal)
- [ ] Metadata extraction handles absent optional files without crash
- [ ] Merge contract preserves non-authoritative fields
- [ ] Custom-field mapping allowlist behavior is deterministic

## Integration Tests

- [ ] MCP beta tool dry-run against fixture `.scriv` bundle
- [ ] MCP beta tool write mode updates sidecars as expected
- [ ] Re-run idempotency: second run does not produce unintended drift
- [ ] Fallback messaging on incompatible or malformed source structure

## Regression Coverage

- [ ] Existing `import_scrivener_sync` integration tests remain green
- [ ] Stable sync-folder import behavior unchanged

## Compatibility Matrix (Initial)

Track explicitly as fixtures are added.

- [ ] Scrivener fixture A: baseline project structure
- [ ] Scrivener fixture B: missing optional metadata files
- [ ] Scrivener fixture C: custom metadata-heavy project
- [ ] Scrivener fixture D: reordered binder hierarchy

For each fixture:

- [ ] parse success
- [ ] merge success
- [ ] warning profile reviewed
- [ ] sidecar preservation checks pass

## Exit Criteria For Beta Graduation Review

All must be true before proposing graduation from beta status.

- [ ] Milestones M1-M4 complete
- [ ] No unresolved high-severity data loss issues
- [ ] Compatibility matrix has representative coverage and documented tested versions
- [ ] Fallback path to stable importer validated in automated tests

## Non-Goals Reminder

- Replacing stable sync-folder importer in this initiative
- Supporting every historical Scrivener version on day one
- Expanding into unrelated metadata model changes not required for parity or beta value

## Related

- [scrivener-direct-extraction-beta.md](scrivener-direct-extraction-beta.md)
- [../done/import-sync.md](../done/import-sync.md)
- [../done/metadata.md](../done/metadata.md)
