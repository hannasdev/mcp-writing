# MCP Tooling Usability Milestones (mcp-writing)

Date: 2026-05-01
Companion to: [mcp-tooling-usability.md](./mcp-tooling-usability.md)

## Purpose

Break the usability direction into implementation-oriented milestones based on user value.

This document is intentionally more operational than the main PRD. It exists so implementation planning can focus on one milestone at a time without carrying the full conceptual discussion in working memory.

## Milestone Order

Recommended sequence:

1. Find relevant scenes without reading everything.
2. Catch-up guidance for low-parity projects.
3. Inspect targeted prose with context.
4. Revise scenes safely.
5. Understand characters, places, and threads in context.
6. Prepare review material for sharing.

This order prioritizes helping a real user move from broad manuscript questions to targeted reading and safe action, while also accounting for imported projects that begin below metadata parity.

## Current-State Validation

The milestone assumptions in this document have been checked against the current tool implementations and integration tests.

Overall conclusion:

- the milestone order still looks sound;
- some milestones are already well-supported by current tools and mostly need surfacing changes;
- some milestones have solid primitives but still speak the wrong product language;
- some milestones need meaningful product-behavior work before the milestone assumptions are actually true.

The most important validation findings are:

- scene-scoped prose and editing flows are not yet project-safe when `scene_id` is duplicated across projects;
- `describe_workflows` still reflects an older tool-centric and styleguide-heavy worldview rather than the new outcome-first direction;
- low-parity recovery tools exist, but the product does not yet surface parity state as a coherent catch-up workflow;
- stale-metadata guidance is inconsistent across metadata-oriented read tools;
- discovery results are data-rich, but not yet especially guided toward next steps.

These findings should shape implementation sequencing inside the milestones below.

## Guidance Model

The usability direction in this PRD assumes a split guidance model:

- `describe_workflows` owns initial orientation and uncertainty handling;
- individual tools should suggest the most likely next step from their current result.

This means:

- `describe_workflows` is the default starting point for most agent sessions;
- `describe_workflows` is also the fallback when the agent is uncertain what to do next;
- direct tools do not replace workflow discovery, but they should still help users continue coherently once a task is underway.

Tool-level guidance does not need to be perfect or exhaustive. It should focus on a small number of likely continuations rather than attempting to model every possible next move.

## Milestone 1: Find Relevant Scenes

### User outcome

The user can ask a manuscript question and get plausible scene candidates without needing to understand the full tool surface.

### Product framing

This milestone should be framed as question-driven manuscript discovery, not as search-tool selection.

The intended product language is:

- start here when you have a manuscript question;
- begin with metadata-level exploration;
- use prose only after likely scenes have been identified.

This milestone should make the product feel like a reasoning guide rather than a search utility shelf.

### Relevance rules

This milestone should stay in the foreground whenever:

- the user begins with a broad manuscript question;
- the agent does not yet know which scene or structural surface is relevant;
- metadata-level narrowing is still possible.

### Current tools

- `describe_workflows`
- `sync`
- `find_scenes`
- `search_metadata`
- `flag_scene`

### Front this

- `describe_workflows`
- `find_scenes`
- `search_metadata`

### Tuck away

- `flag_scene`
- `sync` as supporting context rather than a primary reasoning tool

### Why this is first

This is the front door to the product's value. If discovery is weak, users and agents will bypass the intended model and default to prose-heavy fallback.

### Feasible solution

- make `describe_workflows` lead with manuscript exploration and discovery-oriented entry points;
- treat `find_scenes` as the primary structured path;
- treat `search_metadata` as the thematic or fuzzy fallback;
- make search results feel like guidance toward a next step rather than just a list of records;
- keep prose out of the default discovery loop.

### Likely scope of change

Mostly surface design, workflow guidance, and documentation updates rather than major new capability work.

### Success signal

Users can begin with metadata and reach likely scenes without needing to guess which tool family to use.

### Current-state validation

This milestone is partially validated by the current implementation.

What already supports it well:

- `find_scenes` is metadata-only, filterable, and paginated;
- `search_metadata` is a strong fallback for fuzzy or thematic queries;
- both tools already reinforce the idea that prose should not be the first retrieval layer.

What does not yet fully match the milestone:

