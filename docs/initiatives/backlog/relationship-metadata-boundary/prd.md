# PRD: Relationship Metadata Boundary

**Status:** Deferred backlog (not active)

Created: 2026-05-28.

Related docs:
- [Product Overview](../../../../PRODUCT.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Architecture Alignment Follow-up](../../done/architecture-alignment-follow-up/prd.md)
- [Architecture Alignment Follow-up Inventory](../../done/architecture-alignment-follow-up/inventory.md)

## Goal

Close the remaining relationship-metadata authority gap left after the
Architecture Alignment Follow-up: generic scene metadata updates should no
longer be an active sidecar-first mutation path for canonical scene
relationships.

The target state is that daily relationship changes use outcome-oriented,
SQLite-first workflows, while `.meta.yaml` relationship fields remain
compatibility input, generated compatibility output, import material, or
review notes according to the Managed Structure Contract.

## Problem

Writing MCP now has outcome-level relationship tools for threads,
character/place evidence, character relationship beats, and reference evidence.
Those tools commit canonical SQLite state first, refresh project backups, and
treat sidecar/frontmatter output as generated compatibility.

One older path still blurs the boundary:

- `update_scene_metadata` accepts `characters` and `places`.
- It writes the supplied values to the scene sidecar first.
- It then reindexes `scene_characters` and `scene_places` from that sidecar
  content.

That behavior is useful for legacy compatibility, but it means a generic
metadata tool can still function as a relationship mutation surface. It is the
opposite write order from the current relationship workflows and makes it
harder for humans and AI agents to know which path owns relationship authority.

## User Value

- Authors get relationship changes that preserve intent and validation instead
  of treating sidecar lists as the interface.
- AI agents get a clearer rule: use relationship workflows for relationship
  changes, not generic metadata patching.
- Maintainers get simpler ownership reasoning when debugging stale relationship
  indexes, backups, and compatibility output.
- Future relationship work can build on a single mutation doctrine instead of
  carrying a sidecar-first exception forward.

## Design Alignment

This initiative supports the product design principles:

1. **Preserve authorship and intent:** relationship edits should say what story
   evidence changed, not just which YAML list was overwritten.
2. **Explicit structural mutation:** relationship metadata is canonical
   structured state and should move through sanctioned workflows.
3. **Stable identities:** relationship changes should reference stable
   `scene_id`, `character_id`, `place_id`, `thread_id`, and `doc_id` values.
4. **Separated artifact ownership:** sidecars should not become daily-work
   authority for canonical relationship state.
5. **Generated transparency:** compatibility sidecar output can explain or
   bridge state, but it should not define relationship truth.
6. **Import is a special mode:** sync/import can still interpret legacy
   relationship fields, but daily work should be explicit.
7. **Outcome-oriented tools:** public relationship writes should express writing
   and continuity outcomes rather than raw storage fields.

Use the Managed Structure Contract as the arbiter for every behavior change.

## Scope

In scope:

- Decide the future contract for `characters` and `places` in
  `update_scene_metadata`.
- Keep existing read/search behavior working for indexed scene relationship
  data.
- Preserve legacy import and sync compatibility for existing sidecar
  `characters` and `places` fields.
- Route daily scene-backed character/place relationship changes to
  `connect_character_place_evidence` or a deliberately named replacement.
- Update workflow guidance and generated tool documentation so agents stop
  treating sidecar lists as relationship authority.
- Refresh project backups after canonical relationship mutations, or document
  why a retained compatibility operation is non-canonical.
- Add regression tests around sidecar preservation, relationship index
  mutation order, warnings, and compatibility behavior.

Out of scope:

- Removing sidecar support wholesale.
- Removing Scrivener import, frontmatter migration, or legacy sync indexing.
- Redesigning all scene tags, versions, status, flags, character tags, place
  tags, or place associated-character notes.
- Introducing a broad relationship editor UI.
- Changing prose storage.
- Adding divisions or other manuscript structure concepts.

## Proposed Direction

The preferred direction is a staged migration:

1. Freeze the current behavior with characterization tests and document the
   public contract decision.
2. Stop `update_scene_metadata` from acting as a sidecar-first canonical
   relationship writer for `characters` and `places`.
3. Preserve legacy relationship fields as compatibility input/output and
   diagnostics.
4. Ensure outcome-level tools are sufficient for the common daily-work cases
   that `update_scene_metadata` previously covered.

There are two acceptable implementation shapes:

- **Strict contract:** reject `characters` and `places` in
  `update_scene_metadata`, similar to structural fields, and point callers to
  relationship workflows.
- **Compatibility-only contract:** allow the fields only as retained
  sidecar/review metadata and do not let that operation rebuild canonical
  relationship rows.

