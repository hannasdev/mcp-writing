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

## Features Under Consideration

### 📊 [Embedding-Based Search](docs/prd/todo/embeddings-search.md) 📋

Semantic search for queries that require understanding meaning, not just keywords.

**Example:** "Find scenes with confrontation near water" (currently impossible with FTS5 alone)

**Status:** Deferred to Phase 4. Pending evaluation of embedding backend (OpenAI vs Ollama vs Hugging Face), cost, and performance.

---

### 📚 [Reference Document Querying](docs/prd/todo/reference-docs.md) 📋

Index and search world-building notes, research, and continuity scratchpads.

**Example:** "Find all continuity notes mentioning Elena" or "What are the rules of magic in this world?"

**Status:** Deferred to Phase 4. Pending decision on lightweight vs full indexing.

---

### 🚀 [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) 🚧

Deploy writing-mcp as a service in the OpenClaw runtime with the Writing World agent.

**Status:** In progress. Runtime shape, deployment targets, and agent integration points are defined; remaining work is implementation and rollout.

### 🧪 [Scrivener Direct Extraction (Beta)](docs/prd/in-progress/scrivener-direct-extraction-beta.md) 🚧

Define an official beta ingestion path that reads Scrivener project internals (`.scriv`/`.scrivx`) for richer metadata extraction, while keeping sync-folder text import as the stable default.

**Status:** In progress. Scope and safeguards are being defined before implementation to avoid schema-coupled regressions and preserve current import safety guarantees.

---

## Open Questions & Ideas

See [ideas-and-questions.md](docs/prd/inbox/ideas-and-questions.md) for:
- Resolved design questions (enrichment model, sidecar files, database inclusion)
- Deferred edge cases (mass reorders, circular relationships, multi-book arcs)
- Feature ideas (tag enhancements, relationship graphs, continuity checker)
- Operational improvements (first-time setup, permission warnings)

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

## Status

- **Phase 1** ✅ — Ask questions about your project (all tools implemented)
- **Phase 2** ✅ — Answers stay accurate (metadata staleness, sidecar migration, enrichment)
- **Phase 3** ✅ — AI helps edit prose (two-step proposals, git history, snapshots)
- **Phase 4** 📋 — Semantic search & reference docs (pending evaluation)
- **Phase 5** 🚧 — OpenClaw integration (active planning and integration work underway)

---

## For More Details

- [Metadata Architecture](docs/prd/done/metadata.md) — sidecar design, staleness, re-enrichment
- [Import & Sync](docs/prd/done/import-sync.md) — folder structure, identity, reconciliation
- [Prose Editing](docs/prd/done/editing.md) — two-step workflow, git history
- [Search & Analysis](docs/prd/done/search-analysis.md) — querying, reasoning flows, pagination
- [Open Ideas](docs/prd/inbox/ideas-and-questions.md) — design questions, feature ideas
