# Workflow Discovery: `describe_workflows` Tool

**Status:** ✅ Complete

---

## Problem

The server exposes 44 tools. An AI entering a session has no map: no hierarchy, no starting point, no indication of which tools belong together in a flow. The result observed in practice is that the AI tries to guess sequences, gets stuck on missing preconditions (e.g. running `update_prose_styleguide_config` before a config exists), and falls back to writing Node.js scripts to invoke tools indirectly. This defeats the purpose of the MCP.

The root cause is not model quality. It is a missing affordance: the server provides primitives but no workflows.

---

## Goal

Add a single `describe_workflows` tool that gives an AI everything it needs to orient itself in a new session: what workflows are available, which tools belong to each, what the current project context looks like, and what the correct entry point is for any common task.

This is not documentation. It is a runtime affordance — a call the AI can make whenever it is uncertain, and that always returns current state alongside the workflow map.

---

## Non-goals

- Composite tools that execute multi-step workflows automatically. That is a separate feature (see [ideas-and-questions.md](../inbox/ideas-and-questions.md)).
- MCP Prompts (protocol-level). Client support in VS Code Copilot is incomplete. Tools work everywhere.
- Replacing `get_runtime_config`. That tool is for path diagnostics. This one is for navigation.
- Documenting every tool. The workflow map covers task-level flows, not individual tool parameters.

---

## Tool Specification

### Name

`describe_workflows`

### Description (shown to the AI in the tool list)

> Return a map of available task workflows and the current project context. Call this at the start of a session or whenever you are unsure what to do next. Never write scripts to invoke tools — call them directly.

### Parameters

None.

### Response shape

```json
{
  "ok": true,
  "context": {
    "project_id": "universe-1/book-1-the-lamb",
    "scene_count": 104,
    "sync_dir": "/path/to/sync",
    "styleguide_exists": {
      "sync_root": true,
      "project_root": false
    },
    "git_available": true,
    "pending_proposals": 0
  },
  "workflows": [
    {
      "id": "first_time_setup",
      "label": "First-time setup",
      "use_when": "Connecting to a project for the first time or verifying the runtime is correctly configured.",
      "steps": [
        { "tool": "get_runtime_config", "note": "Verify sync dir and capabilities." },
        { "tool": "sync", "note": "Index scenes from disk." }
      ]
    },
    ...
  ],
  "notes": [
    "Never write JavaScript or shell scripts to invoke tools. Call them directly.",
    "If a tool returns a next_step field (in a success or error response), follow it before trying anything else.",
    "Use find_scenes without filters to discover what project_ids are indexed.",
    "When calling bootstrap_prose_styleguide_config or check_prose_styleguide_drift, set max_scenes to context.scene_count to avoid the default limit."
  ]
}
```

---

## Workflow Catalogue

These are the workflows the tool must document. Each entry maps to a `steps` array in the response.

### first_time_setup

**Use when:** Connecting to a project for the first time.

1. `get_runtime_config` — verify sync dir, writability, git availability
2. `sync` — index scenes from disk

---

### styleguide_setup_new

**Use when:** No prose styleguide config exists and you want to create one from the manuscript's existing conventions.

1. `describe_workflows` — check `context.scene_count`; use that value as `max_scenes`
2. `bootstrap_prose_styleguide_config` — detect dominant conventions; confirm suggestions with user
3. `setup_prose_styleguide_config` — create config at `project_root` scope if `context.styleguide_exists.project_root` is false
4. `update_prose_styleguide_config` — apply accepted fields from bootstrap suggestions

---

### styleguide_drift_check

**Use when:** A styleguide config exists and you want to check whether recent scenes conform to it.

1. `get_prose_styleguide_config` — confirm current resolved config
2. `check_prose_styleguide_drift` — detect non-conforming scenes; set `max_scenes` from `context.scene_count`
3. `update_prose_styleguide_config` — if drift found and user approves, update config or note the outliers

---

### manuscript_exploration

**Use when:** Answering questions about the manuscript, finding scenes, or getting an overview.

1. `find_scenes` — filter by character, beat, tag, part, chapter, or POV; no filters returns all
2. `get_scene_prose` — load prose for specific scenes
3. `get_chapter_prose` — load all prose for a chapter (use sparingly; large chapters overflow context)
4. `search_metadata` — full-text search across scene metadata fields

---

### prose_editing

