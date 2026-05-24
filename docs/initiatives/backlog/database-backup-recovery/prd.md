# PRD: Database Backup and Recovery

**Status:** Active

Current focus: M3 — Backup Diagnostics and Freshness.

The product is ready to extend the SQLite-canonical architecture with a complete backup and recovery story.
The need is clear because structural manuscript state has moved away from files-first authority.
The internal backup artifact shape and explicit project backup export tool are implemented; the next implementation slice should make backup trust, freshness, and tamper status visible before restore behavior depends on it.

Implementation slices are tracked in [milestones.md](milestones.md).

Docker and homeserver volume backup expectations for `/sync` and `/data` are covered by the completed [Docker, CI, and Deployment Workflow](../../done/docker-ci-deployment/prd.md).
This initiative is about the separate application-level recovery surface: Git-reviewable backup artifacts generated from SQLite-canonical state, diagnostics, and explicit restore workflows.

## Problem Statement

Writing MCP now treats SQLite as the durable canonical model for structural manuscript state, while prose remains file-based.
That architecture protects structural invariants and gives AI agents one sanctioned mutation path, but it weakens the earlier backup story where most meaningful changes were naturally visible and recoverable through Git.

The current structure export and restore workflows are useful, but they cover a narrow slice of canonical structure.
As more durable project state lives in SQLite, users need confidence that database loss, stale exports, or deployment mistakes will not strand their manuscript metadata outside normal Git-backed review and recovery habits.

The product needs a backup strategy that preserves the target architecture:

- SQLite remains canonical during daily work.
- Generated files remain transparency and recovery surfaces, not mutation surfaces.
- Git remains useful for review, auditability, and off-machine redundancy.
- Restore is explicit, transactional, and diagnosable.

## Solution

Introduce a project backup system that generates deterministic, Git-trackable backup artifacts from canonical SQLite state.
Sanctioned canonical mutation workflows refresh those artifacts after successful database writes, and diagnostics report when backups are missing, stale, tampered, incompatible, or incomplete.

The v1 recovery promise is:

- a trusted backup can rebuild canonical project database state after SQLite loss;
- authored prose remains backed up through normal file and Git workflows;
- derived indexes, FTS tables, generated reports, caches, and runtime jobs are regenerated rather than restored as authority.

The backup system should extend the existing `export_structure_snapshot` and `restore_structure_from_export` direction rather than replacing it wholesale.
Those tools remain useful as structure-specific workflows, while the project backup system becomes the broader operational safety net for SQLite-canonical state.

## User Stories

1. As an author, I want database-backed manuscript structure to remain recoverable through Git-backed artifacts, so that I can trust the new architecture as much as the old files-first workflow.
2. As an author, I want backup artifacts to update after structural changes, so that I do not have to remember a separate backup step during ordinary writing work.
3. As an author, I want backup failures to be visible, so that I can fix backup freshness before I need recovery.
4. As an author, I want restore to default to a dry run, so that I can inspect what would change before canonical database state is rewritten.
5. As an author, I want prose files to stay outside database backup blobs, so that authored text remains readable, diffable, and backed up as plain files.
6. As an AI agent, I want clear workflow guidance for backup and restore, so that I do not patch generated backup files as if they were normal mutation surfaces.
7. As an AI agent, I want diagnostics to say whether a backup is trusted, stale, or incompatible, so that I can choose the right recovery path without guessing.
8. As a maintainer, I want deterministic backup output, so that Git diffs are reviewable and testable.
9. As a maintainer, I want checksums and schema versions in backup artifacts, so that tampering, partial writes, and incompatible restores are refused.
10. As a maintainer, I want restore to be transactional, so that failed recovery cannot leave the canonical database half-restored.
11. As a Docker or homeserver user, I want runtime diagnostics to report app-level backup artifact location and freshness, so that I can pair deployment volume backups with trustworthy project recovery artifacts.
12. As a project owner, I want Git commits to remain an explicit user or agent decision, so that automatic backup refresh does not create noisy commit history.
13. As a project owner, I want a semantic operation history for canonical mutations, so that Git review explains what changed and why, not only what the final database snapshot contains.
14. As a developer, I want existing structure export and restore behavior preserved, so that shipped recovery workflows do not regress while broader backup coverage is added.

## Implementation Decisions

- Add a generated backup bundle under `WRITING_SYNC_DIR`, defaulting to a dedicated `project-backups/<project_id>/` directory.
- Treat backup files as generated transparency and explicit recovery input. Editing them does not mutate canonical state during daily work.
- Generate deterministic backup artifacts:
  - `manifest.json` for project identity, schema/app versions, covered domains, checksums, and restore compatibility.
  - `canonical.snapshot.json` for durable canonical state needed to rebuild the project database.
