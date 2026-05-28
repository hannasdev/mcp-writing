# Sidecar Compatibility and Migration

This guide explains how to work with existing `.meta.yaml` sidecars now that
Writing MCP treats SQLite as canonical for structural and relationship
metadata.

Sidecars are still supported. They are no longer the daily-work source of truth
for structure or relationships once a project is managed by Writing MCP.

## Current Authority Model

| Metadata area | Current daily-work authority | Sidecar role |
| --- | --- | --- |
| Scene identity and import linkage | SQLite after import/sync | Import compatibility input and generated compatibility output |
| Chapter placement, chapter titles, ordering, epigraph links | SQLite via explicit structure tools | Generated compatibility output and drift signal |
| Thread beats | SQLite via `track_thread_arc` | Deprecated/import compatibility input |
| Scene character/place evidence | SQLite via `connect_character_place_evidence` and sync indexes | Compatibility input/output; retained batch repair output |
| Character relationship beats | SQLite via `record_character_relationship_beat` | No active sidecar authority |
| Reference links | SQLite via `link_reference_evidence` or reference suggestion apply workflows | Generated compatibility output and legacy alias input |
| Character/place names and profile fields | SQLite via sheet update tools | Generated compatibility output |
| Scene flags, scene status, character tags, place tags, place associated characters | Retained compatibility/review metadata | Review notes until a future schema migration or deprecation decision |
| Authored prose and support notes | Filesystem prose files | Not sidecar metadata |

## Migration Posture

Existing projects do not need a one-time manual sidecar rewrite to keep working.
Use this migration posture instead:

1. Run `sync` after upgrading so SQLite indexes and compatibility diagnostics
   reflect the current project.
2. Run `describe_workflows` to choose the outcome workflow for the task.
3. Use explicit structure tools for chapter, scene placement, and epigraph
   changes: `list_chapters`, `assign_scene_to_chapter`, `move_scene`,
   `rename_chapter`, `reorder_chapter`, and `attach_epigraph`.
4. Use relationship outcome tools for story metadata:
   `track_thread_arc`, `connect_character_place_evidence`,
   `record_character_relationship_beat`, `link_reference_evidence`, and
   `audit_relationship_metadata`.
5. Treat sidecar-only flags, tags, status, and associated-character notes as
   compatibility/review notes. Do not rely on them as canonical relationship
   authority unless a future release promotes the field into SQLite.
6. Use `diagnose_structure`, `audit_relationship_metadata`, and
   `diagnose_project_backups` before repair or recovery work.

## What Not To Do

- Do not edit sidecar chapter, order, thread, character/place relationship, or
  reference-link fields as the normal way to change a managed project.
- Do not treat generated sidecars, structure exports, review bundles, or project
  backups as competing sources of truth.
- Do not use Scrivener import conventions as daily mutation rules after the
  import has established canonical state.

## Supported Compatibility Paths

The following sidecar paths remain intentionally supported:

- Scrivener External Folder Sync import can create scene sidecars and seed
  canonical state.
- Direct `.scriv` merge can add Scrivener-derived compatibility metadata after
  the stable import path has created matching sidecars.
- Frontmatter and legacy sidecars can seed or refresh indexes during setup,
  import, legacy migration, and named repair workflows.
- Some tools refresh sidecar-shaped files as generated compatibility output so
  existing projects and external tools remain inspectable during migration.

## Recovery and Review

For review and recovery, prefer generated artifacts that are explicitly labeled
for that purpose:

- `export_structure_snapshot` creates a structure export for Git review and
  explicit structure recovery.
- `export_project_backup` creates a broader recovery snapshot with
  `manifest.json`, `canonical.snapshot.json`, and advisory `operations.jsonl`.
- `restore_structure_from_export` and `restore_project_from_backup` are explicit
  dry-run-first restore workflows. Editing generated files does not mutate
  current project state.

## Future Deprecation Boundaries

No sidecar file type is removed by this guide. Remaining sidecar-only fields are
documented so future work can make focused decisions:

- promote a field to SQLite when it has durable product value;
- keep it as compatibility/review metadata when it is useful but not canonical;
- deprecate it when outcome workflows or generated snapshots replace the need.
