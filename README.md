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

## Documentation

| Guide | Description |
|---|---|
| [docs/setup.md](docs/setup.md) | Prerequisites, first-time setup, Scrivener import, native sync format |
| [docs/docker.md](docs/docker.md) | Docker Compose, OpenClaw integration, SSH hardening |
| [docs/data-ownership.md](docs/data-ownership.md) | Which tools write which files, import safety rules |
| [docs/tools.md](docs/tools.md) | Full tool reference — auto-generated from source |
| [docs/development.md](docs/development.md) | Running locally, tests, environment variables, troubleshooting |

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

## License
AGPL-3.0-only
