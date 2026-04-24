# Scrivener Direct Extraction (Beta) — Implementation Checklist

**Status:** 🚧 In Progress

This document translates the beta PRD into execution-ready tasks. It is intentionally checklist-first to limit scope creep.

## Milestones

- M1: Parser and merge core extracted from legacy script ✅
- M2: Official beta entrypoints (MCP + CLI) ✅
- M2.5: Large-project UX (async jobs, warning aggregation, scoped parsing) ✅
- M3: Safety and parity hardening ✅
- M4: Docs, compatibility posture, and beta operations ✅
- M5: Data safety hardening (critical fixes) 🚧

## Recommended Execution Order

Use focused PRs with one concern each. Do not combine milestones unless explicitly required.

1. PR-1: Parser core extraction (foundation) ✅
2. PR-2: MCP beta entrypoint and dry-run payloads ✅
3. PR-2.5: Large-project UX hardening ✅
4. PR-3: Ownership and parity hardening ✅
5. PR-4: Docs, compatibility matrix, and beta operational guidance ✅
6. PR-5: Data safety hardening (critical fixes) 🚧

## Next PR Sequence (Concrete)

Use this as the execution plan for remaining work. Keep each PR narrowly scoped.

### PR-3a: Ownership Enforcement ✅

Scope:
- Enforce importer-authoritative write boundaries in beta merge.
- Keep additive-only behavior for non-authoritative fields.
- Make overwrite/skip decisions explicit in result payloads and warnings.
- Align `walkYamls` in `scrivener-direct.js` to skip mirror subdirectories (`projects/`, `universes/`) consistent with `walkSidecarFiles` in `importer.js`, to prevent phantom `missing_bracket_id` warnings from nested mirror trees.

Acceptance checks:
- Beta merge never silently overwrites agent-authoritative fields.
- Attempted writes to importer-authoritative fields follow explicit policy and are reported.
- Unit tests cover allowed write, blocked write, and no-op merge outcomes.
- Integration tests verify stable importer behavior remains unchanged.
- `walkYamls` skips mirror subdirectories; test confirms no phantom warnings from nested mirrors.

Exit signal:
- Close checklist items:
  - Enforce importer-authoritative field boundaries during merge
  - No silent overwrite of agent-authoritative fields
  - Ownership-safe merge policy implementation
  - `walkYamls` mirror-path guard parity with `walkSidecarFiles`

### PR-3b: Ambiguity Conflicts + Warning Taxonomy ✅

Scope:
- Define and document ambiguous mapping conditions (e.g., unresolved identity ties, contradictory source metadata, ambiguous folder-derived structure).
- Add dedicated conflict/warning codes for each condition.
- Ensure warnings are stable, summarized, and test-covered.

Warning taxonomy (implemented):
- `ambiguous_identity_tie`:
  Trigger: sidecar identity context conflicts with Scrivener mapping assumptions (for example, existing `external_source` is non-`scrivener`, or `external_source: scrivener` is missing `external_id`).
  Behavior: keep existing sidecar identity fields; emit warning with `reason` details.
- `ambiguous_structure_mapping`:
  Trigger: existing sidecar `part`/`chapter`/`chapter_title` differs from Scrivener-derived structure for the same mapped scene.
  Behavior: keep existing sidecar structure field; emit warning with `field`, `existing_value`, `scrivener_value`.
- `ambiguous_metadata_mapping`:
  Trigger: existing non-structure sidecar metadata field differs from Scrivener-extracted metadata for the same mapped scene.
  Behavior: keep existing sidecar field; emit warning with `field`, `existing_value`, `scrivener_value`.

Acceptance checks:
- Warning taxonomy documented in this file and reflected in tool/runtime outputs.
- Ambiguous mapping scenarios emit deterministic conflict/warning codes.
- Unit/integration tests cover each new code and summary behavior.

Exit signal:
- Close checklist items:
  - Add conflict/warning reporting for ambiguous mappings
  - Warning taxonomy is stable and documented

### PR-4b: Compatibility Matrix Expansion ✅

Scope:
- Add and validate fixtures B/C/D:
  - B: missing optional metadata files
  - C: custom metadata-heavy project
  - D: reordered binder hierarchy
- Record tested-version coverage and warning profile outcomes.

Acceptance checks:
- Each fixture has parse success + merge success + sidecar preservation checks.
- Warning profile reviewed and recorded for each fixture.
- Compatibility notes updated with tested-version details and known constraints.

Exit signal:
- Close checklist items:
  - Compatibility matrix expansion beyond baseline fixture
  - Tested-version coverage documentation partial -> complete
  - Compatibility matrix representative coverage

