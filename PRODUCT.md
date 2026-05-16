# Writing MCP — Product Overview

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for relevant scenes.

Writing MCP works with plain-text manuscript projects, including Scrivener External Folder Sync, without coupling the product model to Scrivener itself.
It supports metadata-first reasoning, explicit prose editing workflows, and review/export outputs for sharing or manual review.

---

## Active Development

No feature PRD is currently marked active.

The active product focus is design consolidation around structural manuscript state, especially the boundaries captured in [Managed Structure Contract](docs/prd/managed-structure-contract.md).

---

## Deferred Backlog (Not Active)

See [BACKLOG.md](BACKLOG.md) for deferred product work that is not currently active.

---

## Design Principles

1. **Two-phase retrieval:** metadata and indexes first, prose on demand.
2. **Preserve authorship and intent:** automate deterministic indexing and diagnostics, not editorial meaning or silent structural decisions.
3. **Explicit structural mutation:** canonical structure changes go through sanctioned MCP workflows.
4. **Git-backed auditability:** version control records project changes; MCP workflows enforce structural invariants.
5. **Stable identities:** durable IDs survive title changes, order changes, file moves, and source-tool restructures.
6. **Separated artifact ownership:** prose, canonical structure, derived views, and migration inputs have distinct read/write rules.
7. **Generated transparency:** reports, outlines, bundles, and indexes explain state but do not become authority.
8. **Import is a special mode:** setup/import may infer cautiously, but daily work should use explicit operations.

For structural manuscript state, use [Managed Structure Contract](docs/prd/managed-structure-contract.md) as the detailed arbiter for trusted mutation paths, generated views, import boundaries, and AI/human workflow guardrails.

---

## Completed Capabilities

Historical completed feature summaries live in [docs/prd/completed-features.md](docs/prd/completed-features.md).

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

## For More Details

- [Backlog](BACKLOG.md) — deferred product work that is not currently active
- [Managed Structure Contract](docs/prd/managed-structure-contract.md) — design boundaries for structural mutation, generated transparency, import, and maintenance workflows
- [Open Ideas](docs/prd/inbox/ideas-and-questions.md) — design questions, feature ideas
- [Workflow Discovery](docs/prd/done/describe-workflows.md) — `describe_workflows` tool, entry-point for AI navigation
