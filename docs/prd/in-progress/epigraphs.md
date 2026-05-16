# Epigraphs

## Status

The initial epigraph implementation is already shipped alongside canonical chapter indexing.
This document remains relevant because it defines constraints and follow-up alignment for the remaining chapter-structure work, but it should not be read as if epigraph support is still entirely speculative.

Implemented baseline:

- project-scoped `epigraphs` records exist
- `find_epigraphs` is available
- review bundles render chapter-linked epigraph content before scenes

Remaining value in this document:

- clarify the intended source contract and validation behavior
- keep epigraph-specific constraints aligned with the remaining chapter follow-up gates
- document what should happen if compatibility behavior is tightened later

For milestone accounting of the shipped chapter/epigraph rollout, use [chapters-epigraphs-implementation.md](../done/chapters-epigraphs-implementation.md).

## Problem

Epigraphs are structurally and editorially different from scenes.
They are short, rendered in full, and usually function as chapter-opening mood or thematic framing.
Treating them as scenes would force scene-oriented fields and tools that do not fit.

## User Value

This enables better author workflows, not just cleaner data modeling:

- Authors can search and manage epigraphs directly without scene-only filters.
- Outline and export experiences can render epigraph text in full, matching reading intent.
- Chapter composition becomes clearer: chapter title, then epigraph, then scenes.
- Character and theme analysis can include epigraph mentions as first-class narrative signals.

## Decisions

- Epigraph is a first-class entity, distinct from scene.
- Epigraph includes:
	- `epigraph_id`
	- `project_id`
	- `chapter_id`
	- prose body text
	- associated characters
	- optional tags
- Epigraph identity is scoped to a project/book.
- Epigraph does not require a logline/synopsis.
- Epigraphs are searchable and identifiable via dedicated tools.
- `find_scenes` remains scene-only.

## Placement and Ordering

- In v1, epigraph is chapter-opening content.
- Epigraph is rendered after chapter heading and before chapter scenes.
- Assume at most one epigraph per chapter in v1.
- Epigraphs require explicit chapter linkage in v1.
- Epigraphs are not attached to prologue or epilogue scenes in v1 unless a later milestone explicitly adds non-chapter structural containers.

## Sync and Staleness

- Epigraphs are ingestible from sync files as text content.
- Epigraph metadata can become stale and must be reindexed after source changes.

## Acceptance Criteria

1. Epigraphs are stored and indexed as a distinct entity type.
2. Epigraph schema requires project-scoped `epigraph_id`, `project_id`, `chapter_id`, and prose body.
3. Epigraph schema supports character associations and optional tags.
4. Epigraphs do not require logline/synopsis fields.
5. Query tooling supports epigraph-specific discovery (separate from `find_scenes`).
6. Rendering/export paths can output full epigraph text.
7. v1 enforces chapter-opening placement and at-most-one-epigraph-per-chapter.
8. Sync pipeline ingests epigraph content from explicit sync-folder sources or explicit metadata.
9. Epigraph records participate in metadata staleness tracking.

## Milestone Alignment

Shared migration gates are defined in `chapters.md`.
This section defines epigraph-specific requirements that must be satisfied within those shared gates.

### Gate 1 Alignment: Canonical Model

Cross-reference: `chapters.md` -> `Gate 1: Canonical Domain Model and Schema`.

1. Epigraph is represented as a first-class entity in schema, not as a scene subtype.
2. Epigraph requires `project_id`, `epigraph_id`, and `chapter_id`.
3. Epigraph identity and chapter linkage are project-scoped.

### Gate 2 Alignment: Explicit Sync Contract and Validation

Cross-reference: `chapters.md` -> `Gate 2: Explicit Sync Contract and Validation`.

1. Sync imports epigraph source files into epigraph entities only when chapter linkage is explicit.
2. Re-sync updates epigraph staleness when prose changes.
3. At-most-one-epigraph-per-chapter validation is enforced in v1.
4. Ambiguous epigraph placement surfaces deterministic validation guidance.

### Gate 3 Alignment: Conservative Scrivener Import Canonicalization

Cross-reference: `chapters.md` -> `Gate 3: Conservative Scrivener Import Canonicalization`.

1. Scrivener-derived epigraph inference is accepted only when the containing chapter relationship is unambiguous.
2. Ambiguous epigraph-like scene/title/tag heuristics are reported, not silently converted.

### Gate 4 Alignment: Query Contracts

Cross-reference: `chapters.md` -> `Gate 4: Search and Query Contract Refactor`.

1. Epigraph discovery is exposed via dedicated epigraph query tooling.
2. Scene discovery remains scene-only (`find_scenes` does not return epigraphs).
3. Epigraph queries support chapter-scoped retrieval and searchability.
4. Epigraph query parameters use project-scoped chapter identifiers.

### Gate 5 Alignment: Rendering and Bundles

Cross-reference: `chapters.md` -> `Gate 5: Rendering and Review Bundle Rewrite`.

1. Rendering order is chapter title, then epigraph, then scenes.
2. Epigraph content is rendered in full, not summarized as a logline.
3. Epigraph styling remains visually distinct from scene prose.

### Gate 6 Alignment: Metadata and Lint

Cross-reference: `chapters.md` -> `Gate 6: Metadata, Lint, and Editing Tool Alignment`.

1. Epigraph metadata schema is validated by lint/tooling.
2. Character associations and optional tags are validated and indexed.

### Gate 8 Alignment: Release Readiness

Cross-reference: `chapters.md` -> `Gate 8: Consolidation and Breaking Release Readiness`.

1. Tool docs and behavior accurately describe epigraphs as first-class entities.
2. Manual validation confirms end-user outcomes:
	- epigraphs are searchable directly
	- epigraphs render before scenes in chapter output
	- epigraphs do not require logline/synopsis metadata