### PR-4c: Graduation Gate Validation ✅

Scope:
- Validate fallback to stable importer in automated tests as an explicit gate.
- Summarize release-window risk posture for data-loss class bugs.

Acceptance checks:
- Automated tests assert fallback guidance path on beta failure conditions.
- Graduation criteria checklist updated with concrete evidence links.

Exit signal:
- Close checklist items:
  - Fallback path to stable importer validated in automated tests
  - Milestones M1-M4 complete

---

## Phase A — Parser Core Extraction (M1) ✅

### Phase A Tasks

- [x] Extract `.scrivx` parsing and Scrivener data reads from `scripts/merge-scrivx.js` into reusable module(s)
- [x] Define typed internal model for:
  - [x] binder items
  - [x] sync number to UUID mapping
  - [x] keyword map
  - [x] per-scene extracted metadata
- [x] Define deterministic merge contract (input scene sidecar + extracted data -> merged sidecar)
- [x] Preserve current script behavior while moving logic out of script wrapper

### Phase A Deliverables

- [x] `scrivener-direct.js` — parser/merge module with `loadScrivenerProjectData`, `mergeSidecarData`, `mergeScrivenerProjectMetadata` exports
- [x] `scripts/merge-scrivx.js` — thinned to ~15-line arg-parsing wrapper

---

## Phase B — Official Beta Entry Points (M2) ✅

### Phase B Tasks

- [x] Add MCP beta tool for direct Scrivener extraction (`merge_scrivener_project_beta`)
- [x] Keep stable `import_scrivener_sync` unchanged and documented as default
- [x] Add explicit beta wording in tool/CLI descriptions and responses
- [x] Add `dry_run` summary with field-level change preview counts
- [x] Add `scenes_dir` override parameter for non-standard sync layouts
- [x] Universe-scoped `project_id` (`universe/project`) resolves to correct `universes/` path

### Phase B Deliverables

- [x] MCP tool in `index.js` with structured success/error payloads
- [x] `SCRIVENER_DIRECT_BETA_FAILED` error code with `details.fallback` guidance
- [x] Integration tests: dry-run stats, failure fallback, `scenes_dir` override, priority over `project_id`

---

## Phase B.5 — Large-Project UX Hardening (M2.5) ✅

This phase was identified during manual testing against a real 430+ file project where blocking MCP calls timed out.

### Phase B.5 Tasks

- [x] Async job infrastructure: `startAsyncJob`, `toPublicJob`, TTL-based pruning
- [x] `import_scrivener_sync_async` — non-blocking import, returns `job_id` immediately
- [x] `merge_scrivener_project_beta` — non-blocking merge, returns `job_id` immediately
- [x] `get_async_job_status` — poll job by ID, returns status + result payload
- [x] `list_async_jobs` — list all known jobs with optional result payloads
- [x] `cancel_async_job` — SIGTERM worker process, marks job cancelled
- [x] `scripts/async-job-runner.mjs` — isolated worker process for both import and merge kinds
- [x] Warning aggregation in `sync.js`: `buildWarningSummary` buckets warnings by type with `count` + up to 5 `examples`; all sync responses return `warning_summary` instead of raw flat list
- [x] `import_scrivener_sync` and `import_scrivener_sync_async`: `preflight` mode (scan without writing, returns `file_previews`, `files_to_process`, `existing_sidecars`)
- [x] `import_scrivener_sync` and `import_scrivener_sync_async`: `ignore_patterns` (array of regex strings matched against filenames)
- [x] `MCP_TRANSPORT=stdio` env var: starts server in stdio mode, no HTTP listener, no port conflicts for local tooling and debug scripts

### Phase B.5 Warning Types Tracked

| Type | Trigger |
| --- | --- |
| `no_scene_id` | File has no `scene_id` in metadata |
| `duplicate_scene_id` | Same `scene_id` in two files under same project |
| `path_metadata_mismatch` | Part/chapter in sidecar doesn't match filesystem path |
| `orphaned_sidecar` | `.meta.yaml` has no matching prose file |
| `moved_scene` | Sidecar exists at stale path (prose moved) |
| `nested_mirror` | Path is inside a nested mirror directory |

### Phase B.5 Acceptance Criteria

- [x] Large imports don't block MCP; clients poll status until completion
- [x] Async jobs retain result for TTL window (default 24h, configurable via `ASYNC_JOB_TTL_MS`)
- [x] Warning flood on large trees is summarised, not raw-listed
- [x] `preflight` answers "what would this import do?" before any disk writes
- [x] `ignore_patterns` excludes noise files (fragments, beat sheets) from import scope
- [x] `MCP_TRANSPORT=stdio` allows local debug scripts without port conflicts

