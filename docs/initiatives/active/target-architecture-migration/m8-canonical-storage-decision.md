# M8 Canonical Storage Direction

Status: Draft decision brief

## Purpose

M8 decides what should be treated as durable canonical storage for structural manuscript state after the M7 explicit structure commands proved the MCP-controlled mutation pattern.

This brief should be completed before implementing a storage migration.
Its job is to choose a direction, identify the migration path, and make rollback and recovery risks explicit.

## Decision To Make

Choose one canonical storage direction for structural state:

1. Sidecars remain canonical structure storage.
2. SQLite becomes canonical structure storage.
3. Hybrid canonical storage splits durable ownership between files and SQLite.

The decision applies to structural state such as chapter identity, chapter order, scene membership, epigraph attachment, and future divisions.
It does not require prose to stop being plain text.

## Current Evidence

Writing MCP now has:

- canonical `chapters` and `epigraphs` tables;
- stable `chapter_id` scene links;
- chapter-aware search, prose retrieval, review bundles, and diagnostics;
- read-only structure diagnostics that can observe drift without repairing it;
- explicit M5 and M7 structure mutation commands for chapter creation, rename, reorder, epigraph attachment, and scene movement;
- numeric chapter compatibility paths that resolve through canonical chapter identity where possible.

This means daily structural mutation can increasingly be command-driven.
The unresolved question is whether the durable record behind those commands should remain file-first, database-first, or deliberately hybrid.

## Evaluation Criteria

The chosen direction should:

- preserve authored prose as inspectable, portable text;
- keep structure changes behind sanctioned MCP workflows;
- support Git-backed auditability for meaningful manuscript changes;
- avoid making generated views competing sources of truth;
- provide deterministic recovery when database state and file state disagree;
- preserve Scrivener and legacy import/export paths without letting import conventions become daily-work authority;
- support future divisions without coupling identity or order to folder names;
- keep AI agents and human users under the same structural guardrails.

## Options

### Option A: Sidecars Remain Canonical

Structural sidecar files continue to be the durable source of truth.
SQLite remains a derived index and query engine.

Strengths:

- Git diffs remain naturally inspectable.
- Recovery from database loss is straightforward.
- The storage model stays close to the current plain-file workflow.

Risks:

- Structural invariants remain spread across many editable files.
- AI and human direct-file edits can still bypass MCP commands.
- Future divisions may repeat the current folder and sidecar coupling unless heavily guarded.

### Option B: SQLite Becomes Canonical

SQLite owns durable structural state.
Sidecars and generated files become representation, export, or compatibility surfaces.

Strengths:

- Structural invariants can be validated in one authoritative model.
- Daily work aligns cleanly with MCP-only mutation.
- Future structural concepts can be added without overloading filesystem layout.

Risks:

- Git auditability becomes less transparent unless paired with generated review artifacts or database export snapshots.
- Recovery and conflict handling need an explicit story.
- Users may lose confidence if managed state feels opaque.

### Option C: Hybrid Canonical Storage

Some structural state remains file-canonical while other structural state is database-canonical.

Strengths:

- Can preserve file readability for selected state while centralizing harder invariants.
- May reduce migration blast radius.
- Could provide a gradual path from current behavior to stronger managed state.

Risks:

- Split authority can be harder to explain and debug.
- Drift recovery may become more complex than either single-authority option.
- Future tools may need to know too much about which field lives where.

## Recovery Questions

Before implementation, the decision should answer:

- If SQLite is missing but files exist, what can be reconstructed automatically?
- If files and SQLite disagree, which state wins in daily work?
- Which disagreements are safe to repair automatically, and which require explicit user approval?
- What generated artifact, export, or diagnostic makes database-only changes reviewable in Git?
- How should import adapters commit inferred structure into the chosen canonical model?

## Recommended Next Step

Write the actual decision record by choosing one option and documenting:

- the selected canonical storage direction;
- which artifacts are authoritative, generated, or migration inputs;
- the migration phases;
- rollback and recovery behavior;
- test strategy for migration, drift detection, and import/export compatibility.

Do not begin storage migration implementation until that record exists.

## Related

- [Target Architecture Migration PRD](./prd.md)
- [Target Architecture Migration Milestones](./milestones.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
