# Human Input Forgiveness - Architecture Notes

**Status:** Done

Created: 2026-06-06.

## Context

Writing MCP intentionally uses durable canonical IDs for structural manuscript
state. That model is necessary because names, titles, order, folders, and source
tool representations change over the life of a manuscript.

The usability gap is at the public request boundary: callers often know the
human-facing name or a case variant, not the exact canonical ID. The system can
be more forgiving there without weakening canonical identity, as long as
resolution is explicit, deterministic, scoped, and conservative.

## Architecture Principle

Forgiving input belongs at the tool request boundary.

It must not:

- change canonical IDs;
- add name-based identity to SQLite;
- let sidecars or generated artifacts become authority;
- guess ambiguous targets for mutating workflows;
- invent editorial meaning or promote prose mentions into world-model records.

It may:

- resolve exact stable IDs;
- resolve unique case-insensitive names or IDs;
- suggest candidate canonical IDs for near misses;
- include canonical `resolved_id` details in responses;
- help the caller continue after a failed lookup.

## Resolver Boundary

### Inputs

Each resolver call should receive:

- target kind, such as `scene`, `character`, `place`, `chapter`, `tag`, or
  `beat`;
- raw caller input;
- project scope when required;
- universe scope when the domain allows project/universe inheritance;
- mode:
  - `strict_id`;
  - `case_insensitive_exact`;
  - `suggest_only`;
  - future `near_match_suggestions`.

### Outputs

Successful resolution should return:

- canonical ID or canonical value;
- target kind;
- whether the input was already canonical;
- `resolved_from` details when the input differed from the canonical ID;
- optional display label.

Failed resolution should return:

- stable error code;
- target kind;
- input;
- project/universe scope;
- candidate matches when available;
- next step.

### Match Policy

The default policy should be conservative:

1. Exact stable ID match.
2. Case-insensitive stable ID match when unique.
3. Case-insensitive display-name match when unique.
4. Suggestions for other near matches.
5. Refuse ambiguity.

Only steps 1-3 may automatically proceed to mutation. Step 4 is guidance only
unless a future milestone explicitly adds an approved confirmation shape.
Any step-4 ranking must be local, deterministic, suggestion-only, and covered
by tests before it appears in public responses.

### Error Taxonomy

Resolver failures stay inside the existing JSON error envelope.

- Use `AMBIGUOUS_TARGET` when more than one valid canonical target matches by
  exact or case-insensitive ID/name/title resolution.
- Use `NOT_FOUND` when no canonical target matches. Include fuzzy or near-match
  suggestions when deterministic suggestions are available.
- Use existing validation errors for malformed scope, invalid project IDs, or
  inputs that are disallowed by a tool contract, such as numeric chapter aliases
  in mutating chapter workflows.

Both `AMBIGUOUS_TARGET` and suggestion-bearing `NOT_FOUND` responses must
include `lookup_kind`, `input`, relevant scope fields, `candidate_matches` when
available, and `next_step`.

### Candidate And Resolution Detail Shape

Candidate lists should be compact and deterministic. Default maximum:
5 candidates, with a hard maximum of 10 if a tool explicitly opts in.

Each `candidate_matches` entry should include:

- `target_kind`;
- canonical `id`;
- `label`;
- `matched_field`;
- `match_type`, such as `exact_id`, `case_insensitive_id`,
  `case_insensitive_name`, `case_insensitive_title`, or
  `near_match_suggestion`;
- relevant scope fields such as `project_id` and `universe_id`;
- optional `context` with target-specific details.

Candidate ordering:

1. exact/case-insensitive ID matches;
2. exact/case-insensitive display-name or title matches;
3. deterministic near-match suggestions;
4. within a group, sort by lowercase `label`, then canonical `id`.

Successful `resolved_from` details should use the public argument name as the
key and include:

- `input`;
- `matched_field`;
- `match_type`;
- canonical `id`.

`resolution_hint` is a short human-readable hint only; clients should parse
`candidate_matches` and `next_step` instead of deriving behavior from the hint.

### Workflow Recommendation Shape

`describe_workflows` should expose a top-level `recommended_next_actions`
array before `workflows`. It should contain three to five entries ordered by
likely next action priority.

Each entry should include:

- `id`: stable recommendation ID;
- `label`: short human-readable action label;
- `tool`: primary MCP tool to call next;
- `reason`: why this action is recommended from current context;
- `next_step`: concise instruction for the caller.

Optional fields:

- `workflow_id`: related workflow catalogue ID;
- `priority`: numeric ordering value when deterministic ordering needs to be
  asserted in tests.

The full `WORKFLOW_CATALOGUE` remains the detailed navigation surface. The
recommendation array is an additive summary and must not remove or reorder the
full catalogue.

## Target Classes

### Scenes

Scene resolution is project-scoped. Stable `scene_id` remains the canonical
input. Optional title matching must be unique within the project. No other
scene display fields are accepted as auto-resolution inputs in this initiative.

Ambiguity risk:
- scene titles are more likely to repeat or be draft placeholders.

Mitigation:
- prefer ID;
- include chapter/timeline/title context in candidate matches;
- never auto-resolve near matches for scene mutation.

Scene candidate `context` should include `project_id`, `title`, `chapter_id`,
`chapter_title`, and `timeline_position` when available.

### Characters

Character resolution must follow the existing relationship-tool ownership rule:
for a given project, candidates may be project-owned, in the same universe as
the project, or global records with both `project_id` and `universe_id` null.

Ambiguity risk:
- two characters can share names across projects or universes.

Mitigation:
- scope candidates by the relationship-tool project/universe/global lookup rule;
- return role or first appearance when available.

### Places

Place resolution mirrors character resolution: candidates may be project-owned,
in the same universe as the project, or global records with both `project_id`
and `universe_id` null.

Ambiguity risk:
- locations often have aliases or generic names.

Mitigation:
- start with exact/case-insensitive matching;
- scope candidates by the relationship-tool project/universe/global lookup rule;
- defer alias handling unless current schema already stores aliases.

### Chapters

Chapter resolution is project-scoped. Canonical `chapter_id` remains the
preferred mutating input for chapter and scene-placement workflows.

Allowed request-boundary forgiveness for this initiative:

- exact `chapter_id`;
- unique case-insensitive `chapter_id`.

Chapter-title resolution for mutating chapter workflows is a future expansion
that requires a reviewed planning update before implementation.

Numeric chapter aliases remain read-scoped compatibility inputs only. They may
continue to help `find_scenes`, chapter prose retrieval, styleguide analysis,
batch enrichment, and review-bundle planning, but they must not become mutation
targets for creating, renaming, reordering, attaching epigraphs, moving scenes,
or assigning scenes to chapters.

Ambiguity risk:
- chapter titles are mutable and may repeat;
- numeric chapter labels are compatibility aliases, not identity.

Mitigation:
- prefer canonical `chapter_id`;
- include title, sort order, and project context in candidate matches;
- never auto-resolve numeric chapter aliases for mutating workflows;
- fail closed on repeated titles or title/order ambiguity.

### Tags, Beats, And Editorial Vocabulary

These are not all canonical identity fields. Resolution should distinguish:

- values with existing indexed vocabulary that can support suggestions;
- freeform editorial values that should not become controlled lists by
  accident.

Case-insensitive matching can reduce friction, but mutation behavior should not
silently rewrite user-chosen editorial text unless the tool already normalizes
that field.

## Response Contracts

### Error Envelope

