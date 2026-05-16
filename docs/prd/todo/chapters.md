# Chapters

## Status

This document no longer describes a purely future migration.
The initial chapter/epigraph rollout is already implemented in the codebase:

- canonical `chapters` and `epigraphs` tables exist
- scenes support canonical `chapter_id`
- `list_chapters` and `find_epigraphs` are available
- chapter-aware search, prose retrieval, and review-bundle rendering are shipped
- numeric chapter targeting remains as a compatibility layer in some tools

This file now lives in `todo/` because the remaining chapter, epigraph, and division follow-up work is deferred while structural manuscript state boundaries are clarified.

It still captures follow-up work that is not fully settled or completed:

- deferred division support
- final cleanup of compatibility behavior and release-readiness documentation
- confirmation that the remaining gates still match the implementation path

Read this document as a follow-up and consolidation plan for chapter structure, not as a statement that none of the chapter work has shipped yet.

For milestone accounting of what is already delivered, use [chapters-epigraphs-implementation.md](../done/chapters-epigraphs-implementation.md).

## Document Relationship

This document is the canonical migration plan for structure changes in the manuscript domain.
It defines the shared milestone gates and cross-cutting functional requirements for chapters, epigraphs, search, sync, rendering, and release readiness.

Use [Managed Structure Contract](../managed-structure-contract.md) as the design arbiter for whether chapter, epigraph, and future division workflows should mutate canonical state through MCP tools, generated views, import workflows, or maintenance/repair paths.

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
- Chapter, division, and epigraph identities are scoped to a single project/book.
- Database identity should follow existing project scoping patterns rather than assuming globally unique chapter-like IDs.
- Chapter entity includes:
	- `chapter_id`
	- `project_id`
	- `title`
	- optional `logline`
	- `sort_index` for deterministic query ordering and chain validation
	- optional `prev_chapter_id` and `next_chapter_id` if the implementation chooses to persist linked-list validation fields
- Scene may belong to one chapter via nullable `chapter_id`.
- Scenes may exist outside chapters for conventional front/back matter such as prologue and epilogue.
- Prologue and epilogue are scenes, not separate prose entity types in v1.
- A project may have at most one prologue scene and at most one epilogue scene.
- Existing scene chapter metadata is replaced by chapter references.
- Chapters are flat. No child chapters.
- Divisions are deferred from the first implementation slice unless needed to preserve existing behavior.

## Source Contract Direction

Two competing goals exist:

1. Infer as much useful structure as possible from Scrivener sync output.
2. Allow authors to build chapter structure explicitly and gradually from zero.

When these goals conflict, explicit author intent wins.

Scrivener folder export can suggest chapter structure, but it is not a durable contract by itself.
Folder marker files are empty text files whose order and title may imply a chapter, but that inference depends on author-specific Scrivener organization.
The first implementation should therefore support conservative inference only where intent is unambiguous, while defining an explicit sync-folder contract for reliable chapter indexing.

Initial source contract:

- Chapter identity is reliable when a scene lives inside an explicit chapter folder.
- Chapter folders are project-scoped.
- Chapter folder naming and/or metadata must produce a stable `chapter_id` and title.
- Epigraph files may be indexed as chapter-opening epigraphs only when they are located inside an explicit chapter folder or have explicit metadata linking them to a chapter.
- Scrivener-derived folder marker files may be used as migration hints, not as the sole source of truth when the surrounding file structure is ambiguous.
- Validation should explain what structure is required before sync when chapter inference is unsafe.

Full Scrivener structure inference is valuable, but it is a separate feature from first-class chapter support.
The v1 migration should avoid guessing relationships that cannot be validated from explicit folders or metadata.

## Divisions (Parent Sections)

Books may use Parts, Acts, or other major section conventions.
To support this flexibly:

- Introduce a generic division container.
- Division has a type/label (for example Part or Act).
- Chapter may reference `division_id`.
- Divisions are optional.

Divisions are not required for the first chapter migration gate.
They should be implemented after chapter identity, scene linkage, epigraphs, and core tool contracts are stable.

## Ordering Rules

- Chapters form a single ordered sequence for the main story.
- `sort_index` is the canonical persisted ordering field for v1 query and rendering order.
- If linked-list fields are persisted, they are validation aids and must agree with `sort_index`.
- Reorder operations must have one clear write path so `sort_index` and any pointer fields cannot drift independently.
- Prologue, epilogue, and other non-chapter scenes are outside the chapter sequence.

## Sync and Staleness

