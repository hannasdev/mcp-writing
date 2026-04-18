# MCP Writing Tools

A Model Context Protocol server for managing long-form writing projects, specifically tailored for Scrivener-style "Draft" folders and scene-based workflows. It provides tools for indexing manuscripts, managing scene metadata, and interfacing with LLMs for creative writing assistance.

## Quickstart

```sh
npm install
npm run build
```

Then configure your MCP client to run the build output.

## Environment Variables

- `WRITING_SYNC_DIR`: Path to the directory containing your manuscript files (required for sync tools).
- `DB_PATH`: Path to the SQLite database file (default: `./writing.db`).

## Docker Context

When `mcp-writing` runs behind OpenClaw (or any Docker MCP gateway), these details prevent common runtime failures.

#### Required environment and mounts

- Set `WRITING_SYNC_DIR=/sync`
- Set `DB_PATH=/data/writing.db`
- Mount your manuscript sync repo to `/sync`
- Mount a persistent path for SQLite data at `/data`

If `/sync` contains raw Scrivener external-sync output, run the importer once before normal `sync` usage:

```sh
node scripts/import.js /path/to/scrivener-export /sync --project my-novel
```

`sync` indexes files that already contain scene metadata. It does not convert Scrivener `Draft/` filenames into scene sidecars by itself.

## Available Tools

### Syncing and Indexing
- `sync`: Scans the `WRITING_SYNC_DIR` for Markdown files and YAML sidecars, indexing them into the SQLite database.
- `status`: Provides a summary of the current project state (word counts, scene status, etc.).

### Writing Assistance
- `generate-scene`: Uses defined metadata to suggest scene content or structure.
- `analyze-pacing`: Scans scenes for word count distribution and plot beats.

## License
MIT
