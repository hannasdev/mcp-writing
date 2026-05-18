# Target Architecture Migration — Milestones

Status: Active  
Current milestone: M4 — Add Read-Only Structure Diagnostics  
Owner: MCP Writing  
Date: 2026-05-17

This milestone plan intentionally gives early refactoring milestones more detail than later migration work.
The early milestones should preserve behavior while making the current structure-control boundaries explicit.
Later milestones remain directional until the earlier seams and diagnostics teach us what needs to change.

## Objective

Stage preparatory refactoring that moves Writing MCP toward the target architecture without over-committing to storage, public API, or Scrivener workflow decisions too early.

## Guardrails

- Preserve existing behavior in M1-M3.
- Keep refactor-only commits separate from behavior-changing commits where practical.
- Add characterization tests before risky extractions.
- Do not remove compatibility paths until explicit replacement workflows exist.
- Keep the system passing and releasable after each milestone.

## M1 — Name Current Structure Inference Boundaries

Goal: make existing structure inference and indexing behavior easier to understand without changing it.

Deliverables:

- Extract chapter and epigraph inference helpers from generic sync code into a focused structure module.
- Extract canonical chapter resolution/upsert logic from scene indexing into a focused helper or module.
- Preserve all current warnings, derived IDs, database writes, and sync results.
- Add characterization tests for the extracted behavior.

Candidate module names:

- `src/structure/structure-inference.js`
- `src/structure/chapter-indexing.js`

Acceptance criteria:

- Existing sync behavior is unchanged for explicit chapter folders, legacy chapter paths, epigraph files, and ambiguous chapter order.
- Tests cover current behavior before the extraction becomes a dependency for later work.
- `src/sync/sync.js` has less direct responsibility for deciding what structural observations mean.

Test strategy:

- Unit tests for explicit chapter folder inference.
- Unit tests for legacy path fallback inference.
- Unit tests for epigraph detection from metadata and filename.
- Unit tests for unknown or conflicting chapter linkage warnings.
- Existing sync integration tests pass unchanged.

Out of scope:

- New public tools.
- New strict mode.
- Changing whether sync mutates canonical chapter rows.

## M2 — Centralize Structural Sidecar Writes

Status: Complete.

Goal: stop structural sidecar patches from being spread through generic metadata update paths.

Deliverables:

- Introduce a shared internal helper for scene structure sidecar patches.
- Route existing writers through the helper where they touch fields such as:
  - `chapter_id`
  - `chapter`
  - `chapter_title`
  - `part`
  - `scene_role`
- Preserve current `update_scene_metadata` public behavior.
- Preserve current enrichment and batch behavior where they normalize scene metadata.

Candidate helper names:

- `buildSceneStructurePatch`
- `applySceneChapterFields`
- `normalizeSceneStructureFields`

Acceptance criteria:

- Current metadata writes produce the same sidecar fields as before.
- Chapter compatibility behavior remains available.
- Future explicit structure commands have one obvious helper/service to call.

Test strategy:

- Unit tests for the helper using current sidecar inputs.
- Integration test proving `update_scene_metadata` still persists canonical `chapter_id` and compatibility fields as today.
- Existing metadata and styleguide tests pass unchanged.

Out of scope:

- Deprecating `chapter` or `chapter_id` fields on `update_scene_metadata`.
- Changing sidecar schema.

## M3 — Split Sync Observation From Canonical Mutation Internals

Status: Complete.

Goal: create internal seams so sync can later observe broadly without always mutating canonical structure.

Deliverables:

- Refactor sync into clearer internal phases:
  - file scan
  - metadata/prose read
  - structure observation
  - canonical indexing
  - derived index regeneration
  - pruning
  - diagnostics summary
- Use explicit intermediate result objects for observed structure and diagnostics.
- Preserve existing sync output and database effects.

Suggested internal concepts:

- `observedChapter`
- `observedEpigraph`
- `structureDiagnostic`
- `canonicalIndexPlan`

Acceptance criteria:

- Sync results and warning summaries remain compatible.
- Pruning behavior is unchanged.
- The code can express "observed drift" separately from "mutated canonical state," even if both still happen in this milestone.

Test strategy:

- Characterization tests around sync warning summaries.
- Integration parity tests for representative project fixtures.
- Unit tests for diagnostic summary construction if extracted.

Out of scope:

- Read-only sync mode.
- Strict sync mode.
- Changing import behavior.

## M4 — Add Read-Only Structure Diagnostics

Goal: expose structure drift and ambiguity without repairing it.

Deliverables:

- Add an internal diagnostics layer, then expose it through a public read-only tool if appropriate.
- Extract the M3 sync phase seams into focused structure/sync modules where doing so keeps the diagnostics layer understandable.
- Report categories such as:
  - duplicate chapter sort indexes
  - scenes linked to unknown chapters
  - epigraphs linked to unknown or conflicting chapters
  - multiple prologue or epilogue roles in one project
  - folder-derived structure that disagrees with canonical records
  - numeric compatibility fields that disagree with canonical chapter identity
- Return actionable next steps without mutating files or database canonical state.

Acceptance criteria:

- Diagnostics can run independently from repair.
- Diagnostics distinguish observation, derived-state regeneration, and canonical mutation.
- Structure diagnostics do not add more responsibility to `src/sync/sync.js` when a focused module boundary would keep the behavior clearer.
- Ambiguity is reported deterministically enough for an AI agent to explain to a user.

Test strategy:

- Unit tests for each diagnostic category.
- Unit tests for any extracted sync/structure module boundaries that diagnostics depend on.
- Integration test on a mixed fixture containing clean structure, ambiguous structure, and stale compatibility fields.

Out of scope:

- Auto-repair.
- Canonical storage redesign.

## M5 — Introduce Explicit Scene-to-Chapter Mutation

Goal: add the first sanctioned daily-work structural mutation path.

Deliverables:

- Add an explicit scene-to-chapter assignment workflow, likely `assign_scene_to_chapter`.
- Support clearing a scene chapter link if product direction confirms this should be allowed.
- Route the command through shared structure patching/indexing helpers.
- Keep `update_scene_metadata` compatibility behavior working.
- Update workflow/tool descriptions to steer AI agents toward the explicit operation.

Acceptance criteria:

- A scene can be assigned to a canonical chapter through a named MCP operation.
- The command validates project scope and chapter identity.
- The command updates sidecar state and index state consistently with current storage.
- Existing compatibility paths are not removed in this milestone.

Test strategy:

- Unit tests for validation and patch generation.
- Integration test for assignment followed by `find_scenes`.
- Integration test for assignment followed by `get_chapter_prose`.
- Review-bundle scope test if the affected scene participates in bundle planning.

Out of scope:

- Chapter rename or reorder commands.
- Removing direct structural fields from generic metadata updates.

## M6 — Normalize Compatibility Resolution

Goal: reduce long-term reliance on numeric chapter fields as authority.

Deliverables:

- Resolve numeric `chapter` and `chapters` filters through canonical chapter identity where possible.
- Align review-bundle planning with canonical chapter resolution.
- Keep numeric chapter inputs as compatibility aliases.
- Add clear errors or warnings when compatibility inputs cannot resolve safely.

Acceptance criteria:

- Numeric chapter targeting behaves consistently across search, prose retrieval, styleguide, batch enrichment, and review bundles.
- Canonical `chapter_id` remains the preferred target in tool descriptions.
- Ambiguous compatibility resolution does not silently select the wrong structure.

Test strategy:

- Unit tests for compatibility resolution.
- Integration tests for all public tools that still accept numeric chapter filters.
- Regression tests for no-result and ambiguous-result behavior.

## M7 — Add Additional Explicit Structure Commands

Goal: expand sanctioned structural mutation paths after the first command proves the pattern.

Potential commands:

- `create_chapter`
- `rename_chapter`
- `reorder_chapter`
- `attach_epigraph`
- `move_scene`

Acceptance criteria:

- Each command owns one structural intent.
- Commands validate invariants before writing.
- Commands produce clear diagnostics and next steps.

Details intentionally deferred:

- exact tool names
- whether commands write sidecars, database rows, or both
- how much Scrivener-compatible output is generated immediately

## M8 — Decide Canonical Storage Direction

Goal: make an evidence-based decision about whether sidecars remain canonical storage or become a representation layer.

Questions to answer:

- Is SQLite the durable canonical model, a derived index, or part of a hybrid model?
- Which files remain author-editable?
- Which files become managed system state?
- How does Git-backed auditability work if managed state becomes opaque or semi-opaque?
- How do import/export adapters preserve Scrivener interoperability?
- What recovery story exists if database and files disagree?

Acceptance criteria:

- A decision record or follow-up PRD exists before implementation.
- Migration strategy is explicit.
- Rollback and recovery risks are documented.

## Test Strategy Summary

Early milestones:

- prioritize characterization tests
- run narrow unit tests around extracted helpers
- run existing sync, metadata, search, and review-bundle integration tests

Later milestones:

- add command-level integration coverage
- add compatibility resolution regression tests
- add migration/recovery tests only after storage direction is chosen

## Definition of Done

This initiative is complete when Writing MCP has clear internal boundaries for structural observation, canonical mutation, diagnostics, and compatibility resolution, and the remaining storage-model migration can be planned from evidence rather than speculation.
