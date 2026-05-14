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
- [Beta Reader Accountability and Book-Like Layout](docs/prd/done/beta-reader-accountability-layout.md)
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

The canonical tool list and contracts are maintained in [docs/tools.md](docs/tools.md), which is auto-generated from the server source.

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
- [Beta Reader Accountability and Book-Like Layout](docs/prd/done/beta-reader-accountability-layout.md) — chapter-scoped beta packets with per-page accountability and book-like PDF defaults
- [OpenClaw Integration](docs/prd/in-progress/openclaw-integration.md) — deployment and runtime integration
- [Client-Agnostic Setup Contract](docs/prd/in-progress/client-agnostic-setup.md) — shared setup contract and client-hosted setup UI direction
- [Open Ideas](docs/prd/inbox/ideas-and-questions.md) — design questions, feature ideas
- [Workflow Discovery](docs/prd/done/describe-workflows.md) — `describe_workflows` tool, entry-point for AI navigation
