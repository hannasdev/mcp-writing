# Setup Guide

- [Prerequisites](#prerequisites)
- [Permission contract](#permission-contract)
- [First-time setup path (recommended)](#first-time-setup-path-recommended)
- [Choosing a Scrivener path](#choosing-a-scrivener-path)
- [Quick start with Scrivener (stable default)](#quick-start-with-scrivener-stable-default)
- [Direct Scrivener project merge (beta)](#direct-scrivener-project-merge-beta)
- [Beta compatibility and fallback](#beta-compatibility-and-fallback)
- [Advanced: Native sync format](#advanced-native-sync-format)
- [Data ownership model](data-ownership.md)

---

## Prerequisites

- **Node.js 22.6.0 or later** (required for SQLite support via `--experimental-sqlite` flag)
- **npm 8.0.0 or later**
- **Git** (for edit snapshots and version history)

Verify your setup:

```sh
node --version    # should be v22.6.0 or later
npm --version     # should be 8.0.0 or later
git --version     # should be installed
```

---

## Permission contract

To keep MCP write tools reliable across local runs, Docker, and AI agents, use this contract:

1. The same non-root user should own and write the sync directory.
2. Containerized runs should use host UID/GID, not root.
3. If ownership drifts (for example root-owned files), repair once on host and continue.

Repair commands (host):

```sh
sudo chown -R "$(id -u):$(id -g)" /path/to/sync-dir
find /path/to/sync-dir -type d -exec chmod u+rwx {} +
find /path/to/sync-dir -type f -exec chmod u+rw {} +
```

You can also inspect ownership/writability status at runtime via `get_runtime_config`.

---

## First-time setup path (recommended)

If this is your first time, follow these steps in order:

1. Start with **Quick start with Scrivener** below (or use [docker.md](docker.md) if that is your preferred setup).
2. Start the server.
3. Verify the server (`/healthz` and `/sse`).
4. Run `import_scrivener_sync` with `dry_run: true` first to preview what will happen.
5. Run it again with `dry_run: false` to write files. Keep `auto_sync: true` (default) so your scenes are indexed immediately.

Once this is working, you can come back to:

- **Advanced: Native sync format** below for custom project layouts
- **[docs/tools.md](tools.md)** for the full tool catalog
- **[README.md](../README.md#usage-scenarios)** for workflow ideas

If you later want richer metadata from a full `.scriv` bundle, add the **Direct Scrivener project merge (beta)** step after the stable import has already created your scene sidecars.

---

## Choosing a Scrivener path

There are two supported Scrivener ingestion paths, and they are not equally stable.

| Path | Stability | Use when | Tooling |
| --- | --- | --- | --- |
| External Folder Sync export | Stable default | First-time setup, routine imports, safest long-term path | `import_scrivener_sync`, `import_scrivener_sync_async` |
| Direct `.scriv` project merge | Beta / opt-in | You already imported scenes and want extra metadata from Scrivener internals | `merge_scrivener_project_beta` (async) |

Recommendation:

1. Start with the stable External Folder Sync path.
2. Confirm your scene sidecars and indexing are correct.
3. Use the beta direct-merge path only if you need metadata that plain-text sync cannot provide, such as Scrivener keywords, synopsis files, or selected custom fields.

---

## Quick start with Scrivener (stable default)

If you write in [Scrivener](https://www.literatureandlatte.com/scrivener), this gives you the smoothest path to get started.

### 1. Export from Scrivener

In Scrivener, go to **File → Sync → With External Folder**. Set the format to **plain text** (`.txt`) and choose an output folder, for example `~/my-novel-txt/`.

Only `Draft/` is imported automatically.

### 2. Start mcp-writing

```sh
WRITING_SYNC_DIR=/path/to/sync-dir DB_PATH=./writing.db npm start
```

You should see:

```sh
[mcp-writing] Listening on port 3000
[mcp-writing] Sync dir: /path/to/sync-dir
[mcp-writing] DB path: ./writing.db
```

### 3. Verify the server

- Open `http://localhost:3000/healthz` and confirm it returns `ok` (plain text, no JSON).
- Open `http://localhost:3000/sse` and confirm it opens an SSE stream.

### 4. Import Draft scenes through MCP (recommended)

From your MCP client, call `import_scrivener_sync` with:

```json
{
  "source_dir": "/Users/yourname/my-novel-txt",
  "project_id": "my-novel",
  "dry_run": true
}
```

> **Note:** use a full absolute path for `source_dir`. Shell shortcuts like `~` are not expanded by Node.js.

If the preview looks right, run it again with writes enabled:

```json
{
  "source_dir": "/Users/yourname/my-novel-txt",
  "project_id": "my-novel",
  "dry_run": false,
  "auto_sync": true
}
```

The importer:

- Converts `Draft/` files to scene sidecars (`.meta.yaml`) with generated `scene_id`, `title`, `timeline_position`, `external_source`, `external_id`, and carried `save_the_cat_beat` where applicable.
- Skips beat-marker files (`-Setup-`, `-Catalyst-`, etc.), epigraphs, empty files, and files that do not match the expected `NNN Title [binder_id].txt` naming pattern.
- Reconciles updates by stable Scrivener binder ID (`[123]` in filenames) so reorder/move operations map to existing scenes.

Non-draft content is not inferred from `Notes/`. Put it directly into the target sync dir using the `world/` folder conventions described below.

### 5. Optional: CLI fallback import

If you prefer to run the import from the command line, use:

```sh
node scripts/import.js ~/my-novel-txt /path/to/sync-dir --project my-novel
```

Then call `sync` once.

### 6. Lint your metadata (optional)

```sh
node scripts/lint-metadata.mjs --sync-dir /path/to/sync-dir
```

This exits with a non-zero code if it finds errors. Warnings (for example `UNKNOWN_KEY`) are informational.

---

## Direct Scrivener project merge (beta)

Use this only after the stable import path has already created your scene sidecars.

What this beta path is for:

- pull Scrivener keywords into sidecars
- merge synopsis text from `Files/Data/<UUID>/synopsis.txt`
- carry selected Scrivener custom fields into supported scene metadata keys

What it is not for:

- first-time scene creation
- replacing `import_scrivener_sync` as the default path
- broad compatibility guarantees across all Scrivener schema variations

Recommended beta flow:

1. Run the stable `import_scrivener_sync` flow first.
2. Run the beta merge as a dry run.
3. Inspect `merge.preview_changes`, `merge.warnings`, and `merge.warning_summary`.
4. Re-run with `dry_run: false` only if the preview looks correct.

Example dry run:

```json
{
  "source_project_dir": "/Users/yourname/My Novel.scriv",
  "project_id": "my-novel",
  "dry_run": true,
  "auto_sync": false
}
```

If the preview is correct, write the merge:

```json
{
  "source_project_dir": "/Users/yourname/My Novel.scriv",
  "project_id": "my-novel",
  "dry_run": false,
  "auto_sync": true
}
```

Use `scenes_dir` instead of `project_id` when your sidecars live in a non-standard layout or under a universe/project path that you want to resolve explicitly.

---

## Beta compatibility and fallback

Current beta posture:

- Runtime requirement: Node.js 22.6.0 or newer
- Stable fallback remains: Scrivener External Folder Sync plus `import_scrivener_sync`
- Current automated bundle coverage includes a baseline `.scriv` fixture with:
  - `.scrivx` sync-number mapping
  - Scrivener keywords
  - synopsis files
  - selected custom metadata fields
  - `scenes_dir` override coverage
- Not yet declared as broadly compatible:
  - historical Scrivener versions as a published matrix
  - custom-metadata-heavy projects
  - reordered binder hierarchies beyond current fixture coverage

Treat direct `.scriv` parsing as version-fragile until the beta coverage matrix expands.

If the beta merge fails:

1. Confirm `source_project_dir` points to the `.scriv` bundle directory itself, not the `.scrivx` file.
2. Re-run with `dry_run: true` first.
3. If you get `SCRIVENER_DIRECT_BETA_FAILED`, fall back to `import_scrivener_sync` from an External Folder Sync export.

If the beta merge returns warnings:

1. `missing_bracket_id`: the sidecar filename does not contain a Scrivener sync number like `[123]`; re-import via the stable path if needed.
2. `missing_uuid_mapping`: the sidecar sync number is not present in the `.scrivx` sync map; confirm the sidecars came from the same Scrivener project/export lineage.
3. `ignored_custom_field`: the Scrivener project contains custom metadata that this beta path does not map yet.
4. `invalid_custom_field_value`: the source custom field value could not be normalized into the supported sidecar type and was ignored.

---

## Advanced: Native sync format

For projects not starting from a Scrivener export, place plain `.md` files in the sync folder directly. Metadata lives in a YAML frontmatter block.

### Scene file example

```markdown
---
scene_id: p1-ch2-sc3
title: The Arrival
part: 1
chapter: 2
characters: [elena, marcus]
places: [harbor-district]
logline: Elena arrives at the harbor and meets Marcus for the first time.
save_the_cat_beat: Setup
pov: elena
timeline_position: 4
story_time: "Day 1, morning"
tags: [first-meeting, tension]
---

Prose starts here...
```

Alternatively, metadata can live in a sidecar file named `<scene-file>.meta.yaml` alongside the prose file — useful for keeping the prose file clean.

### Project structure

```bash
/sync-root/
  /universes/
    /my-series/
      /world/
        characters/elena/sheet.md
        characters/elena/arc.md
        places/harbor-district/sheet.md
        reference/vampire-biology.md
      /book-1/
        /part-1/chapter-1/scene-001.md
  /projects/
    /standalone-novel/
      /world/
        characters/
        places/
        reference/
      /part-1/chapter-1/scene-001.md
```

Character/place folders use one canonical sheet file for entity indexing:

- `world/characters/<slug>/sheet.md` or `sheet.txt`
- `world/places/<slug>/sheet.md` or `sheet.txt`

Additional files in the same folder are treated as support notes, not separate entities.

Universe-level characters and places are shared across all books in that universe. Standalone projects are fully isolated.

### Scaffolding templates

Use the scaffold script to create a canonical character or place folder:

```sh
npm run new:entity -- --sync-dir /path/to/sync-root --kind character --scope universe --universe my-series --name "Mira Nystrom"
```

```sh
npm run new:entity -- --sync-dir /path/to/sync-root --kind place --scope project --project standalone-novel --name "University Hospital"
```

> **Note:** The scaffold script only supports standalone projects (`--scope project` without a slash). For book-local entities under `universes/<universe>/<project>/world/`, use `create_place_sheet` and `create_character_sheet` tools or create the folders manually.

This creates:

- `world/characters/<slug>/sheet.md` plus `arc.md` for character arcs
- `world/places/<slug>/sheet.md` for places
- `sheet.meta.yaml` with the required entity ID and starter fields

Generated Markdown follows one formatting contract so scaffolded files are predictable to edit:

- the first line is a top-level title (`# Name`)
- every heading is followed by a blank line
- every generated `.md` file ends with a trailing blank line

Use `--dry-run` to preview the path without writing files.

You can also create canonical sheets directly through the MCP server with `create_character_sheet` and `create_place_sheet`, then move your existing raw notes into the generated folders.

Recommended workflow:

1. Scaffold the entity folder and canonical sheet.
2. Fill in the metadata fields you care about first.
3. For characters, fill in `arc.md` as a separate arc-analysis document.
4. Add any other nearby notes like `relationships.md` or `history.md` as needed.
5. Run `sync` to index the new entity.
