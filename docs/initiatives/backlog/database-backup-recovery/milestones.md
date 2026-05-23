# Database Backup and Recovery — Milestones

**Status:** Active

This milestone plan breaks the PRD into independently reviewable slices.
Each milestone should leave the system in a releasable state and preserve the target architecture rule that SQLite remains canonical while generated backup artifacts provide transparency and explicit recovery input.

Current focus: M2 — Manual Project Backup Export Tool.

## Objective

Add a trustworthy backup and restore story for SQLite-canonical project state without making generated files a daily mutation surface.
Docker volume backup and rollback guidance already lives in the completed Docker initiative; this plan covers app-level backup artifacts, diagnostics, and restore behavior.

## Guardrails

- Do not move authored prose into database backup artifacts.
- Do not make ordinary `sync` restore or adopt backup files as authority.
- Keep existing `export_structure_snapshot` and `restore_structure_from_export` behavior working while broader project backups are introduced.
- Prefer deterministic, Git-reviewable outputs over binary database snapshots for the app-level recovery surface.
- Keep automatic backup refresh separate from automatic Git commits.
- Keep restore explicit, dry-run-first, and transactional.

## M1 — Backup Domain Model and Manifest

Status: Delivered.

Goal: define the backup bundle shape before wiring it into mutation workflows.

Deliverables:

- Introduce a versioned project backup schema with `manifest.json` and `canonical.snapshot.json`.
- Define canonical coverage for v1:
  - projects and universes;
  - scenes and durable SQLite-canonical scene metadata that cannot be safely reconstructed from prose, sidecars, or sync reindexing alone;
  - chapters, epigraphs, scene placement, and timeline positions;
  - characters, places, threads, reference docs, and explicit reference links.
- Define excluded derived state:
  - FTS tables;
  - generated reports, bundles, and tool docs;
  - runtime async jobs;
  - transient caches;
  - authored prose bodies.
- Add deterministic serialization, stable ordering, and checksum calculation.
- Define full deterministic snapshots as restore authority; do not introduce custom delta chains or event replay as the v1 recovery mechanism.
- Choose the default generated backup location: `project-backups/<project_id>/`.
- Record backup schema version, application package version, and SQLite schema version separately.
- Reserve manifest space for future operation-log support without implementing `operations.jsonl`.
- Document the explicit v1 table/domain inventory:
  - include `projects`, owning `universes`, `scenes`, `chapters`, `epigraphs`, `epigraph_characters`, `epigraph_tags`, `scene_characters`, `scene_places`, `scene_tags`, `scene_threads`, `characters`, `character_traits`, `character_relationships`, `places`, `threads`, `reference_docs`, `reference_doc_tags`, and `reference_links` when they belong to or are required by the target project;
  - exclude `scenes_fts`, `reference_docs_fts`, `async_jobs`, and raw `schema_version` rows from restore authority.
- Add manifest metadata that warns backup artifacts are Git-trackable but manuscript-sensitive.
- Keep the snapshot schema open to future deterministic domain-file splitting if one monolithic JSON file becomes too noisy for review.

Acceptance criteria:

- A project backup can be built in memory from SQLite canonical state with deterministic output.
- The manifest records project identity, backup schema version, app/schema compatibility metadata, coverage summary, and checksums.
- Snapshot checksums can identify no-op exports so later workflows can avoid rewriting unchanged artifacts.
- Backup artifacts clearly identify themselves as generated transparency and recovery input, not mutation surfaces.
- Backup artifacts clearly identify privacy expectations: no authored prose bodies in v1, but metadata and summaries may still be sensitive.
- Cross-project or universe-level references are represented conservatively enough for diagnostics without granting restore authority over unrelated projects.
- M1 remains internal-only: no public MCP tool, no generated files on disk, no automatic backup refresh, and no restore application.
- Existing structure export tests continue to pass unchanged.

Test strategy:

- Unit tests for deterministic serialization and stable ordering.
- Unit tests for manifest checksum behavior.
- Unit tests proving equivalent canonical state produces the same snapshot checksum.
- Unit tests proving excluded tables or rebuildable state are not represented as restore authority.
- Unit tests proving operation history is advertised as unsupported or absent until M4.
- Unit tests for project-scoped filtering and conservative cross-scope relationship representation.

Out of scope:

- Public MCP tools.
- Filesystem writes.
- Operation history.
- Freshness diagnostics beyond artifact checksums.
- Restore application.
- Automatic refresh after mutations.

Evidence:

- [src/structure/project-backup.js](../../../../src/structure/project-backup.js)
- [src/test/unit/project-backup.test.mjs](../../../../src/test/unit/project-backup.test.mjs)

