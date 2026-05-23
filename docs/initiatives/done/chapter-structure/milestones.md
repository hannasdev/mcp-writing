# Chapters and Epigraphs — Implementation Checklist

**Status:** Complete — chapter/epigraph alignment delivered; divisions extracted to a separate backlog initiative

This document tracks the current delivery state for first-class chapters and epigraphs.
It exists to separate shipped milestone accounting from the remaining deferred follow-up plan in [prd.md](prd.md) and [architecture.md](architecture.md).

## Delivered Milestones

- **M1** ✅ — canonical schema and migration foundation
- **M2** ✅ — explicit chapter-folder and epigraph indexing in sync
- **M3** ✅ — conservative compatibility backfill from legacy numeric chapter fields
- **M4** ✅ — chapter-aware query surface
- **M5** ✅ — chapter-linked epigraph rendering in review bundles
- **M6** ✅ — metadata/lint/tooling cleanup aligned with managed structure
- **M7** ↪️ — divisions extracted to [Divisions](../../backlog/divisions/prd.md)
- **M8** ✅ — consolidation and release-readiness cleanup delivered for chapter/epigraph scope

## Delivered Scope

1. `chapters` and `epigraphs` tables with project-scoped identities
2. `scenes.chapter_id` support
3. Canonical chapter backfill from legacy scene `chapter` and `chapter_title`
4. Sync indexing from explicit chapter folders and `epigraph.md`
5. `list_chapters`
6. `find_epigraphs`
7. `find_scenes` support for `chapter_id`
8. `get_chapter_prose` support for canonical `chapter_id`
9. Review-bundle rendering that inserts chapter-linked epigraph content before scenes
10. Compatibility behavior that still accepts numeric chapter targeting in some tools
11. Explicit structure workflows for chapter creation, chapter rename/reorder, epigraph attachment, scene movement, and scene-to-chapter assignment
12. Managed sync guardrails that report file-derived chapter/epigraph drift instead of adopting it for already managed projects
13. Metadata lint support for scene `chapter_id`, scene roles, and epigraph metadata

## Milestones

### M1: Canonical Schema and Migration Foundation ✅

Delivered:

- `chapters` table with `chapter_id`, `project_id`, `title`, `sort_index`, and related metadata
- `epigraphs` table with project-scoped identity and one-epigraph-per-chapter constraint
- `chapter_id` column on scenes
- migration support that backfills canonical chapters from legacy numeric scene chapter fields

Implemented shape:

- project-scoped chapter and epigraph identity is now real, not planned
- scene membership is nullable in practice because some scenes remain unchaptered
- numeric `chapter` and `chapter_title` still exist as compatibility/supporting fields

Evidence:

- [src/core/db.js](../../../../src/core/db.js)
- [src/test/unit/db.test.mjs](../../../../src/test/unit/db.test.mjs)

### M2: Explicit Sync Contract and Validation ✅

Delivered:

- sync indexes canonical chapters from explicit ordered chapter folders
- sync indexes explicit `epigraph.md` files linked to chapters
- scenes outside chapter folders remain valid and can keep null `chapter_id`
- sync tests cover explicit chapters, epigraph indexing, chapter rename behavior, and mixed chapter/unchaptered scene cases

Current contract:

- chapter folders are the reliable explicit source for canonical indexing
- epigraph indexing depends on explicit chapter linkage
- invalid or unlinked epigraph inputs are not silently counted as indexed epigraphs

Evidence:

- [src/test/unit/sync.test.mjs](../../../../src/test/unit/sync.test.mjs)
- [src/test/integration/search.test.mjs](../../../../src/test/integration/search.test.mjs)

### M3: Conservative Compatibility Backfill ✅

Delivered:

- legacy numeric chapter data can resolve to canonical chapters
- `get_chapter_prose` and `find_epigraphs` can still resolve numeric chapter compatibility inputs
- release notes document numeric chapter filters as compatibility aliases during migration

Current boundary:

- compatibility behavior exists to ease migration and remains intentionally supported for read scopes
- numeric chapter inputs still appear in several read contracts, but they resolve through canonical chapter identity and are not mutation targets

Evidence:

- [src/tools/search.js](../../../../src/tools/search.js)
- [release-log.md](../../../../release-log.md)

### M4: Chapter-Aware Query Surface ✅

Delivered:

- `list_chapters`
- `find_epigraphs`
- `find_scenes` chapter filtering via canonical `chapter_id`
- `get_chapter_prose` canonical targeting
- styleguide and review-bundle contracts accept `chapter_id`

Current boundary:

- chapter-aware retrieval is implemented
- some tools intentionally support numeric chapter arguments alongside canonical targeting for read-scope compatibility

Evidence:

- [docs/agents/tools.md](../../../agents/tools.md)
- [src/tools/search.js](../../../../src/tools/search.js)
- [src/tools/styleguide.js](../../../../src/tools/styleguide.js)
- [src/tools/review-bundles.js](../../../../src/tools/review-bundles.js)

### M5: Rendering and Bundle Integration ✅

Delivered:

- review bundles render chapter-linked epigraph content before scenes
- bundle planners and renderers understand canonical `chapter_id`
- existing epigraph presentation remains supported in bundle outputs

Current boundary:

- chapter-aware rendering is shipped
- the remaining work here is documentation cleanup and any later division-aware rendering

Evidence:

- [src/review-bundles/review-bundles-renderer.js](../../../../src/review-bundles/review-bundles-renderer.js)
- [src/review-bundles/review-bundles-planner.js](../../../../src/review-bundles/review-bundles-planner.js)
- [src/test/unit/review-bundles.test.mjs](../../../../src/test/unit/review-bundles.test.mjs)

### M6: Metadata, Lint, and Tooling Cleanup ✅

Delivered:

- `update_scene_metadata` rejects structural fields and points callers to explicit structure workflows
- metadata lint accepts current scene structure fields and validates epigraph metadata separately from scene metadata
- styleguide, batch enrichment, review bundle, search, arc, and shared selector paths resolve canonical chapter identity for chapter-scoped reads
- numeric `chapter` and `chapters` inputs are documented as read-scope compatibility aliases, not mutation targets
- read ordering prefers canonical chapter `sort_index` and falls back to legacy numeric chapter fields only where canonical chapter identity is absent

Current boundary:

- numeric aliases remain intentionally supported for read scopes under the Managed Structure Contract
- compatibility fields may still be mirrored to sidecars as representation/support fields, but SQLite canonical structure remains authoritative

Evidence:

- [src/sync/metadata-lint.js](../../../../src/sync/metadata-lint.js)
- [src/tools/metadata.js](../../../../src/tools/metadata.js)
- [src/tools/search.js](../../../../src/tools/search.js)
- [src/core/helpers.js](../../../../src/core/helpers.js)
- [docs/foundations/managed-structure-contract.md](../../../foundations/managed-structure-contract.md)

### M7: Divisions ↪️

Extracted follow-up:

- [Divisions](../../backlog/divisions/prd.md) tracks optional project-scoped Parts, Acts, or other larger structural sections above chapters.
- Future division work should not reopen shipped chapter identity, epigraph placement, or numeric read-scope compatibility behavior.

### M8: Consolidation and Release Readiness ✅

Delivered:

- chapter/epigraph docs and feature references point at completed initiative docs
- numeric compatibility aliases are documented as read-scope compatibility, not mutation targets
- division follow-up has a separate backlog home

## Related

- [prd.md](prd.md)
- [architecture.md](architecture.md)
- [FEATURES.md](../../../../FEATURES.md)
- [release-log.md](../../../../release-log.md)
