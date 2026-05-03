# Writing MCP — Product Requirements Document (Overview)

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for relevant scenes.

The writing environment is a plain-text sync folder, integrated with Scrivener via External Folder Sync, but not coupled to it. The service is for **reasoning and editing**, not writing or compiling.

---

## Quick Start

1. **Set up sync folder** with Scrivener External Folder Sync
2. **Create world entities** (characters, places) as needed
3. **Ask questions** about your manuscript
4. **Propose edits** when the AI suggests improvements
5. **Track metadata** as you revise

---

## Feature Overview by Theme

### 🎯 [Metadata Architecture & Ownership](docs/prd/done/metadata.md) ✅

How metadata is stored, managed, and kept in sync with prose. Covers sidecar files, staleness detection, and re-enrichment.

**Completed:**
- Tier 1 (structural) and Tier 2 (editorial) metadata split
- Sidecar-based storage (`.meta.yaml`)
- Auto-migration from legacy frontmatter
- Staleness detection and `enrich_scene` tool

**Key Concepts:**
- Scrivener owns prose (`.md` files); MCP owns metadata (`.meta.yaml` sidecars)
- Frontmatter remains read-only legacy; sidecars always win
- `update_scene_metadata`, `update_character_sheet`, `update_place_sheet` write to sidecars only

---

### 📦 [Import & Sync Operations](docs/prd/done/import-sync.md) ✅

How manuscripts are imported from Scrivener and synced. Covers folder structure, identity reconciliation, and edge cases.

**Completed:**
- SQLite index with universe/project/scene/character/place/thread schema
- Scrivener binder-ID based identity (stable even when scenes are reordered)
- World folder structure (characters/, places/, reference/)
- Stale metadata warnings on sync
- Symlink support in sync folder walks

**Key Concepts:**
- External identity (Scrivener binder ID) vs internal identity (`scene_id`)
- Universes (shared world for series) vs Projects (individual books)
- Canonical files (one `sheet.md` per character/place) with optional supporting notes

---

### ✏️ [Prose Editing & Version Control](docs/prd/done/editing.md) ✅

Two-step editing workflow with git-backed version history. Covers prose proposals, commits, and rollback.

**Completed:**
- `propose_edit` → review diff → `commit_edit` workflow
- Git-based version history (no database snapshots)
- Manual `snapshot_scene` for explicit restore points
- Pre-edit snapshots before every `commit_edit`

**Key Concepts:**
- AI proposes, human approves — no silent writes
- Every edit is a git commit with scene ID and instruction message
- Can revert to any past version via `get_scene_prose(scene_id, commit=hash)`
- Branching for experimental rewrites (user-managed in git)

---

### 🔍 [Search, Querying & Analysis](docs/prd/done/search-analysis.md) ✅

Fast metadata-only retrieval and intelligent search. Covers FTS5, pagination, and reasoning flows.

**Completed:**
- `find_scenes()` with filters (character, beat, tag, part, chapter, POV)
- `get_arc()` — ordered scene metadata for a character's journey
- `search_metadata()` — FTS5 full-text search across titles, loglines, keywords
- `get_character_sheet()`, `get_place_sheet()` with supporting notes
- Staleness warnings before analysis
- Paginated results for large result sets

**Key Concepts:**
- Metadata fast; prose on demand
- Always warn if scenes are stale (prose changed since metadata last updated)
- FTS5 with fuzzy/prefix matching for flexible queries
- Character and place entities support both project-local and universe-shared scopes

---

### 🧾 [Review Bundles for Editorial Workflows](docs/prd/done/review-bundles.md) ✅

Deterministic, collaboration-focused bundle generation for editorial workflows. Three profiles: outline discussion, detailed editing, and personalized beta reads.

**Completed:**
- `preview_review_bundle` — dry-run planner with scope, ordering, and warnings
- `create_review_bundle` — artifact writer (PDF default, markdown optional)
- `outline_discussion` profile: scene headings, loglines, beats — no prose
- `editor_detailed` profile: full prose with stable scene anchors and page breaks
- `beta_reader_personalized` profile: named recipient, usage notice, feedback form
- PDF export via pdfkit; companion `manifest.json`, `notice.md`, `feedback-form.md`

**Key Concepts:**
- Review artifacts only — not a publishing or typesetting surface
- Deterministic ordering from indexed scene structure
- Provenance manifest with source commit hash and warning summary
- `warn` vs `fail` strictness mode for stale/incomplete metadata

**Known Issue:**
- Logline renders unconditionally in all profiles; should be `outline_discussion` only. Prose profiles (`editor_detailed`, `beta_reader_personalized`) should suppress it.

---

### 🗂️ [Scrivener Direct Extraction](docs/prd/done/scrivener-direct-extraction-beta.md) ✅

Direct ingestion from Scrivener project internals (`.scriv`/`.scrivx`) for richer metadata extraction. Graduated from beta to stable in v1.14.

**Completed:**
- Official ingestion path reading `.scrivx` binder structure
- Richer metadata extraction compared to External Folder Sync path
- Scoped safeguards to avoid schema-coupled regressions
- Stable alongside sync-folder import as the default path

---

### 📚 [Reference Document Querying](docs/prd/done/reference-docs.md) ✅

Index and link world-building notes, research, and continuity scratchpads as a reference system.

**Example:** "Find all continuity notes mentioning Elena", "What are the rules of magic in this world?", or "What reference docs directly inform this scene?"

