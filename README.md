# mcp-writing

[![CI](https://github.com/hannasdev/mcp-writing/actions/workflows/ci.yml/badge.svg)](https://github.com/hannasdev/mcp-writing/actions/workflows/ci.yml) [![GitHub release](https://img.shields.io/github/v/release/hannasdev/mcp-writing)](https://github.com/hannasdev/mcp-writing/releases) [![npm version](https://img.shields.io/npm/v/%40hanna84%2Fmcp-writing)](https://www.npmjs.com/package/@hanna84/mcp-writing) [![npm downloads](https://img.shields.io/npm/dm/%40hanna84%2Fmcp-writing)](https://www.npmjs.com/package/@hanna84/mcp-writing) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.6.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL--v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

An MCP service for AI-assisted reasoning and editing on long-form fiction projects.

Designed to work with [OpenClaw](https://github.com/openclaw/openclaw) but compatible with any MCP-capable AI gateway.

## What it does

Instead of feeding an entire manuscript to an AI and hoping it fits in the context window, `mcp-writing` builds a structured index from your scene files. The AI queries that index first — finding relevant characters, beats, and loglines — then loads only the specific prose it needs.

**Phase 1:** Read-only analysis. Ask questions about your project.
**Phase 2:** Metadata write-back. Answers stay accurate as the manuscript evolves.
**Phase 3 (current):** AI-assisted prose editing with confirmation and version history.

## Who it is for

- Novelists and writing teams working on long manuscripts with many scenes, characters, and continuity constraints.
- AI-assisted editing workflows where you want targeted context retrieval instead of full-manuscript prompting.
- Projects that need traceable, reversible edits with metadata that stays synchronized as drafts evolve.

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

## Permission Contract (Recommended For All Users)

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

## First-time setup path (recommended)

If this is your first time, follow these steps in order:

1. Start with **Quick start with Scrivener** (or use **Running with Docker** if that is your preferred setup).
2. Start the server.
3. Verify the server (`/healthz` and `/sse`).
4. Run `import_scrivener_sync` with `dry_run: true` first to preview what will happen.
5. Run it again with `dry_run: false` to write files. Keep `auto_sync: true` (default) so your scenes are indexed immediately.

Once this is working, you can come back to:

- **Advanced: Native sync format** for custom project layouts
- **Reference: Available tools** for the full tool catalog
- **Appendix: Real-world usage scenarios** for workflow ideas

## Quick start with Scrivener

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
Listening on port 3000
Sync dir: /path/to/sync-dir
Database: ./writing.db
```

### 3. Verify the server

- Open `http://localhost:3000/healthz` and confirm it returns OK.
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
- Skips beat-marker files (`-Setup-`, `-Catalyst-`, etc.), chapter-intro files, epigraphs, and trashed files.
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

## Appendix: Real-world usage scenarios

The tool list is useful as reference. These example workflows show how people actually use `mcp-writing` while drafting and revising.

### 1) Continuity pass before sending chapters to beta readers

Goal: catch inconsistencies before sharing pages.

1. Run `sync` after your latest writing session.
2. Ask `find_scenes` for scenes involving a specific character or tag (for example, all scenes tagged `injury` or `promise`).
3. Use `get_arc` to review that character's ordered progression across the manuscript.
4. Load only the suspect scenes with `get_scene_prose`.
5. Attach follow-up notes with `flag_scene` where continuity needs a fix.

Outcome: you review one narrative thread at a time instead of rereading the entire novel to find contradictions.

### 2) Planning and tracking subplot beats during revisions

Goal: make sure subplot threads progress intentionally and resolve on time.

1. Run `list_threads` for the project.
2. Use `get_thread_arc` to inspect scene order and beat labels for each thread.
3. When a beat is missing, call `upsert_thread_link` to add or update it on the right scene.
4. Re-run `get_thread_arc` to confirm pacing and coverage.

Outcome: subplot structure stays visible and auditable, which reduces dropped threads in late drafts.

### 3) Tightening scene metadata after heavy prose edits

Goal: keep indexes accurate without manually re-tagging everything.

1. After rewriting scenes, call `enrich_scene` to re-derive lightweight metadata from current prose.
2. Use `update_scene_metadata` for intentional editorial fields (for example, beat, POV, timeline position, and tags).
3. Use `search_metadata` and `find_scenes` to verify scenes are discoverable under the expected filters.

Outcome: your AI assistant can reliably find the right scenes without drifting from the manuscript.

### 4) Safe AI-assisted line edits with rollback

Goal: let AI propose prose edits without losing control of your draft.

1. Ask the AI to call `propose_edit` for a specific scene.
2. Review the staged diff.
3. Accept with `commit_edit` or reject with `discard_edit`.
4. Use `list_snapshots` (and optional `snapshot_scene`) to inspect or preserve revision history.

Outcome: you get AI speed with explicit approval and recoverable history for every applied change.

---

## Reference: Available tools

| Tool | Description |
| --- | --- |
| `sync` | Re-scan the sync folder and update the index |
| `import_scrivener_sync` | Import Scrivener Draft export into sidecars and optionally auto-run sync |
| `find_scenes` | Filter scenes by character, beat, tag, part, chapter, or POV |
| `get_scene_prose` | Load the full prose for a specific scene |
| `get_chapter_prose` | Load all prose for a chapter |
| `get_runtime_config` | Show active paths/capabilities plus runtime warnings and setup recommendations |
| `get_arc` | Ordered scene metadata for all scenes involving a character |
| `list_characters` | All characters, optionally filtered by project or universe |
| `get_character_sheet` | Full character metadata, traits, notes, and support notes |
| `create_character_sheet` | Create a canonical character sheet folder and sidecar |
| `list_places` | All places |
| `get_place_sheet` | Full place metadata, tags, associated characters, notes, and support notes |
| `create_place_sheet` | Create a canonical place sheet folder and sidecar |
| `search_metadata` | Full-text search across scene titles, loglines, and metadata keywords (tags/characters/places/versions) |
| `list_threads` | All subplot threads for a project |
| `get_thread_arc` | Scenes belonging to a thread, with per-thread beat |
| `upsert_thread_link` | Create/update a thread and link it to a scene |
| `enrich_scene` | Re-derive lightweight metadata from current prose and clear `metadata_stale` |
| `update_scene_metadata` | Write metadata fields back to a scene sidecar |
| `update_character_sheet` | Write fields back to a character sidecar |
| `update_place_sheet` | Write fields back to a place sidecar |
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
  user: "${OPENCLAW_UID:-1000}:${OPENCLAW_GID:-1000}"
  environment:
    WRITING_SYNC_DIR: /sync
    DB_PATH: /data/writing.db
    HTTP_PORT: "3000"
    OWNERSHIP_GUARD_MODE: "${OWNERSHIP_GUARD_MODE:-warn}"
    GIT_SSH_COMMAND: "ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/ssh/known_hosts"
  volumes:
    - ${OPENCLAW_WORKSPACE_DIR:?run scripts/setup-openclaw-env.sh first}/sync:/sync
    - ${OPENCLAW_SSH_DIR:?run scripts/setup-openclaw-env.sh first}:/ssh:ro
    - writing-mcp-data:/data
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 30s
    timeout: 5s
    retries: 5

volumes:
  writing-mcp-data:
```

Recommended: start from `docker-compose.example.yml` and generate `.env` with machine-specific values:

```sh
sh scripts/setup-openclaw-env.sh
```

That script writes `OPENCLAW_UID`, `OPENCLAW_GID`, `OPENCLAW_WORKSPACE_DIR`, and `OPENCLAW_SSH_DIR` to `.env`.
Running Compose without these values is unsupported and may create invalid mount definitions.
It also normalizes `OWNERSHIP_GUARD_MODE` to `warn` or `fail` and preserves an existing valid value when rerun.

Then register in your OpenClaw config:

```json
"mcp": {
  "servers": {
    "writing": { "url": "http://writing-mcp:3000/sse" }
  }
}
```

<details>
<summary>Advanced OpenClaw / Docker integration notes</summary>

### OpenClaw / Docker integration notes

When `mcp-writing` runs behind OpenClaw (or any Docker MCP gateway), these details prevent common runtime failures.

#### Required environment and mounts

- Set `WRITING_SYNC_DIR=/sync`
- Set `DB_PATH=/data/writing.db`
- Set `OWNERSHIP_GUARD_MODE=warn` (or `fail` to block startup on ownership drift)
- Mount your manuscript sync repo to `/sync`
- Mount a persistent path for SQLite data at `/data`
- Mount SSH materials read-only at `/ssh` and use `GIT_SSH_COMMAND` with `/ssh` paths

Debug/test-only runtime override knobs:

- `RUNTIME_UID_OVERRIDE` — test helper to simulate runtime UID during ownership diagnostics
- `ALLOW_RUNTIME_UID_OVERRIDE=1` — explicitly enables the override outside `NODE_ENV=test`

Do not set these in normal production or desktop deployments.

If `/sync` contains raw Scrivener external-sync output, run the importer once before normal `sync` usage:

```sh
node scripts/import.js /path/to/scrivener-export /sync --project my-novel
```

`sync` indexes files that already contain scene metadata. It does not convert Scrivener `Draft/` filenames into scene sidecars by itself.

#### Git ownership trust for mounted repos

If host and container ownership differ, git can fail with:

- `fatal: detected dubious ownership in repository`

Mark the mounted repo path as safe in the container image:

```sh
git config --system --add safe.directory /sync
```

#### SSH transport hardening

For private remotes, mount SSH materials read-only and enforce strict host checks:

- Auth key for fetch/pull/push
- `known_hosts` with GitHub host key
- `StrictHostKeyChecking=yes`

Example:

```sh
export GIT_SSH_COMMAND="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/ssh/known_hosts"
```

#### Separate auth and signing keys

Use dedicated keys for transport and signing:

- Auth key: repository transport (`fetch` / `pull` / `push`)
- Signing key: commit/tag signatures

Recommended git config:

```sh
git config gpg.format ssh
git config user.signingkey /root/.ssh/id_ed25519_signing
git config commit.gpgsign true
git config pull.ff only
```

#### Git identity and GitHub email privacy

If GitHub email privacy is enabled, pushes can fail unless `user.email` is a GitHub noreply address:

```sh
git config user.name "Edda"
git config user.email "<id>+<username>@users.noreply.github.com"
```

#### Branch safety for automation

For bot-driven edits, prefer branch-per-change flow:

- Push to `edda/*` or `bot/*`
- Merge via pull request
- Protect `main` from direct automation pushes

#### Quick validation

```sh
ssh -T git@github.com
git -C /sync fetch origin
git -C /sync pull --ff-only
```

Then create and push a signed smoke commit on a temporary branch.

</details>

## Running locally

```sh
npm install
WRITING_SYNC_DIR=./my-manuscript DB_PATH=./writing.db npm start
```

The `npm start` script automatically includes the `--experimental-sqlite` flag needed for SQLite support in Node.js 22+.

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

## Development

```sh
npm install
npm test           # unit + integration tests
npm run test:unit  # unit tests only (no server required)
npm run lint:metadata      # lint metadata in WRITING_SYNC_DIR or ./sync
```

Unit tests use an in-memory SQLite database and temporary directories — no server needed. Integration tests generate a fixture sync tree at runtime in temporary directories, spawn a real server on port 3099, and verify all MCP tools end-to-end.

For real projects, keep your manuscript sync folder outside this tool repository and point `WRITING_SYNC_DIR` at that external path.

Maintainers: see `MAINTAINERS.md` for release and operational setup notes, and `AGENT.md` for persistent workflow conventions and release/recovery guidance.

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

### "OpenClaw can read tools, but scene indexing is empty or incomplete"

You are likely running `sync` on raw Scrivener `Draft/` output that has not been imported yet.

Fix:

1. Run importer once to create scene metadata sidecars:

```sh
node scripts/import.js /path/to/scrivener-export /path/to/sync-dir --project my-novel
```

2. Restart the service (if needed), then call `sync` again.

Note: importer behavior is Draft-aware (`<source>/Draft` if present, else source root), but plain `sync` only indexes already-normalized scene files.

### "Write access to repository denied" (or git push/pull fails in container)

Your container can start and read files, but cannot write metadata, create snapshots, or push branches.

Fix:

1. Check runtime diagnostics via `get_runtime_config`:
  - `sync_dir_writable` must be `true`
  - `runtime_warnings` should be empty for normal editing flows
2. Ensure `/sync` is mounted read-write (no `:ro`) and owned by the container user.
3. For mounted git repos with UID mismatch, mark safe directory:

```sh
git config --system --add safe.directory /sync
```

4. Verify SSH key has write access to the remote and `known_hosts` is mounted.
5. Prefer branch-per-change workflow (`bot/*` or `edda/*`) if `main` is protected.

### "Blocked: file is root-owned" (EACCES / ownership drift)

The runtime user can read but cannot overwrite prose files.

Fix:

1. Repair host ownership once:

```sh
sudo chown -R "$(id -u):$(id -g)" /path/to/sync-dir
```

2. Ensure container user mapping is set from `.env` (`OPENCLAW_UID` / `OPENCLAW_GID`).
3. Optionally set `OWNERSHIP_GUARD_MODE=fail` to catch mismatches at startup.
4. Re-check `get_runtime_config` and confirm ownership warnings are gone.

### Tests fail after updating Node.js

Local install state may be stale after the Node.js change.

Fix: reinstall dependencies.

```sh
rm -rf node_modules package-lock.json
npm install
npm test
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `WRITING_SYNC_DIR` | `./sync` | Path to the sync folder |
| `DB_PATH` | `./writing.db` | Path to the SQLite index database |
| `HTTP_PORT` | `3000` | Port for the MCP SSE endpoint |
| `MAX_CHAPTER_SCENES` | `10` | Maximum scenes returned by `get_chapter_prose` |
| `DEFAULT_METADATA_PAGE_SIZE` | `20` | Default page size for paginated tools |
| `OWNERSHIP_GUARD_MODE` | `warn` | Startup ownership policy: `warn` logs drift, `fail` exits when sampled files are not owned by runtime user |

## License

AGPL-3.0-only
