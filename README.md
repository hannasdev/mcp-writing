# mcp-writing

An MCP service for AI-assisted reasoning and editing on long-form fiction projects.

Designed to work with [OpenClaw](https://github.com/openclaw/openclaw) but compatible with any MCP-capable AI gateway.

## What it does

Instead of feeding an entire manuscript to an AI and hoping it fits in the context window, `mcp-writing` builds a structured index from your scene files. The AI queries that index first — finding relevant characters, beats, and loglines — then loads only the specific prose it needs.

**Phase 1:** Read-only analysis. Ask questions about your project.
**Phase 2:** Metadata write-back. Answers stay accurate as the manuscript evolves.
**Phase 3 (current):** AI-assisted prose editing with confirmation and version history.

## Quick start with Scrivener

If you write in [Scrivener](https://www.literatureandlatte.com/scrivener), you can seed `mcp-writing` from a Scrivener external-sync export for scene prose, then curate non-draft content directly into the target folder structure.

### 1. Export from Scrivener

In Scrivener: **File → Sync → With External Folder**. Set the format to **plain text** (`.txt`) and pick an output folder, for example `~/my-novel-txt/`. `mcp-writing` imports the `Draft/` folder automatically.

### 2. Import into mcp-writing

```sh
node scripts/import.js ~/my-novel-txt /path/to/sync-dir --project my-novel
```

The importer:

- Converts `Draft/` files to scene sidecars (`.meta.yaml`) with auto-generated `scene_id`, `title`, `part`, `chapter`, and `save_the_cat_beat` fields derived from the filename/structure.
- Skips beat-marker files (`-Setup-`, `-Catalyst-`, etc.), chapter-intro files, epigraphs, and trashed files.

Non-draft content is not inferred from `Notes/`. Put it directly into the target sync dir using the `world/` folder conventions described below.

### 3. Start the server

```sh
WRITING_SYNC_DIR=/path/to/sync-dir DB_PATH=./writing.db npm start
```

Then call the `sync` tool once to index everything.

### 4. Lint your metadata (optional)

```sh
node scripts/lint-metadata.mjs --sync-dir /path/to/sync-dir
```

Exits non-zero if any errors are found. Warnings (e.g. `UNKNOWN_KEY`) are informational only.

---

## Native sync format

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

Yes, a template is helpful here. It keeps the canonical metadata fields consistent, lowers the friction of adding a new character or place, and reduces the chance that a file is created in the right folder but missing the fields needed for indexing.

Use the scaffold script to create a canonical character or place folder:

```sh
npm run new:entity -- --sync-dir /path/to/sync-root --kind character --scope universe --universe my-series --name "Mira Nystrom"
```

```sh
npm run new:entity -- --sync-dir /path/to/sync-root --kind place --scope project --project my-series/book-1 --name "University Hospital"
```

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

---

## Available tools

| Tool | Description |
| --- | --- |
| `sync` | Re-scan the sync folder and update the index |
| `find_scenes` | Filter scenes by character, beat, tag, part, chapter, or POV |
| `get_scene_prose` | Load the full prose for a specific scene |
| `get_chapter_prose` | Load all prose for a chapter |
| `get_runtime_config` | Show the active sync dir, DB path, and runtime capabilities |
| `get_arc` | Ordered scene metadata for all scenes involving a character |
| `list_characters` | All characters, optionally filtered by project or universe |
| `get_character_sheet` | Full character metadata, traits, notes, and support notes |
| `create_character_sheet` | Create a canonical character sheet folder and sidecar |
| `list_places` | All places |
| `get_place_sheet` | Full place metadata, tags, associated characters, notes, and support notes |
| `create_place_sheet` | Create a canonical place sheet folder and sidecar |
| `search_metadata` | Full-text search across scene titles and loglines |
| `list_threads` | All subplot threads for a project |
| `get_thread_arc` | Scenes belonging to a thread, with per-thread beat |
| `upsert_thread_link` | Create/update a thread and link it to a scene |
| `enrich_scene` | Re-derive lightweight metadata from current prose and clear `metadata_stale` |
| `update_scene_metadata` | Write metadata fields back to a scene sidecar |
| `update_character_sheet` | Write fields back to a character sidecar |
| `flag_scene` | Mark a scene with a flag for AI follow-up |
| `propose_edit` | Stage a scene revision for review without writing it |
| `commit_edit` | Apply a staged prose edit and create a git-backed snapshot |
| `discard_edit` | Discard a pending staged prose edit |
| `snapshot_scene` | Create a manual git snapshot for a scene |
| `list_snapshots` | List snapshot history for a scene |

Paginated tools (`find_scenes`, `get_arc`, `list_threads`, `get_thread_arc`, `search_metadata`) accept `page` and `page_size` arguments and return `total_count` / `total_pages` in the response envelope.

---

## Running with Docker

```yaml
# docker-compose.yml snippet
writing-mcp:
  build: .
  environment:
    WRITING_SYNC_DIR: /sync
    DB_PATH: /data/writing.db
    HTTP_PORT: "3000"
  volumes:
    - /path/to/sync-dir:/sync
    - writing-mcp-data:/data
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 30s
    timeout: 5s
    retries: 5

volumes:
  writing-mcp-data:
```

Then register in your OpenClaw config:

```json
"mcp": {
  "servers": {
    "writing": { "url": "http://writing-mcp:3000/sse" }
  }
}
```

## Running locally

```sh
npm install
WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

## Development

```sh
npm install
npm test           # unit + integration tests
npm run test:unit  # unit tests only (no server required)
npm run lint:metadata      # lint metadata in WRITING_SYNC_DIR or ./sync
```

Unit tests use an in-memory SQLite database and temporary directories — no server needed. Integration tests generate a fixture sync tree at runtime in temporary directories, spawn a real server on port 3099, and verify all MCP tools end-to-end.

For real projects, keep your manuscript sync folder outside this tool repository and point `WRITING_SYNC_DIR` at that external path.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `WRITING_SYNC_DIR` | `./sync` | Path to the sync folder |
| `DB_PATH` | `./writing.db` | Path to the SQLite index database |
| `HTTP_PORT` | `3000` | Port for the MCP SSE endpoint |
| `MAX_CHAPTER_SCENES` | `10` | Maximum scenes returned by `get_chapter_prose` |
| `DEFAULT_METADATA_PAGE_SIZE` | `20` | Default page size for paginated tools |

## License

MIT
