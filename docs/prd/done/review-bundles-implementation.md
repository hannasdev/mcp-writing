# Review Bundles — Implementation Checklist

**Status:** ✅ Complete — M1, M2, and M4 delivered

## Delivered Milestones

- **M1** ✅ — `outline_discussion` + `editor_detailed`, markdown output (v1.15–1.16)
- **M2** ✅ — `beta_reader_personalized` with notice and feedback form templates (v1.17)
- **M3** 📋 — optional async generation for large projects (deferred; not yet needed at current bundle sizes)
- **M4** ✅ — PDF export via pdfkit (v2.0)

## Deliverables (All Shipped)

1. `preview_review_bundle` tool (dry-run planner)
2. `create_review_bundle` tool (artifact writer)
3. Markdown renderer for all three profiles
4. PDF renderer for all three profiles
5. Bundle manifest output
6. Beta profile templates: notice + feedback form
7. Integration tests for ordering, filters, strictness, and exclusions

## Tool Contracts (As Implemented)

### `preview_review_bundle`

Input:
- `project_id` (string, required)
- `profile` (enum, required): `outline_discussion` | `editor_detailed` | `beta_reader_personalized`
- `part` (int, optional)
- `chapter` (int, optional)
- `tag` (string, optional)
- `scene_ids` (string[], optional)
- `strictness` (enum, optional): `warn` (default) | `fail`
- `include_scene_ids` (boolean, optional, default true)
- `recipient_name` (string, optional; required for `beta_reader_personalized`)
- `format` (enum, optional): `pdf` (default) | `markdown` | `both`

Output:
- `ok` (boolean)
- `profile`
- `resolved_scope`: project_id + applied filters + options
- `ordering`: ordered scene references with `scene_id`, `part`, `chapter`, `timeline_position`
- `summary`: scene_count, estimated_word_count, excluded_scene_ids
- `warnings`: warning list and summary buckets
- `strictness_result`: can_proceed boolean + blocker reasons
- `planned_outputs`: output filenames that would be generated

No disk writes allowed.

### `create_review_bundle`

Input: all `preview_review_bundle` inputs plus:
- `output_dir` (string, required)
- `bundle_name` (string, optional)
- `source_commit` (string, optional)

Output:
- `ok` (boolean)
- `bundle_id` (string)
- `output_paths`: bundle_pdf, bundle_markdown, manifest_json (as applicable)
- `summary`: scene count, profile, applied filters
- `warnings` and warning summary
- `provenance`: commit hash, generation timestamp

## Known Issues

- **Logline in prose profiles (bug):** Logline renders unconditionally in all profiles. For `editor_detailed` and `beta_reader_personalized`, it should be suppressed — loglines are structural summary metadata for `outline_discussion` use only. Fix: gate on `profile === "outline_discussion"` in `renderSceneBlock()` (markdown) and `renderReviewBundlePdf()` (PDF).

## Rendering Rules (As Implemented)

### Shared

1. Deterministic ordering: `part`, `chapter`, `timeline_position`, fallback stable `scene_id` sort.
2. Header includes profile, project, generation timestamp, and source commit.
3. Each scene block gets a stable anchor heading.
4. Absolute local paths excluded from rendered output.

### `outline_discussion`

1. Chapter and scene headings.
2. Metadata summary line: POV, beat, tags.
3. Logline.
4. No prose.
5. Content flows continuously (no page breaks between scenes in PDF).

### `editor_detailed`

1. Full prose.
2. Optional scene IDs in headings.
3. Page breaks between scenes in PDF.
4. No logline (bug: currently renders logline — see Known Issues).

### `beta_reader_personalized`

1. Cover page with recipient name.
2. Usage notice (non-distribution language).
3. Full prose with page breaks.
4. Companion `notice.md` and `feedback-form.md`.
5. No logline (bug: currently renders logline — see Known Issues).

## Related

- [review-bundles.md](review-bundles.md)
- [editing.md](editing.md)
- [search-analysis.md](search-analysis.md)
