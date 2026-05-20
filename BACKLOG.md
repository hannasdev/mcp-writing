# Writing MCP — Backlog

Deferred product work that is not currently active.

## Deferred Backlog (Not Active)

### 🚀 [OpenClaw Integration](docs/initiatives/backlog/openclaw-integration/prd.md) 📋

Deploy Writing MCP as a service in the OpenClaw runtime with the Writing World agent.

**Status:** Deferred backlog (not active). Runtime shape, deployment targets, and agent integration points are defined, but rollout is paused.

### 🧭 [Client-Agnostic Setup Contract](docs/initiatives/backlog/client-agnostic-setup/prd.md) 📋

Define a shared setup contract for configuration-driven writing features so setup can live in client-native UI surfaces while the MCP remains focused on durable capabilities.

**Status:** Deferred backlog (not active). Product direction remains useful and is available for future prioritization.

### 📚 [Chapter Structure Follow-up](docs/initiatives/backlog/chapter-structure/prd.md) 📋

Track the remaining follow-up work around first-class chapters, deferred divisions, and final documentation cleanup after the initial chapter/epigraph rollout.

**Status:** Deferred backlog (not active). Canonical chapters and epigraphs, `chapter_id` targeting, dedicated chapter/epigraph tools, and chapter-aware bundle rendering have already shipped; remaining follow-up work is available for future prioritization.

### 🔒 [Filesystem Boundary Hardening](docs/initiatives/backlog/filesystem-boundary/prd.md) 📋

Centralize filesystem containment, symlink, generated-output, and mutation rules so security checks match Writing MCP's local-file product model instead of warning about expected dynamic path usage.

**Status:** Deferred backlog (not active). Candidate follow-up after security linting; requires characterization tests before migrating high-risk write/delete/move surfaces.

### 📊 [Embedding-Based Search](docs/initiatives/backlog/embeddings-search/prd.md) 📋

Semantic search for queries that require understanding meaning, not just keywords.

**Example:** "Find scenes with confrontation near water" (currently impossible with FTS5 alone)

**Status:** Deferred backlog (not active). Pending evaluation of embedding backend (OpenAI vs Ollama vs Hugging Face), cost, and performance.
