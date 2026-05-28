# Relationship Metadata Boundary — Milestones

**Status:** Deferred backlog (not active)

Use [prd.md](prd.md) for product framing and this document for sequencing,
review gates, and implementation readiness.

## Objective

Close the remaining sidecar-first relationship mutation path while preserving
legacy compatibility and keeping the repository coherent after each slice.

## Guardrails

- Do not remove sidecar/frontmatter import compatibility.
- Do not turn sync into a daily-work relationship mutation API.
- Do not broaden this initiative into tags, flags, status, versions, or place
  profile metadata unless a milestone explicitly re-scopes through planning.
- Preserve SQLite as canonical for scene-backed character/place relationships.
- Keep project backups refreshed after canonical relationship mutations.
- Keep public tools outcome-oriented.

## M0 — Contract Decision And Characterization

Goal: make the current behavior and target contract reviewable before changing
tool behavior.

Deliverables:

- Characterization tests for current `update_scene_metadata` handling of
  `characters` and `places`.
- A documented contract decision choosing strict rejection or
  compatibility-only behavior for those fields.
- If compatibility-only behavior remains an option, a decision on how it avoids
  delayed canonical mutation through ordinary sync.
- Identification of any known clients or docs that still recommend generic
  metadata updates for relationship changes.
- Explicit confirmation that `tags`, `status`, `flags`, and `versions` remain
  outside this initiative.

Acceptance criteria:

- Reviewers can see the before/after contract from tests and docs.
- The chosen contract is consistent with the Managed Structure Contract.
- The migration path preserves legacy sync/import compatibility.
- Compatibility-only behavior, if chosen, cannot write ordinary fields that
  ordinary sync later adopts as canonical relationship state.
- No public behavior changes are included beyond characterization or docs.

Required validation:

- `node --experimental-sqlite --test src/test/unit/metadata-tools.test.mjs`
- `node --experimental-sqlite --test src/test/integration/metadata.test.mjs`

Out of scope:

- Rejecting fields in production.
- Adding new relationship tools.
- Changing sync indexing behavior.

## M1 — Generic Metadata Relationship Guardrail

Goal: stop `update_scene_metadata` from silently converting sidecar-first
character/place edits into canonical relationship authority.

Deliverables:

- Apply the M0 contract decision to `update_scene_metadata`.
- Return actionable guidance that points callers to
  `connect_character_place_evidence`, `audit_relationship_metadata`, and
  relevant discovery tools.
- Preserve non-relationship metadata behavior for title, logline, status, beat,
  POV, tags, and story time.
- Preserve structural sidecar-field protection from the earlier sidecar
  boundary work.

Acceptance criteria:

- A call to `update_scene_metadata` with `characters` or `places` either fails
  with a clear relationship-boundary error or stores only non-authoritative
  compatibility/review metadata without changing canonical relationship rows,
  depending on the M0 decision.
- If compatibility/review metadata is retained, subsequent ordinary sync does
  not convert that retained metadata into canonical relationship rows.
- The tool response names the correct relationship workflow for daily work.
- Existing allowed metadata fields continue to work.
- Sidecar structural compatibility fields remain preserved.
- Canonical relationship indexes do not change through sidecar-first generic
  metadata writes.

Required validation:

- `node --experimental-sqlite --test src/test/unit/metadata-tools.test.mjs`
- `node --experimental-sqlite --test src/test/integration/metadata.test.mjs`
- `node --experimental-sqlite --test src/test/integration/search.test.mjs`

Out of scope:

- Removing sync/import compatibility fields.
- Redesigning tags.
- Bulk relationship editing.

## M2 — Compatibility Sync And Audit Alignment

Goal: keep legacy projects usable while making compatibility authority visible.

Deliverables:

- Ensure sync/import still indexes existing sidecar/frontmatter
  `characters` and `places` as compatibility input.
- Ensure `audit_relationship_metadata` distinguishes retained compatibility
  fields from canonical relationship authority.
- Add diagnostics or next-step guidance for scenes where compatibility fields
  appear stale or disagree with canonical indexes.
- Confirm generated sidecar compatibility output remains clearly
  non-authoritative.

Acceptance criteria:

- Existing projects with sidecar `characters` and `places` still become
  searchable after sync.
- Audit output gives a clear next step for compatibility relationship drift.
- No ordinary sync path deletes or rewrites canonical relationship authority as
  a hidden repair.
- Compatibility output failures do not roll back successful canonical commits.

Required validation:

- `node --experimental-sqlite --test src/test/unit/sync.test.mjs`
- `node --experimental-sqlite --test src/test/unit/metadata-tools.test.mjs`
- `node --experimental-sqlite --test src/test/integration/sync.test.mjs`

Out of scope:

- Full sidecar deprecation.
- New repair workflows beyond guidance unless M1 reveals a blocker.

## M3 — Workflow And Documentation Update

Goal: make the new boundary discoverable for humans, AI agents, and generated
tool consumers.

Deliverables:

- Update tool descriptions and schemas for `update_scene_metadata` and
  relationship tools.
- Update `describe_workflows` so relationship repair and sidecar migration
  guidance routes to outcome-level tools.
- Regenerate `docs/agents/tools.md`.
- Update user/agent docs if they mention sidecar relationship editing or
  generic metadata relationship updates.
- Add a release-log entry if the public tool contract changes.

Acceptance criteria:

- Generated tool docs match the source tool descriptions.
- Workflow guidance no longer implies generic sidecar editing is a daily
  relationship mutation path.
- Users and agents get actionable replacement workflows.
- Any breaking or compatibility-sensitive behavior is documented.

Required validation:

- `npm run docs`
- `npm run check:docs`
- `npm run check:static`

Out of scope:

- Broad documentation rewrites unrelated to relationship authority.

## M4 — End-To-End Regression And Release Readiness

Goal: prove the boundary holds across common writing workflows before PR
completion.

Deliverables:

- End-to-end integration coverage for relationship mutation, metadata update,
  sync compatibility, search reads, and backup freshness.
- Regression coverage for review bundles or other consumers if they depend on
  scene character/place indexes.
- Final PR description that calls out migration behavior and any compatibility
  notes.

Acceptance criteria:

- `connect_character_place_evidence` remains the daily-work relationship write
  path and refreshes backups after canonical commit.
- `update_scene_metadata` no longer creates hidden canonical relationship
  changes from sidecar-first writes.
- Legacy sync/import compatibility still works.
- Search, arc, and bundle consumers still read relationship indexes correctly.
- Maintainers have clear release notes for any changed client behavior.

Required validation:

- `npm test`
- `npm run check:pr`

Out of scope:

- Activating unrelated backlog initiatives.
- Shipping a new client UI.
