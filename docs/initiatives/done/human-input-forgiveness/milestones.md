# Human Input Forgiveness - Milestones

**Status:** Done

Current focus: None - initiative closed.

Created: 2026-06-06.

## Objective

Ship forgiving request-boundary resolution and compact response guidance in
small, reviewable slices without weakening Writing MCP's stable-ID,
SQLite-canonical, explicit-mutation model.

## Guardrails

- Stable IDs remain canonical and continue to be accepted exactly.
- Name, tag, beat, or case-insensitive matching is a request-boundary
  convenience, not durable identity.
- Mutating tools must not apply ambiguous fuzzy matches.
- Near-match suggestions, when present, must be local, deterministic,
  suggestion-only, and covered by tests before being exposed.
- Response changes should be additive unless a milestone explicitly calls out a
  breaking cleanup.
- Every milestone that changes public tool behavior, response shape, generated
  tool documentation, or user/maintainer guidance must include a release-log
  entry in the same milestone PR.
- Search wording must not promise semantic or prose search until a separate
  semantic-search initiative implements it.
- Restore safety requirements must not be weakened.

## M1 - Response Clarity Baseline

Goal: make the most confusing successful and failed responses clearer before
changing input resolution.

Deliverables:

- Add explicit no-op outcome wording for already-linked one-sided relationship
  evidence by preserving the existing `action: "connected"` value and adding
  additive `outcome: "no_op"` plus clear next-step guidance.
- Add `next_step` details to `NOT_FOUND` errors from relationship evidence
  tools.
- Add compact `recommended_next_actions` summary tier to `describe_workflows`
  while preserving the full workflow catalogue. The field name is exactly
  `recommended_next_actions`.
- Clarify `search_metadata` description and no-result guidance as keyword/FTS
  metadata search, not semantic/prose search.
- Do not add a `search_metadata` alias in this milestone.
- Regenerate agent tool docs if tool descriptions change.
- Update README/user-facing docs if the changed response or search wording
  affects app users.
- Add a release-log entry for the public response and guidance changes.

Acceptance criteria:

- Calling one-sided evidence connection for an already-linked entity returns a
  clearly recognizable no-op result via additive `outcome: "no_op"` while
  preserving `action: "connected"` for compatibility.
- Missing scene, character, or place in relationship evidence tools returns an
  actionable `next_step`.
- `describe_workflows` puts `recommended_next_actions` before long workflow
  details, ordered by likely next action priority.
- `search_metadata` no longer suggests it can answer semantic/prose queries by
  name or wording.
- No new `search_metadata` alias exists in M1.
- Existing clients can still parse the previous core fields.
- User-facing docs are updated if app-user behavior or guidance changes.
- Release-log coverage exists before this milestone is PR-ready.

Required validation:

- Unit tests for no-op outcome construction where applicable.
- Integration tests for relationship `NOT_FOUND` details.
- Integration tests for `describe_workflows` summary fields.
- Search/tool-doc assertions updated to the new keyword-search language.
- README/user-facing documentation assertions or review notes are included when
  behavior affects app users.
- Release-log entry reviewed for user/client-visible behavior changes.

Explicit non-goals:

- No fuzzy matching or human-name resolution yet.
- No restore plan compaction yet.
- No semantic search implementation.

## M2 - Shared Canonical Target Resolver

Goal: introduce a reusable resolver that can safely convert unambiguous
human-shaped inputs into canonical target IDs.

Deliverables:

- Build the shared resolver as internal infrastructure only. M2 should not
  broaden any public tool input contract until M3 wires it into relationship
  evidence tools.
- Shared resolver helpers for target classes needed by the first production
  tools:
  - scene by `scene_id` or unique title within `project_id`;
  - character by `character_id` or name within project/universe scope;
  - place by `place_id` or name within project/universe scope.
- Case-insensitive exact matching for IDs and names.
- Candidate details for no-match and ambiguous-match outcomes.
- Error taxonomy: ambiguous targets return `AMBIGUOUS_TARGET`; missing targets
  return `NOT_FOUND` with suggestions when available.
- A suggestion policy that permits exact/case-insensitive auto-resolution only;
  any near-match ranking is local, deterministic, suggestion-only, and covered
  by tests before public use.
- Response details that include `resolved_from` and canonical IDs when a
  non-canonical input succeeds.

Acceptance criteria:

- Exact stable IDs behave unchanged.
- Unique case-insensitive ID/name matches resolve successfully.
- Ambiguous name matches do not mutate state and return candidate matches.
- Ambiguous resolution responses use `AMBIGUOUS_TARGET` in the JSON error
  envelope.
