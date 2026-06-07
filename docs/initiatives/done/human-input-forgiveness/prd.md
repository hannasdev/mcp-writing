# PRD: Human Input Forgiveness

**Status:** Done

Completed: 2026-06-07.

Created: 2026-06-06.

Related docs:
- [Product Overview](../../../../PRODUCT.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [MCP Tooling Usability](../../done/mcp-tooling-usability/prd.md)
- [Relationship Metadata Boundary](../../done/relationship-metadata-boundary/prd.md)
- [Database Backup and Recovery](../../done/database-backup-recovery/prd.md)
- [Embedding-Based Search](../../backlog/embeddings-search/prd.md)

## Goal

Make Writing MCP more forgiving of human-shaped inputs and more scannable in
stressful or ambiguous workflows, while preserving the product's canonical
stable-ID and explicit-mutation model.

The target state is:

- users and agents can provide natural names or case variants when the intended
  target is unambiguous;
- ambiguous, missing, or near-miss targets return deterministic suggestions,
  actionable candidates, and next steps without becoming mutation inputs;
- high-signal workflow and recovery responses put the most important action
  before long diagnostic or plan details;
- keyword metadata search is described honestly, without implying semantic or
  prose search.

## Source Feedback

Live user testing against `mcp-writing:3.24.1` found that the core workflows are
solid and guarded, especially relationship metadata boundaries and backup
restore protections.

The main usability issues were:

- exact IDs are required across many tools, while human names and case variants
  often fail;
- `search_metadata` sounds more semantic than it is;
- some failed calls return `ok: false` in the JSON envelope rather than an
  MCP-level error, which is workable but must remain explicit and consistent;
- `describe_workflows` is useful but long and needs a compact "next actions"
  tier;
- restore confirmation failures include a large unchanged plan, making the
  immediate diagnostic less prominent;
- repeated one-sided evidence connections return `action: "connected"` with
  `already_linked: true`, which reads like a mutation even when the operation is
  effectively a no-op.

## Problem

Writing MCP has intentionally moved toward stable identities and explicit
outcome workflows. That direction is correct for long-form manuscript state:
scene IDs, character IDs, place IDs, chapter IDs, and project IDs must survive
renames, reorderings, and source-tool changes.

However, daily use still asks humans and AI agents to know and type those IDs
too early. A caller may know "Elena Voss" but not `char-elena-voss`, or type
`Harbor` when the indexed tag is `harbor`. When the system rejects those
requests without candidates, the user experience feels brittle even though the
underlying safety model is sound.

The same issue appears in responses: some tools return all available detail,
but the next action is not visually dominant. This is especially costly in
backup restore flows where a user may already be trying to recover from a
stressful state.

## User Value

- Authors can use names and story vocabulary without first doing database-like
  lookup work.
- AI agents can recover from near misses by following structured suggestions
  instead of retrying blindly.
- Maintainers keep clear canonical identity boundaries and better regression
  coverage around response envelopes.
- Recovery and workflow-discovery output becomes easier to scan without
  removing detailed plan data for audits.

## Design Alignment

This initiative supports the product design principles:

1. **Two-phase retrieval:** forgiving lookup should improve metadata-first
   narrowing before prose is loaded.
2. **Preserve authorship and intent:** tools should resolve explicit caller
   intent, not silently invent relationships or editorial meaning.
3. **Stable identities:** durable IDs remain canonical; fuzzy or
   case-insensitive inputs are request-boundary conveniences only.
4. **Explicit structural mutation:** resolution must happen before sanctioned
   mutation workflows commit canonical state.
5. **Generated transparency:** compact summaries should make generated plans
   easier to review without hiding full details.
6. **Outcome-oriented tools:** failures should guide users toward the next
   writing, repair, recovery, or discovery outcome.

## Scope

In scope:

- Shared case-insensitive exact-match and near-match suggestions for common
  target classes:
  - scenes;
  - characters;
  - places;
  - exact and case-insensitive `chapter_id` handling where explicitly
    inventoried, with numeric chapter aliases remaining read-scoped
    compatibility inputs only and chapter-title resolution for mutating
    workflows requiring later re-review;
  - project-scoped tags and beats where tools accept vocabulary values.
- Additive response details for `NOT_FOUND`, `NO_RESULTS`, validation, and
  no-op outcomes where they help the caller continue.
- Compact `describe_workflows` summary tier before the full workflow map.
- Restore response scannability improvements, especially confirmation failures
  and unchanged restore rows.
- Clearer no-op outcomes for already-linked relationship evidence.
- Search contract wording and response guidance that distinguishes keyword
  metadata search from semantic or prose search.
- Human-readable release-log entries in each milestone that changes public
  tool behavior, response shape, or user/maintainer guidance.
- Unit and integration tests that prove stable-ID behavior remains intact.

Out of scope:

- Replacing stable IDs with names as canonical identity.
- Treating numeric chapter aliases as mutation targets.
- Accepting ambiguous fuzzy matches for mutating workflows without caller
  confirmation.
- Creating character or place sheets from freeform prose mentions.
- Implementing semantic embeddings search. That remains covered by the
  separate Embedding-Based Search backlog item.
- Redesigning MCP error transport semantics away from the existing JSON
  envelope.
- Changing already-linked relationship evidence from `action: "connected"` to
  a different action value in the first milestone.
- Building a broad UI or natural-language command parser.
- Changing authored prose storage or backup restore authority.

## Proposed Direction

### 1. Shared Resolution Boundary

Introduce a shared resolver for public tool inputs that need canonical targets.
The resolver should:

- accept current stable IDs exactly as the first and preferred path;
- match case-insensitive exact names or IDs when there is exactly one candidate;
- return near-match suggestions for misses only when the suggestion algorithm
  is local, deterministic, suggestion-only, and covered by tests;
- refuse ambiguous matches with candidate details instead of guessing;
- report the final canonical ID used by successful mutating tools.

The resolver should live at the request boundary. It should not change
canonical schema, durable IDs, sync/import behavior, or backup authority.

### 2. Better Failure Continuations

Tool failures should keep the existing envelope shape:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "...",
    "details": {
      "next_step": "..."
    }
  }
}
```

Within that envelope, add consistent details where useful:

- `lookup_kind`;
- `input`;
- `project_id`;
- `candidate_matches`;
- `next_step`;
- `resolution_hint`.

Ambiguous target resolution uses `AMBIGUOUS_TARGET`. Missing targets use
`NOT_FOUND` with candidate suggestions when available. This keeps ambiguity
parseable without changing the JSON error envelope.

This keeps clients/tests able to parse the existing envelope while making
failures more self-recovering.

### 3. Compact Workflow Discovery

Add a short top-level `recommended_next_actions` summary to
`describe_workflows`. It should appear before the full workflow catalogue in
the JSON response and contain the first three to five likely next actions using
the shape defined in the architecture notes.

The full workflow catalogue remains present for compatibility and detailed
agent planning.

### 4. Restore Response Scannability

Restore planning and confirmation failures should lead with the blocking
requirement and compact plan summary.

Preferred additive fields:

- `blocking_requirements`;
- `plan_summary`;
- `plan_detail_policy`;
- `include_unchanged` input, where the default preserves full unchanged rows
  and `include_unchanged=false` suppresses unchanged rows.

Do not weaken checksum, destructive, cross-scope, dry-run, or transactional
restore protections.

The first implementation should be additive: introduce `include_unchanged`
without changing the default full-plan contract. A later breaking cleanup may
change defaults only after documenting compatibility impact and release notes.

### 5. Honest Search Language

Keep `search_metadata` compatible, but clarify that it is keyword/FTS metadata
search over titles, loglines, and metadata keywords. M1 does not add a new
alias; it improves wording and no-result guidance only. A future planning pass
may consider additive aliases such as `keyword_search_metadata`, but aliases
create permanent tool surface area and are not part of the first slice.

Semantic or prose search should remain a separate initiative because it implies
new indexing, model/backend decisions, privacy/cost tradeoffs, and evaluation
work.

## Acceptance Criteria

- Stable IDs continue to work exactly as before.
- Unambiguous case-insensitive names or IDs resolve to canonical IDs for the
  selected target classes.
- Ambiguous fuzzy matches never trigger a mutating workflow without an explicit
  canonical ID or follow-up confirmation.
- Ambiguous target resolution returns `AMBIGUOUS_TARGET`; no-match resolution
  returns `NOT_FOUND` with suggestions when available.
- Near-match ranking, if present, is local, deterministic, suggestion-only, and
  covered by tests before it appears in public responses.
- Relationship evidence tools return actionable `NOT_FOUND` details for
  missing scenes, characters, and places.
- Already-linked one-sided evidence returns an explicit no-op outcome or next
  step that cannot be mistaken for a fresh mutation.
- M1 preserves `action: "connected"` for already-linked evidence and adds
  additive `outcome: "no_op"` plus clear next-step guidance rather than changing
  the existing action value.
- `describe_workflows` exposes a compact recommended-action tier before the
  full workflow list using the exact `recommended_next_actions` field.
- Restore confirmation failures lead with blocking requirements and compact
  summary data.
- Restore responses expose `include_unchanged` as an additive way to suppress
  unchanged rows before any default response-shape change is considered.
- Search tool documentation and generated tool reference no longer imply
  semantic/prose search.
- Unit and integration tests cover resolver success, resolver ambiguity,
  response envelopes, no-op evidence behavior, workflow summary fields, and
  restore response shape.

## Risks

### Silent Wrong-Target Mutation

Forgiving resolution could accidentally map a human name to the wrong canonical
record.

Mitigation:
- only auto-resolve exact stable IDs and unambiguous case-insensitive exact
  matches;
- return candidates instead of guessing for near matches;
- include `resolved_from` and canonical IDs in mutation responses.

### Contract Churn For Existing Clients

Changing response shape could break clients that assert exact payloads.

Mitigation:
- prefer additive fields;
- keep existing envelopes and core fields;
- update generated docs and integration tests together.
- include release-log entries in the same milestone PR as any public behavior
  or response-shape change.

### Search Scope Creep

User feedback about semantic expectations could pull this initiative into
embedding search.

Mitigation:
- clarify naming and next-step guidance now;
- keep semantic search in the existing Embedding-Based Search backlog item.

### Overlong Guidance

Adding more suggestions can make responses longer instead of clearer.

Mitigation:
- lead with compact summaries and place detailed candidates/plans under
  structured detail fields;
- test response shape for common stressful recovery paths.

## Test Strategy

Unit tests:

- resolver exact stable-ID behavior;
- case-insensitive unique match behavior;
- ambiguity and no-match candidate details;
- candidate ranking boundaries;
- local deterministic suggestion-only behavior;
- restore plan compaction helpers;
- response envelope helpers where shared.

Integration tests:

- relationship evidence tools with human names, case variants, and bad inputs;
- ambiguity paths returning `AMBIGUOUS_TARGET` without mutation;
- `describe_workflows` compact summary plus full workflow catalogue;
- restore dry-run and confirmation-required responses with compact details;
- `search_metadata` no-result guidance and documentation contract;
- regression coverage proving canonical mutation order and backup refresh remain
  unchanged.

Manual validation:

- repeat the live temp-fixture feedback scenarios;
- verify that successful mutations report canonical IDs;
- verify that no-op relationship evidence reads clearly as no-op;
- inspect generated tool docs for search and workflow language.
- confirm release-log coverage for every public response or tool-contract
  change before a milestone PR is considered ready.

## Settled Planning Decisions

- Relationship evidence tools are the first production slice for forgiving
  mutating inputs; broader mutating-tool rollout should follow only after those
  tests prove the resolver boundary.
- Early resolver milestones may auto-resolve exact stable IDs and unique
  case-insensitive exact ID/name matches. Near matches are suggestions only.
- Ambiguous target resolution uses `AMBIGUOUS_TARGET`; no-match resolution uses
  `NOT_FOUND` with suggestions when available.
- M1 no-op relationship evidence preserves the existing action value and adds
  additive `outcome: "no_op"` plus next-step guidance.
- Restore scannability starts with additive `include_unchanged` support while
  preserving current default full-plan detail; `include_unchanged=false`
  suppresses unchanged rows.
- M5 chapter handling is limited to `find_scenes.chapter_id` canonical
  resolution and preserving `find_scenes.chapter` as a read-only compatibility
  alias. Chapter-title resolution for mutating chapter workflows requires a
  later reviewed planning update.

- M1 improves `search_metadata` wording and no-result guidance only; it does
  not add a new alias.
- Existing relationship evidence `*_id` arguments remain the public parameters;
  M3 extends their contract so they accept canonical IDs first and selected
  unambiguous human-shaped inputs second.
