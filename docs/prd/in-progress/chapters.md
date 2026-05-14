# Chapters

## Document Relationship

This document is the canonical migration plan for structure changes in the manuscript domain.
It defines the shared milestone gates and cross-cutting functional requirements for chapters, epigraphs, search, sync, rendering, and release readiness.

Use this file when:

- Planning or sequencing implementation work.
- Determining gate pass/fail criteria.
- Resolving scope questions across multiple entities.

Use `epigraphs.md` when:

- Defining epigraph-specific behavior and constraints.
- Verifying epigraph acceptance criteria and rendering expectations.

Rule of precedence:

- Shared migration sequencing and gate definitions live here.
- Epigraph-specific requirements live in `epigraphs.md` and must align to the gates defined here.

## Problem

Chapter metadata currently lives indirectly on scenes (chapter numbers and related labels).
That creates drift risk because chapter-level values may need repeated updates across many scenes.
It also limits chapter-level tooling because chapters are not first-class entities.

## User Value

This is not just data architecture. It enables author-facing workflow improvements:

- Authors can rename or retheme a chapter once, and all chapter references stay consistent.
- Outlines can show chapter title plus chapter synopsis without inferring from scenes.
- Reordering chapters becomes reliable and intentional instead of dependent on per-scene chapter numbers.
- Tools can provide chapter-centric navigation, review, and analysis.

## Decisions

- Chapters are first-class entities.
- Chapter entity includes:
	- `chapter_id`
	- `title`
	- optional `logline`
	- `prev_chapter_id` and `next_chapter_id` for linked-list ordering
	- `sort_index` for deterministic query ordering and chain validation
	- optional `division_id` for major story sections
- Scene belongs to exactly one chapter via `chapter_id`.
- Existing scene chapter metadata is replaced by chapter references.
- Chapters are flat. No child chapters.
- Prologue and epilogue are outside chapters and outside chapter ordering.

## Divisions (Parent Sections)

Books may use Parts, Acts, or other major section conventions.
To support this flexibly:

- Introduce a generic division container.
- Division has a type/label (for example Part or Act).
- Chapter may reference `division_id`.
- Divisions are optional.

## Ordering Rules

- Chapters form a single ordered chain for the main story.
- A chapter may have null `prev_chapter_id` only when it is first.
- A chapter may have null `next_chapter_id` only when it is last.
- Chapter order is validated against both pointers and `sort_index`.

## Sync and Staleness

- Chapters are ingestible from sync files.
- Chapter metadata can become stale and must be reindexed after source changes.

## Migration Approach

This is a breaking migration branch, but it still needs an explicit source-to-target mapping so implementation can proceed without guesswork.

- Existing scene-level `part`, `chapter`, and `chapter_title` values are treated as migration inputs, not long-term identity fields.
- During import and sync, chapter identity is derived into canonical `chapters` records first, then scenes are linked via `chapter_id`.
- Where current scene metadata is ambiguous or inconsistent, the migration should emit deterministic warnings and leave the source row unchanged rather than inventing identity.
- Prologue and epilogue should be represented as optional explicit entities in the new model, not inferred from scene number offsets.
- Any helper or rendering path that still depends on scene-local numeric chapter fields must be updated in the same migration slice as the schema change.

## Acceptance Criteria

1. Chapters exist as standalone entities with required IDs and titles.
2. Scene schema stores `chapter_id` and no longer depends on numeric chapter metadata for chapter identity.
3. Chapters support optional chapter synopsis/logline.
4. Chapters support linked-list ordering and deterministic `sort_index` ordering.
5. Validation detects chapter chain errors (cycles, broken links, multiple heads, orphans).
6. Divisions are first-class optional entities and can be assigned to chapters.
7. Prologue and epilogue are optional and, when present, are represented explicitly outside chapter membership.
8. Sync pipeline indexes chapter entities from sync folder sources.
9. Chapter records participate in metadata staleness tracking.
10. Tooling can list and retrieve chapters independent of scenes.

## Milestone Gates

These gates are intended for a single breaking migration branch.
No backwards-compatibility layer is required between milestones.
Each gate must pass before moving to the next milestone.

### Gate 1: Canonical Domain Model and Schema

Epigraph linkage: see `epigraphs.md` -> `Gate 1 Alignment: Canonical Model`.

Functional requirements:

