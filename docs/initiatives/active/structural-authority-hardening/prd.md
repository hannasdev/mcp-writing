# PRD: Structural Authority Hardening

**Status:** Active implementation

This follow-up initiative closes the remaining discrepancies between the current implementation and the [Conceptual Target Architecture](../../../foundations/target-architecture.md) after the completed [Target Architecture Migration](../../done/target-architecture-migration/prd.md).

Target Architecture Migration established the doctrine and first implementation slice: SQLite is canonical for structural manuscript state, explicit structure commands exist, diagnostics are read-only, and deterministic structure exports make canonical state reviewable in Git.
This follow-up tightens the remaining compatibility paths so daily work can no longer accidentally treat sidecars, folder layout, numeric chapter fields, or generic metadata updates as structural authority.

## Goal

Make structural authority enforcement match the documented architecture:

- daily structural mutation goes through named MCP structure workflows;
- ordinary sync observes, indexes, and reports drift without silently adopting file-derived structure as canonical;
- sidecars and numeric chapter fields remain compatibility or generated representation only;
- generated structure exports can be checked for staleness and used by explicit recovery workflows.

## Problem

The current implementation is materially aligned with the target architecture, but several transitional paths still blur the boundary:

1. Ordinary `sync` can still infer and upsert canonical chapter or epigraph structure from folder and sidecar state.
2. `update_scene_metadata` accepted structure-adjacent fields such as `part`, `chapter`, `chapter_id`, and `timeline_position` before this initiative's first implementation slice.
3. `assign_scene_to_chapter` and `move_scene` still write sidecars first and refresh SQLite through indexing, rather than writing canonical SQLite state first and mirroring representation after.
4. Deterministic structure exports exist, but staleness diagnostics and restore/repair from a trusted export do not.
5. Numeric chapter compatibility aliases remain visible in several public contracts and query/order paths.

These are intentional migration affordances, not current bugs.
The risk is that they become permanent authority leaks if they are not given a focused cleanup milestone.

## Implementation Progress

- Done in current branch: remove structural authority from `update_scene_metadata` by rejecting `part`, `chapter`, `chapter_id`, and `timeline_position` in normal metadata updates.
- Done in current branch: move `assign_scene_to_chapter` and `move_scene` to SQLite-first persistence with sidecar mirroring diagnostics.
- Done in current branch: split ordinary sync from import/repair inference for managed projects, so sync preserves existing canonical chapter/epigraph state and reports file-derived drift instead of adopting it.
- Done in current branch: add structure export trust diagnostics for missing, stale, wrong-project, and incompatible-schema exports.
- Done in current branch: add explicit trusted-export restore/repair with dry-run validation, checksum/schema/file/conflict checks, and transactional SQLite writes.
- Done in current branch: retain numeric chapter inputs as read-scope compatibility aliases resolved through canonical chapter identity, while documenting that structural mutation uses `chapter_id` and named structure workflows.

## Design Principles

1. **Preserve prose inspectability**
   Authored prose remains file-based and human-readable.

2. **Tighten structure without stranding old projects**
   Compatibility inputs should continue to produce useful diagnostics and migration paths, but not silently mutate canonical structure during daily work.

3. **Prefer explicit modes over hidden behavior**
   If a workflow needs to infer or repair canonical structure, it should be named as import, migration, or repair.

4. **Make rollback and recovery operational**
   Generated structure exports should be reviewable and diagnosable before they are trusted as repair input.

## Milestone: Close Structural Authority Leaks

### Scope

1. Split ordinary sync from import/repair inference.
   - Ordinary `sync` may observe folder-derived and sidecar-derived structure.
   - Ordinary `sync` may regenerate derived indexes from existing canonical state.
   - Ordinary `sync` must not create, rename, reorder, or reattach canonical structure from folder or sidecar hints for an already managed project.
   - Import, first-time setup, or explicit repair workflows may still infer structure, but only with clear diagnostics and explicit commitment.

