# mcp-writing

[![CI](https://github.com/hannasdev/mcp-writing/actions/workflows/ci.yml/badge.svg)](https://github.com/hannasdev/mcp-writing/actions/workflows/ci.yml) [![GitHub release](https://img.shields.io/github/v/release/hannasdev/mcp-writing)](https://github.com/hannasdev/mcp-writing/releases) [![npm version](https://img.shields.io/npm/v/%40hanna84%2Fmcp-writing)](https://www.npmjs.com/package/@hanna84/mcp-writing) [![npm downloads](https://img.shields.io/npm/dm/%40hanna84%2Fmcp-writing)](https://www.npmjs.com/package/@hanna84/mcp-writing) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.6.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL--v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

An MCP service for AI-assisted reasoning and editing on long-form fiction projects.

Designed to work with [OpenClaw](https://github.com/openclaw/openclaw) but compatible with any MCP-capable AI gateway.

## Quick launch

For local stdio MCP clients, run the published package directly:

```sh
WRITING_SYNC_DIR=/path/to/sync-dir DB_PATH=./writing.db npx -y @hanna84/mcp-writing
```

The CLI wrapper defaults to stdio transport and adds the Node 22 SQLite flag automatically when needed.

## What it does

Instead of feeding an entire manuscript to an AI and hoping it fits in the context window, `mcp-writing` builds a structured index from your scene files. The AI queries that index first — finding relevant characters, beats, and loglines — then loads only the specific prose it needs.

**Current status:**
- **Core platform complete:** Metadata-first analysis, sidecar-backed metadata maintenance, AI-assisted prose editing with confirmation + git history, review bundles, and Scrivener Direct extraction are all implemented.
- **Recently delivered:** Guideline generation is now delivered and tracked in done PRDs.
- **Active development:** OpenClaw integration is the current focus area.
- **Deferred backlog:** embeddings search is intentionally deferred for later exploration.

## Who it is for

- Novelists and writing teams working on long manuscripts with many scenes, characters, and continuity constraints.
- AI-assisted editing workflows where you want targeted context retrieval instead of full-manuscript prompting.
- Projects that need traceable, reversible edits with metadata that stays synchronized as drafts evolve.

## Documentation

| Guide | Description |
|---|---|
| [docs/setup.md](docs/setup.md) | Prerequisites, first-time setup, Scrivener import, native sync format |
| [docs/docker.md](docs/docker.md) | Docker Compose, OpenClaw integration, SSH hardening |
| [docs/data-ownership.md](docs/data-ownership.md) | Which tools write which files, import safety rules |
| [docs/tools.md](docs/tools.md) | Full tool reference — auto-generated from source |
| [docs/development.md](docs/development.md) | Running locally, tests, environment variables, troubleshooting |

## Breaking changes

### `describe_workflows` surface redesign

`describe_workflows` now exposes an outcome-first, discovery-first workflow map. This is a breaking change if your prompts or automation depend on previous workflow IDs or ordering.

Update integrations using this mapping:

- `manuscript_exploration` -> `question_driven_discovery` (or `targeted_scene_reading` when the task is prose inspection)
- `prose_editing` -> `safe_scene_revision`
- `character_management` -> `character_understanding`
- `place_management` -> `place_understanding`
- `review_bundle` -> `review_preparation`

New workflow IDs added:

- `thread_understanding`
- `parity_recovery`

Styleguide workflows are still available, but no longer positioned as part of the primary daily workflow surface.

### `find_scenes` and `get_arc` response-shape standardization

`find_scenes` and `get_arc` now always return structured envelopes, including non-paginated calls.

- Envelope fields: `results`, `total_count`.
- Pagination fields are included when paging is active.
- `warning` / `next_step` are included when relevant.

If your integration previously handled raw arrays for non-paginated calls, update it to parse envelopes consistently.

Safe parsing pattern:

```js
const parsed = JSON.parse(toolText);
const scenes = parsed.results ?? [];
const totalCount = parsed.total_count ?? scenes.length;
const warning = parsed.warning ?? null;
const nextStep = parsed.next_step ?? null;
```

## Usage scenarios

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

### 5) Refreshing scene-character links after imports or major rewrites

Goal: rebuild scene-to-character links in a controlled way after imported prose changes or metadata drift.

1. Start with `enrich_scene_characters_batch` using the default `dry_run=true` to preview inferred links for a project, chapter, or explicit scene list.
2. Poll `get_async_job_status` until the batch job completes, then review `job.result.results` for changed scenes, ambiguous matches, and partial failures.
3. Spot-check a few affected scenes with `get_scene_prose` if the changes touch important continuity or cast-heavy chapters.
4. Re-run `enrich_scene_characters_batch` with `dry_run=false` once the preview looks correct.
5. If you want a destructive overwrite instead of additive merge behavior, use `replace_mode=replace` with `confirm_replace=true` deliberately.

Outcome: character-link maintenance becomes a preview-first batch operation instead of a one-off regex script or manual sidecar cleanup.

### 6) Post-upgrade recovery after legacy migration warnings

Goal: recover index confidence quickly when legacy upgrade warnings indicate ambiguous rows were skipped.

1. Start by checking `get_runtime_config` (or `describe_workflows`) and confirm whether `db_migration_warnings` contains `LEGACY_JOIN_ROWS_SKIPPED`.
2. If present, run `sync` immediately to rebuild scene relationships from current sidecars and prose metadata.
3. Continue normal discovery (`find_scenes`, `get_arc`, `get_thread_arc`) and watch for stale-metadata warnings.
4. When you touch stale scenes, run `enrich_scene(scene_id, project_id)` to recover metadata parity incrementally.
5. If many scenes remain stale, switch to `enrich_scene_characters_batch` (dry-run first) for broader catch-up.

Outcome: upgrade-related data loss risk becomes an explicit, operator-visible recovery workflow instead of a silent state mismatch.

## License
AGPL-3.0-only