- Defer `operations.jsonl` to the semantic operation history milestone. M1 may reserve the manifest field names needed to describe future operation-log support, but it should not implement operation logging.
- Treat full deterministic snapshots as restore authority. Hash comparison should avoid no-op rewrites, and Git should provide storage/review deltas for changed snapshot content.
- Do not use custom delta chains or event replay as the primary v1 recovery mechanism.
- Refresh backup artifacts after successful canonical database mutations.
- Do not automatically create Git commits in v1. Tools should update Git-trackable files and return guidance to review or commit them.
- Restore from backup is an explicit maintenance workflow, never an ordinary `sync` side effect.
- Restore defaults to dry run and applies changes transactionally only when explicitly requested.
- Backup freshness should be based on deterministic checksums or a database revision marker, not timestamps alone.
- Preserve existing `export_structure_snapshot` and `restore_structure_from_export` tools as narrower structure workflows or compatibility wrappers.
- Include canonical durable state in v1 coverage:
  - projects and universes;
  - chapters, epigraph links, scene chapter membership, and timeline positions;
  - scene metadata that is durable canonical state in SQLite and not safely reconstructable from prose, sidecar metadata, or sync reindexing alone;
  - characters, places, threads, reference documents, explicit reference links, and other user-authored structured relationships.
- Exclude derived or rebuildable state from v1 restore authority:
  - FTS tables;
  - generated reports, bundles, and tool docs;
  - runtime async jobs;
  - transient caches;
  - authored prose bodies.

## Design Considerations

### Initiative Location

This active initiative remains under `docs/initiatives/backlog/` because the repository currently has only `backlog/` and `done/` initiative buckets.
`PRODUCT.md` is the source of truth for active status.
If more active initiatives need concurrent tracking later, introduce `docs/initiatives/active/` as a separate docs-taxonomy change instead of moving this initiative as part of M1.

### Canonical Table Inventory

M1 must turn the coverage policy into an explicit table/domain inventory.
The starting inventory for v1 backup coverage is:

- project identity: `projects`, plus the owning `universes` row when `projects.universe_id` is present
- manuscript structure: `chapters`, `epigraphs`, `epigraph_characters`, `epigraph_tags`
- scene identity and placement: `scenes`, `scene_characters`, `scene_places`, `scene_tags`, `scene_threads`
- world and continuity metadata: `characters`, `character_traits`, `character_relationships`, `places`, `threads`
- reference material metadata and explicit links: `reference_docs`, `reference_doc_tags`, `reference_links`

The starting exclusion list is:

- rebuildable search indexes: `scenes_fts`, `reference_docs_fts`
- runtime state: `async_jobs`
- migration/control metadata: `schema_version`, except for compatibility metadata copied into `manifest.json`
- authored prose bodies and generated artifacts outside SQLite

If implementation discovers a table whose authority is mixed or ambiguous, M1 should document the decision in the manifest coverage summary and tests rather than silently including it.

### Privacy and Git Expectations

Backup artifacts are intended to be Git-trackable, but they may still contain private story data.
They can include titles, loglines, summaries, character traits, relationship notes, reference summaries, tags, and structural relationships.
They must not include authored scene or epigraph prose bodies in v1, but users should treat backup artifacts as manuscript-sensitive material and only commit or push them to repositories they trust.

### Backup File Size and Reviewability

Deterministic JSON should remain reviewable.
The default M1 shape may use a single `canonical.snapshot.json`, but the schema should allow future splitting into stable domain files if one monolithic snapshot becomes too noisy for Git review.
Splitting must preserve deterministic checksums and restore compatibility.

### Snapshot Authority vs Delta History

The recovery model should stay snapshot-first.
Each trusted backup bundle should be able to represent the current restorable canonical project state without replaying a chain of prior events.
When a freshly generated snapshot is byte-for-byte or checksum equivalent to the existing artifact, export and refresh workflows should avoid rewriting it.
When it differs, the deterministic artifact should be rewritten and Git should provide the line-level and storage-level delta between versions.

Custom block-chain-like delta chains are out of scope for v1 recovery because they make restore depend on replay order, base availability, chain compaction, and long-range migration correctness.
Those concerns can be revisited later for audit or analytics, but not as the recovery foundation.

### Future Audit and Provenance

The future `operations.jsonl` scope is valuable for provenance, accountability, and project analytics.
It may support questions such as who or what changed a project, when changes happened, how much structure or metadata changed during a period, and whether a sudden bulk rewrite deserves review.

That audit trail should be advisory.
It may inform credibility, contribution timelines, progress statistics, and tool/agent accountability, but v1 restore must not depend on replaying it.
If operation history grows too large, a later milestone can define rotation, checkpointing, or snapshot-boundary compaction without changing snapshot restore semantics.

