# Review Bundles for Editorial Workflows

**Status:** 📋 Proposed (Phase 4A)

## Goal

Add deterministic, collaboration-focused manuscript bundle generation for editing workflows without turning mcp-writing into a publishing or typesetting system.

This feature is intentionally scoped to:
- conceptual discussion bundles (outline-level, low prose density)
- detailed editorial reading bundles (proofreading/copyediting)
- personalized beta-reader bundles (with explicit non-distribution framing)

## Product Boundary

This is **not** a final-distribution compiler.

Out of scope:
- print-ready typography and trim/bleed control
- retail EPUB optimization
- full publishing layout controls and style engines
- replacing Scrivener Compile, Vellum, InDesign, or similar tools

In scope:
- deterministic assembly from existing scene metadata/prose
- review-oriented packaging and provenance
- explicit privacy and sharing controls for editorial circulation

## User Problems

### 1) Conceptual Discussion Without Full Prose

Users need a high-level package of a part or full book for story conversations (structure, pacing, thematic progression) without including all scene prose.

Desired outcome:
- narrative shape is discussable in meetings/workshops
- discussion can reference stable scene/chapter anchors
- prose context is minimized by design

### 2) Detailed Editorial Reading Draft

Users need a prose-heavy editing packet for proofread/copyedit passes with stable references for comments.

Desired outcome:
- editors can annotate specific sections consistently
- authors can map feedback back to scene IDs and source files
- output stays reproducible across revisions

### 3) Personalized Beta-Reader Draft

Users need a targeted bundle for a specific beta reader with explicit "not for distribution" framing and an attached feedback form.

Desired outcome:
- each recipient gets a context-appropriate packet
- distribution intent is clear
- collected feedback is structured and easy to ingest

## Bundle Profiles (Initial)

### `outline_discussion`

Purpose: conceptual discussions.

Default content:
- chapter/scene ordering
- titles, loglines, beats, tags, POV, and optional thread markers
- optional short excerpts (configurable, off by default)

Default exclusions:
- full scene prose
- internal diagnostics unless explicitly requested

### `editor_detailed`

Purpose: proofreading/copyediting passes.

Default content:
- full scene prose in deterministic order
- chapter and scene anchors (`part/chapter/scene_id`)
- optional paragraph anchors or line indices
- optional scene-level metadata sidebar

Default exclusions:
- private operational notes unless explicitly enabled

### `beta_reader_personalized`

Purpose: guided feedback from a named individual.

Default content:
- selected prose scope (full project or filtered)
- cover page with recipient name and usage notice
- non-distribution notice template (NDA-style language, informational only)
- attached feedback form template

Default exclusions:
- internal continuity flags, debug metadata, and process notes

## Functional Requirements (Phase 4A)

1. Generate a bundle from an explicit scope:
   - `project_id` (required)
   - optional filters (`part`, `chapter`, `tag`, `scene_ids`)
2. Require explicit profile selection:
   - `outline_discussion`, `editor_detailed`, or `beta_reader_personalized`
3. Produce deterministic ordering based on indexed scene structure.
4. Emit a manifest with provenance:
   - source commit hash/snapshot reference
   - applied filters and profile
   - included and excluded scene IDs
   - warnings (for stale metadata, missing ordering fields, etc.)
5. Support strictness mode:
   - `warn` (default): produce output with warnings
   - `fail`: abort when blockers are detected (for example stale metadata)
6. Keep source files read-only during bundle generation.
7. Write all artifacts to an output folder outside indexed prose files.

## Output Format (Phase 4A)

Primary output:
- PDF bundle (single-file default)
- Markdown bundle (optional via `format` parameter)
- Both PDF and Markdown (optional via `format: both`)

Companion outputs:
- `manifest.json`
- `feedback-form.md` (for beta profile)
- `notice.md` (for beta profile)

Potential extensions (not required in Phase 4A):
- optional DOCX adapter built from the same intermediate representation
- richer PDF typography/layout controls built from the same intermediate representation

## Tool Surface (Proposed)

### `preview_review_bundle`

Dry-run planning tool.

Returns:
- resolved scene count and ordering
- inclusion/exclusion summary
- warnings and strictness impact
- planned output filenames

### `create_review_bundle`

Execution tool.

Returns:
- output paths
- manifest summary
- warning summary
- provenance metadata

Optional async counterpart for large projects may be added if generation time becomes significant.

## Privacy, Legal, and Safety Notes

1. Personalized beta bundles must include clear non-distribution language.
2. NDA text should be template-based and user-editable, with explicit disclaimer that this is not legal advice.
3. Internal process metadata (`flags`, private notes, diagnostics) is excluded by default.
4. Bundle generation should avoid embedding machine-local absolute paths in exported files.

## Tradeoffs

### Why this scope is valuable

- closes the loop from editing to shareable review packets
- improves collaboration without forcing users into external compile tools for every iteration
- preserves current product identity (reasoning + editing)

### Why this scope is constrained

- avoids becoming a publishing/typesetting surface
- keeps maintenance burden manageable
- reduces format-specific rendering regressions

## Edge Cases and Concerns

1. Missing/ambiguous ordering metadata (`part`, `chapter`, `timeline_position`).
2. Scene sets containing alternates, placeholders, or intentionally hidden draft material.
3. Metadata staleness: whether to block compile in strict mode.
4. Multi-project universe exports: keep Phase 4A project-scoped by default.
5. Anchor stability when prose changes between review rounds.
6. Accidental leakage of internal notes in beta-reader packets.
7. Large bundles that exceed practical reviewer consumption size.

## Implementation Path

1. Define intermediate bundle model (ordered sections + rendering metadata).
2. Implement `preview_review_bundle` (dry-run only).
3. Implement markdown renderer + manifest writer.
4. Add profile presets and exclusion defaults.
5. Add beta profile templates (notice + feedback form).
6. Add integration tests for deterministic ordering, exclusion rules, and strictness behavior.
7. Evaluate optional async execution based on observed runtime.

## Rollout

- Phase 4A.1: `outline_discussion` + `editor_detailed` in markdown only
- Phase 4A.2: `beta_reader_personalized` (notice + feedback form templates)
- Phase 4A.3: optional DOCX/PDF adapters if markdown adoption is strong

## Open Questions

1. Should we support multi-file chapter bundles in Phase 4A, or only single-file output?
2. Should paragraph anchors be generated as deterministic IDs or positional counters?
3. Should `fail` strictness block on stale metadata only, or also on missing ordering fields?
4. How much profile customization is allowed before this becomes a template system?
5. Should feedback form schema be fixed, or profile-configurable with limited fields?

## Related

- [editing.md](../done/editing.md) — Prose editing and git-backed provenance
- [search-analysis.md](../done/search-analysis.md) — Metadata-first retrieval model
- [reference-docs.md](reference-docs.md) — Adjacent Phase 4 querying work
- [review-bundles-implementation.md](review-bundles-implementation.md) — Phase 4A.1 implementation checklist and tool contracts