### Phase B.5 Deliverables

- [x] `scripts/async-job-runner.mjs` — worker process
- [x] 5 new MCP tools: `import_scrivener_sync_async`, `merge_scrivener_project_beta`, `get_async_job_status`, `list_async_jobs`, `cancel_async_job`
- [x] Integration tests: async import completes, async merge completes, preflight no-write, `ignore_patterns` count

---

## Phase C — Safety and Parity Hardening (M3)

### Phase C Tasks

- [x] Enforce importer-authoritative field boundaries during merge
- [x] Ensure non-authoritative sidecar fields are preserved
- [x] Align `walkYamls` (in `scrivener-direct.js`) to skip `projects/`/`universes/` mirror subdirectories, consistent with `walkSidecarFiles` in `importer.js`
- [x] Normalize handling for:
  - [x] missing UUID mappings
  - [x] missing synopsis files
  - [x] unknown custom fields
  - [x] malformed metadata values
- [x] Add conflict/warning reporting for ambiguous mappings
- [x] Preserve scene identity and reconciliation assumptions from current importer model

### Phase C Acceptance Criteria

- [x] No duplicate logical scenes created due to ordering or path changes in source
- [x] No silent overwrite of agent-authoritative fields
- [x] Warning taxonomy is stable and documented

### Phase C Deliverables

- [x] Ownership-safe merge policy implementation
- [x] Structured warnings and error codes

---

## Phase D — Docs and Beta Ops (M4)

### Phase D Tasks

- [x] Update setup docs with two-path guidance (stable vs beta)
- [x] Add "tested versions" compatibility section for beta path (initial baseline posture)
- [x] Add troubleshooting section for parser/schema mismatch failures
- [x] Add tool reference updates and explicit stability tier labeling

### Phase D Acceptance Criteria

- [x] Users can clearly distinguish stable default from beta option
- [x] Docs provide a clear fallback path when beta ingestion fails
- [x] Beta caveats appear in all relevant surfaces (setup, tools, runtime)

### Phase D Deliverables

- [x] Documentation updates across setup and tool reference docs
- [x] Compatibility notes and operational troubleshooting guidance (baseline beta posture)

---

## Test Plan

### Unit Tests

- [x] Parser reads `.scrivx` maps correctly (sync map, keyword map, binder traversal)
- [x] Metadata extraction handles absent optional files without crash
- [x] Merge contract preserves non-authoritative fields
- [x] Custom-field mapping allowlist behavior is deterministic

### Integration Tests

- [x] MCP beta tool dry-run against fixture `.scriv` bundle
- [x] MCP beta tool write mode updates sidecars as expected
- [x] Re-run idempotency: second run does not produce unintended drift
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
- [x] Scrivener fixture B: missing optional metadata files
- [x] Scrivener fixture C: custom metadata-heavy project
- [x] Scrivener fixture D: reordered binder hierarchy

For each fixture:

- [x] parse success
- [x] merge success
- [x] warning profile reviewed
- [x] sidecar preservation checks pass

---

## Phase E — Data Safety Hardening (Critical Fixes)

Post-fixture-validation critical safety improvements required before graduation.

### Phase E Tasks

- [x] Add git commit tracking for all merged sidecar writes
  - Each sidecar write calls `createSnapshot()` with merge-specific message content (`beta merge Scrivener project metadata [UUID-xxx]`)
  - Enables full audit trail and revert capability
  - Aligns with stable importer's snapshot behavior

- [x] Fix non-atomic file move safety in `moveFileIfNeeded()`
  - Current: `fs.copyFileSync()` → `fs.unlinkSync()` is not atomic; unlink failure leaves duplicate files
  - Fix: wrap copy+unlink in try-catch with proper error handling, or verify copy before unlink
  - Prevents race condition where prose file exists in both old and new locations

- [x] Add sidecar orphan detection and warnings
  - Detect sidecars with no matching prose file (`.md` or `.txt`)
  - Emit `sidecar_missing_prose` warning before attempting relocation
  - Prevents silent failures when prose has been deleted

- [x] Add XML file size check and memory guardrail
  - Check `.scrivx` file size before DOM parsing
  - Emit structured warning if larger than 50MB (typical very large project threshold)
  - Surfaces potential long-running/high-memory parse risk for massive projects (1000+ scenes); parser still runs in best-effort mode

### Phase E Acceptance Criteria

