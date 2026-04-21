# Batch Scene-Character Linking (v1) — Implementation Checklist

**Status:** In Progress

This document translates the PRD into execution-ready tasks for v1.

Scope reminder for v1:
- Precision-first matching
- Canonical-name-only matching (no alias support)
- Shared async framework reuse (`startAsyncJob`, `get_async_job_status`, `list_async_jobs`, `cancel_async_job`)

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

- [ ] Add MCP tool definition for `enrich_scene_characters_batch` in `index.js`
- [ ] Validate params:
  - [ ] `project_id` required and valid
  - [ ] `replace_mode=replace` requires `confirm_replace=true`
  - [ ] `max_scenes` positive integer
- [ ] Implement filter precedence:
  - [ ] `scene_ids` allowlist
  - [ ] optional `part`/`chapter` narrowing
  - [ ] optional `only_stale=true` narrowing
- [ ] Resolve zero-target behavior to completed async job with `total_scenes: 0`
- [ ] Enforce `max_scenes` hard guardrail with `VALIDATION_ERROR` on overflow

### Acceptance Criteria

- [ ] Invalid params return structured `VALIDATION_ERROR`
- [ ] Filter precedence is deterministic and documented in code comments/tests
- [ ] No-target requests return a completed async job record, not a hard error

### Deliverables

- [ ] Tool stub + validation in `index.js`
- [ ] Deterministic target resolution helper

---

## Phase B — Async Integration (M2)

### Tasks

- [ ] Add new async job kind for batch linking in `scripts/async-job-runner.mjs`
- [ ] Wire start path through existing `startAsyncJob` in `index.js`
- [ ] Reuse existing status/poll/cancel/list tools without introducing a new polling surface
- [ ] Extend shared job shape with optional `job.progress` (backward-compatible)
- [ ] Ensure progress fields include:
  - [ ] `total_scenes`
  - [ ] `processed_scenes`
  - [ ] `scenes_changed`
  - [ ] `failed_scenes`

### Acceptance Criteria

- [ ] Start tool returns `ok: true`, `async: true`, and `job`
- [ ] Job can be polled via `get_async_job_status`
- [ ] Progress is visible while running (if enabled) and final results are retained

### Deliverables

- [ ] Async job dispatch for `enrich_scene_characters_batch`
- [ ] Worker support in `scripts/async-job-runner.mjs`

---

## Phase C — Matching + Writes + Failure Semantics (M3)

### Tasks

- [ ] Implement canonical-name-only matching:
  - [ ] full-name phrase preference
  - [ ] conservative token handling
  - [ ] ambiguous token -> `skipped_ambiguous`
- [ ] Compute per-scene delta fields:
  - [ ] `before_characters`, `inferred_characters`, `after_characters`
  - [ ] `added`, `removed`, `changed`, per-scene `status`
- [ ] Implement `dry_run=true` preview-only behavior
- [ ] Implement write mode (`dry_run=false`):
  - [ ] update sidecar `characters`
  - [ ] reindex scene immediately
  - [ ] clear `metadata_stale` only for successfully updated scenes
- [ ] Per-scene atomic success/failure semantics:
  - [ ] scene marked success only after sidecar write + reindex
  - [ ] write-success/reindex-failure surfaces recoverable failure details
- [ ] Cancellation semantics:
  - [ ] best-effort stop
  - [ ] retain completed scene results
  - [ ] untouched unstarted scenes

### Acceptance Criteria

- [ ] `merge` default preserves existing editorial links unless explicitly removed by mode
- [ ] `replace` requires explicit confirmation and behaves predictably
- [ ] Mixed-result runs end as `completed` with `failed_scenes > 0` and partial diagnostics in result payload

### Deliverables

- [ ] Core batch processor module/function
- [ ] Result payload normalization aligned with PRD

---

## Phase D — Tests and Documentation (M4)

### Unit Tests

- [ ] Canonical-name-only matching behavior
- [ ] Ambiguous token handling
- [ ] Delta computation for `merge` and `replace`
- [ ] `max_scenes` guardrail overflow
- [ ] Filter precedence and zero-target behavior

### Integration Tests

- [ ] `dry_run=true` does not modify sidecars or DB links
- [ ] `dry_run=false` updates sidecars and `scene_characters` links
- [ ] `only_stale=true` scopes targets correctly
- [ ] Read-only mode returns `READ_ONLY` for write attempts
- [ ] Async job lifecycle via shared tools (start/status/list/cancel)
- [ ] Progress fields during running job (if enabled)
- [ ] Cancellation retains completed results and leaves unstarted scenes untouched
- [ ] Zero-target run returns completed job with `total_scenes: 0`

### Docs Tasks

- [ ] Add tool docs section in `docs/tools.md` (via docs generator)
- [ ] Add usage examples for preview vs apply mode
- [ ] Document v1 limitation: canonical-name-only, aliases deferred

### Acceptance Criteria

- [ ] Tests pass for happy path, partial failures, cancellation, and guardrails
- [ ] Tool docs reflect async contract and result payload location (`job.result`)

---

## Exit Criteria (v1 Ready)

- [ ] PRD-aligned behavior implemented for all required parameters and result fields
- [ ] Async contract aligned with existing shared framework
- [ ] Canonical-name-only matching shipped with precision-first behavior
- [ ] No unresolved high-severity data-loss or index-consistency bugs

## Non-Goals Reminder (v1)

- Alias matching and character-sidecar alias schema changes
- NLP/semantic entity recognition
- Relationship inference

## Related

- [scene-character-linking-batch.md](scene-character-linking-batch.md)
- [scrivener-direct-extraction-beta-implementation.md](scrivener-direct-extraction-beta-implementation.md)
- [../done/metadata.md](../done/metadata.md)
- [../done/import-sync.md](../done/import-sync.md)
