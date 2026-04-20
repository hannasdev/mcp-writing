# Prose Editing & Version Control

**Status:** ✅ Complete (Phase 3)

## Version Control Architecture

The sync folder is a git repository. Git provides version history instead of a `scene_snapshots` SQLite table — better diffing, branching for experimental rewrites, and meaningful commit messages.

### Setup

`git init` the sync folder on first use. The MCP service requires git to be available in the container.

### How It Works

- Before any `commit_edit` write, the service runs `git add <file> && git commit -m "pre-edit snapshot: <scene_id> — <instruction>"`
- `list_snapshots(scene_id)` is implemented as `git log <file>`
- `get_scene_prose(scene_id, commit?)` for a past version is implemented as `git show <commit>:<file>`
- Manual snapshots: call `snapshot_scene(scene_id, project_id, reason)` at any time to commit the current state

### Remote (Strongly Recommended)

The git remote is local-first — the service functions without one. A remote is strongly recommended for redundancy and off-site backup. Any git host works (GitHub, GitLab, Gitea). The service warns if no remote is configured but will not block operation.

### Branching for Experimental Rewrites

For structural experiments (e.g. reordering acts, trying alternate endings), create a branch, apply changes there, and leave `main` untouched. The user merges or discards the branch in git. This is outside the MCP tool surface for Phase 3 — users manage branches directly.

## Two-Step Editing: Propose, Then Commit

The AI can never write prose in a single step. All prose edits require explicit confirmation.

### Tools

| Tool | Description |
| --- | --- |
| `propose_edit(scene_id, instruction, revised_prose)` | Stores a complete revised version, returns a `proposal_id`, and shows a diff preview without writing |
| `commit_edit(scene_id, proposal_id)` | Runs preflight path checks; if they pass, git-commits current prose as pre-edit snapshot and writes the proposed revision. Returns explicit envelopes for stale/misclassified/unwritable paths. |
| `discard_edit(proposal_id)` | Discards a pending proposal |
| `snapshot_scene(scene_id, project_id, reason)` | Manually git-commits the current state with a descriptive message |
| `list_snapshots(scene_id)` | Lists git commit history for a scene file with timestamps and messages |

### Proposal Lifecycle

1. **Propose:** `propose_edit(scene_id, instruction, revised_prose)` stages the change and returns a `proposal_id`
2. **Review:** User sees a diff preview of the proposed change
3. **Decide:** Either `commit_edit(scene_id, proposal_id)` to apply or `discard_edit(proposal_id)` to reject

Proposals are not persisted; a restart between propose and commit loses the proposal. This is acceptable for Phase 3 — proposals are temporary review staging, not saved work.

### Preflight Checks on Commit

`commit_edit` runs these checks before writing:
- Path exists and is writable
- File has not moved since proposal (stale path check)
- Prose file is not corrupted or deleted

If any check fails, no snapshot is created and no prose is written. The tool returns explicit error envelopes (`STALE_PATH`, `INVALID_PROSE_PATH`, `PROSE_FILE_NOT_WRITABLE`).

## Relationship Tracking

### Tool

| Tool | Description |
| --- | --- |
| `get_relationship_arc(from_character, to_character, project_id?)` | Temporal character relationship graph between two characters |

Shows how the relationship between two characters evolves across scenes with state transitions (TRUST, CONFLICT, DEPENDENCY, AFFECTION, etc.) and their causes.

## Phase 3 Completion

- [x] Ensure git is available in container; `git init` sync folder on first use
- [x] Implement `propose_edit`, `commit_edit`, `discard_edit` (git commit as pre-edit snapshot)
- [x] Implement `snapshot_scene`, `list_snapshots`, `get_scene_prose(scene_id, commit?)`
- [ ] Warn at startup if sync folder has no git remote configured
- [ ] Decide on proposal persistence model (Open Question C)

## Metadata & Prose Interaction

When prose changes, related metadata may become stale:
- loglines derived from opening sentences
- tags assigned by keywords
- beat assignments
- relationship state
- continuity flags

After editing, the workflow is:

1. Run `sync()` to pick up any external changes
2. For substantially changed scenes, optionally call `enrich_scene(scene_id)` to refresh derived fields
3. Update relationship state via `update_scene_metadata` if character dynamics shifted

See [metadata.md](../done/metadata.md) for staleness detection and re-enrichment details.

## Known Edge Cases

### #4 — `get_chapter_prose` Unbounded Load (IMPORTANT)

A large chapter (e.g. 30 scenes × 3000 words) produces ~90k words in a single tool response — guaranteed context overflow. Add a configurable `MAX_CHAPTER_SCENES` limit (default: 10) with explicit warning in the response when the limit is hit.

### #9 — Unguarded IO Errors in Write Tools (RESOLVED)

`update_scene_metadata`, `update_character_sheet`, and `flag_scene` previously threw unhandled exceptions when indexed file paths were stale. All three now return a `STALE_PATH` error (with `indexed_path` detail) on ENOENT, and `IO_ERROR` for other failures, consistent with `get_scene_prose`.

## Related Sections

- [metadata.md](../done/metadata.md) — Staleness detection and re-enrichment
- [search-analysis.md](../done/search-analysis.md) — Querying before and after edits