**Use when:** Revising scene prose. All edits require explicit user confirmation before writing.

1. `find_scenes` + `get_scene_prose` — identify the target scene
2. `propose_edit` — stage a revision; returns a diff preview and a `proposal_id`
3. User reviews diff
4. `commit_edit` — write the revision (runs preflight checks)
5. `discard_edit` — reject the revision if unwanted

---

### character_management

**Use when:** Working with characters — finding them, reading their sheets, or updating details.

1. `list_characters` — find `character_id` values
2. `get_character_sheet` — read full character details
3. `create_character_sheet` — create a new character (requires `project_id` or `universe_id`, not both)
4. `update_character_sheet` — edit character metadata

---

### place_management

**Use when:** Working with locations.

1. `list_places` — find `place_id` values
2. `get_place_sheet` — read full place details
3. `create_place_sheet` — create a new place (requires `project_id` or `universe_id`, not both)
4. `update_place_sheet` — edit place metadata

---

### review_bundle

**Use when:** Preparing a formatted bundle for human review (outline, editorial, or beta read).

1. `preview_review_bundle` — check which scenes would be included and estimated size
2. `create_review_bundle` — generate the bundle

---

### async_job_tracking

**Use when:** A tool returns a `job_id` instead of an immediate result (e.g. `import_scrivener_sync_async`).

1. Call `get_async_job_status` with the `job_id` — poll until `status` is `completed` or `failed`
2. On `failed`: inspect `error` field; do not retry automatically without user confirmation
3. On `completed`: use the `result` field; call `sync` if the job modified files on disk

---

## Context Fields

The `context` object is computed at call time and reflects current server state.

| Field | Source | Purpose |
|---|---|---|
| `project_id` | Most frequent `project_id` in the scenes table (secondary sort: alphabetical for stability), or null if db is empty | Tells the AI what project is connected |
| `scene_count` | `SELECT COUNT(*) FROM scenes` | Lets the AI set `max_scenes` correctly without guessing |
| `sync_dir` | `SYNC_DIR_ABS` | Path confirmation |
| `styleguide_exists.sync_root` | File existence check | Skips `setup_prose_styleguide_config` if already created |
| `styleguide_exists.project_root` | File existence check per derived project_id | Same, at project scope |
| `git_available` | `GIT_AVAILABLE` runtime flag | Tells the AI whether snapshot/version tools will work |
| `pending_proposals` | `pendingProposals.size` | Alerts the AI if uncommitted proposals exist |

---

## Design Decisions

**Static workflow list, dynamic context.** The workflow catalogue does not change between calls. The context does. Separating them in the response makes it easy for an AI to re-call only for context refresh without re-reading the whole catalogue.

**No parameters.** The tool is a zero-friction entry point. Any parameter requirement risks the AI not calling it when it should.

**`project_id` in context is best-effort.** The server has no explicit "current project" setting. The derived value is the most frequent `project_id` in the scenes table (ties broken alphabetically for stability), or null if the db is empty. This is informational only; the AI should confirm with the user if unsure.

**`notes` array, not prose.** Machine-readable rules the AI can act on directly, not narrative explanation.

**Workflow steps use `note` for inline guidance.** This replaces the need to look up individual tool descriptions for sequencing decisions.

---

## Implementation Notes

- The tool has no schema parameters (empty `{}`).
- `styleguide_exists` checks use `fs.existsSync` on the two standard config paths; no file parsing.
- `project_id` derivation: `SELECT project_id, COUNT(*) as c FROM scenes GROUP BY project_id ORDER BY c DESC LIMIT 1`.
- `pending_proposals` requires access to the `pendingProposals` Map in the edit proposal state — pass it in the tool registration context alongside `db`.
- The workflow catalogue is a static constant defined once; it does not need to be regenerated per call.
- This tool should be listed first in the tool registration order so it appears at the top of tool lists in clients that preserve insertion order.

---

## Completion Checklist

- [x] Implement `describe_workflows` tool in `index.js`
- [x] Implement `context` fields: `project_id`, `scene_count`, `styleguide_exists`, `git_available`, `pending_proposals`, `sync_dir`
- [x] Define static `WORKFLOW_CATALOGUE` constant with all 9 workflows
- [x] Register tool first in tool registration order
- [x] Add integration tests: shape, all workflow ids, `scene_count` vs db, per-workflow structural validity
- [x] Update `PRD.md` overview to reference this feature
