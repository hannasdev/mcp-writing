# PRD: Relationship Metadata Boundary

**Status:** Active — M1 selected

Created: 2026-05-28.
Activated: 2026-05-29.

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
- Treat scene `characters` and `places` metadata as sheet-backed entity
  references only. A character or place should not be promoted into scene
  relationship metadata unless it has a corresponding character or place sheet.
- Preserve the independent cardinality of scene relationship links: a scene may
  have no linked characters or places, one or more sheet-backed characters with
  no linked place, one or more sheet-backed places with no linked character, or
  both.
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

The contract decision must preserve one product rule: scene `characters` and
`places` metadata is for sheet-backed entities. Not every named person or
location in prose deserves a character or place sheet. Unmodeled mentions should
remain prose context, not relationship metadata.

Scene character and scene place links are independent optional relationships,
not a required character/place pair. `connect_character_place_evidence` covers
paired evidence, but it is not by itself a complete replacement for character-
only or place-only sheet-backed scene evidence.

Before M0 there were two acceptable implementation shapes:

- **Strict contract:** reject `characters` and `places` in
  `update_scene_metadata`, similar to structural fields, and point callers to
  relationship workflows.
- **Compatibility-only contract:** allow the fields only as retained
  sidecar/review metadata and do not let that operation rebuild canonical
  relationship rows.

M0 selects the strict contract because it is easiest for agents and users to
understand and avoids the delayed-mutation risk. The compatibility-only contract
is not selected for this initiative because it would need a review-only storage
shape that sync ignores, or an accompanying sync contract change that prevents
ordinary sidecar `characters` or `places` from becoming canonical relationship
rows later.

## M0 Contract Decision

M0 selects the **strict contract** for M1 implementation:

- `update_scene_metadata` should reject `characters` and `places` as
  relationship-boundary fields rather than storing compatibility-only values.
- Generic scene metadata writes must not mutate canonical `scene_characters` or
  `scene_places` rows immediately, and must not write ordinary sidecar fields
  that a later ordinary sync can adopt as canonical relationship rows.
- Legacy sidecar/frontmatter `characters` and `places` remain supported as
  setup, import, sync compatibility, generated compatibility output, and audit
  evidence.
- Scene `characters` and `places` represent sheet-backed entities only.
  Unsheeted named people or locations remain prose context until a deliberate
  sheet-creation workflow promotes them into the world model.
- Scene-character and scene-place links are independent optional relationships:
  a scene can have zero, one, or many sheet-backed character links and zero,
  one, or many sheet-backed place links, without requiring both sides.
- `connect_character_place_evidence` is the replacement workflow only when a
  scene proves a paired sheet-backed character/place association. Character-only
  and place-only sheet-backed scene evidence need a future deliberately named
  workflow if daily-work mutation support is required.
- `tags`, `status`, `flags`, and `versions` remain outside this initiative and
  keep their current compatibility/review/search roles until a separate
  planning decision changes them.

### M0 Guidance Inventory

Current user-facing guidance does not recommend using `update_scene_metadata`
for scene `characters` or `places`:

- `README.md` recommends `update_scene_metadata` for editorial fields such as
  beat, POV, status, and tags.
- `docs/guides/sidecar-compatibility.md` routes current relationship work to
  outcome tools and warns against direct sidecar relationship edits.
- `docs/agents/tools.md` is generated from the current tool schema and still
  exposes `characters` and `places` as accepted `update_scene_metadata` fields;
  M3 should regenerate it after M1 changes the schema and tool description.

Historical completed initiative docs still mention relationship updates through
`update_scene_metadata`, notably the completed prose-editing and metadata
architecture PRDs. Those documents are historical records rather than current
product guidance, but reviewers should be aware of them when checking for stale
public wording.

## Workflows

### Daily Character/Place Evidence

1. Use `find_scenes`, `list_characters`, and `list_places` to identify stable
   IDs.
2. Use `connect_character_place_evidence` when a scene proves a paired
   character/place association.
3. Do not add a character or place to scene metadata unless it has a
   corresponding character or place sheet. Unsheeted named people or locations
   remain prose context until a deliberate sheet-creation workflow promotes
   them.
4. Treat any sidecar refresh as generated compatibility output.
5. Use `audit_relationship_metadata` when sidecar relationship fields disagree
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

1. The public contract for `update_scene_metadata` explicitly states that
   `characters` and `places` are rejected as relationship-boundary fields.
2. Daily scene-backed character/place relationship changes are routed through
   outcome-level SQLite-first workflows.
3. Existing legacy sidecar/frontmatter `characters` and `places` fields remain
   indexable through sync/import compatibility paths.
4. Generic scene metadata updates no longer silently convert sidecar-first
   character/place edits into canonical relationship authority.
5. Generic metadata writes cannot create canonical relationship rows
   immediately or through later ordinary sync.
6. Tool responses and workflow guidance point agents to the correct
   relationship workflow.
7. Backups and operation history stay current after canonical relationship
   mutations.
8. Tests cover old compatibility behavior, new daily-work guardrails, stale
   sidecar diagnostics, and generated documentation.

## Risks And Tradeoffs

| Risk | Impact | Mitigation / Decision Path |
| --- | --- | --- |
| Existing clients may call `update_scene_metadata` with `characters` or `places`. | Behavior change could surprise integrations. | Characterize current behavior first, then implement strict rejection with clear error guidance. |
| Replacement guidance overfits to paired character/place evidence. | Scenes can validly have zero links, character-only links, place-only links, multiple characters, multiple places, or both; routing every case to a paired workflow would misrepresent the model. | M0 must state independent optional cardinality and decide whether a future character-only/place-only workflow is needed before M1 guidance changes. |
| Compatibility-only writes are later adopted by sync. | A delayed canonical mutation would preserve the authority leak under a different timing. | If compatibility-only is selected, use review-only metadata ignored by sync or change sync so those writes remain non-authoritative. |
| Callers may list unsheeted named people or locations as scene metadata. | Freeform mentions could be accidentally promoted into canonical relationship state, creating weak IDs and false authority. | State that `characters` and `places` metadata is sheet-backed only; unsheeted mentions stay in prose until deliberately promoted through sheet creation and relationship evidence. |
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

## Remaining Open Questions

1. What named workflow, if any, should handle character-only or place-only
   sheet-backed scene evidence, given that scenes can validly have either side
   independently and `connect_character_place_evidence` only covers paired
   associations?
2. Should scene `tags` stay in `update_scene_metadata` as search/editorial
   metadata, or should a later initiative decide whether tags need their own
   canonical ownership model?

## Activation Notes

- Activate M0 first; do not make production behavior changes before the
  strict-versus-compatibility contract and replacement workflow adequacy are
  decided.
- M0 preserves that scene-character and scene-place links are independent
  optional relationships. Character-only and place-only sheet-backed scene
  evidence remain a future workflow decision unless M1 adds only guidance.
- M0 should preserve the rule that scene `characters` and `places` metadata is
  only for entities with character or place sheets; unsheeted mentions remain
  prose context.
- M0 selected strict rejection, so no compatibility-only storage shape or sync
  rule is introduced.
- Generic metadata writes must not create canonical relationship changes
  immediately or after a later ordinary sync.
