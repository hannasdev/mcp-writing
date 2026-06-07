# Writing MCP — Product Overview

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for relevant scenes.

Writing MCP works with plain-text manuscript projects, including Scrivener External Folder Sync, without coupling the product model to Scrivener itself.
It supports metadata-first reasoning, explicit prose editing workflows, and review/export outputs for sharing or manual review.

---

## Product Status

Active initiative: None.

Current focus: None.

Most recent completed initiative: [Human Input Forgiveness](docs/initiatives/done/human-input-forgiveness/prd.md).

Human Input Forgiveness made selected request-boundary inputs more forgiving, added compact workflow and restore response guidance, clarified keyword metadata search boundaries, preserved stable canonical IDs, and recorded original temp-fixture feedback replay evidence.
Relationship Metadata Boundary closed the sidecar-first scene relationship mutation path, preserved legacy sidecar/frontmatter compatibility, added paired and one-sided SQLite-first evidence workflows, and proved end-to-end regression coverage for relationship mutation, search/read consumers, sync compatibility, and backup freshness.
Architecture Alignment Follow-up completed the managed sync preservation, sidecar write-boundary, outcome-oriented relationship workflow, and sidecar compatibility documentation slices that closed the known target-architecture follow-up gaps.
Database Backup and Recovery added deterministic project backup bundles, trust/freshness diagnostics, advisory operation history, automatic backup refresh after sanctioned canonical mutations, dry-run restore planning, transactional restore application, and operational backup/restore documentation.
Docker, CI, and Deployment Workflow made Docker a supported way to build, run, smoke-test, and deploy Writing MCP, with a documented container contract, Compose workflow, CI smoke coverage, and deployment-readiness guidance.
Target Architecture Migration completed the structural manuscript state consolidation scope.
SQLite is the durable canonical model for structural manuscript state, while prose remains file-based and generated structure exports provide Git-reviewable transparency and future recovery input.
Filesystem Boundary Hardening centralized local file mutation through application-aware helpers so sync-root writes, generated outputs, imports, runtime temp files, moves, deletes, and lint guardrails share one filesystem policy.
Chapter and Epigraph Structure delivered first-class canonical chapters and epigraphs, explicit chapter/scene/epigraph structure workflows, managed-sync guardrails, chapter-aware read ordering, and read-scope numeric chapter compatibility aliases.

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
9. **Outcome-oriented tools:** MCP tools should express writing, revision, review, recovery, and reasoning outcomes rather than exposing raw storage CRUD or table-shaped APIs.

For structural manuscript state, use [Managed Structure Contract](docs/foundations/managed-structure-contract.md) as the detailed arbiter for trusted mutation paths, generated views, import boundaries, and AI/human workflow guardrails.

---

## For More Details

- [Features](FEATURES.md) — shipped product capabilities and links to completed initiative docs
- [Human Input Forgiveness](docs/initiatives/done/human-input-forgiveness/prd.md) — completed initiative for forgiving request-boundary resolution and compact response guidance while preserving stable canonical IDs
- [Backlog](BACKLOG.md) — deferred product work that is not currently active
- [Relationship Metadata Boundary](docs/initiatives/done/relationship-metadata-boundary/prd.md) — completed initiative closing the remaining sidecar-first scene character/place relationship mutation path
- [Architecture Alignment Follow-up](docs/initiatives/done/architecture-alignment-follow-up/prd.md) — completed initiative documenting sidecar compatibility, migration, deprecation expectations, and relationship workflow alignment
- [Database Backup and Recovery](docs/initiatives/done/database-backup-recovery/prd.md) — completed initiative for Git-reviewable recovery artifacts and explicit restore workflows for SQLite-canonical state
- [Conceptual Target Architecture](docs/foundations/target-architecture.md) — idealized architectural model for evaluating future structure, tooling, and workflow decisions
- [Managed Structure Contract](docs/foundations/managed-structure-contract.md) — design boundaries for structural mutation, generated transparency, import, and maintenance workflows
- [Docker, CI, and Deployment Workflow](docs/initiatives/done/docker-ci-deployment/prd.md) — completed milestone for supported container build, run, smoke-test, and deployment operations
- [Filesystem Boundary Hardening](docs/initiatives/done/filesystem-boundary/prd.md) — completed milestone for centralizing local filesystem mutation policy and lint guardrails
- [Structural Authority Hardening](docs/initiatives/done/structural-authority-hardening/prd.md) — completed milestone for tightening remaining target-architecture discrepancies
- [Chapter and Epigraph Structure](docs/initiatives/done/chapter-structure/prd.md) — completed milestone for first-class chapter and epigraph structure
- [Agent Tool Reference](docs/agents/tools.md) — generated tool catalog including `describe_workflows`, the main AI navigation entry-point