- [x] All merged sidecars have corresponding git commits with descriptive messages
- [x] File move operations are atomic or properly handled on failure
- [x] Sidecar-without-prose cases are detected and warned
- [x] XML parsing has size checks and graceful degradation

### Phase E Deliverables

- [x] Updated `scrivener-direct.js`:
  - `mergeScrivenerProjectMetadata()` calls `createSnapshot()` for each updated scene
  - `moveFileIfNeeded()` wraps operations in try-catch with validation
  - Sidecar orphan detection in merge loop
  - XML size check in `loadScrivenerProjectData()`

- [x] Updated unit and integration tests covering:
  - Git commit creation for each merge
  - File move edge cases (EXDEV, permission denied, destination exists)
  - Sidecar-without-prose scenarios
  - Large XML file handling

- [x] Updated implementation notes documenting safety guarantees

### Phase E Exit Signal

- [x] All critical fixes implemented and tested
- [x] No data-loss edge cases remain unhandled
- [x] Full audit trail via git commits enabled
- [x] Ready for formal graduation review

---

## Implementation Notes

- Current merge behavior is additive-only: beta merge fills missing sidecar fields and does not overwrite existing values.
- Missing UUID mappings are skipped with structured warning payloads, and missing synopsis files are tolerated without failing the merge.
- Unknown Scrivener custom fields are ignored unless explicitly mapped into supported sidecar fields.
- Invalid numeric Scrivener custom field values are ignored with structured warnings rather than hard-failing the merge.
- Ownership boundaries are enforced via `IMPORTER_AUTHORITATIVE_FIELDS` (exported from `scrivener-direct.js`). Fields in this set (`scene_id`, `external_source`, `external_id`, `title`, `timeline_position`) are silently skipped by beta merge and reported as `blockedKeys` in the `mergeSidecarData` return value.
- `save_the_cat_beat` is intentionally **not** importer-authoritative. It can be written by the beta path (from the `savethecat!` Scrivener custom metadata field) or by the importer (from beat marker filenames). Additive-only semantics mean whichever runs first wins. A future docs task (PR-4) should explain how to set up the `savethecat!` custom metadata field in Scrivener to benefit from this mapping.
- PR-3b ambiguity taxonomy is now implemented and surfaced in `warningSummary` / `warnings` outputs with deterministic codes:
  - `ambiguous_identity_tie`
  - `ambiguous_structure_mapping`
  - `ambiguous_metadata_mapping`
- Phase D baseline docs slice is complete: setup guidance, troubleshooting, stability-tier tool descriptions, and generated tool reference are in place.
- Compatibility matrix is now representative: fixtures A–D cover baseline project, missing-optional-metadata, custom-metadata-heavy, and reordered binder hierarchy scenarios. All fixtures have confirmed parse success, merge success, warning profile review, and sidecar preservation.
  - Fixture B (missing optional metadata): parser gracefully handles absent `synopsis.txt`, empty keyword list, and absent `MetaData` elements. No warnings emitted when omission is valid.
  - Fixture C (custom-metadata-heavy): all seven known custom field IDs map correctly; unknown field IDs emit deterministic `ignored_custom_field` warnings and do not appear in sidecars.
  - Fixture D (reordered binder hierarchy): chapter numbering is assigned by depth-first binder traversal position, not by sync number. A scene with a lower sync number that appears in a later binder chapter correctly receives the higher chapter number.
- Fallback guidance (`import_scrivener_sync`) is validated by the integration test "returns structured fallback guidance on parser/path failure" in `test/integration.test.mjs`.
- Phase E (data safety hardening) implementation is complete: git commit tracking, atomic move safeguards, orphan detection, and XML size guardrails are in place.

---

## Exit Criteria For Beta Graduation Review

All must be true before proposing graduation from beta status.

- [x] Milestones M1-M4 complete (phases A–D)
- [x] **Phase E critical safety fixes implemented and tested**:
  - [x] Git commit tracking enabled for all merged sidecars
  - [x] Non-atomic file move operations handled safely
  - [x] Sidecar orphan detection and warning
  - [x] XML size check and memory guardrail
- [ ] Zero unresolved high-severity data-loss issues
- [x] Compatibility matrix has representative coverage (fixtures A–D)
- [x] Fallback path to stable importer validated in automated tests

## Non-Goals Reminder

- Replacing stable sync-folder importer in this initiative
- Supporting every historical Scrivener version on day one
- Expanding into unrelated metadata model changes not required for parity or beta value

## Related

- [scrivener-direct-extraction-beta.md](scrivener-direct-extraction-beta.md)
- [../done/import-sync.md](../done/import-sync.md)
- [../done/metadata.md](../done/metadata.md)
