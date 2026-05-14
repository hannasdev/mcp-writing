# Beta Reader Accountability and Book-Like Layout

**Status:** ✅ Done (shipped 2026-05-08)

## Implementation Status

Implemented across planner, renderer, writer, tool schemas, and tests.

- Tool contract supports `chapters` and `beta_accountability` for beta bundles.
- Beta PDF output includes per-page visible accountability footer and per-page fingerprint tokens.
- Manifest includes fingerprint metadata for accountable beta PDF bundles.
- Beta PDF layout uses book-like defaults (6x9 page geometry).
- Release entry: [Release Log](../../release-log.md)

## Problem

Authors need to share one chapter or a small set of chapters with beta readers while discouraging redistribution and maintaining a comfortable reading experience.

Current beta bundles support recipient naming and notices, but they do not provide per-page accountability marks or book-like page geometry.

## Goals

1. Allow chapter-scoped beta-reading bundles (single chapter or small chapter set).
2. Render explicit accountability on every PDF page for beta-reader bundles:
   - recipient name
   - unique per-page fingerprint token
3. Improve reading ergonomics so output feels closer to a book:
   - narrower line length
   - shorter visual page rhythm than Letter defaults
4. Preserve deterministic outputs and provenance tracking.

## Non-Goals

1. Full publishing/typesetting system.
2. DRM, encryption, or anti-copy technical enforcement.
3. Replacing Scrivener Compile, Vellum, or InDesign.
4. Applying fingerprint and layout rules to non-beta profiles in v1.

## User Outcomes

1. Authors can safely circulate chapter-limited drafts to specific readers.
2. Beta readers see clear ownership framing on every page.
3. Reading comfort improves for long prose sessions.
4. Authors can trace a shared bundle back to recipient + bundle metadata.

## Scope

### In Scope (v1)

1. `beta_reader_personalized` profile only.
2. PDF output only for accountability footer behavior.
3. Chapter filter support for one/few chapter beta packets.
4. Visible footer on each page with recipient + fingerprint token.
5. Manifest additions describing fingerprinting and token mapping.
6. Book-like layout defaults for beta profile PDF rendering.

### Out of Scope (v1)

1. Invisible-only fingerprinting modes.
2. Custom theme/template editor for PDF typography.
3. Per-recipient layout customization.
4. Fingerprint rendering in markdown output.

## Functional Requirements

1. Bundle scope must support one or many chapters in deterministic order.
2. For `beta_reader_personalized` with PDF output, each page must include a footer with:
   - `recipient_display_name`
   - page-unique fingerprint token
3. Fingerprint tokens must be deterministic for a given bundle generation input set.
4. Fingerprint tokens must differ across pages in the same bundle.
5. Manifest must include fingerprint metadata:
   - fingerprint mode
   - recipient name value used
   - page-token mapping
   - generation context summary (non-secret provenance fields)
6. Existing behavior for `outline_discussion` and `editor_detailed` remains unchanged by default.
7. Source prose remains read-only; all artifacts written under `output_dir`.

## UX and Output Specification

### Footer Content

Recommended footer pattern:

`For: <Recipient Name> | Fingerprint: <Token> | Page <N>`

Token format is implementation-defined but must be stable, readable, and concise.

### Layout Defaults (Beta PDF)

1. Page size: `6 x 9 in`.
2. Margins: target `0.8-0.9 in` range.
3. Body text size: around `11 pt`.
4. Body line spacing: around `1.35-1.45` equivalent.
5. Footer text size: `8-9 pt`.

These are defaults, not user-exposed publishing controls.

## Privacy and Safety Notes

1. Footer should provide accountability without exposing local file paths or machine identifiers.
2. Fingerprint provenance must avoid storing raw secrets.
3. Non-distribution notice remains included for beta bundles.

## Tradeoffs

1. Visible accountability marks increase deterrence but may slightly reduce immersion.
2. Book-like smaller pages improve readability but increase total page count.
3. Deterministic tokening improves traceability but requires careful input normalization to avoid accidental drift.

## Resolved Decisions

1. Footer appears on all beta PDF pages (cover, notice, and prose pages).
2. Token remains opaque and readable (`BR-...-P###`) without embedding recipient fragments.
3. Chapter selection uses explicit `chapters: number[]` support, with deterministic normalization and validation.

## Acceptance Criteria

1. A beta bundle can be generated for one chapter and for a multi-chapter selection.
2. Every included PDF page for beta profile contains recipient + fingerprint footer.
3. Fingerprint tokens are unique per page and stable across repeat generation with identical inputs.
4. Manifest includes fingerprint metadata and page-token map.
5. Non-beta profiles are unchanged.
6. Integration tests validate footer presence and scope correctness.

## Test Strategy

### Unit Tests

1. Token generation determinism and per-page uniqueness.
2. Recipient normalization and footer formatting.
3. Manifest fingerprint metadata shape and content.
4. Beta layout configuration values (page size, margins, font sizing intent).

