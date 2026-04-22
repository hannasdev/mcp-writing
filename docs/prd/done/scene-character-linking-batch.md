# Batch Scene-Character Linking

**Status:** Done

## Goal

Provide a first-class MCP capability to infer character mentions from scene prose in batch, then apply those inferences to scene metadata so scene-character links are reliably present in the index.

This replaces one-off ad hoc scripts with a reproducible, testable workflow that supports preview before write.

## Problem Statement

Current behavior supports:

1. `enrich_scene(scene_id)` for one scene at a time
2. Manual metadata updates via `update_scene_metadata`

This is not efficient when many scenes need character-link refresh after import or large prose updates. Users currently run custom regex scripts to detect mentions and then manually align metadata/index links, which creates:

1. Inconsistent matching rules across users/sessions
2. High manual effort
3. Risk of accidental regressions from broad name matching

## User Story

As an author/editor using mcp-writing, I want to scan many scenes for character mentions and apply scene metadata updates in one operation, so the `scene_characters` index links are accurate without manual one-off scripts.

## Success Criteria

1. User can run a batch operation for a project and get per-scene inferred character IDs.
2. User can preview changes without writes (`dry_run`).
3. User can apply changes in a single operation with sidecar updates and immediate reindex.
4. Operation is precision-first by default and minimizes false positives, even at the cost of lower recall.
5. Structured output reports exactly what changed and why.

## Proposed Tool

## Name

`enrich_scene_characters_batch`

## Type

Write-capable MCP tool with preview mode and asynchronous execution.

## Parameters

1. `project_id` (string, required)
2. `scene_ids` (string[], optional)
3. `part` (integer, optional)
4. `chapter` (integer, optional)
5. `only_stale` (boolean, optional, default: false)
6. `dry_run` (boolean, optional, default: true)
7. `replace_mode` (string, optional, enum: `merge` | `replace`, default: `merge`)
8. `max_scenes` (integer, optional, default: 200)
9. `include_match_details` (boolean, optional, default: false)
10. `confirm_replace` (boolean, optional, default: false; required when `replace_mode=replace`)

## Behavior

1. Resolve target scenes by filters.
2. Filter precedence is explicit:
	- `scene_ids`, if provided, define the initial allowlist.
	- `part` and `chapter`, if provided, narrow the candidate set.
	- `only_stale=true` narrows the remaining set to prose-stale scenes.
3. If no scenes remain after filtering, return a successful empty result rather than an error.
4. Start an asynchronous batch job and return a job handle immediately.
5. Process each scene independently so progress can continue after a per-scene failure.
6. For each scene, infer character IDs from prose using canonical character metadata only (no aliases in v1).
7. Compute delta against existing scene metadata `characters`.
8. If `dry_run=true`, persist no metadata changes and record preview results only.
9. If `dry_run=false`, write sidecar metadata updates during processing and run index refresh after the batch completes.
10. Return progress and final summary through the async job result.

## Execution Model

The operation should run as an async job rather than a synchronous MCP response.

Implementation direction: reuse the existing async job framework already used by `import_scrivener_sync_async` and `merge_scrivener_project_beta_async`.

Requirements:

1. The server returns a job identifier immediately after validation and target resolution.
2. The shared async framework should be extended to expose lightweight in-flight progress for this and future batch tools.
3. Progress reports include at minimum: `total_scenes`, `processed_scenes`, `scenes_changed`, `failed_scenes`.
4. Failure in one scene must not abort the full job.
5. Per-scene work is the atomic unit of success or failure.
6. Per-scene processing is evaluated at sidecar operation boundaries; index refresh runs post-batch as a single reconciliation step.
7. If post-batch index refresh fails, the job should surface failure details at the job level for operator recovery.
8. If target resolution yields zero scenes, the tool should still return a completed async job record with `total_scenes: 0` so clients can use one polling contract.
9. If `project_id` is unknown and resolution yields zero scenes, keep completed zero-target behavior for backward compatibility but include an explicit warning in `job.result.warning`.

