# Architecture Alignment Follow-up

**Status:** Deferred backlog (not active)

This initiative records target-architecture alignment gaps discovered during
periodic reviews. It is a holding place for missing parts, correction
candidates, and follow-up work that should not be lost, but it is not active
implementation scope until explicitly prioritized.

Implementation sequencing lives in [milestones.md](milestones.md). The M0
metadata ownership inventory lives in [inventory.md](inventory.md).

## Goal

Keep Writing MCP converging toward the [Conceptual Target Architecture](../../../foundations/target-architecture.md)
and [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
as compatibility paths, recovery workflows, and day-to-day tools evolve.

The goal is not to reopen completed initiatives by default. The goal is to
make architectural drift visible, group it by risk, and turn the highest-value
corrections into focused implementation work when selected.

## Problem

Writing MCP has materially moved toward the target architecture:

- SQLite is the durable canonical model for structural manuscript state.
- Prose remains file-based and inspectable.
- Explicit structure workflows exist for chapter, scene, and epigraph changes.
- Generated exports and backups are transparency and recovery artifacts, not
  normal mutation surfaces.
- Managed sync preserves canonical structure over folder and sidecar-derived
  hints in common conflict cases.

Some compatibility and maintenance paths still need continued scrutiny. These
paths are useful, but they can accidentally become authority leaks if they
mutate canonical state, rewrite structural representations, or make filesystem
state look more authoritative than the MCP control plane.

## User Value

- Authors get safer project state because structural changes remain deliberate.
- AI agents have fewer tempting shortcuts around sanctioned workflows.
- Maintainers can prioritize architecture cleanup without relying on memory
  from past reviews.
- Future initiatives such as divisions can build on a cleaner structure
  boundary instead of inheriting ambiguous behavior.

## Alignment Log

### 1. Managed sync should not delete canonical scene structure from filesystem absence

Current pressure point:
- Ordinary `syncAll()` prunes missing scene rows, scene relationship rows,
  epigraphs, and chapters based on what files were observed during the scan.

Why it matters:
- For managed projects, filesystem absence should be treated as missing prose,
  stale representation, or a repair/delete candidate.
- Actual canonical deletion should happen through an explicit workflow, restore
  operation, or confirmed repair path.

Target direction:
- Preserve canonical rows for managed projects when prose files disappear.
- Report missing prose or missing representation diagnostics.
- Add explicit delete, detach, archive, or repair workflows if product needs
  require canonical removal.
- Keep first-time import and legacy migration behavior separate from ordinary
  daily sync behavior.

### 2. Generic metadata updates should not rewrite structural sidecar fields from path normalization

Current pressure point:
- `update_scene_metadata` rejects structural fields in user input, but it reads
  normalized metadata and writes the merged object back to the sidecar.
- That can mirror path-derived `part`, `chapter`, `chapter_id`, or
  `chapter_title` compatibility fields while the user only requested a
  non-structural metadata update.

Why it matters:
- SQLite canonical state is protected for managed projects, but the sidecar can
  still become a misleading structural representation.
- A tool described as non-structural should preserve structural representation
  fields unless an explicit structure workflow owns the mirror update.

Target direction:
- Split raw sidecar reads from sync-normalized metadata reads.
- Make generic metadata updates preserve existing structural sidecar fields.
- Route structural sidecar mirror writes only through explicit structure
  workflows or named repair/regeneration flows.

### 3. Relationship metadata ownership and write ordering should be explicit

Current pressure point:
- Some relationship-oriented metadata, such as character/place tags, reference
  links, and legacy thread-shaped sidecar fields, still crosses sidecar,
  generated-output, and SQLite boundaries unevenly.
- Several paths write a compatibility representation first and then reindex or
  mirror data into SQLite.

Why it matters:
- SQLite should be the canonical model for structured metadata relationships.
- Sidecar-first writes make it harder to reason about validation, rollback,
  diagnostics, and recovery ordering.
- Relationship metadata is exactly where AI agents need outcome-level tools,
  because raw table operations expose implementation shape instead of story
  intent.

Target direction:
- Classify each relationship metadata family by canonical owner, compatibility
  input/output role, and recovery behavior.
- Move active relationship changes behind SQLite-first, outcome-oriented
  workflows.
- Keep any compatibility files as generated views, import inputs, review
  snapshots, or recovery snapshots rather than writable authority.

## Scope

### In Scope

- Track architecture alignment gaps found during reviews.
- Convert confirmed gaps into focused follow-up milestones.
- Add characterization tests around risky compatibility behavior.
- Tighten ordinary sync, generic metadata updates, diagnostics, and repair
  workflows where they blur authority boundaries.
- Clarify relationship metadata ownership and replace storage-shaped mutation
  surfaces with outcome-oriented workflows.
- Update workflow guidance and generated tool docs when behavior changes.

### Out of Scope

- Rewriting prose storage.
- Removing Scrivener import or legacy compatibility paths wholesale.
- Removing numeric chapter read aliases without a separate product decision.
- Introducing divisions.
- Changing generated backup or structure export authority without an explicit
  recovery-design decision.

## Architecture Alignment

Use the Managed Structure Contract as the arbiter:

- Canonical structure changes must go through sanctioned MCP workflows.
- Prose can remain file-based and human-inspectable.
- Sidecars, folders, and generated exports are representations, compatibility
  surfaces, or recovery inputs, not daily-work authority.
- Import may infer cautiously, but daily work should be explicit.
- Maintenance may observe broadly and regenerate derived state, but canonical
  repair should be deliberate.

## Tooling Philosophy

The product-wide tool philosophy applies here: MCP tools should express writing,
revision, review, recovery, and reasoning outcomes rather than exposing raw
storage CRUD or table-shaped APIs.

Replacing writable sidecars with SQLite-canonical data must preserve that
principle.

The user or AI agent should not need to understand whether the implementation
stores state in `threads`, `scene_threads`, `scene_tags`, `reference_links`, or
future normalized tables.

For example, a thread workflow should focus on outcomes such as:

- track a storyline across relevant scenes;
- mark a scene as setup, escalation, reveal, reversal, payoff, or another
  thread-specific beat;
- review a thread's ordered progression and identify missing setup/payoff or
  stale scene evidence;
- find a named or described thread such as "Mneme's tablet";
- remove a mistaken scene from a thread because it is not actually relevant.

The database remains the canonical implementation detail underneath those
workflows. The public tool surface should preserve author intent, validation,
diagnostics, and next-step guidance instead of exposing direct create/read/update
or delete operations for individual tables.

## Acceptance Criteria

1. Architecture review findings are captured in this initiative or split into
   more specific initiatives before implementation begins.
2. Each logged gap identifies the current behavior, why it matters, and the
   target direction.
3. Any implemented correction has focused unit coverage and integration
   coverage when user-facing tool behavior changes.
4. Ordinary managed-project sync no longer treats missing prose files as silent
   canonical structural deletion.
5. Generic metadata updates no longer rewrite structural sidecar compatibility
   fields except through explicit structure or repair workflows.
6. Workflow guidance continues to route humans and AI agents to named
   structure tools for structural changes.
7. Sidecar replacement work introduces outcome-oriented workflows, not raw CRUD
   wrappers around SQLite tables.
8. The PRD contains a milestone plan that can be converted into independently
   reviewable implementation initiatives in [milestones.md](milestones.md).

## Test Strategy

- Unit: managed sync missing-file planning, prune behavior by project mode,
  raw sidecar read helpers, and metadata update preservation of structural
  fields.
- Integration: sync after prose deletion in a managed project, diagnostics for
  missing prose, explicit delete/repair follow-up when introduced, and
  `update_scene_metadata` on a path-conflicting managed scene.
- Regression: chapter resolution, scene assignment, move scene, structure
  diagnostics, backup diagnostics, relationship workflow guidance, and
  generated tool docs.

## Related

- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Milestones](milestones.md)
- [Metadata Ownership Inventory](inventory.md)
- [Structural Authority Hardening](../../done/structural-authority-hardening/prd.md)
- [Target Architecture Migration](../../done/target-architecture-migration/prd.md)
- [Database Backup and Recovery](../../done/database-backup-recovery/prd.md)