- Chapters are ingestible from sync files.
- Chapter metadata can become stale and must be reindexed after source changes.

## Migration Approach

This is a breaking migration branch, but it still needs an explicit source-to-target mapping so implementation can proceed without guesswork.

- Existing scene-level `part`, `chapter`, and `chapter_title` values are treated as migration inputs, not long-term identity fields.
- During import and sync, chapter identity is derived into canonical `chapters` records first, then scenes are linked via nullable `chapter_id` when the relationship is clear.
- Where current scene metadata is ambiguous or inconsistent, migration should use an explicit failure mode rather than inventing identity.
- Valid failure modes are:
	- leave `chapter_id` null and emit deterministic warnings,
	- reject strict migration/sync when chapter structure is required by the caller,
	- report validation guidance explaining the expected folder or metadata contract.
- Prologue and epilogue should be represented as scenes with explicit structural role metadata, not inferred from scene number offsets.
- Any helper or rendering path that still depends on scene-local numeric chapter fields must be updated in the same migration slice as the schema change.

## Acceptance Criteria

1. Chapters exist as standalone entities with required IDs and titles.
2. Chapter, division, and epigraph identities are project-scoped.
3. Scene schema stores nullable `chapter_id` and no longer depends on numeric chapter metadata for chapter identity.
4. Scenes can exist outside chapters for prologue, epilogue, or small/simple projects.
5. Validation allows at most one prologue scene and at most one epilogue scene per project.
6. Chapters support optional chapter synopsis/logline.
7. Chapters support deterministic `sort_index` ordering.
8. Validation detects chapter ordering errors and invalid scene-to-chapter references.
9. Sync pipeline indexes chapter entities from explicit sync-folder sources or unambiguous metadata.
10. Chapter records participate in metadata staleness tracking.
11. Tooling can list and retrieve chapters independent of scenes.
12. Divisions are first-class optional entities in a later gate and can be assigned to chapters once implemented.

## Milestone Gates

These gates are intended for a single breaking migration branch.
No backwards-compatibility layer is required between milestones.
Each gate must pass before moving to the next milestone.

### Gate 1: Canonical Domain Model and Schema

Epigraph linkage: see `epigraphs.md` -> `Gate 1 Alignment: Canonical Model`.

Functional requirements:

1. Add project-scoped canonical entities for `chapters` and `epigraphs`.
2. Add nullable canonical linkage from scene to chapter via `chapter_id`.
3. Support canonical chapter ordering via `sort_index`.
4. Support optional linked-list fields only if they are clearly secondary to `sort_index`.
5. Support explicit scene structural role metadata for prologue and epilogue outside chapter membership.
6. Enforce at most one prologue scene and at most one epilogue scene per project.

Design decisions:

- Use `project_id` as part of the durable identity boundary for chapter-like entities.
- Allow `scenes.chapter_id` to be nullable so non-chapter prose remains valid.
- Treat prologue and epilogue as scene roles, not standalone prose containers.
- Make `sort_index` the v1 ordering authority; linked-list fields are optional validation support.

Gate checks:

1. DB boot works on clean setup and migrated setup.
2. New tables and constraints are present and queryable.
3. Project-scoped identity prevents collisions across books/projects.
4. Chapter ordering checks detect duplicate indexes, gaps if disallowed, pointer disagreement if pointers are persisted, and invalid scene links.
5. Prologue/epilogue uniqueness checks pass.
6. Schema migration tests pass.

Test strategy:

- Unit: clean schema creation, legacy schema migration, project-scoped ID collision prevention, nullable scene chapter links, prologue/epilogue uniqueness, and chapter ordering validation.
- Integration: boot an existing fixture database through migration and verify scenes, chapters, epigraphs, and unchaptered scenes are queryable.

### Gate 2: Explicit Sync Contract and Validation

Epigraph linkage: see `epigraphs.md` -> `Gate 2 Alignment: Explicit Sync Contract and Validation`.

Functional requirements:

1. Define the sync-folder chapter source contract in setup/development docs.
2. Index chapters from explicit chapter folders or explicit chapter metadata.
3. Link scenes to chapters when they are inside explicit chapter folders or carry explicit chapter metadata.
4. Leave `chapter_id` null for scenes outside chapters.
5. Provide validation warnings for ambiguous structure before sync results are trusted.
6. Index epigraph entities only when chapter linkage is explicit.
7. Staleness tracking includes chapters and epigraphs.

Design decisions:

