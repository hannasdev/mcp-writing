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

## Tool Selection Order

Use this decision order to choose tools quickly:
1. Start with metadata-only tools (`find_scenes()`, `search_metadata()`, `get_arc()`) to narrow scope.
2. Load prose tools (`get_scene_prose()`, `get_chapter_prose()`) only for scenes you must inspect closely.
3. Apply edit or metadata update tools only after scope and target are confirmed.

## Key Concepts

- **Metadata-first**: Queries return lightweight metadata (fits in context). Load prose only when needed.
- **Staleness warnings**: Tools warn if scenes are marked `metadata_stale` (prose changed since metadata last updated).
- **Git-backed edits**: All prose edits create git commits. Revert or view history via `get_scene_prose(commit=hash)`.
- **Sidecar ownership**: MCP manages `.meta.yaml` sidecars; Scrivener owns `.md` prose files.
- **Invalid input handling**: If a tool call fails due to invalid or missing input, report the specific invalid field and suggest the exact correction before retrying.

## Documentation

For complete details, see:
- [PRD.md](../PRD.md) — Product overview and roadmap
- [docs/tools.md](../docs/tools.md) — Full tool reference
- [AGENTS.md](../AGENTS.md) — Project-specific agent guidance (development workflow)
