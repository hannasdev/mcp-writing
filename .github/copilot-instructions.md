# Copilot Instructions for mcp-writing

This workspace contains an MCP (Model Context Protocol) server for fiction manuscript analysis and editing. Copilot Chat can connect to it to help reason about and edit long-form stories.

## MCP Server Details

- **Name**: mcp-writing
- **Transport**: HTTP SSE
- **Endpoint**: `http://localhost:3000/sse`
- **Health check**: `http://localhost:3000/healthz`
- **Port**: 3000 (configurable via `HTTP_PORT` env var)

The server must be running before use. Start it with:
```bash
npm start
```

## Available Tools

Use these tools to work with manuscripts:

### Discovery & Analysis
- **`find_scenes()`** — Query scenes by character, beat, chapter, tags, POV. Returns lightweight metadata.
- **`search_metadata()`** — Full-text search across scene titles and loglines (FTS5).
- **`get_arc()`** — Get ordered scenes for a character's journey throughout the manuscript.
- **`get_relationship_arc()`** — Track how a relationship between two characters evolves.
- **`list_characters()`, `list_places()`** — Enumerate entities in the project.

### Content Access
- **`get_scene_prose()`** — Load full text for a specific scene (use sparingly to conserve context).
- **`get_chapter_prose()`** — Load all scenes in a chapter.
- **`get_character_sheet()`, `get_place_sheet()`** — Get entity details with supporting notes.

### Editing & Metadata
- **`propose_edit()`** → **`commit_edit()`** — Two-step editing workflow (propose, review diff, commit).
- **`update_scene_metadata()`, `update_character_sheet()`, `update_place_sheet()`** — Update structured metadata.
- **`flag_scene()`** — Attach continuity notes or review questions to a scene.
- **`enrich_scene()`** — Re-derive metadata (logline, character mentions) from prose.

### Project Management
- **`import_scrivener_sync()`** — Bootstrap from Scrivener External Folder Sync.
- **`sync()`** — Re-scan the sync folder after external changes.
- **`get_async_job_status()`** — Check status of long-running operations.

## Common Workflows

**Analyze a manuscript:**
1. `find_scenes()` with filters to understand structure
2. `search_metadata()` to find scenes by theme or keyword
3. `get_arc()` to trace a character's journey
4. Use `get_scene_prose()` only for scenes you need to examine closely

**Propose an edit:**
1. `get_scene_prose()` to load the target scene
2. `propose_edit()` with your proposed changes
3. Show the user the diff for review
4. `commit_edit()` only after approval

**Update metadata after changes:**
- `sync()` — after Scrivener edits or external file changes
- `update_scene_metadata()` — to change scene-level fields
- `flag_scene()` — to note continuity issues for the user

## Key Concepts

- **Metadata-first**: Queries return lightweight metadata (fits in context). Load prose only when needed.
- **Staleness warnings**: Tools warn if scenes are marked `metadata_stale` (prose changed since metadata last updated).
- **Git-backed edits**: All prose edits create git commits. Revert or view history via `get_scene_prose(commit=hash)`.
- **Sidecar ownership**: MCP manages `.meta.yaml` sidecars; Scrivener owns `.md` prose files.

## Documentation

For complete details, see:
- [PRD.md](PRD.md) — Product overview and roadmap
- [docs/tools.md](docs/tools.md) — Full tool reference
- [AGENTS.md](AGENTS.md) — Project-specific agent guidance (development workflow)