**Status:** Completed. Phase 4A–4D are shipped; follow-up candidates are documented in the PRD.

---

## Active Development

### 🚀 [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) 🚧

Deploy Writing MCP as a service in the OpenClaw runtime with the Writing World agent.

**Status:** In progress. Runtime shape, deployment targets, and agent integration points are defined; remaining work is implementation and rollout.

---

### 🪄 [Guideline Generation](docs/prd/done/guideline-generation.md) ✅

Build a reusable prose styleguide system with config resolution, skill generation, and in-edit behavior that helps authors preserve voice and structural consistency.

**Status:** Delivered. Core styleguide capabilities are live and tracked in done PRDs; follow-up onboarding and long-term UX refinements are tracked separately.

Onboarding and config lifecycle requirements are tracked separately in [Onboarding Framework](docs/prd/todo/onboarding-framework.md).

---

### 🧭 [Onboarding Framework](docs/prd/todo/onboarding-framework.md) 📋

Define a shared onboarding and configuration lifecycle for writing-assistant features, including setup scope, defaults, bootstrap, and boot-file publication behavior.

**Status:** Deferred backlog (not active).

---

## Deferred Backlog (Not Active)

### 📊 [Embedding-Based Search](docs/prd/todo/embeddings-search.md) 📋

Semantic search for queries that require understanding meaning, not just keywords.

**Example:** "Find scenes with confrontation near water" (currently impossible with FTS5 alone)

**Status:** Deferred backlog (not active). Pending evaluation of embedding backend (OpenAI vs Ollama vs Hugging Face), cost, and performance.

---

## Open Questions & Ideas

See [ideas-and-questions.md](docs/prd/inbox/ideas-and-questions.md) for:
- Resolved design questions (enrichment model, sidecar files, database inclusion)
- Deferred edge cases (mass reorders, circular relationships, multi-book arcs)
- Feature ideas (tag enhancements, relationship graphs, continuity checker)
- Operational improvements (first-time setup, permission warnings)

Additional completed structural proposal:
- [Root Structure Reorganization](docs/prd/done/root-structure-reorganization.md)

---

## Tool Reference

### Fast Metadata Tools (no prose loaded)

- `find_scenes(character?, beat?, tag?, ...)` — filter by metadata
- `get_arc(character_id)` — character's scene journey
- `get_character_sheet(character_id)` — full character metadata
- `list_characters()`, `list_places()`, `list_threads()`
- `search_metadata(query)` — FTS5 search
- `get_runtime_config()` — system status and diagnostics

### Prose Tools (loads file content)

- `get_scene_prose(scene_id)` — current prose
- `get_chapter_prose(project_id, part, chapter)` — all scenes in a chapter
- `list_snapshots(scene_id)` — git commit history

### Editing Tools (two-step confirm)

- `propose_edit(scene_id, instruction, revised_prose)` — stage a change
- `commit_edit(scene_id, proposal_id)` — apply it (git-backed)
- `discard_edit(proposal_id)` — reject it
- `snapshot_scene(scene_id, project_id, reason)` — manual restore point

### Metadata Update Tools (write to sidecars)

- `update_scene_metadata(scene_id, fields)` — update beat, tags, logline, status, etc.
- `update_character_sheet(character_id, fields)` — update character metadata
- `update_place_sheet(place_id, fields)` — update place metadata
- `flag_scene(scene_id, note)` — mark for AI follow-up

### Sync Tools

- `sync()` — re-read sync folder and update index
- `enrich_scene(scene_id)` — refresh metadata from current prose

---

## Design Principles

1. **Two-phase retrieval:** metadata first (cheap), prose on demand (targeted)
2. **Automate structure, preserve authorship:** deterministic inference, never auto-generate editorial metadata
3. **Explicit over implicit:** no silent writes, all prose edits require confirmation
4. **Git-backed history:** version control instead of database snapshots
5. **Stable identities:** scene/character IDs remain constant even when Scrivener reorders or restructures
6. **Read-only source management:** Scrivener manages prose exclusively; MCP manages metadata exclusively

---

## Current State

Writing MCP is now in continuous development rather than sequential phase delivery.

- **Core platform complete:** metadata architecture, import/sync, prose editing, search/analysis, review bundles, and Scrivener Direct extraction are all implemented.
- **Active development:** OpenClaw integration.
- **Deferred backlog:** embeddings search.
- **Ideas and open questions:** tracked separately so future exploration does not distort the active roadmap.

---

## For More Details

- [Metadata Architecture](docs/prd/done/metadata.md) — sidecar design, staleness, re-enrichment
- [Import & Sync](docs/prd/done/import-sync.md) — folder structure, identity, reconciliation
- [Prose Editing](docs/prd/done/editing.md) — two-step workflow, git history
- [Search & Analysis](docs/prd/done/search-analysis.md) — querying, reasoning flows, pagination
- [Review Bundles](docs/prd/done/review-bundles.md) — editorial workflows, profiles, known issues
- [Scrivener Direct Extraction](docs/prd/done/scrivener-direct-extraction-beta.md) — direct .scriv ingestion
- [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) — deployment and runtime integration
- [Guideline Generation](docs/prd/done/guideline-generation.md) — styleguide generation, onboarding, and authoring UX
- [Open Ideas](docs/prd/inbox/ideas-and-questions.md) — design questions, feature ideas
- [Workflow Discovery](docs/prd/done/describe-workflows.md) — `describe_workflows` tool, entry-point for AI navigation
