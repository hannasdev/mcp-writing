# Backup and Recovery

Writing MCP stores authored prose as files in `WRITING_SYNC_DIR`, while SQLite is the canonical store for project structure and metadata that cannot safely be reconstructed from prose alone.
Project backup artifacts make that SQLite-canonical state reviewable and recoverable without turning generated files into the normal mutation surface.

## What to Back Up

Keep all three layers protected:

| Layer | Default location | Why it matters |
| --- | --- | --- |
| Prose and sidecars | `WRITING_SYNC_DIR` | Authored manuscript files, sidecar metadata, generated review/export artifacts, and Git history |
| Project backup artifacts | `WRITING_SYNC_DIR/project-backups/<project_id>/` | Git-reviewable recovery input for SQLite-canonical project state |
| Runtime database | `DB_PATH` or Docker `/data` | Live SQLite database used by the MCP server |

Project backup artifacts are useful with Git, but they are not a substitute for filesystem or volume backups.
For Docker and homeserver deployments, back up both `/sync` and `/data`; see [Docker Setup](docker.md#backup-checklist).

Backup artifacts are manuscript-sensitive.
They do not include authored scene or epigraph prose bodies, but they may include titles, summaries, tags, relationship notes, reference summaries, and structural metadata.
Commit or push them only to repositories you trust.

## Generate a Project Backup

Run `export_project_backup` for the target project:

```json
{
  "project_id": "test-novel"
}
```

By default this writes:

- `project-backups/<project_id>/manifest.json`
- `project-backups/<project_id>/canonical.snapshot.json`
- `project-backups/<project_id>/operations.jsonl`

After ordinary sanctioned project mutations, Writing MCP refreshes the backup bundle automatically when it can.
Automatic refresh does not create Git commits.
Review the generated diff and commit it intentionally with the prose or metadata change it explains.

Do not edit files under `project-backups/` as a way to change manuscript state.
They are generated transparency and explicit recovery input only.

## Check Backup Health

Run `diagnose_project_backups` before trusting a bundle for recovery:

```json
{
  "project_id": "test-novel"
}
```

Diagnostics report whether the bundle is missing, partial, wrong-project, incompatible, tampered, unreadable, stale, or current.
A stale backup is not automatically invalid for restore; it means the backup differs from the current SQLite state, and restore planning will show the create, update, delete, and unchanged changes that would result.

## Restore Workflow

Restore is explicit and dry-run-first.
Start with:

```json
{
  "project_id": "test-novel",
  "dry_run": true
}
```

The dry run validates the trusted backup bundle and returns a deterministic plan plus a `current_snapshot_checksum`.
Review the plan before applying it, especially:

- `delete` changes, which remove current SQLite records absent from the backup
- `cross_scope` changes, which affect universe-scoped records represented by the project backup
- any `refused` or conflict diagnostics

To apply a trusted plan with deletes:

```json
{
  "project_id": "test-novel",
  "dry_run": false,
  "expected_current_snapshot_checksum": "<current_snapshot_checksum from the reviewed dry run>",
  "confirm_destructive": true
}
```

If the plan includes universe-scoped changes, also pass:

```json
{
  "confirm_cross_scope": true
}
```

Restore applies SQLite changes in one transaction.
If the write fails, the database is rolled back.
After a successful restore, run `sync`, `diagnose_project_backups`, and `export_project_backup` to regenerate derived indexes and refresh generated backup transparency.

## Failure Handling

- Missing or partial bundle: run `export_project_backup` from a healthy database or restore the backup files from Git or filesystem backup.
- Tampered or checksum mismatch: do not restore; regenerate or choose a trusted committed bundle.
- Incompatible schema: use a compatible server version or regenerate the bundle with the current version before restoring.
- Missing prose or reference files: restore the referenced files under `WRITING_SYNC_DIR`, then retry the dry run.
- Read-only runtime: restore requires a writable sync/runtime configuration when `dry_run=false`.

## Docker and Homeserver Notes

App-level project backups protect SQLite-canonical project state in a Git-reviewable form.
They complement the deployment backups described in [Docker Setup](docker.md#backup-checklist):

- `/sync` contains prose, sidecars, Git state, generated exports, and project backup artifacts.
- `/data` contains the live SQLite database and must be included in volume or filesystem backups.
- A Git remote helps protect `/sync`, but it does not protect `/data`.

Before upgrades, make sure `/sync` and `/data` have a recent backup.
After upgrades or restores, verify `/healthz`, `get_runtime_config`, a small read-only MCP call, and project backup diagnostics before resuming write workflows.
