# M8 Canonical Storage Direction

Status: Accepted

## Decision

SQLite is the durable canonical model for structural manuscript state.

Sidecars, folder layout, generated views, and Scrivener-compatible outputs are representation, compatibility, import, export, or recovery surfaces.
They may preserve useful human-readable state, but they must not become the daily-work authority for structural identity, ordering, or membership once a project is under MCP management.

Authored prose remains file-based and inspectable.
This decision applies to structural state such as chapter identity, chapter order, scene membership, epigraph attachment, and future divisions.

## Rationale

M7 proved that explicit MCP commands can own structural intent:

- `create_chapter`
- `rename_chapter`
- `reorder_chapter`
- `attach_epigraph`
- `move_scene`
- `assign_scene_to_chapter`

Those commands already validate against canonical `chapters`, `epigraphs`, and scene linkage rows before writing.
They also report when a visible representation, such as a source folder or sidecar field, was not moved or renamed.

That behavior matches the target architecture:

- structure changes go through sanctioned MCP workflows;
- identity is not title;
- order is not folder name;
- membership is not physical containment;
- generated views explain state but do not define it;
- import may infer, but daily work should be explicit.

Keeping sidecars as the durable structural authority would preserve easy Git diffs, but it would also keep structural invariants distributed across editable files.
That would leave human users and AI agents with too many ways to bypass the same command paths M5-M7 established.

## Artifact Ownership

| Artifact | Authority after M8 | Notes |
| --- | --- | --- |
| Authored scene prose | Prose files | Plain text remains author-facing and inspectable. |
| Authored epigraph prose | Prose files | The text is authored content; attachment to chapters is structural state. |
| Chapter identity, title, order, logline | SQLite | Mutated through sanctioned MCP commands. |
| Scene chapter membership and timeline position | SQLite | Mutated through `assign_scene_to_chapter` and `move_scene`; sidecars may mirror compatibility fields during migration. |
| Epigraph chapter attachment | SQLite | Mutated through `attach_epigraph`; source files are not moved as authority. |
| Compatibility sidecar fields | Representation or migration input | Useful for old workflows, diagnostics, import, and review, but not daily-work authority. |
| Folder layout and Scrivener sync output | Import/export representation | May imply structure during import, but should not silently override canonical state during daily work. |
| Generated docs, reports, bundles, snapshots | Generated transparency | Review and recovery aids, not normal edit surfaces. |

## Migration Strategy

### Phase 1: Freeze the Doctrine

Document SQLite as canonical for structural state.
Keep existing sidecar and folder compatibility behavior available while preventing new product work from treating those representations as authority.

Done in M8:

- decision record exists;
- artifact ownership is explicit;
- recovery and rollback expectations are documented before storage migration begins.

### Phase 2: Add Reviewable Structure Exports

Add a deterministic generated structure export for Git review and recovery.
The export should be produced from SQLite and include enough state to review structural changes without opening the database directly.

Minimum contents:

- project identity;
- chapters with IDs, titles, sort indexes, and loglines;
- scene structural links and timeline positions;
- epigraph IDs and chapter attachments;
- checksum or generated-at metadata sufficient to diagnose stale exports.

Rules:

- the export is generated from SQLite;
- editing the export does not mutate canonical state;
- recovery from the export must be an explicit repair/import workflow, not an implicit sync side effect.

### Phase 3: Tighten Sidecar Writes

Gradually reduce structural writes to sidecars to compatibility mirroring.

Expected changes:

- MCP commands continue writing SQLite first;
- compatibility fields may still be mirrored where current tools require them;
- diagnostics should flag sidecar/folder disagreement as drift, not silently treat it as the new truth;
- generic metadata paths should stop being expanded as structural mutation paths.

### Phase 4: Add Explicit Recovery Workflows

Add repair workflows that make recovery choices visible.

Required recovery paths:

- rebuild derived indexes from SQLite and prose files;
- regenerate structure exports from SQLite;
- reconstruct missing SQLite structural state from a trusted generated export when explicitly requested;
- inspect sidecar/folder-derived structure as migration input and report conflicts before applying changes.

### Phase 5: Decide Representation Deprecations

Only after review exports and recovery workflows exist, decide which compatibility fields remain, which become generated-only mirrors, and which can be deprecated.

Do not remove numeric chapter or sidecar compatibility paths until replacement workflows are documented and tested.

## Recovery Rules

If SQLite and files disagree during daily work:

1. SQLite wins for structural state.
2. Diagnostics report file-derived disagreement as drift.
3. Repair requires an explicit workflow.
4. Import may propose canonical changes, but it must not silently override existing canonical structure.

If SQLite is missing but prose files and sidecars exist:

1. Prose files remain authoritative for authored prose.
2. Sidecars and folder layout are migration inputs, not automatically trusted canonical state.
3. The preferred recovery source is the latest trusted generated structure export.
4. If no trusted export exists, recovery must run through import-style inference with warnings and explicit user approval.

If a generated structure export and SQLite disagree:

1. SQLite remains authoritative unless the user invokes an explicit restore or repair workflow.
2. Diagnostics should identify whether the export is stale before offering repair.
3. Restore should be transactional and produce a reviewable summary.

## Rollback Risks

SQLite-as-canonical introduces three important risks:

- Git diffs become less naturally readable for structural changes.
- Database loss is more serious if no structure export exists.
- Users may mistrust managed state if visible files no longer reflect the latest structure.

Mitigations:

- add deterministic structure exports before tightening sidecar authority;
- keep diagnostics clear about canonical state versus representation drift;
- preserve prose files as inspectable text;
- keep import/export adapters explicit about when they infer, mirror, regenerate, or mutate.

## Test Strategy

Storage migration work after M8 should include:

- unit tests for structure export shape and deterministic ordering;
- integration tests for command-driven structural mutations followed by export regeneration;
- diagnostics tests for SQLite/file disagreement;
- recovery tests for missing SQLite state with a trusted export;
- refusal tests for implicit sidecar or folder overrides during daily work;
- import compatibility tests for Scrivener and legacy folder inputs.

## Follow-Up Work

Create follow-up implementation slices for:

1. deterministic structure export generation;
2. structure export staleness diagnostics;
3. explicit restore or repair from trusted export;
4. tightening sidecar structural mirroring behind command paths;
5. deciding compatibility-field deprecations after replacement workflows exist.

## Related

- [Target Architecture Migration PRD](./prd.md)
- [Target Architecture Migration Milestones](./milestones.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