## Async Framework Reuse

The preferred implementation is to extend the current job system rather than create a parallel mechanism.

Reuse expectations:

1. Start jobs through the existing `startAsyncJob` path.
2. Expose status through existing `get_async_job_status`.
3. Surface jobs through existing `list_async_jobs`.
4. Support termination through existing `cancel_async_job`.
5. Add a new worker `kind` in `scripts/async-job-runner.mjs` for scene-character batch linking.
6. Reuse existing TTL-based job retention and pruning behavior.
7. Reuse the current public job shape (`job_id`, `status`, timestamps, optional `result`) so clients do not need a separate polling contract.
8. If progress visibility is added, add it as a backward-compatible extension to the shared job shape rather than as a tool-specific polling surface.

Status model:

1. Reuse the existing lifecycle states exposed by the current async framework: `running`, `completed`, `failed`, `cancelling`, `cancelled`.
2. Do not introduce `queued` or `completed_with_errors` for this tool unless the shared async framework itself adopts them first.
3. Mixed-result jobs should remain `completed` at the job-status layer, with partial-success details represented in the result payload.

## Output Contract

Job result payload fields:

1. `ok`
2. `project_id`
3. `dry_run`
4. `total_scenes`
5. `processed_scenes`
6. `scenes_changed`
7. `failed_scenes`
8. `links_added`
9. `links_removed`
10. `results` (array, may be omitted or truncated while job is still running)
11. `warning` (optional, for stale/partial/match-limit conditions)
12. `truncated` (optional, true when result details are intentionally capped)

Async response shape:

1. The start tool should follow the existing async convention and return `ok: true`, `async: true`, and a nested `job` object.
2. The `job` object should reuse the current public fields: `job_id`, `kind`, `status`, `created_at`, `started_at`, `finished_at`, optional `pid`, optional `error`, and optional `result`.
3. Batch-specific summary fields such as `total_scenes`, `processed_scenes`, `scenes_changed`, `failed_scenes`, `links_added`, and `links_removed` should live inside the job `result` payload rather than redefining a second top-level async envelope.
4. If live progress is added to the shared framework, expose it as an optional `job.progress` object while the job is running.
5. `job.progress` should include at minimum: `total_scenes`, `processed_scenes`, `scenes_changed`, `failed_scenes`.

Per-scene result fields:

1. `scene_id`
2. `file_path`
3. `before_characters`
4. `inferred_characters`
5. `after_characters`
6. `added`
7. `removed`
8. `changed` (boolean)
9. `status` (`changed` | `unchanged` | `failed` | `skipped_ambiguous`)
10. `error` (optional)
11. `match_details` (optional)

Result detail policy:

1. Default responses should favor compact summaries over exhaustive evidence.
2. `match_details` should be opt-in and preferably limited to changed or failed scenes.
3. Large jobs may cap `results` and set `truncated=true`.
4. Verification is intentionally human-in-the-loop: users can inspect scene prose directly for final spot checks.
5. If a job is cancelled, completed per-scene results up to the cancellation point should remain visible in the retained result payload.

## Matching Strategy

## Data Sources

1. Character IDs and names from indexed `characters` entities.
2. Version 1 uses canonical character names only.
3. Do not use aliases in v1.
4. Existing internal helper behavior used by `enrich_scene` where possible.

## Matching Rules (Default Conservative)

1. Prefer full-name phrase matches.
2. Do not match aliases in v1.
3. Avoid short single-token names unless disambiguated.
4. Case-insensitive word-boundary matching.
5. Deduplicate inferred character IDs per scene.
6. If a token could map to multiple characters, do not auto-link any of them; report the match as ambiguous.

## Precision-First v1 Policy

Version 1 optimizes for precision over recall.

Implications:

1. Nickname-only or single-name-only scenes may be missed.
2. Ambiguous mentions should be skipped rather than guessed.
3. Users retain responsibility for the last small fraction of manual verification and curation.

## Future Option (Not Required in v1)

