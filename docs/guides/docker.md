# Docker Setup

- [Quick Start](#quick-start)
- [Docker Compose](#docker-compose)
- [Runtime Contract](#runtime-contract)
- [Git and SSH](#git-and-ssh)
- [Health and Logs](#health-and-logs)
- [Troubleshooting](#troubleshooting)
- [MCP Gateway Notes](#mcp-gateway-notes)

---

## Quick Start

Build the image from a checkout:

```sh
docker build -t mcp-writing .
```

Create host directories for manuscript sync files and durable SQLite data:

```sh
mkdir -p ./sync ./data
```

Run the server in HTTP/SSE mode:

```sh
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/sync:/sync" \
  -v "$PWD/data:/data" \
  -e WRITING_SYNC_DIR=/sync \
  -e DB_PATH=/data/writing.db \
  mcp-writing
```

Verify the server:

```sh
curl http://localhost:3000/healthz
```

The response should be `ok`.
MCP clients and gateways should connect to `http://localhost:3000/sse`.

If `/sync` contains raw Scrivener external-sync output, run the importer once before normal `sync` usage:

```sh
docker run --rm \
  -v "$PWD/scrivener-export:/import:ro" \
  -v "$PWD/sync:/sync" \
  -v "$PWD/data:/data" \
  mcp-writing \
  node src/scripts/import.js /import /sync --project my-novel
```

`sync` indexes files that already contain scene metadata. It does not convert raw Scrivener `Draft/` filenames into scene sidecars by itself.

## Docker Compose

Start from `docker-compose.example.yml`:

```sh
mkdir -p ./sync ./data
docker compose -f docker-compose.example.yml up --build
```

Optional `.env` values:

```sh
WRITING_UID=1000
WRITING_GID=1000
WRITING_HTTP_PORT=3000
WRITING_SYNC_DIR_HOST=/absolute/path/to/manuscript-sync
WRITING_DATA_DIR_HOST=/absolute/path/to/writing-data
OWNERSHIP_GUARD_MODE=warn
```

Use `WRITING_UID` and `WRITING_GID` to match the host owner for Linux bind mounts. The Compose example uses bind mounts for both `/sync` and `/data` so the configured runtime user can write manuscript files and the SQLite database. On Docker Desktop for macOS, the default values are usually enough.

## Runtime Contract

The image expects these paths and environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WRITING_SYNC_DIR` | `/sync` | Manuscript sync folder mounted read-write |
| `DB_PATH` | `/data/writing.db` | SQLite index database path |
| `HTTP_PORT` | `3000` | HTTP/SSE and `/healthz` port |
| `MCP_TRANSPORT` | `http` | Docker default transport |
| `OWNERSHIP_GUARD_MODE` | `warn` | `warn` logs ownership drift; `fail` exits on sampled non-runtime-owned files |

Mounts:

| Container Path | Purpose |
| --- | --- |
| `/sync` | Authored manuscript files, metadata sidecars, generated exports, and Git repo state |
| `/data` | Durable runtime data, including the SQLite index |
| `/ssh` | Optional read-only SSH material for private Git remotes |

The image includes Node, production npm dependencies, SQLite support through Node's built-in `node:sqlite`, Git, OpenSSH client, and CA certificates.

## Git and SSH

The image marks `/sync` as a Git safe directory:

```sh
git config --system --add safe.directory /sync
```

For private remotes, mount SSH materials read-only and use strict host checking:

```sh
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/sync:/sync" \
  -v "$PWD/data:/data" \
  -v "$HOME/.ssh/writing-mcp:/ssh:ro" \
  -e GIT_SSH_COMMAND="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/ssh/known_hosts" \
  mcp-writing
```

Use separate keys for repository transport and commit signing when signing is required.

## Health and Logs

Health check:

```sh
curl http://localhost:3000/healthz
```

Container logs:

```sh
docker logs <container-name>
```

Runtime diagnostics are available through the MCP tool `get_runtime_config`.
Check it when debugging sync path, database path, Git, or ownership issues.

## Troubleshooting

### "Opening `/healthz` works, but scene indexing is empty"

You are likely running `sync` on raw Scrivener `Draft/` output that has not been imported yet.

Fix:

1. Run the importer once to create scene metadata sidecars.
2. Restart the service if needed.
3. Call `sync` again.

### "Write access to repository denied" or Git push/pull fails

Check `get_runtime_config`:

- `sync_dir_writable` should be `true`
- `runtime_warnings` should be empty for normal editing flows

Then verify:

- `/sync` is mounted read-write, not `:ro`
- the runtime UID/GID can write to the host sync directory
- SSH keys and `known_hosts` are mounted under `/ssh` when private remotes are used
- the remote allows the mounted key to fetch or push

### "Blocked: file is root-owned"

The runtime user can read but cannot overwrite files in `/sync`.

Fix host ownership once:

```sh
sudo chown -R "$(id -u):$(id -g)" /path/to/sync-dir
```

Then rerun with matching IDs:

```sh
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -p 3000:3000 \
  -v "/path/to/sync-dir:/sync" \
  -v "$PWD/data:/data" \
  mcp-writing
```

### "Database cannot be opened"

The `/data` mount may not exist or may not be writable by the runtime user.

Fix:

```sh
mkdir -p ./data
sudo chown -R "$(id -u):$(id -g)" ./data
```

## MCP Gateway Notes

Any MCP gateway that supports HTTP/SSE can register the Docker service URL:

```json
{
  "mcp": {
    "servers": {
      "writing": { "url": "http://localhost:3000/sse" }
    }
  }
}
```

When the gateway runs in the same Docker network, use the Compose service name:

```json
{
  "mcp": {
    "servers": {
      "writing": { "url": "http://writing-mcp:3000/sse" }
    }
  }
}
```
