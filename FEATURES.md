# Writing MCP — Features

Shipped product capabilities and the initiative docs that explain them in more detail.

Use this page when you want to understand what the product can do today.
Use [PRODUCT.md](PRODUCT.md) for the high-level product overview, active direction, backlog, and foundations.

## Core Platform

### 🎯 [Metadata Architecture & Ownership](docs/initiatives/done/metadata-architecture/prd.md)

How metadata is stored, managed, and kept in sync with prose.

Highlights:

- Tier 1 (structural) and Tier 2 (editorial) metadata split
- Sidecar-based storage with `.meta.yaml`
- Auto-migration from legacy frontmatter
- Staleness detection and `enrich_scene`

### 📦 [Import & Sync Operations](docs/initiatives/done/import-sync/prd.md)

How manuscripts are imported from Scrivener and synced into the indexed workspace.

Highlights:

- SQLite index with universe/project/scene/character/place/thread schema
- Scrivener binder-ID based identity
- World folder structure for characters, places, and reference docs
- Stale metadata warnings on sync

### ✏️ [Prose Editing & Version Control](docs/initiatives/done/prose-editing/prd.md)

Two-step editing workflow with git-backed history.

Highlights:

- `propose_edit` to `commit_edit` confirmation flow
- Pre-edit snapshots before every commit
- Manual snapshots for restore points
- Git-backed version history rather than database snapshots

### 🔍 [Search, Querying & Analysis](docs/initiatives/done/search-analysis/prd.md)

Fast metadata-first discovery with prose loaded on demand.

Highlights:

- `find_scenes()` with metadata filters
- `get_arc()` for ordered scene journeys
- `search_metadata()` with FTS5
- Staleness warnings before analysis

### 🧾 [Review Bundles for Editorial Workflows](docs/initiatives/done/review-bundles/prd.md)

Deterministic bundle generation for outline discussion, detailed editing, and beta reading.

Highlights:

- `preview_review_bundle` planning step
- `create_review_bundle` artifact generation
- PDF export with manifest and review companion files
- Strictness modes for stale or incomplete metadata

### 🔐 [Beta Reader Accountability and Book-Like Layout](docs/initiatives/done/beta-reader-accountability-layout/prd.md)

Chapter-scoped beta packets with per-page accountability and improved PDF reading ergonomics.

Highlights:

- `chapters` filter support for one/few chapter beta bundles
- Per-page PDF footer accountability with recipient and fingerprint token
- Manifest fingerprint metadata for provenance and traceability
- 6x9 book-like PDF geometry for beta profile readability

### 🗂️ [Scrivener Direct Extraction](docs/initiatives/done/scrivener-direct-extraction-beta/prd.md)

Direct ingestion from `.scriv` and `.scrivx` internals for richer metadata extraction.

Highlights:

- Official direct binder ingestion path
- Richer metadata than External Folder Sync alone
- Safeguards to avoid schema-coupled regressions

### 📚 [Reference Document Querying](docs/initiatives/done/reference-docs/prd.md)

Reference note indexing and linkage for world-building, continuity, and research material.

Highlights:

- Query reference docs alongside manuscript metadata
- Link reference docs to scenes
- Support continuity and rules-of-the-world questions

## Recently Delivered

### 🧱 [Structural Authority Hardening](docs/initiatives/done/structural-authority-hardening/prd.md)

Final authority hardening after the target architecture migration.

Highlights:

- Ordinary `sync` observes sidecar and folder drift without adopting it as canonical structure for managed projects
- `update_scene_metadata` rejects structural fields and routes chapter placement/order changes to explicit structure workflows
- Structure export diagnostics report missing, stale, wrong-project, and incompatible-schema exports before repair
- `restore_structure_from_export` provides explicit transactional recovery from trusted generated exports
- Numeric chapter inputs remain read-scope compatibility aliases resolved through canonical chapter identity

### 🏗️ [Target Architecture Migration](docs/initiatives/done/target-architecture-migration/prd.md)

Structural manuscript state boundaries, explicit mutation workflows, and SQLite-canonical structure storage.

Highlights:

- Structure inference, sidecar structural writes, sync observation, diagnostics, and compatibility resolution now have clearer internal boundaries
- Explicit structure commands cover scene assignment, chapter creation/rename/reorder, epigraph attachment, and scene movement
- SQLite is documented as canonical for structural manuscript state while prose remains file-based
- `export_structure_snapshot` generates deterministic SQLite-derived structure exports for Git review and future recovery workflows

### 📚 Chapter and Epigraph Indexing

First-class chapters and epigraphs with canonical `chapter_id` targeting, chapter-aware retrieval, and chapter-linked rendering.

Highlights:

- Canonical `chapters` and `epigraphs` entities with project-scoped identifiers
- `list_chapters` and `find_epigraphs` as dedicated discovery tools
- `find_scenes`, `get_chapter_prose`, styleguide flows, and review bundles updated for `chapter_id`
- Explicit chapter-folder and `epigraph.md` indexing path, with numeric chapter filters retained as read-scope compatibility aliases resolved through canonical chapter identity

Implementation status:

- [milestones.md](docs/initiatives/backlog/chapter-structure/milestones.md) — delivered milestones vs remaining follow-up work

### 🪄 [Guideline Generation](docs/initiatives/done/guideline-generation/prd.md)

Reusable prose styleguide system with config resolution, skill generation, and edit-time enforcement behavior.

Follow-up work:

- [Client-Agnostic Setup Contract](docs/initiatives/backlog/client-agnostic-setup/prd.md)

## Additional Completed References

- [Agent Tool Reference](docs/agents/tools.md)
- [Source-Root Reorganization](docs/initiatives/done/source-root-reorganization/prd.md)
- [MCP Tooling Usability](docs/initiatives/done/mcp-tooling-usability/prd.md)
- [MCP Tooling Usability Milestones](docs/initiatives/done/mcp-tooling-usability/milestones.md)
- [Codebase Modularization](docs/initiatives/done/codebase-modularization/prd.md)
