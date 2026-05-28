# Architecture Alignment Follow-up — Milestones

**Status:** Done

This milestone plan breaks the Architecture Alignment Follow-up PRD into
independently reviewable slices. Use [prd.md](prd.md) for product framing and
this document for sequencing, gates, and implementation readiness.
M0–M5 are accepted.

Current focus: None — initiative closed.

## Objective

Tighten remaining target-architecture drift while preserving Writing MCP's core
direction: SQLite is canonical for structural and relationship metadata, prose
remains file-based, generated artifacts provide transparency or recovery input,
and public tools express writing outcomes rather than storage internals.

## Guardrails

- Do not make sidecars, folders, generated exports, review snapshots, or
  recovery snapshots daily-work authority.
- Do not remove Scrivener import or legacy compatibility paths without an
  explicit migration decision.
- Keep first-time import and legacy migration behavior separate from ordinary
  managed-project sync behavior.
- Keep destructive canonical changes explicit, recoverable, and diagnosable.
- Preserve authored prose as file-based content.
- Prefer outcome-oriented workflows over raw CRUD wrappers around tables or
  files.
- Treat Milestones 0 and 1 as decision gates before behavior-changing work.

## M0 — Metadata Ownership Inventory

Status: Accepted for M1 sequencing.

Goal: build an implementation-backed inventory before changing behavior.

Deliverables:

- Inventory current metadata fields, relationship tables, sidecar fields,
  generated views, and import/export paths.
- Mark each metadata family as one of:
  - SQLite-canonical;
  - prose-authored;
  - generated view;
  - import-only compatibility input;
  - review snapshot;
  - recovery snapshot;
  - deprecated.
- Identify which fields remain sidecar-only or sidecar-first.
- Identify fields without current SQLite homes, including scene
  `external_source`, `external_id`, `status`, sidecar `threads`, character
  `group` and `tags`, place `associated_characters` and `tags`, `versions`, and
  legacy reference aliases.
- Identify which outcome workflows already exist and where callers are still
  forced into storage-shaped operations.
- Include prose-derived metadata enrichment and apply/dry-run workflows in the
  write-order inventory.
- Update [prd.md](prd.md) or add a companion inventory document with the
  ownership matrix.

Evidence:

- [inventory.md](inventory.md)

Acceptance gates:

- Scenes, chapters, epigraphs, threads, characters, places, reference links,
  tags, status fields, and source identifiers all have named current owners and
  target ownership decisions.
- Relationship metadata families have explicit write-order expectations.
- Each sidecar-shaped field is classified as current authority, generated view,
  import compatibility, review snapshot, recovery snapshot, or deprecated.
- Fields without a current SQLite home are marked as migrate-to-schema,
  generated/import-only, deprecated, or intentionally prose/file-owned.
- Maintainers can see which compatibility paths are safe to preserve and which
  require migration or deprecation.
- No behavior-changing milestone starts until this inventory is reviewed.

Test strategy:

- No production behavior changes are expected.
- Add characterization tests only when the inventory depends on fragile current
  behavior that later milestones will change.

Out of scope:

- Schema migrations.
- Tool behavior changes.
- Sidecar deprecation.

## M1 — Snapshot Model Decision

Status: Accepted.

Goal: replace the writable-sidecar mental model with explicit review snapshots
and recovery snapshots.

Deliverables:

- Define review snapshots as temporary, human/AI-readable before/after material
  for dry runs, Git review, and proposed operations.
- Define recovery snapshots as durable rollback or rebuild material tied to
  backup/restore workflows.
- Document that neither snapshot type is a daily-work source of truth.
- Decide whether existing sidecar-shaped generated output should become a named
  snapshot artifact or be deprecated.
- Update architecture docs so sidecars, review snapshots, and recovery
  snapshots have distinct ownership and mutation rules.

Evidence:

- [Managed Structure Contract](../../../foundations/managed-structure-contract.md#snapshot-and-sidecar-roles)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md#snapshot-and-sidecar-roles)

Acceptance gates:

- The Managed Structure Contract or related architecture docs state that review
  snapshots are advisory and recovery snapshots are explicit restore inputs.
- Planned tool behavior routes proposed changes through review snapshots and
  committed changes through SQLite-backed workflows.
- Generated sidecar-shaped output has a named future role or deprecation path.
- Restore authority remains explicit and does not rely on daily sidecar edits.
- The decision is documented before sync, metadata, or relationship workflows
  start changing sidecar behavior.

Test strategy:

- Documentation-only unless an existing snapshot/export tool is renamed or
  reclassified.
- If tool contracts change, add focused tests for output labels, guidance, and
  non-authoritative warnings.

Out of scope:

- Implementing new snapshot tools.
- Removing existing compatibility files.
- Changing restore implementation.

## M2 — Managed Sync Preservation

Status: Accepted.

Goal: stop ordinary managed-project sync from deleting canonical structure
because prose or representation files are missing.

Deliverables:

- Change sync planning so missing files produce diagnostics or repair/delete
  candidates instead of silent canonical deletion.
- Preserve first-time import and legacy migration behavior as explicit modes.
- Add explicit delete, detach, archive, or repair follow-up workflows only when
  product needs require canonical removal.
- Return actionable diagnostics for missing prose, stale representation, and
  missing generated artifacts.
- Cover scenes, epigraphs, chapters, and relationship rows affected by sync
  pruning.

Evidence:

- [src/sync/sync.js](../../../../src/sync/sync.js)
- [src/test/unit/sync.test.mjs](../../../../src/test/unit/sync.test.mjs)
- [release-log.md](../../../../release-log.md)

Acceptance notes:

- Managed sync now preserves canonical scenes, chapters, epigraphs, and scene
  relationship rows when their filesystem representations are missing.
- Missing canonical scene, chapter, and epigraph representations now produce
  classified sync warnings instead of silent canonical deletion.
- First-time import, legacy migration, and unmanaged pruning paths remain
  covered by existing regression tests.
- No new canonical mutation was introduced by this milestone; preservation
  avoids deletion, so backup refresh and operation-history requirements do not
  apply to the new missing-file diagnostics.
- Explicit delete, detach, archive, or repair workflows remain deferred until a
  product need requires canonical removal beyond existing restore and structure
  workflows.

Acceptance gates:

- Managed daily sync observes filesystem absence without treating it as
  canonical delete authority.
- Destructive structural outcomes require an explicit workflow, restore
  operation, or confirmed repair path.
- Import and migration modes still support legitimate adoption from external
  structure.
- Existing chapter, scene, epigraph, backup, and structure diagnostics remain
  coherent after the change.
- Tool responses guide users or agents to the next explicit outcome instead of
  silently mutating canonical state.
- Every canonical mutation introduced or reordered by this milestone refreshes
  project backup artifacts and operation history after successful commit, or
  documents why the affected state is non-canonical or derived.

Test strategy:

- Unit tests for missing-file planning and prune behavior by project mode.
- Integration tests for sync after deleting scene prose, epigraph files, chapter
  folders, and relationship representations in a managed project.
- Regression tests for first-time import and legacy migration behavior.

Out of scope:

- Broad sidecar deprecation.
- Relationship workflow redesign.
- New recovery snapshot implementation unless needed for diagnostics.

## M3 — Sidecar Write Boundary

Status: Accepted.

Goal: prevent generic metadata updates from rewriting structural sidecar
compatibility fields and stop sidecar-shaped files from acting as active
mutation surfaces.

Deliverables:

- Separate raw sidecar reads from sync-normalized metadata reads.
- Preserve existing structural compatibility fields during non-structural
  updates.
- Route any regeneration of structure-shaped compatibility output through named
  generated-view, review-snapshot, or recovery-snapshot workflows.
- Ensure structural mirror updates are owned by explicit structure workflows or
  named repair/regeneration flows.
- Add diagnostics or guidance when callers attempt to use generic metadata
  tools for structural outcomes.

Evidence:

- [src/sync/sync.js](../../../../src/sync/sync.js)
- [src/tools/metadata.js](../../../../src/tools/metadata.js)
- [src/tools/sync.js](../../../../src/tools/sync.js)
- [src/tools/reference-link-persistence.js](../../../../src/tools/reference-link-persistence.js)
- [src/sync/scene-character-batch.js](../../../../src/sync/scene-character-batch.js)
- [src/scripts/normalize-scene-characters.mjs](../../../../src/scripts/normalize-scene-characters.mjs)
- [src/test/unit/sync.test.mjs](../../../../src/test/unit/sync.test.mjs)
- [src/test/unit/scene-character.test.mjs](../../../../src/test/unit/scene-character.test.mjs)
- [src/test/integration/metadata.test.mjs](../../../../src/test/integration/metadata.test.mjs)
- [src/test/integration/search.test.mjs](../../../../src/test/integration/search.test.mjs)
- [src/test/integration/sync.test.mjs](../../../../src/test/integration/sync.test.mjs)
- [release-log.md](../../../../release-log.md)

Acceptance notes:

- Generic scene metadata writes now use raw/source sidecar metadata for writes,
  while normalized metadata remains available for sync and indexing.
- `update_scene_metadata` rejects `chapter_title` along with `part`,
  `chapter`, `chapter_id`, and `timeline_position`, and points callers to
  explicit structure workflows.
- Enrichment, flagging, reference-link, batch character enrichment, and
  character-normalization writes preserve existing structural sidecar
  compatibility fields during non-structural updates.
- Path-conflicting managed scene regressions cover structural field
  preservation for generic metadata, enrichment, reference-link, flagging,
  batch character enrichment, and CLI normalization workflows.
- Relationship metadata authority and broader sidecar-first write-order cleanup
  remain deferred to M4.

Acceptance gates:

- `update_scene_metadata` and related generic metadata tools cannot
  accidentally rewrite structural representations.
- Path-derived `part`, `chapter`, `chapter_id`, or `chapter_title` values are
  not mirrored by non-structural updates.
- Structural compatibility output has a named owner and is not treated as
  canonical input during daily work.
- Tests prove path-conflicting managed scenes preserve structural fields.
- Tool guidance points structural changes to explicit structure workflows.
- Existing non-structural metadata use cases remain available, or are
  explicitly marked pending M4 replacement with diagnostics and next-step
  guidance.

Test strategy:

- Unit tests for raw sidecar read helpers and normalized metadata readers.
- Unit tests for metadata update preservation of structural fields.
- Integration tests for `update_scene_metadata` on path-conflicting managed
  scenes.
- Regression tests for chapter resolution, scene assignment, move scene, and
  structure diagnostics.

Out of scope:

- Removing sidecar read compatibility.
- Redesigning character/place/reference relationship workflows.
- Changing authored prose storage.

## M4 — Outcome-Oriented Relationship Workflows

Status: Accepted.

Goal: expose relationship metadata changes through story and review outcomes
instead of storage CRUD.

Deliverables:

- Convert or add workflows for thread tracking, character/place association,
  reference linking, prose-derived metadata enrichment, metadata audit, and
  metadata repair where gaps exist.
- Ensure active relationship writes are SQLite-first, validated, and
  diagnostically clear.
- Keep compatibility files read-only, generated, import-only, or deprecated
  according to the M0 ownership matrix.
- Update `describe_workflows` and generated tool docs so AI agents choose
  outcome workflows.
- Preserve useful review/dry-run visibility through review snapshots rather
  than writable sidecars.

Implementation notes:

- `track_thread_arc`, `connect_character_place_evidence`,
  `record_character_relationship_beat`, `link_reference_evidence`, and
  `audit_relationship_metadata` provide outcome-level surfaces for the
  previously under-specified relationship families.
- `update_character_sheet` and canonical `update_place_sheet` name changes now
  commit SQLite first, refresh project backups, then refresh sidecar
  compatibility output. Place `associated_characters`, place tags, character
  tags, and scene flags are explicitly non-authoritative compatibility/review
  notes until a future migration promotes or removes them.
- `enrich_scene_characters_batch` remains a retained prose-derived repair path
  that writes scene character compatibility output before sync-index repair;
  its responses and inventory now document that retained ordering rather than
  presenting sidecars as general relationship authority.
- Broad schema migration/deprecation for sidecar-only tags, flags,
  workflow-status fields, and place associated-character fields remains M5 or a
  future focused initiative.

Evidence:

- [release-log.md](../../../../release-log.md)
- [docs/agents/tools.md](../../../agents/tools.md)
- [src/workflows/workflow-catalogue.js](../../../../src/workflows/workflow-catalogue.js)
- [src/tools/metadata.js](../../../../src/tools/metadata.js)

Acceptance gates:

- Public tools express goals such as tracking an arc, linking evidence,
  reviewing stale relationships, repairing metadata, or preparing a recovery
  snapshot.
- Relationship mutations do not require callers to understand table names such
  as `threads`, `scene_threads`, `scene_tags`, or `reference_links`.
- Active writes are SQLite-first and have clear validation and rollback
  behavior.
- Every canonical mutation introduced or reordered by this milestone refreshes
  project backup artifacts and operation history after successful commit, or
  documents why the affected state is non-canonical or derived.
- Reference-link apply workflows commit SQLite first or transactionally couple
  compatibility output with canonical writes.
- Compatibility files cannot be mistaken for current relationship authority.
- Workflow discovery steers both humans and AI agents toward outcome-level
  operations.

Acceptance notes:

- Accepted in PR [#225](https://github.com/hannasdev/mcp-writing/pull/225).
- Outcome-level relationship tools and workflow guidance now steer callers away
  from raw table-shaped relationship operations.
- Retained compatibility output is documented as generated, review-oriented, or
  migration-compatible rather than daily-work authority.

Test strategy:

- Unit tests for relationship validation and write ordering.
- Integration tests for representative thread, character/place, and reference
  link workflows.
- Regression tests for relationship workflow guidance and generated tool docs.
- Characterization tests for any retained import-only sidecar relationship
  behavior.

Out of scope:

- Broad prose editing redesign.
- Raw table maintenance tools as public MCP workflow replacements.
- New analytics features beyond relationship diagnostics needed for alignment.

## M5 — Deprecation, Migration, and Documentation

Status: Accepted.

Goal: make remaining sidecar behavior explicit, migrated, or removed from normal
workflows.

Deliverables:

- Add migration guidance for projects with existing sidecars.
- Update README, workflow docs, generated tool docs, and architecture docs where
  user-facing behavior changes.
- Add release-log coverage if tools or compatibility expectations change.
- Document which sidecar paths remain import compatibility and which are
  generated/review/recovery artifacts.
- Remove or de-emphasize docs that imply sidecars are daily-work authority.

Evidence:

- [Sidecar Compatibility and Migration](../../../guides/sidecar-compatibility.md)
- [Setup Guide](../../../guides/setup.md#sidecar-compatibility-after-setup)
- [Agent Docs](../../../agents/README.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md#snapshot-and-sidecar-roles)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md#snapshot-and-sidecar-roles)
- [Generated Tool Reference](../../../agents/tools.md)
- [release-log.md](../../../../release-log.md)

Acceptance gates:

- Product docs consistently present SQLite as canonical structural and
  relationship metadata storage.
- Any remaining sidecar support has a named compatibility role.
- Users and AI agents can understand how to migrate, review, recover, and
  continue daily work without editing sidecars as source of truth.
- Release notes describe behavior changes and migration expectations.
- Completed milestone evidence is linked from this file.

Acceptance notes:

- Accepted in PR [#226](https://github.com/hannasdev/mcp-writing/pull/226).
- Sidecar compatibility and migration guidance now explains retained import,
  generated, review, and recovery roles without presenting sidecars as
  daily-work authority.
- Setup, agent, architecture, generated tool, and release-log documentation now
  route users and AI agents toward SQLite-canonical workflows and explicit
  relationship/structure tools.

Test strategy:

- Documentation link checks where available.
- Regression tests for generated tool docs and workflow discovery.
- Integration tests for migration or compatibility paths that remain supported.
- Manual review of README, PRODUCT, architecture docs, and release-log text.

Out of scope:

- Removing Scrivener support.
- Introducing divisions.
- Replacing database backup/restore with sidecar replay.

## Related

- [prd.md](prd.md)
- [PRODUCT.md](../../../../PRODUCT.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