## M2 — Manual Project Backup Export Tool

Status: Current focus.

Goal: expose project backup generation as an explicit workflow.

Deliverables:

- Add `export_project_backup(project_id, output_dir?)`.
- Write `manifest.json` and `canonical.snapshot.json` under the backup directory.
- Return artifact paths, relative paths, checksums, coverage summary, and next-step guidance.
- Route writes through filesystem boundary helpers for generated output.
- Preserve `export_structure_snapshot` as a structure-specific tool.

Acceptance criteria:

- Export refuses invalid project IDs and output locations outside the sync root.
- Export output is stable across repeated runs when canonical state has not changed.
- Tool guidance tells users or agents to review or commit generated backup files without editing them as mutation surfaces.
- Existing structure export behavior remains compatible.

Test strategy:

- Unit tests for path validation and output rendering.
- Integration test for exporting a representative fixture project.
- Regression test showing `export_structure_snapshot` still writes the existing structure export shape.

Out of scope:

- Automatic export after every mutation.
- Operation history.
- Restore.

## M3 — Backup Diagnostics and Freshness

Goal: make backup trust visible before backup artifacts are needed for recovery.

Deliverables:

- Add `diagnose_project_backups` or extend existing diagnostics with project backup checks.
- Detect missing, stale, wrong-project, incompatible-schema, tampered, partial, and unreadable backup bundles.
- Compare current SQLite canonical state to the latest backup using checksums or a database revision marker.
- Report backup directory, trust status, freshness status, and actionable next steps.
- Surface backup freshness in runtime or workflow discovery where useful.
- Decide whether freshness is computed by rebuilding the canonical snapshot and comparing checksums, by introducing a database revision marker, or by combining both. Timestamp-only freshness is not sufficient.

Acceptance criteria:

- Diagnostics distinguish canonical state drift from stale generated backup state.
- Tampered or partial backup artifacts are refused as trusted recovery input.
- Missing backups produce guidance to run `export_project_backup`.
- Diagnostics do not mutate SQLite or generated files.

Test strategy:

- Unit tests for every diagnostic category.
- Unit tests for checksum mismatch and incompatible schema handling.
- Integration test for a stale backup after canonical state changes.

Out of scope:

- Auto-repair.
- Restore application.
- Git commits.

## M4 — Semantic Operation History

Goal: make canonical mutations reviewable as a human-readable event stream.

This milestone supports future audit, provenance, authorship credibility, progress analytics, and tool/agent accountability.
It must remain separate from restore authority: the current snapshot plus manifest is the recovery source of truth, while operation history explains how the project changed over time.

Deliverables:

- Add an append-only `operations.jsonl` artifact to the backup bundle.
- Define a minimal event envelope:
  - operation name;
  - project ID;
  - affected entity IDs;
  - timestamp;
  - actor/tool when available;
  - before/after summary or patch payload;
  - backup schema and app version metadata.
- Emit operation records from sanctioned canonical mutation workflows.
- Keep operation history advisory for audit and review; restore authority remains the canonical snapshot plus manifest.
- Document rotation, checkpointing, or snapshot-boundary compaction options if operation history becomes too large for practical review.

Acceptance criteria:

- Representative structural mutations append deterministic, meaningful operation records.
- Operation records are useful in Git review without requiring users to inspect SQLite.
- Operation records can support later progress and provenance analytics without requiring restore replay.
- Failure to append the operation log is reported as a backup warning without silently hiding backup drift.
- Operation log behavior does not make generated files authoritative.

Test strategy:

- Unit tests for event envelope rendering.
- Unit tests for representative mutation event payloads.
- Integration test for a canonical mutation producing both database change and operation log entry.

Out of scope:

- Event replay as the primary restore mechanism.
- Rewriting old operation records.
- Automatic Git commits.

## M5 — Automatic Backup Refresh After Canonical Mutations

Goal: keep generated backup artifacts fresh during ordinary sanctioned workflows.

Deliverables:

- Add a shared post-mutation backup refresh path for canonical database writes.
- Refresh `manifest.json`, `canonical.snapshot.json`, and `operations.jsonl` after successful canonical mutations.
- Return clear warnings when backup refresh fails after the canonical mutation succeeds.
- Ensure refresh behavior is idempotent and does not create Git commits.
- Update workflow guidance so agents know backup artifacts should normally be fresh after mutation tools run.

Acceptance criteria:

- Canonical mutation tools refresh backup artifacts automatically.
- A backup refresh failure does not roll back an otherwise valid canonical mutation solely because generated output failed.
- Failed refresh is visible in the tool response and diagnostics.
- Repeated mutation and export workflows remain deterministic.

Test strategy:

- Integration tests for representative mutation tools followed by fresh backup diagnostics.
- Unit tests for post-mutation warning envelopes.
- Failure-injection tests for generated-output write errors.

Out of scope:

- Full restore implementation.
- Git commit creation.
- Backup scheduling outside mutation workflows.

## M6 — Restore Planning and Dry Run

Goal: make recovery inspectable before any canonical state is rewritten.

Deliverables:

- Add `restore_project_from_backup(project_id, backup_path?, dry_run=true)` in dry-run mode.
- Validate manifest, schema compatibility, project identity, checksums, file references, and conflicts.
- Produce a restore plan that summarizes rows/entities to create, update, delete, or leave unchanged.
- Refuse tampered, stale, partial, wrong-project, or incompatible backup bundles.
- Treat records present in SQLite but absent from the backup as destructive restore candidates that require explicit dry-run reporting and later confirmation.
- Preserve existing `restore_structure_from_export` behavior as a narrower structure repair workflow.

Acceptance criteria:

- Dry run is the default.
- Dry run never mutates SQLite or generated files.
- Restore plans are deterministic and reviewable by a user or AI agent.
- Restore plans distinguish create, update, delete, unchanged, and refused/conflict cases.
- Invalid backup bundles return actionable diagnostics rather than partial plans.

Test strategy:

- Unit tests for validation and restore-plan construction.
- Unit tests for checksum, schema, project identity, and file-reference failures.
- Integration dry-run test against a representative backup bundle.

Out of scope:

- Applying restore changes.
- Import-style recovery when no trusted backup exists.
- Restoring prose bodies.

## M7 — Transactional Restore and Rebuild Path

Goal: fulfill the v1 recovery promise by rebuilding canonical database state from a trusted backup.

Deliverables:

- Apply `restore_project_from_backup(..., dry_run=false)` transactionally.
- Rebuild canonical project state covered by the backup bundle.
- Regenerate or prompt regeneration of derived indexes after restore.
- Return a reviewable summary of applied changes and recommended follow-up checks.
- Ensure failed restore leaves the database unchanged.
- Require explicit confirmation for destructive deletes or cross-scope changes identified during dry-run planning.

Acceptance criteria:

- A trusted backup can reconstruct canonical project state after SQLite loss or targeted canonical-state damage.
- Restore refuses unsafe input before opening a write transaction.
- Restore failures roll back all database changes.
- After restore and derived-index regeneration, core read workflows return expected project state.

Test strategy:

- Transaction tests for successful and failed restore.
- Integration test deleting or recreating canonical database state from a trusted backup.
- Integration test for restore followed by sync or derived-index regeneration.
- Regression test that ordinary `sync` still does not treat backup artifacts as authority.

Out of scope:

- Exact point-in-time restoration of FTS, async jobs, caches, or generated reports.
- Event-log replay as the primary restore path.
- Cross-project merge restore.

## M8 — Deployment, Documentation, and Release Readiness

Goal: make the app-level backup system understandable and operationally safe across local, Docker, and homeserver workflows without duplicating deployment volume-backup guidance.

Deliverables:

- Update user and maintainer documentation for backup location, Git expectations, restore workflow, and failure handling.
- Link to the completed Docker deployment guidance for `/sync`, `/data`, Git remotes, upgrade, and rollback expectations.
- Document how app-level backup artifacts complement, but do not replace, deployment volume backups.
- Update generated tool docs and workflow discovery text.
- Add release-log guidance if the implementation changes user-facing backup or restore behavior.
- Run manual validation on representative local and containerized projects for backup artifact generation, freshness diagnostics, and restore workflows.

Acceptance criteria:

- Users can explain what must be backed up: prose/Git sync root, generated backup artifacts, and live SQLite volume where applicable.
- Users know that app-level backup artifacts are Git-reviewable recovery input, not a substitute for normal volume backups.
- Agents are routed toward `export_project_backup`, diagnostics, and dry-run restore instead of editing backup files.
- The initiative is ready to move to completed status once backup export, diagnostics, restore, and documentation behavior are delivered and validated.

Test strategy:

- Documentation link checks where practical.
- Generated tool docs drift check.
- Manual local restore walkthrough.
- Manual Docker or homeserver smoke focused on app-level backup paths and diagnostics with separate `/sync` and `/data` mounts.

Out of scope:

- Hosted backup service.
- Client-specific restore UI.
- Automatic Git push or remote setup.

## Related

- [prd.md](prd.md)
- [Target Architecture Migration](../../done/target-architecture-migration/prd.md)
- [Structural Authority Hardening](../../done/structural-authority-hardening/prd.md)
- [Docker, CI, and Deployment Workflow](../../done/docker-ci-deployment/prd.md)
