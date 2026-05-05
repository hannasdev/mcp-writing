# Release Log

Human-readable release notes focused on user and maintainer value.

This complements `CHANGELOG.md`:
- `CHANGELOG.md` is technical and release-oriented.
- This log is plain-language and outcome-oriented.

## Unreleased

### 2026-05-05 — Split PRD overview from completed-feature archive

- What changed: Restructured `PRD.md` into a lighter project overview, moved completed-feature summaries into a dedicated `docs/prd/completed-features.md` index, and added a new in-progress PRD (`docs/prd/in-progress/client-agnostic-setup.md`) that defines a client-agnostic setup contract with client-hosted UI flows.
- Why it matters: Maintainers and contributors can navigate roadmap status faster, while setup direction now favors reusable MCP capabilities plus client-native onboarding UX instead of growing the tool list for first-run-only workflows.
- Who is affected: Maintainers and contributors updating PRDs, setup UX direction, or roadmap documentation.
- Action needed: Optional. Use `docs/prd/completed-features.md` for shipped capability summaries and keep `PRD.md` focused on active direction and navigation.
- PR: (this PR)

### 2026-05-03 — Prose styleguide skill with formal output contract

- What changed: Enhanced `skills/prose-styleguide/SKILL.md` generation to include a formal "Review Mode Output Contract" section with structured critique categories (Structural Issues, Convention Drift, Prose Issues) and sample feedback templates. Updated prose styleguide PRD status from in-progress to completed (tracked at `docs/prd/done/guideline-generation.md`) and annotated success criteria.
- Why it matters: Authors and AI agents now have an explicit, verifiable specification for how styleguide critique is delivered, reducing ambiguity in feedback quality and making output predictable across sessions.
- Who is affected: Users invoking prose styleguide review mode, and developers integrating styleguide feedback into editorial workflows.
- Action needed: Optional. Existing styleguide configs remain compatible. To receive the enhanced review output contract specification, regenerate with `setup_prose_styleguide_skill(overwrite=true)`.
- PR: [#173](https://github.com/hannasdev/mcp-writing/pull/173)

### 2026-05-03 — Add review-comment resolution skill with helper script

- What changed: Added `skills/review-comment-resolution/SKILL.md` to standardize PR comment triage and closure, and bundled `skills/review-comment-resolution/scripts/review-comments.mjs` to list unresolved threads, resolve selected thread IDs, and check PR status.
- Why it matters: Review feedback handling is now repeatable and less error-prone across sessions, with fewer manual GraphQL command copy/paste steps.
- Who is affected: Maintainers and contributors processing PR feedback in this repo.
- Action needed: None.
- PR: [#172](https://github.com/hannasdev/mcp-writing/pull/172)

### 2026-05-03 — Publish AI boot files during prose styleguide skill setup

- What changed: `setup_prose_styleguide_skill` now publishes AI boot files at sync root by default in addition to generating `skills/prose-styleguide/SKILL.md`. It upserts `CLAUDE.md` (ensuring `@skills/prose-styleguide/SKILL.md`) and `.github/copilot-instructions.md` (managed inline styleguide snapshot block).
- Why it matters: First-time styleguide setup is now complete without manual vendor wiring, reducing setup friction and mismatched agent behavior.
- Who is affected: Users running styleguide setup in writing sync directories, and maintainers automating setup workflows.
- Action needed: Optional: use `publish_boot_files=false` to skip boot-file publishing, or `boot_files_overwrite=true` to force full rewrites of existing boot files.
- PR: [#171](https://github.com/hannasdev/mcp-writing/pull/171)

### 2026-05-03 — Move generated styleguide skill to skills/prose-styleguide/SKILL.md

- What changed: `setup_prose_styleguide_skill` now writes to `skills/prose-styleguide/SKILL.md` instead of `skills/prose-styleguide.md`, matching the `skills/skillname/SKILL.md` directory convention used by all other skills.
- Why it matters: Consistent skill layout makes discovery and vendor wiring (e.g. CLAUDE.md imports) predictable.
- Who is affected: Any user or automation that references the generated skill file by its old path.
- Action needed: If you have an existing `skills/prose-styleguide.md`, move it to `skills/prose-styleguide/SKILL.md` or regenerate with `setup_prose_styleguide_skill(overwrite=true)`.
- PR: [#168](https://github.com/hannasdev/mcp-writing/pull/168)

### 2026-05-03 — Surface runtime warning for invalid styleguide enforcement mode

- What changed: Server startup now emits an explicit `STYLEGUIDE_ENFORCEMENT_MODE_INVALID` warning when `PROSE_STYLEGUIDE_ENFORCEMENT_MODE` environment variable is set to an invalid value (falling back to default `warn` mode).
- Why it matters: Operators are now notified of configuration typos instead of silently accepting fallback behavior, reducing misconfiguration issues in production deployments.
- Who is affected: Maintainers and operators configuring `PROSE_STYLEGUIDE_ENFORCEMENT_MODE` environment variable.
- Action needed: If you see this warning, set `PROSE_STYLEGUIDE_ENFORCEMENT_MODE` to one of: `off`, `warn`, or `required`.
- PR: [#167](https://github.com/hannasdev/mcp-writing/pull/167)

### 2026-05-02 — Enforce prose styleguide automatically in edit proposals

- What changed: `propose_edit` now runs automatic styleguide checks by default, returns structured styleguide diagnostics in the proposal response, supports explicit bypass (`bypass_styleguide` + required `bypass_reason`), and `commit_edit` now rejects stale proposals when styleguide inputs changed after proposal creation.
- Why it matters: Style consistency checks are now built into the safe edit flow without adding extra setup commands in normal use, and approvals are protected from committing against outdated style rules.
- Who is affected: Anyone using `propose_edit` and `commit_edit`, especially teams maintaining project style conventions.
- Action needed: Optional: set `PROSE_STYLEGUIDE_ENFORCEMENT_MODE` to `off`, `warn` (default), or `required` based on your workflow strictness.
- PR: [#166](https://github.com/hannasdev/mcp-writing/pull/166)

### 2026-05-02 — Surface legacy migration skips with explicit operator follow-up

- What changed: Legacy join-table upgrade behavior now emits an explicit `LEGACY_JOIN_ROWS_SKIPPED` warning (startup logs plus runtime surfaces such as `get_runtime_config` and `describe_workflows` context) when ambiguous legacy rows are dropped during project-scoping migration.
- Why it matters: Ambiguous legacy rows are no longer a silent background event; operators get a visible signal that follow-up recovery is required.
- Who is affected: Maintainers and users upgrading existing databases where duplicate scene IDs across projects created ambiguous legacy join rows.
- Action needed: After upgrade, run `sync()` immediately; if stale metadata warnings remain, run `enrich_scene(scene_id, project_id)` for scenes you touch.
- PR: [#165](https://github.com/hannasdev/mcp-writing/pull/165)

### 2026-05-02 — Redesign MCP workflow surface and harden scene ID safety

- What changed: Reworked `describe_workflows` to an outcome-first discovery surface, updated key tool contracts (`find_scenes`, `get_arc`, `get_scene_prose`, `list_snapshots`) for envelope/disambiguation clarity, and hardened project-scoped scene joins to prevent cross-project leakage when scene IDs are reused.
- Why it matters: Day-to-day MCP prompting becomes more guided and predictable, while duplicate `scene_id` cases are handled safely instead of returning ambiguous or cross-project results.
- Who is affected: Anyone using MCP workflows, search/editing tools, or automation that depended on previous workflow IDs/order or text-only response assumptions.
- Action needed: Update prompt/automation mappings to new workflow IDs and parse structured envelopes (`results`, `total_count`, pagination fields, and `structuredContent` advisories) where applicable.
- PR: [#165](https://github.com/hannasdev/mcp-writing/pull/165)

### 2026-05-01 — Add scene reference suggestion/apply workflow

- What changed: Expanded reference linking to include character/place sources and added `suggest_scene_references` with `preview` and one-call `apply` modes to persist scene links directly from suggestions.
- Why it matters: Users can now move from discovery to explicit scene linking in a single tool call, reducing multi-step orchestration as the tool surface grows.
- Who is affected: Anyone using reference docs and continuity workflows through MCP tools.
- Action needed: Optional: run `sync()` after external file edits before using `suggest_scene_references` to ensure candidates reflect latest metadata.
- PR: [#163](https://github.com/hannasdev/mcp-writing/pull/163)

### 2026-04-30 — Add explicit reference link upsert tool

- What changed: Added `upsert_reference_link` so agents can create/update scene → reference and reference → reference links directly, with relation normalization and conflict-safe scene disambiguation.
- Why it matters: Reference graph maintenance is now writable through tools, not only inferred during sync, which improves iterative continuity workflows.
- Who is affected: Anyone managing reference relationships from MCP tool calls.
- Action needed: Optional but recommended: pass `source_project_id` for scene links when scene IDs may overlap across projects.
- PR: [#150](https://github.com/hannasdev/mcp-writing/pull/150)

### 2026-04-30 — Add reference link query tools for scenes and docs

- What changed: Added `list_scene_references` (direct scene → reference links) and `get_reference_doc` (reference metadata with optional one-hop related docs).
- Why it matters: Agents can now move from scene context into relevant lore/continuity notes without broad keyword-only search or unbounded graph traversal.
- Who is affected: Anyone using Writing MCP for continuity and world-reference reasoning.
- Action needed: Optional but recommended: keep `reference_ids` on scenes and `related_reference_ids` on reference docs up to date for best results.
- PR: #148

### 2026-04-30 — Add persisted scene and reference document links

- What changed: `sync()` now stores explicit links from scenes to reference docs (`reference_ids`) and between reference docs (`related_reference_ids`), and keeps those links pruned as files are removed.
- Why it matters: Agents can traverse stable reference relationships instead of relying only on keyword matching, making continuity and lore lookups more reliable.
- Who is affected: Anyone using Writing MCP reference docs and scene metadata for reasoning workflows.
- Action needed: Add optional `reference_ids` on scenes and `related_reference_ids` on reference docs to get the most value from link-aware queries.
- PR: #147

### 2026-04-30 — Add reference document search

- What changed: `sync()` now indexes lightweight metadata for reference docs, and a new `search_reference` tool can discover world/reference and Notes documents by title, summary, and tags.
- Why it matters: Writers and agents can find relevant setting, continuity, research, and style notes without loading whole reference files or relying only on scene metadata.
- Who is affected: Anyone using Writing MCP to navigate project reference material.
- Action needed: Add optional frontmatter like `title`, `summary`, `tags`, or `doc_id` to reference docs if you want better search quality and stable identifiers.
- PR: #146

### 2026-04-30 — Keep published package focused after test move

- What changed: Tightened `package.json` publish allowlist so the npm package includes production `src/*` modules without unintentionally shipping `src/test`.
- Why it matters: Keeps install size and published surface clean after moving tests under `src/`, and avoids exposing internal test assets to consumers.
- Who is affected: Maintainers publishing packages and downstream consumers installing them.
- Action needed: None
- PR: #140

### 2026-04-29 — Finish source-root reorg for scripts and tests

- What changed: Moved remaining root `scripts/` and `test/` content under `src/scripts` and `src/test`, and updated commands/workflows/docs to use the new paths.
- Why it matters: This completes the intended source-root structure and removes remaining top-level ambiguity from the refactor.
- Who is affected: Maintainers and contributors running CLI scripts, tests, or release workflows.
- Action needed: Use `src/scripts/...` paths in direct command invocations.
- PR: #139

### 2026-04-29 — Reduce duplicate release-time CI runs

- What changed: CI jobs now skip automated `Release x.y.z` push commits generated by release automation.
- Why it matters: This reduces redundant post-release CI runs and keeps checks quieter while preserving publish-time test coverage.
- Who is affected: Maintainers watching merge/release pipeline runs.
- Action needed: None
- PR: #130

### 2026-04-29 — Template initialized

- What changed: Added a human-readable release log format for future PR entries.
- Why it matters: Important user value will remain visible after PR context is gone.
- Who is affected: Users and maintainers who follow project updates.
- Action needed: None
- PR: #129
