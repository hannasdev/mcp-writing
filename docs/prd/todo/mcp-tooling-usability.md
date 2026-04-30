# MCP Tooling Convention Proposal (mcp-writing)

Date: 2026-04-30
Applies to: mcp-writing 2.15.0 (49 tools)

## Goals

- Keep power and flexibility for advanced users.
- Make first-use and day-to-day usage obvious for agents and humans.
- Preserve full backward compatibility for existing clients.

## Convention Summary

1. Tier tools into `core`, `advanced`, and `admin`.
2. Keep existing tool names stable; add namespaced aliases.
3. Add one discovery tool for intent routing and next-step guidance.
4. Normalize parameter patterns across all tools.
5. Require preview-first for risky or large write operations.

## Tiering Model

### Core tools (recommended default surface)

These should appear first in docs and discovery results:

- describe_workflows
- sync
- find_scenes
- get_scene_prose
- search_metadata
- list_characters
- list_places
- propose_edit
- commit_edit
- discard_edit
- preview_review_bundle
- create_review_bundle
- get_prose_styleguide_config
- check_prose_styleguide_drift
- update_prose_styleguide_config

### Advanced tools (discoverable, but not first-line)

- bootstrap_prose_styleguide_config
- setup_prose_styleguide_config
- setup_prose_styleguide_skill
- summarize_prose_styleguide_config
- preview_prose_styleguide_config_update
- get_chapter_prose
- update_scene_metadata
- enrich_scene
- enrich_scene_characters_batch
- flag_scene
- snapshot_scene
- list_snapshots
- get_arc
- get_relationship_arc
- get_thread_arc
- list_threads
- upsert_thread_link
- get_reference_doc
- list_scene_references
- search_reference
- upsert_reference_link
- create_character_sheet
- update_character_sheet
- get_character_sheet
- create_place_sheet
- update_place_sheet
- get_place_sheet
- import_scrivener_sync
- import_scrivener_sync_async
- merge_scrivener_project_beta

### Admin/runtime tools

- get_runtime_config
- get_async_job_status
- list_async_jobs
- cancel_async_job

## Canonical Naming Convention

Keep current names as canonical compatibility IDs. Add aliases in docs and (optionally) server metadata.

Pattern:

- Collection read: `domain.list`
- Single read: `domain.get`
- Create/update: `domain.create`, `domain.update`
- Relationship edge upsert: `domain.links.upsert`
- Analysis/check: `domain.check`, `domain.analyze`
- Long-running operation: `domain.run` + job tools
- Dry-run: `domain.preview`

## Backward-Compatible Alias Map

- describe_workflows -> workflows.describe
- get_runtime_config -> runtime.get_config
- sync -> index.sync

- find_scenes -> scenes.list
- get_scene_prose -> scenes.get_prose
- get_chapter_prose -> chapters.get_prose
- search_metadata -> scenes.search
- update_scene_metadata -> scenes.update_metadata
- enrich_scene -> scenes.enrich
- enrich_scene_characters_batch -> scenes.enrich_characters_batch
- flag_scene -> scenes.flag
- snapshot_scene -> scenes.snapshot
- list_snapshots -> scenes.list_snapshots

- propose_edit -> edits.propose
- commit_edit -> edits.commit
- discard_edit -> edits.discard

- list_characters -> characters.list
- get_character_sheet -> characters.get
- create_character_sheet -> characters.create
- update_character_sheet -> characters.update
- get_arc -> characters.get_arc
- get_relationship_arc -> characters.get_relationship_arc

- list_places -> places.list
- get_place_sheet -> places.get
- create_place_sheet -> places.create
- update_place_sheet -> places.update

- list_threads -> threads.list
- get_thread_arc -> threads.get_arc
- upsert_thread_link -> threads.links.upsert

- get_reference_doc -> references.get
- list_scene_references -> references.list_scene_links
- search_reference -> references.search
- upsert_reference_link -> references.links.upsert

- bootstrap_prose_styleguide_config -> styleguide.bootstrap
- setup_prose_styleguide_config -> styleguide.setup
- get_prose_styleguide_config -> styleguide.get
- update_prose_styleguide_config -> styleguide.update
- summarize_prose_styleguide_config -> styleguide.summarize
- preview_prose_styleguide_config_update -> styleguide.preview_update
- check_prose_styleguide_drift -> styleguide.check_drift
- setup_prose_styleguide_skill -> styleguide.setup_skill

- preview_review_bundle -> review_bundles.preview
- create_review_bundle -> review_bundles.create

- import_scrivener_sync -> scrivener.import
- import_scrivener_sync_async -> scrivener.import_async
- merge_scrivener_project_beta -> scrivener.merge_project_beta

