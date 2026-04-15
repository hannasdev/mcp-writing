# mcp-writing

An MCP service for AI-assisted reasoning and editing on long-form fiction projects.

Designed to work with [OpenClaw](https://github.com/openclaw/openclaw) but compatible with any MCP-capable AI gateway.

## What it does

Instead of feeding an entire manuscript to an AI and hoping it fits in the context window, `mcp-writing` builds a structured index from your scene files. The AI queries that index first — finding relevant characters, beats, and loglines — then loads only the specific prose it needs.

**Phase 1 (current):** Read-only analysis. Ask questions about your project.
**Phase 2:** Metadata write-back. Answers stay accurate as the manuscript evolves.
**Phase 3:** AI-assisted prose editing with confirmation and version history.

## Source format

Your manuscript lives in a folder of plain `.md` files — one file per scene, character, or place. Metadata is stored in a YAML header block at the top of each file. Scrivener users can generate this folder automatically using **File → Sync → With External Folder**.

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

### Project structure

```bash
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

## Available tools (Phase 1)

| Tool | Description |
| --- | --- |
| `sync` | Re-scan the sync folder and update the index |
| `find_scenes` | Filter scenes by character, beat, tag, part, chapter, or POV (supports `page`/`page_size`, includes `total_count` on paginated responses) |
| `get_scene_prose` | Load the full prose for a specific scene |
| `get_chapter_prose` | Load all prose for a chapter |
| `get_arc` | Ordered scene metadata for all scenes involving a character (supports `page`/`page_size`, includes `total_count` on paginated responses) |
| `list_characters` | All characters, optionally filtered by project or universe |
| `get_character_sheet` | Full character metadata, traits, and notes |
| `list_places` | All places |
| `search_metadata` | Full-text search across scene titles and loglines (supports `page`/`page_size`, includes `total_count` on paginated responses) |
| `list_threads` | All subplot threads for a project (structured JSON with `results` + `total_count`; supports `page`/`page_size`) |
| `get_thread_arc` | Scenes belonging to a thread, with per-thread beat (structured JSON with `thread`, `results`, `total_count`; supports `page`/`page_size`) |
| `upsert_thread_link` | Create/update a thread and link it to a scene (idempotent link upsert; writable sync dir required) |

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
    - /path/to/scrivener/sync:/sync:ro
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
npm test          # unit + integration (77 tests)
npm run test:unit  # unit tests only (no server required)
```

Unit tests use an in-memory SQLite database and temporary directories — no server needed. Integration tests spawn a real server against `test-sync/` on port 3099 and verify all 10 MCP tools end-to-end.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `WRITING_SYNC_DIR` | `./sync` | Path to the Scrivener sync folder |
| `DB_PATH` | `./writing.db` | Path to the SQLite index database |
| `HTTP_PORT` | `3000` | Port for the MCP SSE endpoint |
| `DEFAULT_METADATA_PAGE_SIZE` | `20` | Default page size used by `find_scenes` and `get_arc` pagination |

## License

MIT