2. Move structure commands to SQLite-first writes.
   - `assign_scene_to_chapter`, `move_scene`, `rename_chapter`, `reorder_chapter`, and `attach_epigraph` write canonical SQLite state first.
   - Sidecar updates become compatibility mirroring after canonical writes.
   - A sidecar mirror failure does not make the sidecar authoritative; it returns diagnostics and a follow-up repair/regeneration path.

3. Remove structural authority from `update_scene_metadata`.
   - Generic scene metadata updates should stop accepting `part`, `chapter`, `chapter_id`, and `timeline_position` as normal update fields.
   - Calls that attempt structure changes should return a clear error pointing to `assign_scene_to_chapter` or `move_scene`.
   - If temporary compatibility is required, gate it behind an explicit legacy/migration option rather than leaving it as the default path.

4. Add structure export staleness diagnostics.
   - Detect when an export is missing, stale, from a different project, or generated against an incompatible schema version.
   - Report whether SQLite and the latest export agree before suggesting recovery.
   - Keep exports read-only; editing an export still does not mutate canonical state.

5. Add explicit restore/repair from trusted structure export.
   - Restore is an explicit workflow, not a side effect of sync.
   - Restore validates project identity, schema version, checksums, scene/epigraph file presence, and conflicts before writing.
   - Restore is transactional and returns a reviewable summary.

6. Decide the fate of numeric chapter compatibility aliases.
   - Numeric chapter inputs remain read-scope compatibility aliases for selection and review workflows.
   - They are resolved through canonical chapter identity/order where available, must agree with `chapter_id` when both are provided, and are not daily-work structural mutation targets.

### Acceptance Criteria

This milestone is complete when:

1. Ordinary `sync` cannot silently create or overwrite canonical chapter, epigraph, scene membership, or timeline structure from sidecars or folder layout for managed projects.
2. Any workflow that infers canonical structure is explicitly named as import, migration, or repair.
3. Structure commands persist SQLite canonical changes before sidecar compatibility mirrors.
4. `update_scene_metadata` no longer functions as a structural mutation path in normal daily use.
5. Structure export staleness diagnostics exist and explain whether an export can be trusted.
6. A trusted-export restore/repair workflow exists, is transactional, and produces a reviewable summary.
7. Numeric chapter compatibility behavior is documented as either retained presentation alias, deprecated alias, or removed contract.
8. `describe_workflows` and generated tool docs route agents toward explicit structure workflows and away from generic metadata updates for structural changes.

### Test Strategy

Unit tests:

- sync planning separates observation from canonical mutation;
- managed-project sync refuses implicit sidecar/folder structural overrides;
- structure commands write SQLite state before compatibility mirrors;
- sidecar mirror failures produce diagnostics without changing canonical authority;
- `update_scene_metadata` rejects structural fields in normal mode;
- export staleness checks cover missing, stale, wrong-project, and incompatible-schema exports;
- restore planning validates checksums, schema version, and conflicts before writing.

Integration tests:

- ordinary sync after a folder rename reports drift without renaming canonical chapters;
- ordinary sync after a sidecar chapter edit reports drift without moving scene membership;
- explicit structure command followed by export regeneration yields a stable reviewable diff;
- trusted export restore reconstructs missing SQLite structure transactionally;
- stale or conflicting export restore is refused with deterministic diagnostics;
- search, chapter prose, styleguide, batch enrichment, and review bundles continue to resolve chapter scope through canonical identity.

Manual verification:

- run sync, diagnostics, export, and restore workflows on a representative Scrivener-imported project;
- inspect generated structure export diffs after command-driven chapter and scene moves;
- confirm workflow guidance still starts agents with `describe_workflows` and routes structure edits to named commands.

## Out of Scope

- Changing authored prose storage.
- Introducing divisions.
- Removing Scrivener import/export support.
- Rewriting all metadata storage away from sidecars.
- Solving semantic embeddings or broader search quality.

## Related

- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Target Architecture Migration](../../done/target-architecture-migration/prd.md)
- [M8 Canonical Storage Direction](../../done/target-architecture-migration/m8-canonical-storage-decision.md)
- [Chapter Structure Follow-up](../../backlog/chapter-structure/prd.md)