1. Standardized alias field on character sidecars plus alias-aware matching.
2. Configurable short-name mode for projects that need aggressive matching.
3. Confidence scoring and threshold controls.

## Data Ownership and Safety

1. Writes only to scene sidecars (`.meta.yaml`), never scene prose.
2. Uses same ownership boundaries documented in `docs/data-ownership.md`.
3. Honors read-only sync dir behavior with `READ_ONLY` envelope.
4. Default mode is `dry_run=true` to avoid accidental mass writes.
5. Enforce `max_scenes` as a hard validation guardrail: if the resolved target set exceeds the limit, return `VALIDATION_ERROR` with the matched count and require the caller to rerun with a higher explicit limit.
6. `replace_mode=replace` is destructive and requires `confirm_replace=true`.
7. `merge` remains the default because some scene-character relevance is editorially valid even when the prose does not explicitly name the character.
8. Cancellation is best-effort: scenes completed before cancellation remain persisted, and unstarted scenes remain untouched.

## Interaction with Existing Tools

1. Complements `enrich_scene` (single scene) rather than replacing it.
2. Uses same indexing update pathway as `update_scene_metadata`/`enrich_scene`.
3. Compatible with stale metadata workflow.
4. `only_stale=true` refers only to prose checksum staleness, not to character-sheet metadata changes.
5. `metadata_stale` should clear only for scenes successfully updated by this tool.

## Non-Goals

1. Relationship inference between characters.
2. Semantic/NLP entity resolution beyond deterministic mention matching.
3. Automatic creation of missing character entities.
4. Replacing Scrivener import or sync identity logic.
5. Achieving perfect recall without user review.

## Error Handling

Return structured envelopes for:

1. `VALIDATION_ERROR` for invalid filter combinations or parameters.
2. `NOT_FOUND` when requested `scene_ids` do not exist in the project.
3. `READ_ONLY` when sidecar writes are unavailable and `dry_run=false`.
4. `IO_ERROR` on sidecar read/write failures.
5. `PARTIAL_SUCCESS` warning if some scenes fail while others succeed.
6. Ambiguous matches should be represented in per-scene results, not treated as fatal job errors.
7. `CANCELLED` should not be treated as an error envelope; cancellation is represented by job status plus partial retained results.
8. Unknown `project_id` with zero resolved scenes should return a completed zero-target job with an explicit warning (not a fatal envelope).

## Test Plan

## Unit Tests

1. Matching behavior for canonical names and ambiguous short names.
2. Delta computation for `merge` and `replace` modes.
3. `max_scenes` guardrail behavior.
4. Filter precedence and empty-result behavior.
5. Canonical-name-only matching behavior.

## Integration Tests

1. `dry_run=true` does not modify sidecars or DB links.
2. `dry_run=false` updates sidecars and `scene_characters` links.
3. `only_stale=true` scopes targets correctly.
4. Read-only mode returns `READ_ONLY` for write attempts.
5. Mixed success path returns partial-success warning with per-scene diagnostics.
6. Async job reports progress correctly through the shared job surface while running, then exposes final retained results on completion.
7. `replace_mode=replace` requires explicit confirmation.
8. Post-batch index refresh failure is surfaced clearly with recoverable diagnostics at the job level.
9. Zero-target runs return a completed async job with `total_scenes: 0`.
10. Cancellation preserves completed scene results and leaves untouched scenes unchanged.

## Rollout Plan

1. Phase A: implement tool with conservative matching + dry-run default.
2. Phase B: add docs in `docs/tools.md` and usage examples.
3. Phase C: add optional alias enhancements if needed by real manuscripts.

## Open Questions

No open questions for v1.

## Related

- [metadata.md](../done/metadata.md) - sidecar ownership, staleness, enrich behavior
- [import-sync.md](../done/import-sync.md) - indexing and reconciliation model
- [data-ownership.md](../../data-ownership.md) - importer-authoritative vs agent-authoritative fields
- [search-analysis.md](../done/search-analysis.md) - current metadata reasoning tools
