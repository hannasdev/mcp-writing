# PRD: Target Architecture Migration

**Status:** 📋 Deferred backlog (not active)

This initiative captures preparatory refactoring and staged migration work needed to move Writing MCP toward the [Conceptual Target Architecture](../../../foundations/target-architecture.md) without forcing an early storage rewrite or behavior change.

It should be treated as a staged convergence plan, not a commitment to implement the full target architecture in one branch.

## Goal

Prepare the codebase for a clearer separation between:

- MCP control-plane workflows
- canonical manuscript structure
- authored prose
- derived views and indexes
- import/export adapters
- maintenance diagnostics and repair

The immediate goal is safer future migration, not a new user-facing workflow.

## Problem

The current implementation already has important target-architecture pieces:

- canonical `chapters` and `epigraphs`
- `chapter_id` scene links
- chapter-aware search and prose retrieval
- epigraph-aware review bundle rendering
- sync/import warnings for ambiguous structure

However, several implementation paths still blur architectural boundaries:

- `sync` can infer structural state from folders and sidecars during ordinary indexing.
- scene sidecars still carry compatibility fields such as `part`, `chapter`, and `chapter_title`.
- generic metadata tools can still write structure-adjacent fields.
- numeric chapter filters remain active in several workflows.
- maintenance, observation, indexing, and canonical mutation are not always separated in code.

These behaviors are valuable for compatibility, but they make it harder to enforce the target rule that canonical structure changes should go through sanctioned MCP workflows.

## User Value

This work does not primarily add new author-facing capability.
It lowers the cost and risk of future author-facing work:

- explicit chapter and scene-movement workflows
- safer Scrivener and legacy imports
- better structure diagnostics before repair
- fewer accidental AI sidecar edits
- future divisions without repeating folder/order coupling
- clearer generated views that do not become authority

## Product Boundary

In scope:

- behavior-preserving refactors that expose current structural boundaries
- characterization tests around current sync, metadata, and chapter behavior
- internal seams between observation, inference, canonical indexing, and mutation
- read-only structure diagnostics
- gradual introduction of explicit structural mutation workflows
- compatibility cleanup after safer paths exist

Out of scope for early milestones:

- replacing the sidecar storage model
- changing the public import contract
- removing numeric chapter compatibility
- introducing divisions
- changing Scrivener workflow semantics
- broad rewrite of sync or metadata tools

## Design Principles

1. **Preserve behavior before tightening it**
   Early refactors should make the current behavior explicit and tested before changing contracts.

2. **Separate structure from metadata plumbing**
   Structural fields such as chapter membership and ordering need named pathways rather than being incidental metadata writes.

3. **Split observation from mutation**
   Maintenance and sync code should be able to observe drift without silently repairing canonical structure.

4. **Keep compatibility visible**
   Numeric chapter targeting and folder-derived structure should remain available during migration, but code should label them as compatibility paths.

5. **Prefer small reviewable milestones**
   Each milestone should leave the system releasable and should avoid committing later architectural details too early.

## Migration Direction

The migration should move in three broad phases:

1. **Clarify current behavior**
   Extract and test the existing inference, indexing, and sidecar-write behavior without changing outputs.

2. **Introduce safe architecture seams**
   Centralize structural writes, split sync observation from canonical mutation, and add diagnostics.

3. **Tighten contracts gradually**
   Add explicit structural commands, route callers through them, and later decide whether sidecars remain canonical storage or become a representation layer.

## Acceptance Criteria

This initiative is complete when:

1. Structure inference and canonical indexing logic are isolated from generic sync mechanics.
2. Structural sidecar writes are centralized behind named helpers or services.
3. Sync internals distinguish observation, diagnostics, derived-index regeneration, and canonical mutation.
4. A read-only structure diagnostic surface exists for canonical drift and ambiguous structure.
5. At least one explicit structural mutation workflow exists for scene-to-chapter assignment.
6. Numeric chapter compatibility paths are consistently resolved through canonical chapter identity where possible.
7. Remaining storage-model questions are documented with enough evidence to decide a later migration.

## Test Strategy

Unit tests:

- structure inference from explicit chapter folders
- legacy path fallback behavior
- epigraph detection and linkage requirements
- canonical chapter resolution and compatibility aliases
- structural sidecar patch helpers
- structure diagnostics categories

Integration tests:

- `sync` parity before and after refactors
- `update_scene_metadata` compatibility behavior until explicitly deprecated
- chapter-aware search and prose retrieval
- review bundle chapter and epigraph rendering
- explicit structural command round trips once introduced

Manual verification:

- run sync on representative Scrivener-imported and direct-folder projects
- inspect warning summaries for ambiguous structure
- confirm existing AI-facing tool flows still work through `describe_workflows`

## Related

- [milestones.md](milestones.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Chapter Structure Follow-up](../chapter-structure/prd.md)