The existing JSON envelope remains:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "...",
    "details": {}
  }
}
```

This initiative should add details, not move to transport-level MCP errors.

Recommended detail fields:

- `lookup_kind`;
- `input`;
- `project_id`;
- `universe_id`;
- `candidate_matches`;
- `next_step`;
- `resolution_hint`.

### Successful Mutation Responses

When forgiving resolution is used, mutating tools should include:

- canonical IDs in existing fields;
- `resolved_from` details for each non-canonical input;
- unchanged mutation-order, backup-refresh, and compatibility-output fields.

Example shape:

```json
{
  "ok": true,
  "action": "connected",
  "scene_id": "sc-014-argument",
  "character_id": "char-elena-voss",
  "resolved_from": {
    "character_id": {
      "input": "Elena Voss",
      "matched_field": "name"
    }
  }
}
```

Relationship evidence tools keep the existing public argument names
(`scene_id`, `character_id`, `place_id`). Their broadened contract is:

1. canonical IDs are preferred and resolved first;
2. selected unambiguous human-shaped inputs may be accepted through the shared
   resolver;
3. successful responses always return canonical IDs in the existing fields and
   place any non-canonical input details under `resolved_from`.

### No-Op Responses

Already-satisfied relationship evidence should not read as a new mutation.

M1 must preserve the existing `action: "connected"` value and add additive
fields:

- `outcome: "no_op"`;
- existing `already_linked: true`;
- clear `next_step` explaining that no canonical rows changed.

Changing to `action: "already_linked"` is a compatibility-sensitive follow-up,
not part of M1.

## Restore Response Compaction

Restore planning has two audiences:

- humans under recovery pressure who need the blocking requirement first;
- agents/maintainers who need full plan detail for audit.

The response should serve both by separating summary from detail:

- `blocking_requirements` for confirmation failures;
- `plan_summary` for counts and risk flags;
- full `plan` retained or available on request;
- explicit policy for unchanged rows.

The first implementation should introduce additive `include_unchanged` support:
default behavior preserves current full-plan detail, while
`include_unchanged=false` suppresses unchanged rows. Changing the default detail
level is a later compatibility decision that requires release notes and an
explicit milestone or contract cleanup.

## Workflow Discovery Summary

`describe_workflows` already owns initial orientation and uncertainty handling.
The compact tier should not replace the workflow catalogue. It should provide
the first three to five likely next actions based on:

- scene count;
- setup contract status;
- migration warnings;
- backup or runtime warnings if already surfaced in context;
- default manuscript-discovery workflow.

The full `WORKFLOW_CATALOGUE` remains the durable map for detailed agent
planning.

## Search Boundary

`search_metadata` currently uses SQLite FTS over scene titles, loglines, and
metadata keywords. That is valuable, but it is not semantic search and does not
read prose.

This initiative may:

- clarify the tool description;
- improve no-result guidance;
- defer any alias decision to future planning.

It should not:

- add embeddings;
- add model calls;
- index prose semantically;
- change privacy/cost posture.

Semantic search belongs to the existing Embedding-Based Search backlog item.

## Migration And Compatibility

This initiative should be additive where possible:

- stable IDs remain valid;
- existing tool names remain valid;
- existing response fields remain present;
- new resolver and summary details are added under new fields.

Potential breaking changes, such as changing `action: "connected"` to
`action: "already_linked"` or default restore plan compaction, should be called
out in milestone acceptance criteria and release notes before implementation.
M1 does not take that action-value change; it uses additive fields only.

## Failure Modes

### Ambiguous Human Name

Return `AMBIGUOUS_TARGET` with candidates and next step. Do not mutate.

### Near Miss With One Candidate

Return suggestions only in early milestones. Do not mutate from fuzzy-only
matches without explicit confirmation design.

Near-match ranking, if exposed, must be local and deterministic. It must not
call an external model or semantic backend as part of this initiative.

### Case Variant Of Existing ID

Resolve if unique and report canonical ID.

### Case Variant Of Tag Or Beat

For read filters, match existing vocabulary case-insensitively where possible.
For writes, preserve field ownership rules and avoid silently changing freeform
authorial text unless the field already normalizes.

### Numeric Chapter Alias In A Mutation

Reject or return a candidate list that points to canonical `chapter_id` values.
Do not reinterpret numeric chapter aliases as mutating IDs.

### Resolver Internal Error

Fail closed with a normal tool error. Do not fall back to a guessed target.

## Alternatives Considered

### Require Callers To Use List Tools First

This preserves safety but leaves the exact UX friction identified by testing.
It should remain the fallback for ambiguity, not the only path for unambiguous
human inputs.

### Make Names Canonical

Rejected. Names change and can repeat. This violates stable identity and would
make long-form manuscript state harder to maintain.

### Semantic Search Now

Rejected for this initiative. The feedback exposes a naming and expectation gap
that can be improved immediately, while semantic search requires a separate
backend, indexing, privacy, and evaluation decision.

### Transport-Level MCP Errors

Rejected for this initiative. The current JSON envelope is already used by
clients and tests. The immediate need is consistent parseable detail inside the
envelope.
