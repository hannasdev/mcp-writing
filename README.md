# mcp-writing

An MCP service for AI-assisted reasoning and editing on long-form fiction projects.

Designed to work with [OpenClaw](https://github.com/openclaw/openclaw) but compatible with any MCP-capable AI gateway.

## What it does

Instead of feeding an entire manuscript to an AI and hoping it fits in the context window, `mcp-writing` builds a structured index from your scene files. The AI queries that index first — finding relevant characters, beats, and loglines — then loads only the specific prose it needs.

**Phase 1:** Read-only analysis. Ask questions about your project.
**Phase 2 (current):** Metadata write-back. Answers stay accurate as the manuscript evolves.
**Phase 3:** AI-assisted prose editing with confirmation and version history.

## Quick start with Scrivener

If you write in [Scrivener](https://www.literatureandlatte.com/scrivener), you can seed `mcp-writing` from a Scrivener external-sync export in two steps.

### 1. Export from Scrivener

In Scrivener: **File → Sync → With External Folder**. Set the format to **plain text** (`.txt`) and pick an output folder, for example `~/my-novel-txt/`. Your `Draft/` folder and `Notes/` folder will be exported as numbered `.txt` files.

### 2. Import into mcp-writing

```sh
node scripts/import.js ~/my-novel-txt /path/to/sync-dir --project my-novel
```

The importer:
- Converts `Draft/` files to scene sidecars (`.meta.yaml`) with auto-generated `scene_id`, `title`, `part`, `chapter`, and `save_the_cat_beat` fields derived from the filename/structure.
- Routes `Notes/` files into `world/characters/` or `world/places/` based on section grouping.
- Skips beat-marker files (`-Setup-`, `-Catalyst-`, etc.), chapter-intro files, epigraphs, and trashed files.

> **Note:** The importer writes a `group` key to character sidecar files so characters stay organized by their Notes section (e.g. "Main Characters", "Mira's team"). This is preserved through lint and sync.

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

```
/sync-root/
  /universes/
    /my-series/
      /world/
        characters/elena.md
        places/harbor-district.md
      /book-1/
        /part-1/chapter-1/scene-001.md
  /projects/
    /standalone-novel/
      /world/
        characters/
        places/
      /part-1/chapter-1/scene-001.md
```

Universe-level characters and places are shared across all books in that universe. Standalone projects are fully isolated.

---

## Available tools

| Tool | Description |
| --- | --- |
| `sync` | Re-scan the sync folder and update the index |
| `find_scenes` | Filter scenes by character, beat, tag, part, chapter, or POV |
| `get_scene_prose` | Load the full prose for a specific scene |
| `get_chapter_prose` | Load all prose for a chapter |
| `get_arc` | Ordered scene metadata for all scenes involving a character |
| `list_characters` | All characters, optionally filtered by project or universe |
| `get_character_sheet` | Full character metadata, traits, and notes |
| `list_places` | All places |
| `search_metadata` | Full-text search across scene titles and loglines |
| `list_threads` | All subplot threads for a project |
| `get_thread_arc` | Scenes belonging to a thread, with per-thread beat |
| `upsert_thread_link` | Create/update a thread and link it to a scene |
| `enrich_scene` | Re-derive lightweight metadata from current prose and clear `metadata_stale` |
| `update_scene_metadata` | Write metadata fields back to a scene sidecar |
| `update_character_sheet` | Write fields back to a character sidecar |
| `flag_scene` | Mark a scene with a flag for AI follow-up |

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
npm run lint:metadata:test # lint fixture metadata in ./test-sync
```

Unit tests use an in-memory SQLite database and temporary directories — no server needed. Integration tests spawn a real server against `test-sync/` on port 3099 and verify all MCP tools end-to-end.

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
