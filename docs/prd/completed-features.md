# Completed Features

This document indexes completed product areas that were previously summarized inline in [PRD.md](../../PRD.md).

Use this page when you want shipped capability summaries and links to the underlying done PRDs. Use `PRD.md` for the high-level product overview, active development, backlog, and navigation.

## Core Platform

### 🎯 [Metadata Architecture & Ownership](done/metadata.md)

How metadata is stored, managed, and kept in sync with prose.

Highlights:

- Tier 1 (structural) and Tier 2 (editorial) metadata split
- Sidecar-based storage with `.meta.yaml`
- Auto-migration from legacy frontmatter
- Staleness detection and `enrich_scene`

### 📦 [Import & Sync Operations](done/import-sync.md)

How manuscripts are imported from Scrivener and synced into the indexed workspace.

Highlights:

- SQLite index with universe/project/scene/character/place/thread schema
- Scrivener binder-ID based identity
- World folder structure for characters, places, and reference docs
- Stale metadata warnings on sync

### ✏️ [Prose Editing & Version Control](done/editing.md)

Two-step editing workflow with git-backed history.

Highlights:

- `propose_edit` to `commit_edit` confirmation flow
- Pre-edit snapshots before every commit
- Manual snapshots for restore points
- Git-backed version history rather than database snapshots

### 🔍 [Search, Querying & Analysis](done/search-analysis.md)

Fast metadata-first discovery with prose loaded on demand.

Highlights:

- `find_scenes()` with metadata filters
- `get_arc()` for ordered scene journeys
- `search_metadata()` with FTS5
- Staleness warnings before analysis

### 🧾 [Review Bundles for Editorial Workflows](done/review-bundles.md)

Deterministic bundle generation for outline discussion, detailed editing, and beta reading.

Highlights:

- `preview_review_bundle` planning step
- `create_review_bundle` artifact generation
- PDF export with manifest and review companion files
- Strictness modes for stale or incomplete metadata

### 🔐 [Beta Reader Accountability and Book-Like Layout](done/beta-reader-accountability-layout.md)

Chapter-scoped beta packets with per-page accountability and improved PDF reading ergonomics.

Highlights:

- `chapters` filter support for one/few chapter beta bundles
- Per-page PDF footer accountability with recipient and fingerprint token
- Manifest fingerprint metadata for provenance and traceability
- 6x9 book-like PDF geometry for beta profile readability

### 🗂️ [Scrivener Direct Extraction](done/scrivener-direct-extraction-beta.md)

Direct ingestion from `.scriv` and `.scrivx` internals for richer metadata extraction.

Highlights:

- Official direct binder ingestion path
- Richer metadata than External Folder Sync alone
- Safeguards to avoid schema-coupled regressions

### 📚 [Reference Document Querying](done/reference-docs.md)

Reference note indexing and linkage for world-building, continuity, and research material.

Highlights:

- Query reference docs alongside manuscript metadata
- Link reference docs to scenes
- Support continuity and rules-of-the-world questions

## Recently Delivered

### 📚 Chapter and Epigraph Indexing

First-class chapters and epigraphs with canonical `chapter_id` targeting, chapter-aware retrieval, and chapter-linked rendering.

Highlights:

- Canonical `chapters` and `epigraphs` entities with project-scoped identifiers
- `list_chapters` and `find_epigraphs` as dedicated discovery tools
- `find_scenes`, `get_chapter_prose`, styleguide flows, and review bundles updated for `chapter_id`
- Explicit chapter-folder and `epigraph.md` indexing path, with numeric chapter filters retained as compatibility aliases

Implementation status:

- [chapters-epigraphs-implementation.md](done/chapters-epigraphs-implementation.md) — delivered milestones vs remaining follow-up work

### 🪄 [Guideline Generation](done/guideline-generation.md)

Reusable prose styleguide system with config resolution, skill generation, and edit-time enforcement behavior.

Follow-up work:

- [Client-Agnostic Setup Contract](in-progress/client-agnostic-setup.md)

## Additional Completed PRDs

- [Workflow Discovery](done/describe-workflows.md)
- [Root Structure Reorganization](done/root-structure-reorganization.md)
- [MCP Tooling Usability](done/mcp-tooling-usability.md)
- [MCP Tooling Usability Milestones](done/mcp-tooling-usability-milestones.md)
- [Refactoring](done/refactoring.md)
- [Resolved Design Questions](done/resolved-design-questions.md)