- get_async_job_status -> jobs.get_status
- list_async_jobs -> jobs.list
- cancel_async_job -> jobs.cancel

## Discovery Contract (new helper tool)

Add a single high-signal helper:

- Tool: `recommend_next_tool`
- Inputs:
  - `goal` (string)
  - `project_id` (optional)
  - `experience_level` (`beginner` | `advanced`, default `beginner`)
- Output:
  - `recommended_tool`
  - `arguments`
  - `why`
  - `alternatives` (0-3)
  - `next_step_on_success`
  - `next_step_on_error`

This one tool can hide most complexity for first-time users.

## Parameter Consistency Rules

Apply these uniformly across tools:

- Use `project_id` everywhere, not project/name variants.
- Use `scene_id`, `character_id`, `place_id`, `thread_id` consistently.
- Use pagination as `page`, `page_size` everywhere list-like data may be large.
- Use filtering as a top-level `filters` object when there are 3+ optional filters.
- Use dedicated `domain.preview` tools when preview output needs its own shape or reviewer workflow.
- Use `dry_run` only on heavy writes/imports where preview and execute can share the same validation path and response shape.
- Return `next_step` on actionable errors.

## Response Envelope Convention

Standard response shape for new/updated tools:

- `ok` (boolean)
- `data` (object or list)
- `warnings` (list)
- `errors` (list)
- `next_step` (optional object)
- `meta` (timings, paging, counts)

## Rollout Plan

### Step 1 (immediate, non-breaking in 2.x)

- Keep all existing tool IDs unchanged.
- Update docs and `describe_workflows` to show tier tags and alias names.
- Add `recommend_next_tool`.

### Step 2 (compatibility transition in 2.x)

- Expose aliases in server metadata while retaining original names.
- Add consistency wrappers for parameter normalization where needed.

### Step 3 (major release: 3.0.0 breaking cleanup)

- Remove legacy tool IDs and keep canonical convention names only.
- Remove legacy parameter variants and require normalized parameter shapes.
- Standardize response envelopes for the migrated tool set.
- Keep `recommend_next_tool` to assist migration discovery.

Acceptance criteria for `3.0.0` cut:

- A complete migration guide exists mapping `2.x -> 3.0.0` tool names and parameters.
- All canonical names are stable and documented in one source of truth.
- Integration tests validate all canonical tools and representative workflows.
- At least one pre-release (`3.0.0-rc`) is validated against real agent/client prompts.
- Release notes explicitly call out removed legacy IDs and breaking parameter changes.

## Alternatives & Tradeoffs

### Option A: No breaking change (support legacy forever)

- Pros: Lowest immediate adoption friction.
- Cons: Permanent complexity tax, larger surface area for agents, harder docs/discovery, slower long-term iteration.

### Option B: Immediate big-bang break in 3.0.0

- Pros: Cleanest end state quickly.
- Cons: Highest migration risk; many prompts/clients may fail at once.

### Option C: Staged 2.x transition + 3.0.0 cleanup (recommended)

- Pros: Lets users migrate gradually while preserving a clean long-term API.
- Cons: Requires temporary dual maintenance in 2.x and stronger release discipline.

Decision:

- Chosen option: **Option C** (staged `2.x` transition, then `3.0.0` cleanup).
- Rationale: balances usability improvements and migration safety while still reaching a clean canonical API in the next major.

## Resolved Decisions

1. `recommend_next_tool` decision model

- Use deterministic routing as far as possible via maintained mapping/rules.
- Allow fallback behavior only when no deterministic match exists.

1. Alias precedence and canonical naming

- Adopt aliases as canonical names as early as possible.
- During transition, docs and examples should prefer alias/canonical names.

1. Response envelope rollout scope for `3.0.0`

- Standardize all tools on the response envelope in `3.0.0` (no partial domain rollout).

1. Deprecation observability in `2.x`

- No dedicated observability/telemetry requirement for migration readiness in this phase.
- Migration readiness is assessed by maintainers via docs/tests/review rather than usage analytics.

1. Compatibility window and release policy

- Keep transition window short.
- Use minimal RC/release gating appropriate for a likely small user base.

## Suggested Beginner Menu (15 tools)

- describe_workflows
- sync
- find_scenes
- get_scene_prose
- search_metadata
- list_characters
- list_places
- propose_edit
- commit_edit
- discard_edit
- preview_review_bundle
- create_review_bundle
- get_prose_styleguide_config
- check_prose_styleguide_drift
- update_prose_styleguide_config

## Suggested Docs IA

- Quick Start (Core 15)
- Common Workflows (task-oriented)
- Full Tool Reference (48)
- Advanced/Power Tools
- Error Codes and next_step handling
- Compatibility and alias policy
