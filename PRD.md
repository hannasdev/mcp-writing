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

## Completed Capabilities

Completed feature summaries now live in [docs/prd/completed-features.md](docs/prd/completed-features.md).

Core completed areas:
- [Metadata Architecture & Ownership](docs/prd/done/metadata.md)
- [Import & Sync Operations](docs/prd/done/import-sync.md)
- [Prose Editing & Version Control](docs/prd/done/editing.md)
- [Search, Querying & Analysis](docs/prd/done/search-analysis.md)
- [Review Bundles for Editorial Workflows](docs/prd/done/review-bundles.md)
- [Scrivener Direct Extraction](docs/prd/done/scrivener-direct-extraction-beta.md)
- [Reference Document Querying](docs/prd/done/reference-docs.md)
- [Guideline Generation](docs/prd/done/guideline-generation.md)

---

## Active Development

### 🚀 [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) 🚧

Deploy Writing MCP as a service in the OpenClaw runtime with the Writing World agent.

**Status:** In progress. Runtime shape, deployment targets, and agent integration points are defined; remaining work is implementation and rollout.

### 🧭 [Client-Agnostic Setup Contract](docs/prd/in-progress/client-agnostic-setup.md) 🚧

Define a shared setup contract for configuration-driven writing features so setup can live in client-native UI surfaces while the MCP remains focused on durable capabilities.

**Status:** In progress. Product direction is shifting away from onboarding-heavy MCP workflow expansion and toward a shared contract plus thin client adapters.

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

- **Core platform complete:** the major shipped capabilities are indexed in [docs/prd/completed-features.md](docs/prd/completed-features.md).
- **Active development:** OpenClaw integration and the client-agnostic setup contract.
- **Deferred backlog:** embeddings search.
- **Ideas and open questions:** tracked separately so future exploration does not distort the active roadmap.

---

## For More Details

- [Completed Features Index](docs/prd/completed-features.md) — shipped capability summaries and links
- [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) — deployment and runtime integration
- [Client-Agnostic Setup Contract](docs/prd/in-progress/client-agnostic-setup.md) — shared setup contract and client-hosted setup UI direction
- [Open Ideas](docs/prd/inbox/ideas-and-questions.md) — design questions, feature ideas
- [Workflow Discovery](docs/prd/done/describe-workflows.md) — `describe_workflows` tool, entry-point for AI navigation