1. Add canonical entities for `chapters`, `divisions`, and `epigraphs`.
2. Add canonical linkage from scene to chapter via `chapter_id`.
3. Support chapter ordering fields (`prev_chapter_id`, `next_chapter_id`, `sort_index`).
4. Support optional division ownership of chapters (`division_id`).
5. Support optional explicit prologue and epilogue entities outside chapter membership.

Gate checks:

1. DB boot works on clean setup and migrated setup.
2. New tables and constraints are present and queryable.
3. Chapter chain integrity checks detect cycle, broken link, and multiple-head errors.
4. Schema migration tests pass.

### Gate 2: Sync and Import Canonicalization

Epigraph linkage: see `epigraphs.md` -> `Gate 2 Alignment: Sync and Import`.

Functional requirements:

1. Sync pipeline indexes chapter entities from sync-folder chapter files.
2. Sync pipeline indexes epigraph entities from sync-folder epigraph files.
3. Scene ingestion resolves and writes `chapter_id` links.
4. Staleness tracking includes chapters and epigraphs.
5. Scrivener direct merge maps structural data into chapter entities (not scene-level numeric chapter identity).

Gate checks:

1. Full sync run produces consistent chapter, scene, and epigraph graph.
2. Re-sync after file edits updates stale flags correctly across all three entity types.
3. Import fixtures for chapter and epigraph extraction pass.
4. Orphan/invalid structural mappings surface deterministic warnings.

### Gate 3: Search and Query Contract Refactor

Epigraph linkage: see `epigraphs.md` -> `Gate 3 Alignment: Query Contracts`.

Functional requirements:

1. `find_scenes` remains scene-only and filters by chapter identity through the new model.
2. Add dedicated epigraph discovery/query tooling.
3. Replace numeric chapter prose retrieval with chapter-entity based retrieval.
4. Update arc and thread ordering to use canonical chapter order.
5. Update helper targeting logic to resolve scenes by chapter identity, not `part/chapter` integers.

Gate checks:

1. Search integration tests pass for scenes, arcs, and thread arcs.
2. Epigraph queries are searchable and return stable envelopes.
3. No query path depends on scene `part/chapter` columns for identity.

### Gate 4: Rendering and Review Bundle Rewrite

Epigraph linkage: see `epigraphs.md` -> `Gate 4 Alignment: Rendering and Bundles`.

Functional requirements:

1. Review-bundle planner scopes by chapter entities and canonical ordering.
2. Rendering order is deterministic: chapter heading, epigraph, then scenes.
3. Epigraph rendering uses explicit epigraph entities, not scene tag/title heuristics.
4. Chapter heading rendering uses chapter entities as the source of truth.

Gate checks:

1. Markdown and PDF bundles follow the expected ordering for representative fixtures.
2. Existing epigraph visual treatment is preserved (centered/styled) under the new entity model.
3. Bundle planner warnings and strictness behavior remain deterministic.

### Gate 5: Metadata, Lint, and Editing Tool Alignment

Epigraph linkage: see `epigraphs.md` -> `Gate 5 Alignment: Metadata and Lint`.

Functional requirements:

1. Scene metadata update tooling no longer treats numeric chapter identity as canonical.
2. Metadata lint rules validate new chapter and epigraph metadata shapes.
3. Styleguide and batch-analysis tools accept chapter-identity based filters.
4. Scene-character batch and other shared selectors resolve scenes via updated helper logic.

Gate checks:

1. Tool contracts are internally consistent with new schema.
2. Metadata lint test coverage includes invalid chapter/epigraph cases.
3. Styleguide/bootstrap/drift flows run successfully against migrated projects.

### Gate 6: Consolidation and Breaking Release Readiness

Epigraph linkage: see `epigraphs.md` -> `Gate 6 Alignment: Release Readiness`.

Functional requirements:

1. Remove obsolete references to numeric chapter identity from production code paths.
2. Regenerate tool documentation to reflect final contracts.
3. Update setup/development docs and release log with migration behavior.
4. Provide migration notes for maintainers and users.

Gate checks:

1. Full unit and integration test suite passes on the migration branch.
2. Tool docs and PRD text match implemented behavior.
3. Manual validation pass confirms author-facing user value outcomes:
	- chapter rename/edit once propagates consistently
	- chapter ordering changes are deterministic
	- epigraph search and rendering are first-class
4. Branch is ready for a single breaking release cut.