- Explicit chapter folders or explicit chapter metadata are the reliable source contract for v1.
- Sync may infer structure only where folder or metadata intent is unambiguous.
- Ambiguous scenes remain valid with null `chapter_id`; ambiguity should be surfaced as guidance, not hidden.
- Epigraph sync requires explicit chapter linkage.

Gate checks:

1. Full sync run against explicit chapter folders produces a consistent chapter, scene, and epigraph graph.
2. Scenes outside chapter folders remain queryable with null `chapter_id`.
3. Invalid or ambiguous folder structures surface deterministic warnings with setup guidance.
4. Re-sync after file edits updates stale flags correctly across scenes, chapters, and epigraphs.

Test strategy:

- Unit: folder/metadata parsing, stable chapter ID derivation, null chapter assignment for unchaptered scenes, and warning generation for ambiguous structure.
- Integration: sync explicit chapter folders with scenes and epigraphs, sync unchaptered scenes, and verify staleness changes after edits to scene prose, chapter metadata, and epigraph prose.

### Gate 3: Conservative Scrivener Import Canonicalization

Epigraph linkage: see `epigraphs.md` -> `Gate 3 Alignment: Conservative Scrivener Import Canonicalization`.

Functional requirements:

1. Treat Scrivener folder marker files as migration hints, not unquestioned authority.
2. Scrivener direct merge maps structural data into chapter entities only when folder/file order and explicit folder structure are unambiguous.
3. Existing scene-level `part`, `chapter`, and `chapter_title` values are used only as migration inputs.
4. Ambiguous mappings leave `chapter_id` null or fail strict mode with deterministic diagnostics.
5. Import fixtures cover both successful inference and refused inference.

Design decisions:

- Scrivener folder marker files are hints unless supported by explicit folder structure or metadata.
- Direct merge should prefer a refused inference with diagnostics over a plausible but unverifiable chapter relationship.
- Legacy `part`, `chapter`, and `chapter_title` values help bootstrap migration but do not remain canonical identity.

Gate checks:

1. Scrivener direct merge produces canonical chapters for representative explicit structures.
2. Orphan/invalid structural mappings surface deterministic warnings.
3. No import path writes scene-level numeric chapter identity as canonical output.
4. Import fixtures for chapter and epigraph extraction pass.

Test strategy:

- Unit: Scrivener binder/folder inference cases, refused ambiguous inference, warning payload shape, and strict-mode failure behavior.
- Integration: direct-merge representative `.scriv` fixtures into canonical chapters, plus fixtures where inference is intentionally rejected and scenes remain unchaptered.

### Gate 4: Search and Query Contract Refactor

Epigraph linkage: see `epigraphs.md` -> `Gate 4 Alignment: Query Contracts`.

Functional requirements:

1. `find_scenes` remains scene-only and filters by chapter identity through the new model.
2. Add dedicated epigraph discovery/query tooling.
3. Replace numeric chapter prose retrieval with chapter-entity based retrieval.
4. Update arc and thread ordering to use canonical chapter order.
5. Update helper targeting logic to resolve scenes by chapter identity, not `part/chapter` integers.
6. Define final public API parameters for chapter targeting, including `project_id` + `chapter_id`.
7. Decide whether numeric chapter filters are removed, deprecated as presentation aliases, or rejected in this breaking release.

Design decisions:

- Public chapter targeting should use `project_id` + `chapter_id`.
- `find_scenes` remains scene-only, including when filtering by chapter identity.
- Dedicated chapter and epigraph query tools should expose stable envelopes rather than overloading scene search.
- Numeric chapter fields are not identity; any remaining numeric support must be explicitly presentation or compatibility behavior.

Gate checks:

1. Search integration tests pass for scenes, arcs, and thread arcs.
2. Epigraph queries are searchable and return stable envelopes.
3. No query path depends on scene `part/chapter` columns for identity.
4. Tool contracts consistently expose project-scoped chapter identifiers.

Test strategy:

- Unit: query builder filters by `chapter_id`, rejects or maps legacy numeric filters according to the final API decision, and orders by canonical chapter/scene order.
- Integration: `find_scenes`, chapter prose retrieval, epigraph discovery, character arcs, thread arcs, and shared helper selectors all work through project-scoped chapter identity.

### Gate 5: Rendering and Review Bundle Rewrite

Epigraph linkage: see `epigraphs.md` -> `Gate 5 Alignment: Rendering and Bundles`.

Functional requirements:

1. Review-bundle planner scopes by chapter entities and canonical ordering.
2. Rendering order is deterministic: chapter heading, epigraph, then scenes.
3. Epigraph rendering uses explicit epigraph entities, not scene tag/title heuristics.
4. Chapter heading rendering uses chapter entities as the source of truth.

