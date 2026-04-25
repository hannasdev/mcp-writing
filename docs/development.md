# Development & Troubleshooting

- [Running locally](#running-locally)
- [Verify your setup](#verify-your-setup)
- [Development](#development)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Running locally

```sh
npm install
WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

The `npm start` script automatically includes the `--experimental-sqlite` flag needed for SQLite support in Node.js 22+.

---

## Verify your setup

After starting the server, test that it's working:

```sh
# In a new terminal
curl http://localhost:3000/healthz
# Should return: ok
```

Then test the MCP endpoint:

```sh
curl http://localhost:3000/sse
# Should return a stream endpoint: /message?sessionId=<id>
```

If both return successfully, the server is ready to use.

---

## Development

```sh
npm install
npm test           # unit + integration tests
npm run test:unit  # unit tests only (no server required)
npm run lint:metadata      # lint metadata in WRITING_SYNC_DIR or ./sync
```

Unit tests use an in-memory SQLite database and temporary directories — no server needed. Integration tests generate a fixture sync tree at runtime in temporary directories, spawn a real server on port 3099, and verify all MCP tools end-to-end.

For real projects, keep your manuscript sync folder outside this tool repository and point `WRITING_SYNC_DIR` at that external path.

For manual Scrivener import and merge verification with real project data, keep both the copied `.scriv` bundle and the generated temp sync output outside the repository too. The current local convention is `$HOME/.mcp-writing-manual-data/`, and the reusable runner is `npm run manual:realtest -- --source-dir <external-sync-dir> --scriv-path <external-copied-project.scriv> --project-id <project-id>`.

Maintainers: see `MAINTAINERS.md` for release and operational setup notes, and `AGENTS.md` for persistent workflow conventions and release/recovery guidance.

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `WRITING_SYNC_DIR` | `./sync` | Path to the sync folder |
| `DB_PATH` | `./writing.db` | Path to the SQLite index database |
| `HTTP_PORT` | `3000` | Port for the MCP SSE endpoint |
| `MAX_CHAPTER_SCENES` | `10` | Maximum scenes returned by `get_chapter_prose` |
| `DEFAULT_METADATA_PAGE_SIZE` | `20` | Default page size for paginated tools |
| `OWNERSHIP_GUARD_MODE` | `warn` | Startup ownership policy: `warn` logs drift, `fail` exits when sampled files are not owned by runtime user |

---

## Troubleshooting

### "Module not found: sqlite" or "Database support not available"

Your Node.js version is too old, or SQLite support was not started with the required flag.

Fix:

1. Run `node --version` and confirm v22.6.0 or newer.
2. Upgrade Node.js if needed.
3. Restart with `npm start` (the script already includes `--experimental-sqlite`).

### "EADDRINUSE: address already in use :::3000"

Port 3000 is already in use.

Fix: start on a different port.

```sh
HTTP_PORT=3001 WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

Then update your MCP client config to use `http://localhost:3001/sse`.

### "ENOENT: no such file or directory, open './writing.db'"

The directory for `DB_PATH` does not exist.

Fix: create the directory first.

```sh
mkdir -p $(dirname ./writing.db)  # if using a subdirectory
WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

Or use an absolute path:

```sh
WRITING_SYNC_DIR=~/my-manuscript DB_PATH=~/writing-data/writing.db npm start
```

### "Sync dir not found: ./my-manuscript"

The `WRITING_SYNC_DIR` path does not exist.

Fix: create it (or point to an existing sync folder).

```sh
mkdir -p ./my-manuscript/projects/my-novel
WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

### "Import failed: unrecognized format"

Scrivener export is not plain text (`.txt`) or folder layout is unexpected.

Fix:

1. In Scrivener, re-export with **File → Sync → With External Folder**
2. Ensure the format is set to **Plain text** (not RTF or .docx)
3. Verify the export folder has a `Draft/` subdirectory with `.txt` files
4. Try the import again: `node scripts/import.js ~/my-novel-txt /path/to/sync-dir --project my-novel`

### "SCRIVENER_DIRECT_BETA_FAILED"

The beta direct-merge path could not parse or reconcile the `.scriv` project safely.

Common causes:

1. `source_project_dir` points to the wrong path
2. the `.scriv` bundle has no `.scrivx` file at its root
3. the bundle layout differs from the currently tested beta fixture shape
4. existing sidecars were not created from the same Scrivener project lineage

Fix:

1. Confirm you passed the `.scriv` directory path itself.
2. Re-run `merge_scrivener_project_beta` with `dry_run: true` and poll the job with `get_async_job_status` to inspect `result.merge.warnings` / `result.merge.warning_summary` if present.
3. If the parser still fails, use the stable fallback path: External Folder Sync plus `import_scrivener_sync`.

Beta direct parsing is intentionally opt-in. A parser/schema mismatch should not block the stable sync-folder workflow.

### Tests fail after updating Node.js

Local install state may be stale after the Node.js change.

Fix: reinstall dependencies.

```sh
rm -rf node_modules package-lock.json
npm install
npm test
```

### `preview_review_bundle` or `create_review_bundle` returns warnings about stale metadata

One or more scenes have `metadata_stale: true`, meaning their prose changed after metadata was last indexed.

In `strictness=warn` mode (default), the bundle is generated with a warning in the response and manifest.

In `strictness=fail` mode, generation is blocked and the response includes a `blockers` list with the affected `scene_ids`.

Fix: re-enrich each stale scene before generating the bundle. In `strictness=fail` mode, use the `scene_ids` returned in `strictness_result.blockers` and call `enrich_scene` for each one so metadata is re-derived and the stale flag is cleared.

```json
{ "tool": "enrich_scene", "scene_id": "sc-001-example" }
```

If prose or sidecars were edited outside this server, run a full sync first to refresh the index:

```json
{ "tool": "sync" }
```

Then run `enrich_scene` for stale scenes and retry bundle generation.

### `create_review_bundle` returns warnings about missing ordering fields

Some scenes are missing `part`, `chapter`, or `timeline_position` metadata. Deterministic ordering falls back to alphabetical `scene_id` sort for those scenes, and a `missing_ordering_fields` warning is included in the response.

In `strictness=warn` mode, the bundle is generated with the fallback ordering applied.

In `strictness=fail` mode, generation is currently not blocked by missing ordering fields alone — only stale metadata triggers a hard block. If you need strict ordering guarantees, update the affected scenes via `update_scene_metadata` before generating.

Fix: use `find_scenes` to identify scenes with null ordering fields, then update them:

```json
{
	"tool": "update_scene_metadata",
	"project_id": "my-project",
	"scene_id": "sc-001-example",
	"fields": {
		"part": 1,
		"chapter": 2,
		"timeline_position": 3
	}
}
```

### `create_review_bundle` writes no files / `INVALID_OUTPUT_PATH`

The `output_dir` path may be outside `WRITING_SYNC_DIR`, or the `bundle_name` contains characters that resolve outside the output directory.

Fix:

1. Verify that `output_dir` is an absolute path pointing to a writable location inside the manuscript sync folder (`WRITING_SYNC_DIR`).
2. You do not need to create the output directory first; the tool creates it if it does not already exist.
3. Use a simple `bundle_name` with alphanumeric characters and hyphens — special characters are slugified to a safe name, and if nothing usable remains the tool falls back to `review-bundle`.
