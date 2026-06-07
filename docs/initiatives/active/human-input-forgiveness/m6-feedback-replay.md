# M6 Feedback Replay and Release Audit

Date: 2026-06-07

Scope: Human Input Forgiveness M6 closes the initiative by auditing public docs,
generated tool reference coverage, release-log entries, and the original
temp-fixture feedback scenarios. This milestone records evidence only; it does
not add new runtime behavior.

## Documentation Contract

- README now states that stable IDs remain canonical even when selected
  unambiguous human-shaped inputs are accepted at the request boundary.
- README and generated tool docs distinguish keyword metadata search from
  semantic/prose search.
- Generated tool reference already documents `recommended_next_actions`,
  relationship evidence resolution, already-linked one-sided evidence no-ops,
  restore `plan_summary`/`blocking_requirements`, and
  `include_unchanged=false`.
- The remaining semantic search expectation is explicitly deferred to
  `docs/initiatives/backlog/embeddings-search/prd.md`.

## Release-Log Audit

| Milestone | Release-log entry | Client-facing coverage | Result |
| --- | --- | --- | --- |
| M1 | 2026-06-06 - Clarify next actions and relationship no-op responses | `recommended_next_actions`, relationship `NOT_FOUND` next steps, one-sided evidence `outcome: "no_op"`, and keyword metadata search wording. | Covered |
| M3 | 2026-06-06 - Accept unambiguous names in relationship evidence tools | Relationship evidence tools accept selected unambiguous scene titles, character names, place names, and case variants while returning canonical IDs. | Covered |
| M4 | 2026-06-07 - Make project restore plans easier to scan | Restore responses include `plan_summary`, structured `blocking_requirements`, and additive `include_unchanged=false`. | Covered |
| M5 | 2026-06-07 - Resolve common scene vocabulary variants | `find_scenes` accepts common case variants and unambiguous character names; tag/beat metadata suggestions stay advisory. | Covered |
| M6 | 2026-06-07 - Document Human Input Forgiveness replay and rollout | README contract note, generated docs audit, original feedback replay, and explicit backlog/deferred items. | Added in this milestone |

## Manual Temp-Fixture Replay

Command shape:

```sh
node --experimental-sqlite --input-type=module -e '<M6 replay harness using createTestContext>'
```

Fixture: `src/test/helpers/fixtures.js`, project `test-novel`, temporary
read/write sync directories, in-memory SQLite, MCP calls through the integration
test SSE client.

Observed replay summary:

```json
{
  "human_name_relationship_inputs": {
    "scene_id": "sc-003",
    "character_id": "elena",
    "outcome": "no_op",
    "resolved_from_keys": ["scene_id", "character_id"]
  },
  "case_variants": {
    "scene_ids": ["sc-003"],
    "resolved_filter_keys": ["tag", "beat", "chapter_id"]
  },
  "already_linked_evidence_noop": {
    "action": "connected",
    "outcome": "no_op",
    "already_linked": true
  },
  "describe_workflows_summary": {
    "recommended_next_actions_count": 4,
    "appears_before_workflows": true
  },
  "restore_checksum_required": {
    "ok": false,
    "blocking_requirement_types": [
      "project_restore_current_snapshot_confirmation_required"
    ],
    "include_unchanged": false,
    "unchanged_rows_in_plan": 0
  },
  "keyword_metadata_search_wording": {
    "ok": false,
    "error_code": "NO_RESULTS",
    "search_type": "keyword_metadata_fts",
    "next_step_mentions_metadata_keywords": true,
    "next_step_mentions_not_semantic_or_prose": true,
    "next_step_mentions_get_scene_prose": true
  }
}
```

## Original Feedback Status

| Feedback point | Replay result | Status |
| --- | --- | --- |
| Exact IDs required almost everywhere | Relationship evidence tools accept unambiguous scene title and character/place names; `find_scenes` accepts selected case variants. Stable IDs remain canonical. | Improved |
| `search_metadata` sounds semantic | No-result response identifies `keyword_metadata_fts`, says it is not semantic/prose search, and points to `get_scene_prose` after likely scenes are found. | Improved wording; semantic search deferred |
| `ok: false` appears inside JSON payloads | No-result search still returns JSON envelope `ok: false`; M6 records this as an unchanged client parsing contract. | Explicitly retained |
| `describe_workflows` is long | Top-level `recommended_next_actions` appears before `workflows`. | Improved |
| Restore checksum-required response includes large unchanged plan | Apply refusal surfaces structured `blocking_requirements`; `include_unchanged=false` keeps unchanged row details out of `plan.changes` while preserving summary counts. | Improved |
| Already-linked one-sided evidence says `action: "connected"` | Response remains compatibility-safe with `action: "connected"` and adds `outcome: "no_op"`, `already_linked: true`, and next-step guidance. | Improved; action rename deferred |

## Closed or Deferred Questions

- Semantic/prose search remains out of scope for this initiative and belongs to
  the Embedding-Based Search backlog.
- Transport-level MCP errors remain out of scope; clients should parse the JSON
  envelope consistently.
- Renaming already-linked relationship responses to
  `action: "already_linked"` remains a compatibility-sensitive follow-up, not
  part of M6.
- Chapter title aliases and broader human-shaped targeting remain deferred;
  current chapter forgiveness is limited to exact canonical IDs and unique case
  variants where tools support it.