Design decisions:

- Rendering order is chapter heading, epigraph, then scenes for chapter-scoped output.
- Chapter headings come from chapter entities, never from the first scene in a chapter.
- Prologue, epilogue, and unchaptered scenes need explicit rendering behavior instead of accidental placement.

Gate checks:

1. Markdown and PDF bundles follow the expected ordering for representative fixtures.
2. Existing epigraph visual treatment is preserved (centered/styled) under the new entity model.
3. Bundle planner warnings and strictness behavior remain deterministic.
4. Bundles handle prologue/epilogue scenes and unchaptered scenes intentionally.

Test strategy:

- Unit: planner ordering, chapter heading selection, epigraph placement, and prologue/epilogue placement rules.
- Integration: Markdown and PDF bundles for single chapter, multi-chapter, chapter plus epigraph, prologue/epilogue, unchaptered scenes, and beta-reader chapter-set packets.

### Gate 6: Metadata, Lint, and Editing Tool Alignment

Epigraph linkage: see `epigraphs.md` -> `Gate 6 Alignment: Metadata and Lint`.

Functional requirements:

1. Scene metadata update tooling no longer treats numeric chapter identity as canonical.
2. Metadata lint rules validate new chapter and epigraph metadata shapes.
3. Styleguide and batch-analysis tools accept chapter-identity based filters.
4. Scene-character batch and other shared selectors resolve scenes via updated helper logic.

Design decisions:

- Scene metadata tools should not write numeric chapter identity as canonical state.
- Lint should validate chapter and epigraph shape separately from scene enrichment fields.
- Shared selectors should centralize chapter resolution so styleguide, batch analysis, and editing tools do not each reinvent chapter filtering.

Gate checks:

1. Tool contracts are internally consistent with new schema.
2. Metadata lint test coverage includes invalid chapter/epigraph cases.
3. Styleguide/bootstrap/drift flows run successfully against migrated projects.

Test strategy:

- Unit: metadata update validation, lint rules for chapter/epigraph metadata, shared selector behavior, and invalid chapter references.
- Integration: styleguide bootstrap, drift checks, scene-character batch workflows, and metadata editing against migrated explicit-chapter fixtures.

### Gate 7: Divisions and Larger Structural Sections

Epigraph linkage: none.

Functional requirements:

1. Add project-scoped `divisions` as optional parent sections for chapters.
2. Support division type/label values such as Part or Act.
3. Allow chapters to reference `division_id`.
4. Ensure division ordering and chapter ordering compose deterministically.
5. Update rendering and query surfaces only where division grouping is explicitly useful.

Design decisions:

- Divisions are optional project-scoped containers above chapters.
- Chapters must remain fully usable without divisions.
- Division support should not reopen v1 chapter identity or epigraph placement decisions.

Gate checks:

1. Division schema and migration tests pass.
2. Chapter queries and bundles remain stable with and without divisions.
3. No existing chapter-only workflow requires divisions to be present.

Test strategy:

- Unit: division schema, project-scoped division identity, chapter-to-division references, and division ordering.
- Integration: chapter listing, rendering, and bundles with no divisions, with Parts, and with Acts.

### Gate 8: Consolidation and Breaking Release Readiness

Epigraph linkage: see `epigraphs.md` -> `Gate 8 Alignment: Release Readiness`.

Functional requirements:

1. Remove obsolete references to numeric chapter identity from production code paths.
2. Regenerate tool documentation to reflect final contracts.
3. Update setup/development docs and release log with migration behavior.
4. Provide migration notes for maintainers and users.

Design decisions:

- This remains a breaking release; no long-term compatibility layer is required.
- Release notes must explain the explicit source contract, nullable chapter membership, and project-scoped chapter identifiers.
- Docs should make clear that richer Scrivener inference is future work, not a hidden promise in v1.

Gate checks:

1. Full unit and integration test suite passes on the migration branch.
2. Tool docs and PRD text match implemented behavior.
3. Manual validation pass confirms author-facing user value outcomes:
	- chapter rename/edit once propagates consistently
	- chapter ordering changes are deterministic
	- epigraph search and rendering are first-class
4. Branch is ready for a single breaking release cut.

Test strategy:

- Unit: full suite.
- Integration: full suite plus manual validation of chapter rename/edit once, deterministic chapter ordering, epigraph search/rendering, unchaptered scene behavior, and migration diagnostics.
