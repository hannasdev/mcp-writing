# Review Bundles for Editorial Workflows

**Status:** ✅ Complete — all milestones delivered (M1: markdown bundles, M2: beta_reader_personalized, M4: PDF export)

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

## Bundle Profiles

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
- loglines and summary metadata (those belong in `outline_discussion`)
- private operational notes unless explicitly enabled

### `beta_reader_personalized`

Purpose: guided feedback from a named individual.

Default content:
- selected prose scope (full project or filtered)
- cover page with recipient name and usage notice
- non-distribution notice template (NDA-style language, informational only)
- attached feedback form template

Default exclusions:
- loglines and summary metadata
- internal continuity flags, debug metadata, and process notes

## Functional Requirements

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

## Output Format

Primary output:
- PDF bundle (single-file default)
- Markdown bundle (optional via `format` parameter)
- Both PDF and Markdown (optional via `format: both`)

Companion outputs:
- `manifest.json`
- `feedback-form.md` (for beta profile)
- `notice.md` (for beta profile)

## Tool Surface

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

## Privacy, Legal, and Safety Notes

1. Personalized beta bundles must include clear non-distribution language.
2. NDA text should be template-based and user-editable, with explicit disclaimer that this is not legal advice.
3. Internal process metadata (`flags`, private notes, diagnostics) is excluded by default.
4. Bundle generation should avoid embedding machine-local absolute paths in exported files.

## Known Issues

- **Logline in prose profiles (bug):** The logline renders unconditionally in all profiles, including `editor_detailed` and `beta_reader_personalized`. Per spec, loglines belong in `outline_discussion` only. The logline is a scene summary intended for structural discussion — surfacing it before prose in an editor or beta-reader PDF can prime interpretation before the reader encounters the scene. Fix: gate logline rendering on `profile === "outline_discussion"` in both the markdown and PDF renderers.

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
4. Multi-project universe exports: keep project-scoped by default.
5. Anchor stability when prose changes between review rounds.
6. Accidental leakage of internal notes in beta-reader packets.
7. Large bundles that exceed practical reviewer consumption size.

## Delivered Milestones

- **M1** ✅ — `outline_discussion` + `editor_detailed`, markdown output (v1.15–1.16)
- **M2** ✅ — `beta_reader_personalized` with notice and feedback form templates (v1.17)
- **M3** 📋 — optional async generation for large projects (deferred; not yet needed)
- **M4** ✅ — PDF export via pdfkit (v2.0)

## Related

- [editing.md](editing.md) — Prose editing and git-backed provenance
- [search-analysis.md](search-analysis.md) — Metadata-first retrieval model
- [review-bundles-implementation.md](review-bundles-implementation.md) — Phase 4A.1 implementation checklist and tool contracts