- `describe_workflows` does not yet front this outcome as clearly as it should;
- discovery responses mostly return records rather than strong next-step guidance;
- stale metadata warnings are inconsistent because `find_scenes` only includes warning data in paginated payloads.

Implementation implication:

- this milestone likely needs workflow and response-shaping work more than major new core capability work.

### Implementation plan (ready-to-execute)

Scope this milestone to discovery surface behavior only.

Goal:

- make question-driven discovery the obvious default path;
- reinforce metadata-first narrowing before prose escalation;
- provide light next-step guidance without introducing heavy orchestration.

Planned change set:

1. Workflow discovery surface rewrite

- files: `src/workflows/workflow-catalogue.js`, `src/index.js`, `src/test/integration/runtime.test.mjs`
- changes:
  - ensure discovery-oriented workflows lead the catalogue;
  - ensure `describe_workflows` communicates default-first and uncertainty-fallback behavior;
  - ensure tests assert the new workflow IDs and ordering.

2. Discovery-tool narrative and guidance polish

- files: `src/tools/search.js`, `src/test/integration/search.test.mjs` (if assertions need updates)
- changes:
  - keep `find_scenes` primary and `search_metadata` fallback in tool language;
  - add or refine lightweight next-step hints where they improve continuation clarity;
  - avoid introducing strict gating or orchestration logic in this milestone.

3. Generated reference docs alignment

- files: `docs/tools.md` (generated)
- changes:
  - regenerate docs so tool descriptions and workflow messaging match the new surface framing.

Acceptance checks:

- `describe_workflows` starts from discovery-oriented workflows and passes runtime integration tests.
- Discovery-related tool descriptions clearly prefer metadata-first narrowing before prose reads.
- No change in underlying core retrieval semantics (filtering, pagination, result correctness).
- Tool docs regenerate cleanly and reflect updated behavior language.

Explicitly deferred:

- parity signal detection/reporting systems and broad catch-up orchestration (Milestone 2);
- strict prose-context packaging and advanced escalation logic (Milestone 3);
- project-safe scene targeting fixes for duplicated `scene_id` values (cross-milestone priority outside this reframing slice);
- alias/naming migration and response-envelope migration topics.

## Milestone 2: Catch-Up Guidance For Low-Parity Projects

### User outcome

A user who imports or syncs an existing project gets helpful guidance toward metadata parity instead of remaining stuck in prose-first workflows.

### Product framing

This milestone should be framed as guided parity recovery, not as maintenance work for its own sake.

The intended product language is:

- your project is usable now, but the system can help it become more valuable;
- metadata gaps are opportunities to improve future reasoning quality;
- catch-up work should feel like progress, not punishment.

This milestone should make the product feel like it is helping the user climb into the intended steady-state model.

### Relevance rules

This milestone should become prominent when:

- new source material has been added or imported;
- sync or import reveals parity problems;
- a normal workflow touches low-parity material and there is a clear, useful next recovery step.

The system should suggest likely recovery steps rather than assuming consent for additional follow-up work.

### Current tools

- `describe_workflows`
- `sync`
- `enrich_scene`
- `enrich_scene_characters_batch`
- `get_async_job_status`
- `update_scene_metadata`
- `suggest_scene_references`
- `list_scene_references`
- `flag_scene`

### Front this

- `sync` as the main parity signal
- `enrich_scene` for opportunistic local recovery
- explicit parity-recovery guidance in `describe_workflows`

### Tuck away

- `enrich_scene_characters_batch`
- `get_async_job_status`
- `update_scene_metadata`
- `suggest_scene_references`
- `list_scene_references`

### Why this is second

Many users will not start in a clean steady-state project. Without a recovery story, the product may only work well in the ideal case and underperform in real adoption.

### Feasible solution

- start with a simple default rule: when the user touches material that is stale or not indexed, suggest fixing that as the next step;
- keep the guidance local to the current document or scene rather than trying to solve broad project-wide parity all at once;
- treat full-prose and full-reference reads as opportunities to improve future metadata-first usage;
- keep recovery guidance timely and scoped so it feels helpful rather than bureaucratic;
- defer broad parity-tracking and large-scale catch-up orchestration to a separate future feature if needed.

### Likely scope of change

This milestone likely needs meaningful product behavior changes, not just better surfacing.

### Success signal

Low-parity projects gradually move toward metadata-first usage instead of staying dependent on full-content reads.

### Current-state validation

