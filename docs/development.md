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

For manual Scrivener import and merge verification with real project data, keep both the copied `.scriv` bundle and the generated temp sync output outside the repository too. The current local convention is `/Users/hanna/.mcp-writing-manual-data/`, and the reusable runner is `npm run manual:realtest -- --source-dir <external-sync-dir> --scriv-path <external-copied-project.scriv> --project-id <project-id>`.

Maintainers: see `MAINTAINERS.md` for release and operational setup notes, and `AGENT.md` for persistent workflow conventions and release/recovery guidance.

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

### Tests fail after updating Node.js

Local install state may be stale after the Node.js change.

Fix: reinstall dependencies.

```sh
rm -rf node_modules package-lock.json
npm install
npm test
```