- Near matches are suggestions only unless a later reviewed milestone
  explicitly accepts a confirmation shape.
- Resolver behavior is deterministic and project-scoped.
- Candidate responses follow the architecture cap: default maximum 5
  candidates, hard maximum 10 only when a tool explicitly opts in.
- No public tool accepts new human-shaped inputs before M3.

Required validation:

- Unit tests for resolver exact, case-insensitive, no-match, and ambiguous
  cases.
- Tests for project/universe scoping of character and place resolution.
- Tests that character/place resolution follows the existing relationship-tool
  lookup rule: project-owned records, records in the same universe as the
  project, or global records with both `project_id` and `universe_id` null.
- Regression tests proving stable-ID paths keep current behavior and response
  compatibility.
- Fixture-backed resolver contract tests cover candidate shape, ordering, and
  count caps.

Explicit non-goals:

- No broad fuzzy ranking as mutation input.
- No creation of missing scenes, characters, or places.
- No changes to SQLite identity schema.

## M3 - Forgiving Relationship Evidence Inputs

Goal: apply the shared resolver to the most painful daily-work mutation path:
scene-character/place evidence tools.

Deliverables:

- Allow relationship evidence tools to accept unambiguous resolved scene,
  character, and place inputs.
- Keep the existing public arguments (`scene_id`, `character_id`, and
  `place_id`) and extend their descriptions/contracts: canonical IDs are the
  preferred input, and selected unambiguous human-shaped inputs are accepted
  only through the shared resolver.
- Return canonical IDs and `resolved_from` details in successful responses.
- Preserve SQLite-first mutation order, backup refresh, and generated
  compatibility output behavior.
- Ensure all failed resolution paths return structured candidate and next-step
  details.
- Add a release-log entry for accepting unambiguous human-shaped relationship
  evidence inputs and the new resolver response details.
- Update README/user-facing docs for the broadened relationship evidence input
  contract if those tools are documented for app users.

Acceptance criteria:

- Inputs like human character/place names work when unambiguous.
- Generated tool docs state that `*_id` parameters prefer canonical IDs and
  accept only selected unambiguous human-shaped inputs.
- Case variants of valid IDs work when unambiguous.
- Ambiguous or misspelled inputs return suggestions without mutating SQLite or
  generated compatibility output.
- Ambiguous inputs return `AMBIGUOUS_TARGET`; missing inputs return
  `NOT_FOUND` with suggestions when available.
- Operation history and backup refresh record canonical IDs.
- Release-log coverage exists before this milestone is PR-ready.
- User-facing docs are updated when the changed input contract affects app
  users.

Required validation:

- Integration tests for `connect_character_place_evidence`.
- Integration tests for `connect_scene_character_evidence`.
- Integration tests for `connect_scene_place_evidence`.
- Negative tests proving ambiguous names and suggestions do not write canonical
  rows.
- Negative tests prove ambiguous or suggested-only matches do not refresh
  generated compatibility output, append operation history, or refresh backup
  artifacts.
- Existing relationship metadata boundary tests continue to pass.

Explicit non-goals:

- No bulk relationship repair changes.
- No unlink/delete relationship workflows.
- No sheet creation from freeform prose mentions.

## M4 - Restore Plan Scannability

Goal: make backup restore responses easier to read under pressure while keeping
dry-run-first and checksum-required safety intact.

Deliverables:

- Add compact `blocking_requirements` to confirmation-refused restore
  responses.
- Add `plan_summary` that highlights create/update/delete/refused/conflict/
  unchanged counts and cross-scope/destructive counts.
- Add additive `include_unchanged` input so callers can suppress unchanged rows
  while the default full-plan detail remains compatible.
- Preserve existing full plan access where callers need audit detail.
- Add a release-log entry for restore response-shape additions.
- Update README/user-facing recovery docs if restore response guidance or
  parameters are documented for app users.

Acceptance criteria:

- `dry_run=false` without checksum leads with the checksum requirement.
- Destructive and cross-scope confirmation requirements are visually prominent.
- Long unchanged rows can be suppressed through documented
  `include_unchanged=false` without changing the default response shape.
- Full plan detail remains retrievable for review.
- Release-log coverage exists before this milestone is PR-ready.
- User-facing docs are updated when restore behavior or guidance visible to app
  users changes.

Required validation:

- Unit tests for plan summary and unchanged compaction behavior.
- Integration tests for checksum-required, checksum-changed, destructive, and
  cross-scope restore refusal responses.
- Regression tests for successful dry-run and applied restore behavior.

Explicit non-goals:

- No weakening of checksum, destructive, cross-scope, or transactional restore
  requirements.
- No change to backup snapshot authority.
- No prose backup or restore changes.