This milestone is only partially validated, and it is one of the biggest current gaps.

What already supports it:

- `enrich_scene` provides lightweight per-scene recovery;
- `enrich_scene_characters_batch` already has useful guardrails such as `dry_run`, `max_scenes`, and `only_stale`;
- async job tracking for large catch-up work already exists;
- reference suggestion and linking tools can support parity improvement for scene-reference relationships.

What is missing today:

- `sync` does not currently return a structured parity signal that can be used to drive catch-up guidance;
- `describe_workflows` has no explicit parity-recovery workflow;
- the product does not yet suggest simple next-step recovery when the user touches stale or unindexed material;
- the current recovery experience is a set of tools, not yet a coherent local next-step behavior.

Implementation implication:

- this milestone should start with simple local recovery suggestions rather than a complex parity-management system.

## Milestone 3: Inspect Targeted Prose With Context

### User outcome

Once metadata narrows the space, the user can open the right prose at the right time with enough context to continue productively.

### Product framing

This milestone should be framed as targeted close reading, not as bulk content access.

The intended product language is:

- metadata got us close;
- now open the specific prose that matters;
- keep reading scoped to the current reasoning task.

This milestone should make prose access feel deliberate and well-aimed rather than sprawling.

### Relevance rules

This milestone should become prominent when:

- metadata cannot answer the question by itself;
- the user needs confirmation of details, nuance, continuity, tone, pacing, or other prose-only evidence;
- a scene has already been identified as a likely target for closer reading.

Chapter-wide prose reads should be suggested only when the question cannot be answered from metadata alone or when prose nuance across the chapter must be confirmed.

### Current tools

- `get_scene_prose`
- `get_chapter_prose`
- `find_scenes`
- `search_metadata`
- `list_scene_references`
- `get_reference_doc`

### Front this

- `get_scene_prose`
- `describe_workflows` guidance about when to escalate to prose

### Tuck away

- `get_chapter_prose`
- `get_reference_doc`
- `list_scene_references`

### Why this comes after discovery

The prose escalation only feels disciplined and valuable if the discovery layer already points users toward likely targets.

### Feasible solution

- make single-scene inspection the default prose path;
- treat chapter-wide reads as heavier and more specialized;
- trust the agent and user to decide when more detail is needed, while still offering sensible default suggestions;
- support scene inspection with lightweight reasoning context and a simple suggestion such as reading the full document next when more detail is required;
- preserve the principle that prose access is explicit but not burdensome.

### Likely scope of change

Mostly workflow framing, prioritization, and response guidance rather than large new capability work.

### Success signal

Users read the right prose at the right time rather than expanding into broad reading by default.

### Current-state validation

This milestone is partially validated by the current implementation.

What already supports it:

- `get_scene_prose` clearly positions itself as the targeted prose path;
- `get_chapter_prose` is already described as expensive and secondary;
- the tool surface already encodes the intended escalation from metadata to prose.

What does not yet fully match the milestone:

- `get_scene_prose` is not project-safe when `scene_id` is duplicated across projects;
- prose fetches do not currently provide even lightweight next-step guidance about when to keep reading or escalate further;
- `describe_workflows` still presents chapter-wide reading too casually inside manuscript exploration.

Implementation implication:

- this milestone needs safer targeting and light-touch contextual framing, not strict reading guidance or a heavy prose-orchestration layer.

## Milestone 4: Revise Scenes Safely

### User outcome

The user can move from reasoning to action by revising a scene through a clear, approval-based workflow.

### Product framing

This milestone should be framed as safe revision, not as raw file editing or git manipulation.

The intended product language is:

- review the proposed change;
- approve only when it looks right;
- rely on the system to preserve safety and reversibility.

This milestone should make editing feel explicit, collaborative, and trustworthy.

### Relevance rules

This milestone should become prominent when:

- the user wants to change prose rather than just inspect it;
- a scene has already been identified and understood well enough to revise safely;
- the next meaningful step is action rather than further discovery.

### Current tools

- `find_scenes`
- `get_scene_prose`
- `propose_edit`
- `commit_edit`
- `discard_edit`
- `list_snapshots`

### Front this

- `propose_edit`
- `commit_edit`
- `discard_edit`

### Tuck away

- `list_snapshots`

### Why this comes here

Editing becomes much more trustworthy once discovery and prose inspection already feel disciplined.