### Restore Delete Semantics

Restore milestones must define delete behavior explicitly.
The default policy should be conservative: if SQLite contains canonical records for the target project that are absent from the backup, restore planning reports them as destructive changes and requires explicit confirmation before applying deletion.
Dry-run output should distinguish create, update, delete, unchanged, and refused/conflict cases.

### Freshness Marker

M1 should support artifact-level checksums only.
M3 should decide whether freshness is computed by rebuilding the canonical snapshot and comparing checksums, by introducing a database revision marker, or by combining both.
Until that decision is made, timestamp-only freshness is not acceptable.

### Relationship to Structure Export

Project backup does not replace `export_structure_snapshot` in v1.
Structure export remains the narrow, human-readable structure review and repair surface; project backup is the broader recovery surface for SQLite-canonical project state.
Later milestones may decide whether structure export becomes a view over project backup internals, but the public behavior should stay compatible unless a separate migration plan says otherwise.

### Partial Project and Cross-Scope Relationships

V1 backups are project-scoped.
Project-scoped entities are included for the target project.
Universe-level entities are included only when needed to restore the target project's owning universe or when a relationship from project-scoped state references them directly.
Cross-project relationships should be treated conservatively: M1 should represent enough identity to diagnose external references, while restore milestones should refuse or require explicit confirmation before creating, deleting, or rewriting state owned by another project.

### Backup Scope Clarifications

- Backups are project-scoped in v1. Universe records are included only when needed to restore the owning project relationship; standalone universe-level backup is a separate future concern.
- Backup schema version, application package version, and SQLite schema version must be recorded separately so compatibility decisions can be explicit.
- M1 checksums cover deterministic backup artifact content. Restore milestones may add prose file reference checksums when they validate that restored canonical state still points at the expected authored prose files.
- M1 is an internal domain-model slice: no public MCP tool, no generated files on disk, no automatic mutation hooks, and no restore application.

## Proposed Interfaces

Future implementation should add or extend MCP workflows around these capabilities:

- `export_project_backup(project_id, output_dir?)`
  - writes the full canonical backup bundle;
  - returns artifact paths, checksums, coverage summary, and next-step guidance.
- `restore_project_from_backup(project_id, backup_path?, dry_run=true)`
  - validates manifest, schema compatibility, project identity, checksums, file references, and conflicts;
  - returns a restore plan in dry-run mode;
  - applies canonical database restore transactionally when `dry_run=false`.
- `diagnose_project_backups` or an extension of existing diagnostics
  - reports missing, stale, wrong-project, incompatible, tampered, or incomplete backups;
  - distinguishes canonical drift from stale generated backup state.
- Runtime and workflow discovery surfaces should report backup directory, freshness status, Git availability, and recommended restore entry points.

## Testing Decisions

Good tests should assert observable backup and restore behavior rather than internal helper structure.
The important guarantees are deterministic output, trustworthy diagnostics, transactional restore, and preservation of the architecture boundary between canonical state and generated transparency.

Unit tests should cover:

- deterministic backup rendering and stable ordering;
- manifest checksums and schema compatibility;
- stale, missing, wrong-project, incompatible-schema, tampered, and incomplete backup diagnostics;
- restore planning and conflict detection;
- failed restore leaving SQLite unchanged.

Integration tests should cover:

- canonical mutation followed by automatic backup refresh;
- reviewing backup artifact diffs after a structural change;
- deleting or recreating SQLite canonical state from a trusted backup;
- regenerating derived indexes after restore;
- ordinary `sync` refusing to treat backup artifacts as authority.

Manual validation should cover:

- representative Scrivener-imported projects;
- local Git repositories with and without remotes;
- Docker or homeserver deployments only to verify the app-level backup directory, freshness diagnostics, and restore workflows behave correctly with separate `/sync` and `/data` mounts.

## Out of Scope

- Moving authored prose into SQLite.
- Restoring prose bodies from database backup artifacts.
- Automatically committing backup artifacts to Git.
- Replacing Git remote backup guidance with a hosted backup service.
- Exact point-in-time restoration of every SQLite table, including FTS, async jobs, and caches.
- Using generated backup files as a normal mutation API.
- Import-style recovery from sidecars and folder layout when no trusted backup exists, except as existing or separately planned repair behavior.

## Further Notes

This initiative should link to the completed Docker deployment documentation rather than re-owning volume backup guidance.
The app-level backup bundle protects canonical project state, while deployment docs explain backing up the live SQLite volume, the sync Git repository, and any configured remote.

The key product constraint is that backup handling must not undo the target architecture.
Generated backup files make SQLite-canonical state reviewable and recoverable, but they do not become the primary control plane for manuscript structure.
