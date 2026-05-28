# Relationship Metadata Boundary — Architecture Notes

**Status:** Deferred backlog (not active)

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

Outcome-level relationship workflows already commit SQLite first for current
relationship work:

- `track_thread_arc`
- `connect_character_place_evidence`
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
| `characters` and `places` in `update_scene_metadata` | Reject and route to relationship workflows. | Clearest agent/user contract and matches structural-field rejection. | Allow compatibility-only writes that do not affect canonical relationship indexes. |
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

- current scene-backed character/place relationship authority;
- SQLite-first commit;
- project backup refresh;
- generated compatibility sidecar refresh when possible.

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

If compatibility-only behavior is chosen, callers should receive:

- an explicit `compatibility_only` indicator;
- a statement that canonical relationship rows were not changed;
- next-step guidance to use `connect_character_place_evidence` for authority.

## Failure Modes

- **Stale indexed scene path:** canonical relationship tools should commit only
  after validating the scene and should warn when compatibility output cannot
  refresh.
- **Sidecar write failure after SQLite commit:** canonical state and backups
  remain current; response includes compatibility diagnostics.
- **Legacy sidecar disagreement:** sync/audit reports drift and points to
  outcome-level repair; ordinary sync does not silently decide author intent.
- **Ambiguous character or place identity:** relationship workflows reject or
  require explicit IDs instead of guessing from names.
- **Existing clients use old metadata path:** M0 decides whether to use strict
  rejection or compatibility-only migration based on compatibility risk.

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
- generated docs checks for tool guidance;
- full PR gate before merge.

## Open Questions

1. Should strict rejection happen immediately, or should compatibility-only
   behavior be used as a transition?
2. Do authors need a character-only or place-only evidence workflow, or is the
   paired `connect_character_place_evidence` workflow enough for the current
   daily-work model?
3. Should a later initiative promote scene tags to a clearer canonical schema,
   or are they intentionally retained as search/editorial metadata?
