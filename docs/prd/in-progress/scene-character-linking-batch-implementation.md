# Batch Scene-Character Linking (v1) — Implementation Checklist

**Status:** Complete

This document translates the PRD into execution-ready tasks for v1.

Scope reminder for v1:
- Precision-first matching
- Canonical-name-only matching (no alias support)
- Shared async framework reuse (`startAsyncJob`, `get_async_job_status`, `list_async_jobs`, `cancel_async_job`)

## Progress Snapshot

- Completed: M1 and M2 foundations, plus core M3 implementation path.
- Completed: integration coverage for validation, async execution, progress visibility, write/read-only paths, zero-target behavior, and cancellation partial-result retention.
- Completed: unit coverage for batch matching/delta behavior and docs refresh (tool docs + README usage).
- Remaining: none for v1 scope.

## Milestones

- M1: Tool contract and sync-safe targeting
- M2: Async batch execution path
- M3: Matching, write/reindex, and failure semantics
- M4: Tests and docs

## Recommended Execution Order

Use focused PRs with one concern each.

1. PR-1: Tool contract + validation + target resolution
2. PR-2: Async job kind + worker integration
3. PR-3: Matching/write/reindex + cancellation semantics
4. PR-4: Tests and documentation updates

---

## Phase A — Tool Contract and Target Resolution (M1)

### Tasks

- [x] Add MCP tool definition for `enrich_scene_characters_batch` in `index.js`
- [x] Validate params:
  - [x] `project_id` required and valid
  - [x] `replace_mode=replace` requires `confirm_replace=true`
  - [x] `max_scenes` positive integer
- [x] Implement filter precedence:
  - [x] `scene_ids` allowlist
  - [x] optional `part`/`chapter` narrowing
  - [x] optional `only_stale=true` narrowing
- [x] Resolve zero-target behavior to completed async job with `total_scenes: 0`
- [x] Enforce `max_scenes` hard guardrail with `VALIDATION_ERROR` on overflow

### Acceptance Criteria

- [x] Invalid params return structured `VALIDATION_ERROR`
- [x] Filter precedence is deterministic and documented in code comments/tests
- [x] No-target requests return a completed async job record, not a hard error

### Deliverables

- [x] Tool stub + validation in `index.js`
- [x] Deterministic target resolution helper

---

## Phase B — Async Integration (M2)

### Tasks

- [x] Add new async job kind for batch linking in `scripts/async-job-runner.mjs`
- [x] Wire start path through existing `startAsyncJob` in `index.js`
- [x] Reuse existing status/poll/cancel/list tools without introducing a new polling surface
- [x] Extend shared job shape with optional `job.progress` (backward-compatible)
- [x] Ensure progress fields include:
  - [x] `total_scenes`
  - [x] `processed_scenes`
  - [x] `scenes_changed`
  - [x] `failed_scenes`

### Acceptance Criteria

- [x] Start tool returns `ok: true`, `async: true`, and `job`
- [x] Job can be polled via `get_async_job_status`
- [x] Progress is visible while running (if enabled) and final results are retained

### Deliverables

- [x] Async job dispatch for `enrich_scene_characters_batch`
- [x] Worker support in `scripts/async-job-runner.mjs`

---

## Phase C — Matching + Writes + Failure Semantics (M3)

### Tasks

- [x] Implement canonical-name-only matching:
  - [x] full-name phrase preference
  - [x] conservative token handling
  - [x] ambiguous token -> `skipped_ambiguous`
- [x] Compute per-scene delta fields:
  - [x] `before_characters`, `inferred_characters`, `after_characters`
  - [x] `added`, `removed`, `changed`, per-scene `status`
- [x] Implement `dry_run=true` preview-only behavior
- [x] Implement write mode (`dry_run=false`):
  - [x] update sidecar `characters`
  - [x] reindex scene immediately
  - [x] clear `metadata_stale` only for successfully updated scenes
- [x] Per-scene atomic success/failure semantics:
  - [x] scene marked success only after sidecar write + reindex
  - [x] write-success/reindex-failure surfaces recoverable failure details
- [x] Cancellation semantics:
  - [x] best-effort stop
  - [x] retain completed scene results
  - [x] untouched unstarted scenes

### Acceptance Criteria

- [x] `merge` default preserves existing editorial links unless explicitly removed by mode
- [x] `replace` requires explicit confirmation and behaves predictably
- [x] Mixed-result runs end as `completed` with `failed_scenes > 0` and partial diagnostics in result payload

### Deliverables

- [x] Core batch processor module/function
- [x] Result payload normalization aligned with PRD

---

## Phase D — Tests and Documentation (M4)

### Unit Tests

- [x] Canonical-name-only matching behavior
- [x] Ambiguous token handling
- [x] Delta computation for `merge` and `replace`
- [x] `max_scenes` guardrail overflow (covered at integration/tool-contract layer)
- [x] Filter precedence and zero-target behavior (covered at integration/tool-contract layer)

### Integration Tests

- [x] `dry_run=true` does not modify sidecars or DB links
- [x] `dry_run=false` updates sidecars and `scene_characters` links
- [x] `only_stale=true` scopes targets correctly
- [x] Read-only mode returns `READ_ONLY` for write attempts
- [x] Async job lifecycle via shared tools (start/status/list/cancel)
- [x] Progress fields during running job (if enabled)
- [x] Cancellation retains completed results and leaves unstarted scenes untouched
- [x] Zero-target run returns completed job with `total_scenes: 0`

### Docs Tasks

- [x] Add tool docs section in `docs/tools.md` (via docs generator)
- [x] Add usage examples for preview vs apply mode
- [x] Document v1 limitation: canonical-name-only, aliases deferred

### Acceptance Criteria

- [x] Tests pass for happy path, partial failures, cancellation, and guardrails
- [x] Tool docs reflect async contract and result payload location (`job.result`)

---

## Exit Criteria (v1 Ready)

- [x] PRD-aligned behavior implemented for all required parameters and result fields
- [x] Async contract aligned with existing shared framework
- [x] Canonical-name-only matching shipped with precision-first behavior
- [x] No unresolved high-severity data-loss or index-consistency bugs

## Non-Goals Reminder (v1)

- Alias matching and character-sidecar alias schema changes
- NLP/semantic entity recognition
- Relationship inference

## Related

- [scene-character-linking-batch.md](scene-character-linking-batch.md)
- [scrivener-direct-extraction-beta-implementation.md](scrivener-direct-extraction-beta-implementation.md)
- [../done/metadata.md](../done/metadata.md)
- [../done/import-sync.md](../done/import-sync.md)
