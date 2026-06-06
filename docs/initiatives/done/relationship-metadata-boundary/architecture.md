# Relationship Metadata Boundary — Architecture Notes

**Status:** Done

## Context

The target architecture says the manuscript is a domain model with prose
attachments, not a folder tree with metadata sprinkled around it. Structural
and relationship state should be mutated through sanctioned MCP workflows.
Sidecars, frontmatter, generated exports, and backups can explain, migrate, or
recover state, but they should not become competing daily-work authority.

The Architecture Alignment Follow-up closed several known gaps:

- managed sync preserves canonical structure when filesystem representations
  disappear;
- generic metadata updates preserve structural sidecar compatibility fields;
- relationship workflows now exist for threads, character/place evidence,
  character relationship beats, and reference evidence;
- sidecar compatibility roles are documented.

The remaining boundary issue is narrower: `update_scene_metadata` can still
write scene `characters` and `places` to sidecars before SQLite relationship
indexes are refreshed from those files.

## Current State

### Canonical Relationship State

Canonical or indexed relationship state currently includes:

- `scene_characters`
- `scene_places`
- `threads`
- `scene_threads`
- `character_relationships`
- `reference_links`

Scene character/place relationship metadata is for sheet-backed entities. A
named person or location mentioned in prose should not become a canonical scene
relationship unless it has a corresponding character or place sheet. Unsheeted
mentions remain prose context or review material until a deliberate workflow
promotes them into the world model.

Scene-character and scene-place links are independent optional relationships. A
scene can validly have no linked characters or places, one or more linked
characters without a linked place, one or more linked places without a linked
character, or both. The model should not require paired character/place
evidence.

Outcome-level relationship workflows already commit SQLite first for current
relationship work, but the current character/place evidence coverage is not yet
complete for independent one-sided links:

- `track_thread_arc`
- `connect_character_place_evidence` for paired character/place evidence
- `record_character_relationship_beat`
- `link_reference_evidence`
- `suggest_scene_references` in apply mode

### Compatibility State

Scene sidecar/frontmatter fields such as `characters` and `places` remain
useful as:

- import compatibility input;
- legacy sync input;
- generated compatibility output;
- review or migration evidence when audited.

They should not be the normal daily-work mutation surface once a project is
managed through MCP.

### Problematic Flow

The current generic metadata flow is:

1. Caller invokes `update_scene_metadata` with `characters` or `places`.
2. The tool reads raw source metadata.
3. The tool writes the supplied fields to `.meta.yaml`.
4. The tool normalizes and reindexes the scene.
5. `scene_characters` and `scene_places` are rebuilt from the sidecar-derived
   values.

This makes sidecar data the write authority for that operation.

## Target Shape

Daily relationship writes should follow this shape:

1. Caller expresses relationship intent through an outcome tool.
2. The MCP validates stable IDs and project scope.
3. SQLite canonical/indexed relationship rows commit first.
4. Project backup artifacts and operation history refresh after commit.
5. Sidecar/frontmatter compatibility output refreshes only as generated
   transparency.
6. Compatibility output failure is reported as a warning, not as canonical
   rollback.

Generic scene metadata updates should not mutate canonical relationship rows
through sidecar-first writes.

## Decisions To Make

| Decision | Preferred Direction | Rationale | Alternative |
| --- | --- | --- | --- |
| `characters` and `places` in `update_scene_metadata` | M0 selected strict rejection for M1. | Clearest agent/user contract, matches structural-field rejection, and avoids delayed canonical mutation through ordinary sync. | Compatibility-only writes would require a review-only storage shape or sync-rule change; M0 does not select that path. |
| Scene character/place cardinality | Preserve independent optional links. | Scenes do not always have sheet-backed characters or places, and a valid scene can have one side without the other. | Treat character/place evidence as a required pair, which would misrepresent common manuscript cases. |
| One-sided scene relationship workflows | Add `connect_scene_character_evidence` and `connect_scene_place_evidence` after M3 guidance is corrected. | The model permits independent character and place links, so daily-work writes need explicit outcome tools that do not fabricate a pair. | Defer the gap to backlog, which would leave the initiative closing one authority leak while preserving a missing replacement path. |
| Unsheeted people or locations in scene metadata | Do not treat them as relationship metadata. | Scene relationship authority should reference stable, sheet-backed entity IDs rather than freeform prose mentions. | A future review-note or entity-promotion workflow could capture candidates without indexing them as canonical relationships. |
| Legacy sync handling | Preserve indexing from existing sidecar/frontmatter fields. | Import is a special mode and existing projects need continuity. | Require an explicit migration before indexing legacy relationship fields. |
| Backup refresh | Refresh backups after canonical relationship workflows, not after compatibility-only writes. | Recovery snapshots should represent canonical state. | Refresh backup after all sidecar metadata writes, even if non-canonical. |
| Diagnostic owner | Use `audit_relationship_metadata` for authority/drift guidance. | Keeps repair reasoning in an outcome-oriented workflow. | Add a new diagnostic tool just for character/place sidecars. |

## Contracts And Boundaries

### `update_scene_metadata`

Allowed daily-work role:

- non-relationship editorial scene metadata;
- compatibility/review metadata only where explicitly retained;
- no prose mutation;
- no structural mutation.

Disallowed daily-work role:

- scene-backed character/place authority mutation;
- chapter, epigraph, or ordering mutation;
- raw table-shaped relationship editing.

### `connect_character_place_evidence`

Owned role:

- current scene-backed, sheet-backed paired character/place evidence authority;
- SQLite-first commit;
- project backup refresh;
- generated compatibility sidecar refresh when possible.

Boundary:

- not a universal replacement for every freeform `characters` or `places` list;
- not a complete replacement for independent character-only or place-only
  sheet-backed scene links;
- not responsible for unsheeted people or locations that appear only in prose;
- must not be documented as the daily-work path for one-sided scene evidence.

### One-Sided Scene Evidence Workflows

Owned role:

- `connect_scene_character_evidence` records sheet-backed character evidence for
  a scene without requiring a place;
- `connect_scene_place_evidence` records sheet-backed place evidence for a scene
  without requiring a character;
- SQLite-first commit;
- project backup refresh;
- generated compatibility sidecar refresh when possible.

Boundary:

- require stable `scene_id` plus a stable sheet-backed `character_id` or
  `place_id`;
- do not create character or place sheets from freeform prose mentions;
- do not delete the other side of an existing relationship set;
- when compatibility output refreshes, regenerate the full scene `characters`
  and `places` compatibility representation from canonical indexes rather than
  preserving stale legacy sidecar values as authority;
- do not replace bulk repair, unlink/delete, or entity-promotion workflows.

### Sync And Import

Owned role:

- interpret legacy sidecar/frontmatter relationship fields;
- populate indexes from compatibility input;
- diagnose drift and stale representations;
- avoid hidden canonical repair in ordinary managed-project sync.

### Generated Compatibility Output

Owned role:

- help external tools and older workflows inspect or bridge state;
- remain non-authoritative;
- fail independently from canonical commit success.

## Migration And Compatibility

Existing projects can keep sidecar `characters` and `places` fields. The
initiative should not require a data migration before existing material remains
searchable.

The migration is behavioral:

- current relationship changes should stop using generic metadata writes;
- docs and workflow guidance should route callers to relationship tools;
- paired evidence should route to `connect_character_place_evidence`, while
  character-only and place-only evidence should route to
  `connect_scene_character_evidence` and `connect_scene_place_evidence`;
- audit diagnostics should help identify retained sidecar fields and stale
  relationship indexes;
- generated compatibility output can continue as long as it is labeled
  non-authoritative.

If strict rejection is chosen, callers that still send `characters` or `places`
to `update_scene_metadata` should receive:

- a stable validation error code;
- the blocked fields;
- replacement tools and suggested sequence;
- no sidecar or SQLite mutation.

M0 selected strict rejection for M1. Compatibility-only behavior is not selected
because writing ordinary sidecar `characters` or `places` would risk delayed
canonical mutation through ordinary sync unless paired with a separate ignored
storage shape or sync-rule change.

If a future compatibility-only behavior is reconsidered, callers should receive:

- an explicit `compatibility_only` indicator;
- a statement that canonical relationship rows were not changed;
- next-step guidance to use the appropriate relationship workflow for
  authority: `connect_character_place_evidence` for paired evidence,
  `connect_scene_character_evidence` for character-only evidence, or
  `connect_scene_place_evidence` for place-only evidence.

Compatibility-only behavior must not write ordinary `characters` or `places`
sidecar fields that existing sync treats as relationship input unless sync is
changed in the same milestone to keep those fields non-authoritative for that
path. Otherwise the canonical mutation is merely delayed until the next sync.

## Failure Modes

- **Stale indexed scene path:** canonical relationship tools should commit only
  after validating the scene and should warn when compatibility output cannot
  refresh.
- **Sidecar write failure after SQLite commit:** canonical state and backups
  remain current; response includes compatibility diagnostics.
- **Legacy sidecar disagreement:** sync/audit reports drift and points to
  outcome-level repair; ordinary sync does not silently decide author intent.
- **Compatibility-only delayed mutation:** M0 avoids this by selecting strict
  rejection. If a future compatibility-only path is reconsidered, retained
  review metadata must use a shape that sync does not consume or include a sync
  rule that prevents adoption as canonical relationship rows.
- **Ambiguous character or place identity:** relationship workflows reject or
  require explicit IDs instead of guessing from names.
- **Paired workflow overreach:** guidance that routes one-sided evidence through
  `connect_character_place_evidence` misrepresents the model; M3 must keep docs
  precise and M4 must add one-sided workflows.
- **Existing clients use old metadata path:** M0 selected strict rejection for
  M1; the implementation should provide a stable error and replacement
  guidance.

## Safety Considerations

- Continue routing file writes through filesystem-boundary helpers.
- Do not widen raw filesystem mutation permissions.
- Avoid destructive relationship deletes unless a future explicit repair
  workflow is planned and reviewed.
- Keep backup/restore authority tied to canonical SQLite snapshots, not edited
  sidecars.

## Validation

Required validation should combine:

- unit tests for tool contract and DB mutation behavior;
- integration tests through MCP tool calls;
- sync/import compatibility tests for legacy sidecar fields;
- paired, character-only, and place-only relationship workflow tests;
- generated docs checks for tool guidance;
- full PR gate before merge.

## Remaining Open Questions

1. Should a later initiative promote scene tags to a clearer canonical schema,
   or are they intentionally retained as search/editorial metadata?
