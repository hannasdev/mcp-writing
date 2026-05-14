# Release Log

Human-readable release notes focused on user and maintainer value.

This complements `CHANGELOG.md`:
- `CHANGELOG.md` is technical and release-oriented.
- This log is plain-language and outcome-oriented.

## Unreleased

### 2026-05-14 — Editorial PDF redesign for outline_discussion profile

- What changed: The `outline_discussion` PDF now renders as a professional editorial document — cover page with book title and author, running header, centered page numbers, Times Roman typography, chapter dividers, and styled epigraph scenes. New optional `bundle_title` and `author_name` parameters let you customise the cover. `include_scene_ids` defaults to `false` for this profile.
- Why it matters: The outline PDF is now a shareable, reader-ready document rather than a plain structured dump. Epigraphs are rendered in a centered italic column with breathing room, clearly distinguishing them from regular scenes.
- Who is affected: Anyone planning or generating `outline_discussion` bundles via `preview_review_bundle` (planning) and `create_review_bundle` (artifact generation).
- Action needed: If your `outline_discussion` workflow relied on scene IDs appearing by default, pass `include_scene_ids: true`. Pass `bundle_title` and `author_name` to customise the cover page.
- PR: #191

### 2026-05-14 — Consistent response envelopes for metadata-read tools

- What changed: Four metadata-read tools now return structured envelopes `{ results, total_count, ... }` instead of flat objects or raw arrays: `get_character_sheet`, `get_place_sheet`, `list_scene_references`, and `get_relationship_arc`.
- Why it matters: Agents and integrations can now parse all metadata-read responses with a single consistent pattern, reducing brittle per-tool parsing logic.
- Who is affected: Any integration or prompt that directly parses the JSON response from these four tools.
- Action needed: Update parsers. Sheet tools: use `parsed.results[0]` instead of the flat object. `list_scene_references`: use `parsed.results` instead of `parsed.references`. `get_relationship_arc`: use `parsed.results` instead of the top-level array. Safe parsing patterns are in `README.md`.
- PR: [#189](https://github.com/hannasdev/mcp-writing/pull/189)

### 2026-05-08 — Suppress epigraph document titles in beta exports

- What changed: Beta review-bundle rendering now suppresses epigraph scene headings more robustly, including cases where epigraph metadata tags are missing/case-variant and the scene title starts with "Epigraph ...".
- Why it matters: Prevents duplicate or unwanted heading output (for example, "Epigraph Chapter 15") while keeping chapter headings and epigraph prose intact.
- Who is affected: Authors generating `beta_reader_personalized` review-bundle exports.
- Action needed: None.
- PR: [#187](https://github.com/hannasdev/mcp-writing/pull/187)

### 2026-05-08 — Add standardized post-merge cleanup skill and helper

- What changed: Added `skills/post-merge-cleanup/SKILL.md` and `skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs` to run a consistent post-merge workflow (verify merged PR state, sync `main` from `origin/main`, clean local/optional remote branch, and report unresolved review threads).
- Why it matters: Reduces repeated manual cleanup steps and avoids branch/state drift after merges.
- Who is affected: Maintainers and contributors who merge PRs and handle post-merge repository hygiene.
- Action needed: Optional. Use `node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr <number> --branch <name>` after merges.
- PR: [#186](https://github.com/hannasdev/mcp-writing/pull/186)

### 2026-05-08 — Add accountable beta bundle fingerprinting with chapter-set support

- What changed: `beta_reader_personalized` review bundles now support chapter-set selection (`chapters`) and include per-page accountability footers in PDF output with recipient name, page number, and a unique page fingerprint token; manifests now include fingerprint metadata.
- Why it matters: Makes limited beta sharing safer and more traceable while improving reviewer targeting when authors only want to share one or a few chapters.
- Who is affected: Authors generating beta-reader review bundles and maintainers supporting editorial review workflows.
- Action needed: Optional: switch to `chapters` when sharing selective chapter packets; keep `beta_accountability` enabled (default) for traceable beta PDFs.
- PR: [#182](https://github.com/hannasdev/mcp-writing/pull/182)

### 2026-05-07 — Raise minimum supported Node runtime to 22.13.0

- What changed: Raised the declared Node runtime minimum to `>=22.13.0`, aligned setup/development docs and workflow runners to that floor, and updated dependencies (including `pdfkit` major bump plus security overrides for vulnerable transitives).
- Why it matters: Keeps dependency maintenance current and security posture improved while preventing contributors from using older Node 22 minors that can fail install or tooling resolution.
- Who is affected: Maintainers, contributors, and self-hosted users running local setup/CI with Node 22.
- Action needed: If your environment is below Node 22.13.0, upgrade Node before installing/running `mcp-writing`.
- PR: [#179](https://github.com/hannasdev/mcp-writing/pull/179)

### 2026-05-07 — Align existing-styleguide setup message with cross-scope UX contract

- What changed: Updated `STYLEGUIDE_CONFIG_EXISTS` copy to a scope-neutral message and documented matching VS Code existing-config acceptance criteria so both `project_root` and `sync_root` setup flows use the same user-facing contract.
- Why it matters: Prevents scope-specific wording confusion and keeps server/extension behavior consistent when setup encounters an existing styleguide config.
- Who is affected: Users running prose styleguide setup and maintainers/client implementers relying on dedicated existing-config UX handling.
- Action needed: Optional. If client-side UX hard-codes prior copy, update it to `A prose styleguide config already exists at the target location.`.
- PR: [#178](https://github.com/hannasdev/mcp-writing/pull/178)

### 2026-05-05 — Add client-agnostic setup contract runtime and VS Code handoff docs

- What changed: Added a versioned styleguide setup contract (`src/setup/contracts/styleguide_setup_v1.json`), shared setup runtime helpers (`src/setup/setup-contract.js`), `describe_workflows` setup contract status/plan preview metadata, contract parity tests, and documentation links to the new VS Code extension repository.
- Why it matters: Setup logic is now contract-driven and reusable across clients while keeping MCP focused on durable capabilities instead of onboarding-only tool expansion.
- Who is affected: Maintainers evolving setup flows, and client implementers (starting with VS Code) that consume setup status and action planning metadata.
- Action needed: Optional. If you build client adapters, consume `describe_workflows.context.setup_contract` and follow the plan preview/action semantics documented in development docs.
- PR: [#176](https://github.com/hannasdev/mcp-writing/pull/176)

### 2026-05-05 — Split PRD overview from completed-feature archive

- What changed: Restructured `PRD.md` into a lighter project overview, moved completed-feature summaries into a dedicated `docs/prd/completed-features.md` index, replaced the inlined tool summary with a pointer to auto-generated `docs/tools.md`, and added a new in-progress PRD (`docs/prd/in-progress/client-agnostic-setup.md`) that defines a client-agnostic setup contract with client-hosted UI flows.
- Why it matters: Maintainers and contributors can navigate roadmap status faster, while setup direction now favors reusable MCP capabilities plus client-native onboarding UX instead of growing the tool list for first-run-only workflows.
- Who is affected: Maintainers and contributors updating PRDs, setup UX direction, or roadmap documentation.
- Action needed: Optional. Use `docs/prd/completed-features.md` for shipped capability summaries and keep `PRD.md` focused on active direction and navigation.
- PR: [#175](https://github.com/hannasdev/mcp-writing/pull/175)

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
