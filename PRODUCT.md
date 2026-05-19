# Writing MCP — Product Overview

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for relevant scenes.

Writing MCP works with plain-text manuscript projects, including Scrivener External Folder Sync, without coupling the product model to Scrivener itself.
It supports metadata-first reasoning, explicit prose editing workflows, and review/export outputs for sharing or manual review.

---

## Product Status

No active initiative is currently selected.

Most recent completed initiative: [Target Architecture Migration](docs/initiatives/done/target-architecture-migration/prd.md).

The structural manuscript state consolidation work is complete for the current initiative scope.
SQLite is the durable canonical model for structural manuscript state, while prose remains file-based and generated structure exports provide Git-reviewable transparency and future recovery input.
Next active work should be selected from the deferred backlog or from a new product initiative.

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

For structural manuscript state, use [Managed Structure Contract](docs/foundations/managed-structure-contract.md) as the detailed arbiter for trusted mutation paths, generated views, import boundaries, and AI/human workflow guardrails.

---

## For More Details

- [Features](FEATURES.md) — shipped product capabilities and links to completed initiative docs
- [Backlog](BACKLOG.md) — deferred product work that is not currently active
- [Conceptual Target Architecture](docs/foundations/target-architecture.md) — idealized architectural model for evaluating future structure, tooling, and workflow decisions
- [Managed Structure Contract](docs/foundations/managed-structure-contract.md) — design boundaries for structural mutation, generated transparency, import, and maintenance workflows
- [Structural Authority Hardening](docs/initiatives/backlog/structural-authority-hardening/prd.md) — follow-up milestone for tightening remaining target-architecture discrepancies
- [Agent Tool Reference](docs/agents/tools.md) — generated tool catalog including `describe_workflows`, the main AI navigation entry-point