### Feasible solution

- present revision as one guided flow with a clear approval checkpoint;
- keep `propose_edit` and `commit_edit` conceptually paired;
- keep rollback safety available without making users reason directly from git concepts.

### Likely scope of change

Likely more about surfacing and workflow polish than core implementation, because the edit model is already conceptually strong.

### Success signal

Users can revise scenes safely without confusion about when changes are proposed versus applied.

### Current-state validation

This milestone is mostly validated by the current implementation.

What already supports it strongly:

- `propose_edit` and `commit_edit` are cleanly separated;
- edits remain explicit and approval-based;
- write-time diagnostics and snapshot behavior are already built in;
- `discard_edit` cleanly supports rejection of a proposed change.

What still falls short:

- edit flows share the same scene-resolution problem as prose reads when scene IDs are duplicated across projects;
- the workflow is conceptually strong, but still depends on an older workflow catalogue that has not been updated to the new usability direction.

Implementation implication:

- this milestone likely needs surface polish and safer scene targeting more than deep rework of edit behavior.

## Milestone 5: Understand Entities And Threads In Context

### User outcome

The user can understand a character, place, or thread in manuscript context without manually assembling scene evidence.

### Product framing

This milestone should be framed as structural manuscript understanding, not as entity management.

The intended product language is:

- understand this character's path through the manuscript;
- understand how this place or thread functions in context;
- use lookup steps only when needed to orient the reasoning flow.

This milestone should make the product feel like a story-analysis system rather than a database admin surface.

### Relevance rules

Character understanding should be the primary entry point in this milestone.

Place understanding should become prominent when:

- the current scene includes that place;
- the user is asking about the place directly;
- the place is materially relevant to the current reasoning task.

Thread understanding should become prominent when:

- the current scene or character is clearly tied to an arc, subplot, or recurring storyline question;
- the user is asking about progression, continuity, or structural development across scenes;
- storyline context is more relevant than isolated scene metadata.

### Current tools

- `list_characters`
- `get_character_sheet`
- `get_arc`
- `list_places`
- `get_place_sheet`
- `list_threads`
- `get_thread_arc`

### Front this

- `get_character_sheet`
- `get_arc`
- `get_place_sheet`
- `get_thread_arc`

### Tuck away

- `list_characters`
- `list_places`
- `list_threads`

### Why this follows the scene loop

Entity and thread understanding is powerful, but it is less foundational than scene discovery, parity recovery, and safe revision.

### Feasible solution

- frame these workflows around understanding rather than management;
- treat character understanding and character arc reasoning as the primary entry point within this milestone;
- treat place and thread understanding as secondary structural surfaces that should become prominent only when the task calls for them;
- use lookup tools mainly as helpers for disambiguation and discovery.

### Likely scope of change

Mostly framing, workflow rewriting, and de-CRUDing the surface language.

### Success signal

Users can ask structural questions about the manuscript and get useful contextual answers without falling back to manual scene trawling.

### Current-state validation

This milestone is partially validated by the current implementation.

What already supports it:

- `get_arc`, `get_character_sheet`, `get_place_sheet`, and `get_thread_arc` already support structural manuscript reasoning;
- the underlying data surface is broader than simple scene discovery and can answer more structural questions.

What does not yet fully match the milestone:

- the workflow language still frames these areas as management rather than understanding;
- lookup tools such as `list_characters`, `list_places`, and `list_threads` still occupy more narrative weight than they should;
- stale metadata warnings are not consistently surfaced on non-paginated metadata reads.

Implementation implication:

- this milestone likely needs reframing and workflow rewriting more than new tool primitives.

## Milestone 6: Prepare Review Material

### User outcome

The user can generate predictable review artifacts for editors, collaborators, or beta readers.

### Product framing

This milestone should be framed as review preparation, not as export mechanics.

The intended product language is:

- preview what will be shared;
- confirm the scope and warnings;
- generate a review-ready artifact.

This milestone should make bundle generation feel like a focused editorial workflow rather than a file-rendering feature.

### Relevance rules

This milestone should become prominent when:

- the user is preparing to share material with an editor, collaborator, or beta reader;
- review scope and output format matter more than further manuscript exploration;
- the task has shifted from reasoning or revising into packaging material for human review.

### Current tools

- `preview_review_bundle`
- `create_review_bundle`