The strict contract is the default planning assumption because it is easiest for
agents and users to understand. The compatibility-only contract remains a
fallback if existing integrations need a softer migration, but it has an
important constraint: it must not write ordinary `characters` or `places`
sidecar fields that ordinary sync will later adopt into canonical relationship
rows. If compatibility-only behavior is chosen, it needs a review-only storage
shape that sync ignores, or an accompanying sync contract change that prevents
delayed canonical mutation.

## Workflows

### Daily Character/Place Evidence

1. Use `find_scenes`, `list_characters`, and `list_places` to identify stable
   IDs.
2. Use `connect_character_place_evidence` when a scene proves a character/place
   association.
3. Treat any sidecar refresh as generated compatibility output.
4. Use `audit_relationship_metadata` when sidecar relationship fields disagree
   with canonical indexes.

### Legacy Project Compatibility

1. Run `sync` to index existing sidecar/frontmatter relationship fields.
2. Run `audit_relationship_metadata` to classify retained compatibility notes
   and stale indexes.
3. Use outcome tools for current repairs.
4. Generate backups after meaningful canonical repair work.

### Generic Scene Metadata

`update_scene_metadata` remains useful for non-relationship editorial metadata
such as title, logline, status, beat, POV, tags, and story time. It should not
be the current path for scene-backed character/place authority.

## Acceptance Criteria

1. The public contract for `update_scene_metadata` explicitly states whether
   `characters` and `places` are rejected or compatibility-only.
2. Daily scene-backed character/place relationship changes are routed through
   outcome-level SQLite-first workflows.
3. Existing legacy sidecar/frontmatter `characters` and `places` fields remain
   indexable through sync/import compatibility paths.
4. Generic scene metadata updates no longer silently convert sidecar-first
   character/place edits into canonical relationship authority.
5. If a compatibility-only transition is chosen, later ordinary sync cannot
   convert those compatibility writes into canonical relationship rows.
6. Tool responses and workflow guidance point agents to the correct
   relationship workflow.
7. Backups and operation history stay current after canonical relationship
   mutations.
8. Tests cover old compatibility behavior, new daily-work guardrails, stale
   sidecar diagnostics, and generated documentation.

## Risks And Tradeoffs

| Risk | Impact | Mitigation / Decision Path |
| --- | --- | --- |
| Existing clients may call `update_scene_metadata` with `characters` or `places`. | Behavior change could surprise integrations. | Characterize current behavior first, then choose strict rejection or compatibility-only migration with clear error guidance. |
| Compatibility-only writes are later adopted by sync. | A delayed canonical mutation would preserve the authority leak under a different timing. | If compatibility-only is selected, use review-only metadata ignored by sync or change sync so those writes remain non-authoritative. |
| Removing the sidecar-first path may leave no bulk relationship update path. | Authors may need repetitive calls for broad relationship repair. | Keep `enrich_scene_characters_batch` for dry-run-first repair and consider a future bulk outcome workflow only if needed. |
| Sync still indexes legacy sidecar fields. | The compatibility path could be mistaken for daily authority. | Keep sync wording and audit diagnostics explicit: import/sync compatibility is not a mutation contract. |
| Tags, versions, flags, and status have adjacent ownership questions. | Scope could balloon into a broad metadata redesign. | Limit this initiative to scene character/place relationship authority; record other families as future schema/deprecation decisions. |
| Compatibility sidecar output can fail after SQLite commit. | Users may see stale files even though canonical state is current. | Preserve existing warning pattern: SQLite and backup artifacts are current; sidecar output is generated compatibility. |

## Test Strategy

Unit tests:

- `update_scene_metadata` relationship-field contract.
- Relationship index mutation behavior before and after generic metadata calls.
- Sync/import indexing of legacy sidecar `characters` and `places`.
- `audit_relationship_metadata` diagnostics for retained compatibility fields.
- Backup refresh behavior for canonical relationship workflows.

Integration tests:

- MCP tool call rejecting or demoting `characters` and `places` in
  `update_scene_metadata`.
- `connect_character_place_evidence` remains SQLite-first and refreshes
  compatibility output.
- Legacy project sync still indexes existing relationship sidecar fields.
- `describe_workflows` and generated tool docs route callers to outcome
  workflows.

Regression tests:

- `find_scenes`, `get_arc`, `get_scene_prose`, review bundles, and styleguide
  scene targeting still read relationship indexes correctly.
- Existing sidecar structural-field preservation remains intact.

## Open Questions

1. Should `update_scene_metadata` strictly reject `characters` and `places`, or
   should it retain them as compatibility-only sidecar/review metadata without
   canonical reindexing?
2. Is `connect_character_place_evidence` enough for practical daily-work
   character/place updates, or is a separate named workflow needed for
   character-only or place-only scene evidence?
3. Should scene `tags` stay in `update_scene_metadata` as search/editorial
   metadata, or should a later initiative decide whether tags need their own
   canonical ownership model?
