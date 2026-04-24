# Review Bundles — Phase 4A.1 Implementation Checklist

**Status:** 📋 Planned

This checklist scopes only the first delivery slice:
- `outline_discussion`
- `editor_detailed`
- markdown output
- deterministic planning and generation

Out of scope for this slice:
- `beta_reader_personalized`
- DOCX adapters
- multi-project/universe bundle generation

## Milestone

- M1: Dry-run planning + markdown bundle generation for project-scoped editorial workflows

## Deliverables

1. `preview_review_bundle` tool (dry-run planner)
2. `create_review_bundle` tool (artifact writer)
3. markdown renderer for two profiles
4. bundle manifest output
5. integration tests for ordering, filters, strictness, and exclusions
6. docs update for tool behavior and safety guarantees

## Proposed Tool Contracts

### `preview_review_bundle`

Purpose: resolve scope, ordering, and warnings without writing artifacts.

Input:
- `project_id` (string, required)
- `profile` (enum, required): `outline_discussion` | `editor_detailed`
- `part` (int, optional)
- `chapter` (int, optional)
- `tag` (string, optional)
- `scene_ids` (string[], optional)
- `strictness` (enum, optional): `warn` (default) | `fail`
- `include_scene_ids` (boolean, optional, default true)
- `include_metadata_sidebar` (boolean, optional, default false)
- `include_paragraph_anchors` (boolean, optional, default false)

Output:
- `ok` (boolean)
- `profile`
- `resolved_scope`:
  - `project_id`
  - applied filters
- `ordering`:
  - ordered scene references with `scene_id`, `part`, `chapter`, `timeline_position`
- `summary`:
  - `scene_count`
  - `estimated_word_count`
  - `excluded_scene_ids`
- `warnings`:
  - warning list and warning summary buckets
- `strictness_result`:
  - `can_proceed` boolean
  - blocker reasons when `strictness=fail`
- `planned_outputs`:
  - output filenames that would be generated

No disk writes are allowed.

### `create_review_bundle`

Purpose: generate markdown review artifacts from the same planning logic.

Input:
- all `preview_review_bundle` inputs
- `output_dir` (string, required)
- `bundle_name` (string, optional)
- `source_commit` (string, optional): explicit commit hash; if omitted, resolve current HEAD for provenance

Output:
- `ok` (boolean)
- `bundle_id` (string)
- `output_paths`:
  - `bundle_markdown`
  - `manifest_json`
- `summary`:
  - scene count
  - profile
  - applied filters
- `warnings` and warning summary
- `provenance`:
  - commit hash used
  - generation timestamp

Write behavior:
- write artifacts only under `output_dir`
- never modify prose or sidecar source files

## Rendering Rules (M1)

### Shared

1. Deterministic ordering: `part`, `chapter`, `timeline_position`, fallback stable `scene_id` sort.
2. Header includes profile, project, generation timestamp, and source commit.
3. Each scene block gets a stable anchor heading.
4. Absolute local paths are excluded from rendered output.

### `outline_discussion`

1. Include chapter and scene headings.
2. Include metadata summary line with POV, beat, tags when available.
3. Include logline by default.
4. Exclude full prose by default.

### `editor_detailed`

1. Include full prose.
2. Include optional scene IDs in headings.
3. Include optional paragraph anchors for comment targeting.
4. Exclude internal diagnostics and private notes by default.

## Strictness Behavior (M1)

`warn` mode:
- Generate outputs even with non-fatal issues.
- Return warnings in response and manifest.

`fail` mode:
- Abort generation on blockers such as:
  - stale metadata when profile requires structural reliability
  - unresolved ordering collisions that cannot be deterministically resolved
  - missing project scope

## Acceptance Criteria

1. Same input + same source commit produces stable ordering and equivalent markdown structure.
2. `preview_review_bundle` and `create_review_bundle` share planning logic and return consistent scene resolution.
3. `outline_discussion` excludes full prose by default.
4. `editor_detailed` includes full prose and stable section anchors.
5. `create_review_bundle` never writes outside `output_dir`.
6. `strictness=fail` blocks and returns actionable reasons.
7. Manifest always includes commit provenance and warning summary.

## Test Plan

### Unit Tests

1. Filter resolution precedence when `scene_ids` and chapter/part filters are both supplied.
2. Deterministic ordering fallback behavior.
3. Profile-level inclusion/exclusion defaults.
4. Strictness evaluation (`warn` vs `fail`).

### Integration Tests

1. Preview returns expected scene count and planned filenames for a known fixture project.
2. Create writes exactly expected files under temp output directory.
3. Outline bundle contains no prose body paragraphs from fixture scenes.
4. Editor bundle contains prose and scene anchors.
5. Fail mode blocks generation when fixture is marked metadata-stale.
6. Manifest captures commit hash and warning summary.

## Risks and Mitigations

1. Risk: implicit scope drift into publishing features.
   - Mitigation: enforce profile enum and markdown-only output in M1.
2. Risk: unstable ordering from incomplete metadata.
   - Mitigation: explicit fallback order + warnings + fail mode.
3. Risk: leakage of internal notes.
   - Mitigation: explicit exclusion defaults and regression tests.

## Follow-up Milestones (Not in M1)

1. M2: `beta_reader_personalized` templates (`notice.md`, `feedback-form.md`).
2. M3: optional async generation for large projects.
3. M4: optional DOCX adapter.

## Related

- [review-bundles.md](review-bundles.md)
- [editing.md](../done/editing.md)
- [search-analysis.md](../done/search-analysis.md)