## M5 - Extended Vocabulary Resolution

Goal: apply forgiving resolution to non-identity metadata values where case and
near-match friction is common.

Deliverables:

- Case-insensitive matching or suggestions for tags, beats, character-backed
  filters, and the explicitly inventoried chapter filter.
- Field inventory for M5:
  - `find_scenes.character` and `find_scenes.pov` may resolve character IDs by
    the shared character resolver;
  - `find_scenes.tag` and `find_scenes.beat` may use case-insensitive
    read-filter matching or suggestions based on existing indexed values;
  - `find_scenes.chapter_id` may use canonical chapter resolution;
  - `find_scenes.chapter` remains a numeric read-scope compatibility alias;
  - `update_scene_metadata.fields.tags` may preserve supplied casing while
    returning suggestions for existing differently cased tags;
  - `update_scene_metadata.fields.save_the_cat_beat` may use suggestions for
    existing beat values but remains freeform unless a separate controlled
    vocabulary decision is made.
- Chapter resolution in M5 is limited to `find_scenes.chapter_id`; numeric
  chapter aliases remain read-only compatibility filters and never mutating
  targets. Chapter-title resolution for mutating chapter workflows is outside
  M5 unless the initiative docs are updated and re-reviewed.
- Candidate suggestions for `find_scenes` and `update_scene_metadata` filters
  or fields where appropriate.
- Clear distinction between controlled canonical IDs and freeform editorial
  values.
- Add a release-log entry for any public vocabulary matching or suggestion
  behavior shipped in this milestone.
- Update README/user-facing docs for any public vocabulary matching or
  suggestion behavior that affects app users.

Acceptance criteria:

- Querying or updating with common case variants succeeds or returns useful
  suggestions according to field ownership.
- M5 behavior is limited to the named field inventory unless the initiative docs
  are updated and re-reviewed.
- `find_scenes.chapter_id` reports or filters by canonical `chapter_id`, and
  numeric chapter aliases remain read-only.
- Freeform fields remain freeform where no canonical vocabulary exists.
- Metadata search and scene discovery remain metadata-first and do not read
  prose unless the caller explicitly invokes prose tools.

Required validation:

- Unit tests for vocabulary normalization/suggestion helpers.
- Integration tests for scene discovery filters and safe metadata update paths.
- Integration tests proving numeric chapter aliases stay read-only and
  `find_scenes.chapter_id` resolution uses canonical `chapter_id`.
- Regression tests proving relationship and structural guardrails still reject
  inappropriate generic metadata writes.
- Release-log coverage exists before this milestone is PR-ready when public
  behavior changes.
- User-facing docs are updated before PR readiness when public vocabulary
  behavior changes.

Explicit non-goals:

- No new controlled vocabulary system unless product scope is explicitly
  expanded.
- No numeric chapter alias mutation.
- No semantic interpretation of prose.
- No hidden canonical relationship mutation through tags or freeform metadata.

## M6 - Documentation, Release Notes, and Feedback Replay

Status: Implemented on branch.

Goal: make the new UX contract durable and verify it against the original live
testing scenarios.

Deliverables:

- Update user-facing docs when behavior changes affect app users.
- Update generated agent tool reference.
- Audit release-log entries from M1, M3, M4, and M5; add a final release-log
  entry only if M6 itself changes user-facing docs or rollout guidance.
- Record manual replay results for the original temp-fixture feedback
  scenarios.
- Document remaining semantic search expectations as belonging to the
  Embedding-Based Search backlog item.

Acceptance criteria:

- Docs explain that stable IDs remain canonical even when tools accept
  unambiguous human-shaped inputs.
- Release notes identify any client-facing response additions or default
  compaction changes.
- Manual replay confirms the original rough edges are improved or explicitly
  deferred.
- Open questions are either closed or moved into a follow-up backlog item.

Required validation:

- Full relevant unit and integration test suites pass.
- Manual temp-fixture validation covers:
  - human-name relationship inputs;
  - case variants;
  - already-linked evidence no-op;
  - `describe_workflows` summary;
  - restore checksum-required response;
  - keyword metadata search wording.

Explicit non-goals:

- No activation of Embedding-Based Search.
- No client UI implementation.
- No new transport-level MCP error model.

## Definition Of Done

This initiative is complete when:

1. Users and agents can safely use unambiguous human-shaped inputs for the
   selected high-value tools.
2. Ambiguous inputs return structured candidates instead of guessing.
3. The most important next action is visible first in workflow and restore
   responses.
4. Keyword metadata search is named and documented honestly.
5. Stable IDs, canonical mutation order, backup freshness, and relationship
   boundaries remain protected by regression tests.