### Integration Tests

1. End-to-end bundle for one chapter (PDF) verifies scope and file generation.
2. End-to-end bundle for multi-chapter selection verifies deterministic ordering.
3. PDF assertions verify footer content appears on each page.
4. Same input reproducibility test: identical token map.
5. Variation test: different recipient or bundle context produces different token map.
6. Regression test: non-beta profiles do not get accountability footer.

## Related

- [Review Bundles for Editorial Workflows](./review-bundles.md)
- [Review Bundles — Implementation Checklist](./review-bundles-implementation.md)
- [PRD Overview](../../../PRD.md)

## Implementation Plan

### Milestone 1: Planner and Tool Contract

Goal: support explicit chapter-set beta scope and fingerprint options in planning/execution contracts.

Code touchpoints:

1. `src/tools/review-bundles.js`
   - Extend zod schema for `preview_review_bundle` and `create_review_bundle`.
   - Proposed additions:
     - `chapters?: number[]` (optional; for one/few chapter selection)
     - `beta_accountability?: boolean` (default true for `beta_reader_personalized`)
2. `src/review-bundles/review-bundles-planner.js`
   - Resolve chapter list filter deterministically.
   - Add resolved fingerprint/accountability options into `resolved_scope.options`.
3. `docs/tools.md` (autogenerated after source updates)
   - Reflect tool parameter updates and behavior notes.

Tests:

1. Unit: planner accepts and normalizes `chapters`.
2. Unit: conflicting scope signals (`chapter` + `chapters`) return deterministic behavior or clear validation error.
3. Integration: preview output reflects selected chapter set and planned outputs unchanged except added metadata.

### Milestone 2: Fingerprint/Footer Rendering in PDF

Goal: render recipient identity + unique page fingerprint on every beta PDF page.

Code touchpoints:

1. `src/review-bundles/review-bundles-renderer.js`
   - Add deterministic token builder (page-index-based).
   - Register per-page footer renderer via PDF document page lifecycle hooks.
   - Ensure footer applies to cover, notice, and prose pages (unless product decision changes).
2. `src/review-bundles/review-bundles-writer.js`
   - Preserve returned fingerprint metadata for manifest serialization.

Tests:

1. Unit: token generator stability for same input and uniqueness across page indices.
2. Integration: PDF generation includes expected footer text for beta profile.
3. Regression: non-beta profiles do not include accountability footer.

### Milestone 3: Book-Like Layout Defaults (Beta PDF)

Goal: improve prose readability with narrower measure and calmer page rhythm.

Code touchpoints:

1. `src/review-bundles/review-bundles-renderer.js`
   - Beta profile PDF config:
     - `size: [432, 648]` (6x9 inches at 72 dpi PDF points)
     - adjusted margins in ~0.8-0.9 inch range
     - body font sizing/line gap tuned for long-form prose reading
2. Optional constants extraction in same module for layout readability and future tuning.

Tests:

1. Unit: renderer uses beta layout constants when profile is `beta_reader_personalized`.
2. Integration: generated PDF remains valid and page generation path is stable across sample fixtures.
3. Manual validation: quick visual pass on a long chapter bundle to confirm line length and pagination feel.

### Milestone 4: Manifest and Provenance Extensions

Goal: make accountability traceable and auditable from bundle artifacts.

Code touchpoints:

1. `src/review-bundles/review-bundles-writer.js`
   - Extend `manifest.json` payload with:
     - `fingerprint.mode`
     - `fingerprint.recipient_display_name`
     - `fingerprint.page_tokens` (ordered by page index)
2. `src/review-bundles/review-bundles-planner.js`
   - Ensure plan structure carries fingerprint mode intent.

Tests:

1. Integration: manifest contains fingerprint object for beta PDF bundles.
2. Integration: reproducibility test confirms stable `page_tokens` for identical inputs.
3. Integration: variation test confirms token changes when recipient changes.

### Milestone 5: Guardrails and Existing Bug Cleanup

Goal: ship accountability feature without cross-profile regressions and while addressing known review-bundle bug.

Code touchpoints:

1. `src/review-bundles/review-bundles-renderer.js`
   - Ensure logline rendering is gated to `outline_discussion` only.
2. Existing review-bundles tests:
   - update/add assertions to lock expected profile-specific rendering.

Tests:

1. Integration: `editor_detailed` and `beta_reader_personalized` do not render logline.
2. Integration: `outline_discussion` keeps logline behavior.

## Delivery Sequence

1. Planner/tool contract changes + tests.
2. Footer fingerprint rendering + tests.
3. Beta PDF layout defaults + tests.
4. Manifest provenance extension + tests.
5. Known bug guardrail and regression pass.

## PR Strategy

1. Preferred: single focused feature PR if diff stays reviewable.
2. Split option if needed:
   - PR A: contract/planner + tests
   - PR B: renderer/footer/layout + manifest + tests

Both options remain single-concern: beta-reader accountability and reading ergonomics.