### Front this

- `preview_review_bundle`
- `create_review_bundle`

### Tuck away

- output-detail decisions unless needed for the current review workflow

### Why this is later

This is valuable, but it depends less on core reasoning navigation and more on the rest of the model already feeling coherent.

### Feasible solution

- keep the workflow as a tight preview-then-create sequence;
- position it as a specialized high-value outcome rather than part of the everyday reasoning surface.

### Likely scope of change

Probably modest compared with earlier milestones.

### Success signal

Users can produce review bundles reliably without needing to understand underlying export mechanics.

### Current-state validation

This milestone is mostly validated by the current implementation.

What already supports it strongly:

- `preview_review_bundle` and `create_review_bundle` already form a coherent two-step workflow;
- strictness handling, warnings, deterministic planning, and provenance are already present;
- this area already behaves much more like a finished outcome-oriented flow than several earlier milestones.

What still remains:

- this workflow should be placed correctly in the new surface hierarchy so it does not crowd more foundational reasoning outcomes.

Implementation implication:

- this milestone likely needs positioning and polish more than major behavior change.

## Cross-Milestone Notes

### Framing rules to preserve during implementation

Each milestone should preserve the following framing choices unless a later PRD revision changes them explicitly:

- Milestone 1: question-driven discovery, not tool picking.
- Milestone 2: guided parity recovery, not bureaucratic maintenance.
- Milestone 3: targeted close reading, not bulk prose access.
- Milestone 4: safe revision, not raw editing mechanics.
- Milestone 5: structural understanding, not entity management.
- Milestone 6: review preparation, not export plumbing.

These framing decisions are part of the product design, not just the documentation style. Implementation choices should reinforce them.

### Relevance hierarchy to preserve

Implementation should also preserve the idea that some surfaces become prominent only when context makes them relevant:

- discovery comes first when scope is still broad;
- parity recovery becomes prominent when low-parity conditions are visible;
- targeted prose inspection becomes prominent when metadata is insufficient;
- revision becomes prominent when action is the next clear step;
- character understanding is the primary structural surface;
- place and thread understanding are secondary structural surfaces that should rise when context makes them useful;
- review preparation becomes prominent when the task shifts to sharing.

### Mostly already strong

These capabilities appear conceptually sound and may mainly need better surfacing:

- `find_scenes`
- `search_metadata`
- `get_scene_prose`
- `propose_edit`
- `commit_edit`
- `discard_edit`
- `preview_review_bundle`
- `create_review_bundle`

### Likely to stay secondary

These capabilities remain valuable but should not dominate the primary surface:

- styleguide-related tools
- `get_chapter_prose`
- async job management tools
- runtime/admin tools
- direct metadata update tools
- batch enrichment tools

### Likely to need product design work

These areas likely need more than reordering or documentation:

- rewriting `describe_workflows` around outcome-first navigation;
- fixing project-safe scene targeting for prose and editing flows;
- defining and surfacing parity signals;
- integrating low-parity recovery into normal usage without making it feel mandatory;
- reframing entity and thread flows away from management language and toward understanding.

## Validation Summary By Milestone

### Mostly validated

- Milestone 4: Revise scenes safely
- Milestone 6: Prepare review material

### Strong primitives, but surface needs reframing

- Milestone 1: Find relevant scenes
- Milestone 3: Inspect targeted prose with context
- Milestone 5: Understand entities and threads in context

### Needs meaningful product-behavior work

- Milestone 2: Catch-up guidance for low-parity projects

Milestone 2 should now be understood as needing simple local recovery behavior rather than a broad parity-management system.

## Validation-Driven Near-Term Priorities

The validation work suggests a few high-leverage changes that cut across multiple milestones:

1. Rewrite `describe_workflows` around the new outcome-first model.
2. Make scene-scoped prose and edit flows project-safe.
3. Add structured parity signaling and catch-up guidance around `sync`.
4. Normalize stale-metadata guidance across metadata-oriented read flows.

These changes would reduce the gap between the milestone assumptions and the current product behavior without requiring every milestone to be implemented at once.

## Implementation Planning Use

When implementation begins, each milestone should be broken into:

- the user problem being solved;
- the tools being fronted or hidden;
- the minimal behavior change needed;
- the smallest useful scope that can ship without waiting for later milestones.

This document is meant to support that breakdown.
