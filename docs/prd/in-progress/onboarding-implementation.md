# Onboarding Framework — Implementation Plans by Milestone

This document breaks down the phased implementation of the onboarding framework (defined in `docs/prd/in-progress/onboarding-framework.md`) into actionable tasks, dependencies, and success criteria.

---

## Milestone Status Matrix (Current Product Baseline)

Use this matrix to distinguish what already exists versus what still requires implementation.

### Legend
- **Exists:** Implemented and validated in current product behavior/tests
- **Partial:** Some supporting pieces exist; orchestration or contract is incomplete
- **New:** No meaningful implementation exists yet

### Validation Metadata

| Field | Value |
|---|---|
| Last validated on | 2026-05-04 |
| Validated by (initials) | HH |
| Status owner (initials) | TBD |

Update this block whenever milestone statuses are re-verified.

### Progress Snapshot (2026-05-04)

- `1a.1` documentation deliverables are complete:
  - `docs/onboarding/tier-framework.md` added with Tier A/B/C UX rules, question inventory, and confirmation flow.
  - Phase 1a mandatory/optional question decision record is documented.
- `1a.2` implementation is complete:
  - `setup_prose_styleguide_config` now accepts `path_convention` and validates it against `project_id` shape.
  - `styleguide_setup_new` workflow notes now require asking the path-convention Tier A question before setup.
  - `describe_workflows` now exposes session-scoped `context.onboarding_state.path_convention`.
  - Integration tests cover accepted/rejected `path_convention` values and session persistence.
- `1a.3` implementation is now complete:
  - `setup_prose_styleguide_config` now defaults to preview mode and requires `confirm_write=true` for persistence.
  - Setup responses now include plain-language summary fields (`summary_text`, `summary_lines`) before write confirmation.
  - **New:** Tier-driven question grouping: preview responses now include `tier_groups` field organizing fields by Tier A/B/C.
  - **New:** Conversational prompts per tier (e.g., "Proposed X (based on Y). Keep or change?") generated for client-side orchestration.
  - **New:** `is_inferred` flag on each tier group indicates whether value is language-derived or explicitly set.
  - Integration tests cover default-accept, override, preview-then-confirm flows, and all tier group behavior (4 new tests).
- `1a.4` implementation is complete:
  - `describe_workflows` now returns lightweight `context.setup_state` (`styleguide_configured`, `scenes_available`).
  - `describe_workflows` now returns `context.next_recommended_workflow` (`styleguide_setup_new` when config is missing, otherwise `null`).
  - Integration tests verify recommendation behavior for both missing-config and config-present cases.
- Supporting docs were updated to point onboarding references to `docs/prd/in-progress/onboarding-framework.md`.

### Phase 1a

| Milestone | Status | Notes |
|---|---|---|
| 1a.1 Tier-based question framework + docs | Exists | Tier framework spec and decision record are documented in `docs/onboarding/tier-framework.md`; runtime enforcement remains part of 1a.3. |
| 1a.2 Project path convention selection | Exists | `setup_prose_styleguide_config` accepts/validates `path_convention`, workflow guidance asks the Tier A question, and `describe_workflows` exposes session-scoped path convention context. |
| 1a.3 Styleguide setup workflow integration | Exists | Tier-driven question grouping with tier_groups infrastructure; preview mode with tier-specific prompts; 4 new integration tests covering tier behavior; confirmed ready for client-side orchestration. |
| 1a.4 Lightweight setup state tracking | Exists | `describe_workflows` now exposes `setup_state` (styleguide_configured, scenes_available) and `next_recommended_workflow` (styleguide_setup_new when config missing); query-based implementation selected (no persist). |
| 1a.5 Scrivener import + styleguide combined workflow | Partial | Import tools and styleguide tools exist independently; combined guided flow is not fully encoded. |
| 1a.6 Boot file generation + assistant wiring | Exists | `setup_prose_styleguide_skill` already generates/updates skill and boot files with integration test coverage. |
| 1a.7 Phase 1a testing + onboarding docs | Partial | Strong integration tests exist for tools; onboarding-specific docs and end-to-end guided-flow coverage remain to be added. |

### Phase 1b

| Milestone | Status | Notes |
|---|---|---|
| 1b.1 Native markdown import (Branch B) | Partial | Reusable path inference utilities exist, but Branch B dry-run workflow, collision reporting contract, and adopt-existing orchestration are new work. |
| 1b.2 Full setup state persistence schema | New | No `.mcp-writing/onboarding-state.json` implementation yet. |
| 1b.3 Workflow discovery setup reminders | New | `describe_workflows` does not yet return blocking-step reminders or `next_required_step`. |
| 1b.4 Branch A/B/C1/C2 workflow discovery entries | New | Current catalogue has generic setup/styleguide workflows only; branch-specific onboarding workflows are not present. |
| 1b.5 Workspace scaffolding tool | New | No `scaffold_workspace` tool currently exists. |
| 1b.6 Atomic config writes + per-file boot status policy | Partial | Config writes are direct file writes (non-atomic); boot-file status/rollback behavior already exists in skill setup flow. |
| 1b.7 Tier A/B/C enforcement across full setup | New | Tier framework is specified in PRD but not implemented as deterministic onboarding step contracts across all setup paths. |
| 1b.8 Full-branch tests + docs | Partial | C1 import and styleguide tests exist; branch-complete onboarding tests/docs are still new work. |

### Immediate Prioritization Guidance

1. **MVP completion blockers:** 1a.3, 1a.4, 1a.7
2. **Fastest wins (mostly orchestration):** 1a.4, 1a.5
3. **Largest net-new area:** 1b.1, 1b.2, 1b.4, 1b.5

---

## Implementation Readiness Gate (Before Coding Starts)

Mark all items complete before implementation begins.

### Scope and Contracts
- [ ] Phase 1a scope is frozen and explicitly excludes Phase 1b features.
- [ ] Phase 1a happy path workflow is documented step-by-step (first run to complete).
- [ ] Blocking vs advisory behavior is finalized (`warn` vs `required` styleguide semantics).
- [ ] `describe_workflows` response contract changes are defined and backward-compatible.

### State and Orchestration
- [ ] Phase 1a setup-state approach is selected (query-only or lightweight persisted state).
- [ ] Owner for setup-state migration path to Phase 1b schema is assigned.
- [ ] Decision is made on where tier logic lives (client orchestration vs server-enforced workflow contract).
- [ ] Deterministic next-step recommendation rules are defined for incomplete setup.

### Testing and Quality Gates
- [ ] Contract tests are specified for any changed tool response shape.
- [ ] Integration tests are defined for the full Phase 1a flow (import + styleguide setup).
- [ ] Regression tests are identified for existing styleguide and import behavior.
- [ ] Error-code taxonomy and retry guidance are finalized for onboarding failures.

### Release and Operations
- [ ] Rollout strategy is defined (feature-flagged or direct rollout).
- [ ] Observability/logging expectations are documented (what to log, redact, and monitor).
- [ ] User-facing docs outline is approved before code merge.
- [ ] Ownership is assigned for each milestone and dependency handoff.

### Go/No-Go Decision
- [ ] Product + engineering sign-off recorded for Phase 1a start.

---

## Phase 1a: MVP (Styleguide + Scrivener Import)

**Goal:** One complete end-to-end onboarding workflow: styleguide setup + Scrivener import working together.

**Timeline Estimate:** 2–3 weeks (dependent on UX decisions and lightweight state tracking scope)

**Rationale:** Styleguide setup is already largely built (`setup_prose_styleguide_config`, `bootstrap_prose_styleguide_config`, etc.). Scrivener import is production-ready. Phase 1a integrates them into a single discoverable workflow with project path convention selection.

### 1a.1: Tier-Based Question Framework & Documentation

**Owner:** Product/Design  
**Dependencies:** None

**Tasks:**
- [x] Review provisional tier assignments in PRD (Tier A/B/C question patterns)
- [x] Create UX specification for each tier pattern:
  - Tier A: always ask explicitly, no default acceptance
  - Tier B: propose value, require confirmation
  - Tier C: propose value, allow default acceptance
- [x] Document confirmation flow UI/UX expectations (text prompts, form fields, etc.)
- [x] Map existing styleguide setup questions to tiers (language, spelling, quotation_style, etc.)

**Deliverables:**
- [x] `docs/onboarding/tier-framework.md` — detailed UX spec per tier
- [x] Decision record: which questions are mandatory vs. optional in Phase 1a styleguide setup

**Success Criteria:**
- [x] All styleguide questions assigned to tiers
- [x] Confirmation flow is unambiguous and reviewable before writing config

---

### 1a.2: Project Path Convention Selection (Tier A Question)

**Owner:** Backend/MCP  
**Dependencies:** Tier framework (1a.1)

**Tasks:**
- [x] Add project path convention selection to styleguide setup workflow
  - [x] UI/workflow asks: "Standalone project or universe+book structure?" (workflow guidance + tool parameter)
  - [x] Options: `projects/<project>` vs. `universes/<series>/<project>`
  - [x] Validate user choice against existing project structure
  - [x] Store choice in context for session
- [x] Update `setup_prose_styleguide_config` tool to accept `path_convention` hint
- [x] Update workflow catalogue to include this question in styleguide_setup_new

**Deliverables:**
- [x] Updated `setup_prose_styleguide_config` tool signature
- [x] Updated workflow catalogue step with path convention question
- [x] Integration test showing end-to-end styleguide setup + path convention selection

**Success Criteria:**
- [x] Users can select path convention before styleguide setup
- [x] Choice affects `project_id` interpretation during session
- [x] Test passes for both standalone and universe+book conventions

**Known Issues:**
- Application has no persistent "current project" setting; path convention is session-scoped
- Coordinate with product team on how choice is presented to user across clients

---

### 1a.3: Styleguide Setup Workflow Integration

**Owner:** Backend/MCP  
**Dependencies:** Tier framework (1a.1), project path convention (1a.2)

**Tasks:**
- [x] Apply tier-based question patterns to existing styleguide setup flow
  - [x] Language (Tier B): ask explicitly, require confirmation
  - [x] Spelling, quotation_style, etc. (Tier B/C): propose defaults, confirm before write
  - [x] Less-critical fields (Tier C): propose with keep/change prompt
- [x] Ensure confirmation flow before any file writes
- [x] Add plain-language summary of proposed config before commit
- [x] Test edge cases:
  - [x] User overrides language-derived defaults
  - [x] User accepts all defaults
  - [x] User rejects defaults and provides alternatives

**Deliverables:**
- [x] Refactored styleguide setup workflow with tier patterns applied (tier_groups infrastructure)
- [x] Integration tests covering tier-based question flows (4 new tests for tier_groups behavior)
- [x] Updated tool documentation with tier assignments (tier-framework.md + STYLEGUIDE_TIER_ASSIGNMENTS)

**Success Criteria:**
- [x] All Tier A questions are always asked explicitly (framework defined; path_convention enforced)
- [x] All Tier B/C questions show proposed value and require/allow confirmation (tier_groups with prompts)
- [x] Users can review full config summary before persistence
- [x] No silent writes; all changes require explicit approval

---

### 1a.4: Lightweight Setup State Tracking

**Owner:** Backend/MCP  
**Dependencies:** Styleguide setup integration (1a.3)

**Tasks:**
- [ ] Decide on lightweight state mechanism for Phase 1a
  - [x] Option A: Query-based (check if config file exists; do not persist state)
  - [ ] Option B: Simple JSON file (not full schema; just { "has_styleguide": bool, "has_scenes": bool })
  - [ ] Option C: Lean `.mcp-writing/` structure with minimal fields
- [x] Update `describe_workflows` to detect setup incompleteness
  - [x] Check: does styleguide config exist?
  - [x] Check: does project have scenes?
  - [x] Return `styleguide_setup_new` workflow if config is missing
- [x] Add lightweight context fields to `describe_workflows` response:
  - [x] `setup_state: { styleguide_configured: bool, scenes_available: bool }`
  - [x] `next_recommended_workflow: "styleguide_setup_new" | null`
- [ ] Do NOT implement full `.mcp-writing/onboarding-state.json` schema (deferred to Phase 1b)

**Deliverables:**
- [x] Updated `describe_workflows` tool with setup detection
- [ ] Decision record: lightweight state mechanism chosen
- [x] Integration tests verifying setup state detection

**Success Criteria:**
- [x] `describe_workflows` correctly identifies missing styleguide config
- [x] Recommends `styleguide_setup_new` workflow when config is missing
- [ ] Lightweight state check is fast (sub-100ms)

**Open Questions:**
- [ ] Should lightweight state be query-based or persisted? (Decision needed before implementation)

---

### 1a.5: Scrivener Import + Styleguide Workflow Integration

**Owner:** Backend/MCP  
**Dependencies:** Styleguide setup integration (1a.3), lightweight state tracking (1a.4)

**Tasks:**
- [ ] Integrate `import_scrivener_sync` into styleguide setup workflow
  - [ ] After Scrivener import completes, offer optional styleguide setup
  - [ ] Pass `scene_count` to bootstrap suggestion (pre-populate candidates)
- [ ] Update workflow catalogue to show styleguide_setup_new with Scrivener import as one path
- [ ] Add workflow step notes for integration:
  - [ ] Run `import_scrivener_sync` (or `import_scrivener_sync_async` for large datasets)
  - [ ] Run `bootstrap_prose_styleguide_config` with detected scene count
  - [ ] Run `setup_prose_styleguide_config` with language choice
  - [ ] Run `setup_prose_styleguide_skill` to generate skill + boot files
- [ ] Test end-to-end:
  - [ ] Empty project → Scrivener import → styleguide setup
  - [ ] Async import (large dataset) with polling
  - [ ] Bootstrap suggestions from imported scenes

**Deliverables:**
- [ ] Updated `styleguide_setup_new` workflow in catalogue
- [ ] Integration test: Scrivener import → styleguide setup
- [ ] Integration test: async import + styleguide setup
- [ ] Updated tool documentation with workflow notes

**Success Criteria:**
- [ ] Users can import Scrivener folder + setup styleguide in one workflow
- [ ] Bootstrap suggestions use actual scene count from import
- [ ] Async import workflow completes and triggers styleguide setup
- [ ] No manual tool invocation needed; workflow is fully orchestrated

---

### 1a.6: Boot File Generation & AI Assistant Wiring

**Owner:** Backend/MCP  
**Dependencies:** Styleguide setup integration (1a.3)

**Tasks:**
- [ ] Verify `setup_prose_styleguide_skill` generates boot files correctly
  - [ ] `CLAUDE.md` at sync root (✅ already exists)
  - [ ] `.github/copilot-instructions.md` at sync root (✅ already exists)
  - [ ] `publish_boot_files` parameter works correctly (✅ already exists)
- [ ] Test boot file content:
  - [ ] Boot files accurately reflect resolved styleguide config
  - [ ] Injected rules match config values
  - [ ] Voice notes are included if present
- [ ] Verify non-destructive update behavior (✅ already implemented)
- [ ] Integration test: styleguide setup → boot files generated and readable

**Deliverables:**
- [ ] Verification report: boot files are correct
- [ ] Integration test for boot file generation

**Success Criteria:**
- [ ] Boot files are generated during styleguide setup
- [ ] Boot files are readable and contain correct config values
- [ ] Boot file update is non-destructive (existing comments preserved)

**Note:** This task is primarily validation; implementation is already done.

---

### 1a.7: Phase 1a Testing & Documentation

**Owner:** QA/Docs  
**Dependencies:** All 1a.1–1a.6 tasks complete

**Tasks:**
- [ ] End-to-end test scenarios:
  - [ ] Scenario A: Fresh project → Scrivener import → styleguide setup
  - [ ] Scenario B: Fresh project → styleguide setup only (no import)
  - [ ] Scenario C: Existing styleguide config → verify `describe_workflows` does not recommend setup
- [ ] User-facing documentation:
  - [ ] Onboarding guide: "Getting started with styleguide setup"
  - [ ] Workflow reference: "Styleguide setup workflow"
  - [ ] FAQ: common questions and troubleshooting
- [ ] Release notes for Phase 1a
- [ ] Update README with onboarding guidance

**Deliverables:**
- [ ] Integration test suite covering all Phase 1a scenarios
- [ ] `docs/onboarding/getting-started.md`
- [ ] Release notes entry
- [ ] Updated README onboarding section

**Success Criteria:**
- [ ] All Phase 1a test scenarios pass
- [ ] Users can follow documentation to complete onboarding
- [ ] Common questions are addressed in FAQ

---

### 1a Definition of Done Checklist

- [ ] Tier-based question framework is documented and applied (1a.1)
- [ ] Project path convention selection works as Tier A question (1a.2)
- [ ] Styleguide setup workflow applies tier patterns end-to-end (1a.3)
- [ ] Lightweight setup state tracking allows workflow discovery to detect missing config (1a.4)
- [ ] Scrivener import integrates with styleguide setup in single workflow (1a.5)
- [ ] Boot files are generated correctly during setup (1a.6)
- [ ] All Phase 1a test scenarios pass; documentation is complete (1a.7)
- [ ] `describe_workflows` returns `styleguide_setup_new` when config is missing
- [ ] Users can complete styleguide setup + Scrivener import without editing YAML/JSON

---

## Phase 1b: Full Project Initialization

**Goal:** All four import branches working; full setup state tracking; complete workflow discovery integration.

**Timeline Estimate:** 4–6 weeks (requires significant new infrastructure for Branch B)

**Dependencies:** Phase 1a complete and validated

### 1b.1: Native Markdown Import Infrastructure (Branch B)

**Owner:** Backend/Sync  
**Complexity:** HIGH

**Description:**  
Branch B allows users to adopt existing markdown folder structures. Requires scene ID generation from filenames, chapter inference from paths, collision detection, and dry-run preview.

**Tasks:**
- [ ] **Scene ID generation from filename**
  - [ ] Implement stable ID generation: filename → slugified scene_id
  - [ ] Same filename always produces same ID
  - [ ] Document pattern to users (so they don't rename files after import)
  - [ ] Warn user if generated ID already exists in project

- [ ] **Metadata inference from folder structure**
  - [ ] Pattern: `part-<N>/chapter-<M>/<file>.md`
  - [ ] Infer `part` and `chapter` from matching path segments
  - [ ] Override if frontmatter/sidecar provides explicit values
  - [ ] Leave unset if pattern not matched (emit warning)

- [ ] **Metadata inference from prose**
  - [ ] `title`: frontmatter `title` field → first `# Heading` → filename
  - [ ] Other fields: only from frontmatter/sidecar (do not infer)

- [ ] **Collision detection**
  - [ ] Detect two or more files producing same `scene_id`
  - [ ] Skip all colliding files (do not overwrite)
  - [ ] Report collisions to user with file paths
  - [ ] Require manual resolution before index

- [ ] **Dry-run preview**
  - [ ] `sync --dry-run` mode (or new `preview_native_import` tool)
  - [ ] Output: file count, detected structure, warnings, inferred metadata per file
  - [ ] No sidecars written; user must confirm before proceeding

- [ ] **Implementation approach**
  - [ ] Extend existing `sync.js` or create new `native-markdown-import.js` module
  - [ ] Reuse `indexSceneFile()` and `normalizeSceneMetaForPath()` from sync
  - [ ] Add dry-run flag to `sync()` function

**Deliverables:**
- [ ] Native markdown import module with all tasks above
- [ ] Dry-run preview tool or mode
- [ ] Unit tests: scene ID generation, chapter inference, collision detection
- [ ] Integration tests: full Branch B workflow with dry-run preview

**Success Criteria:**
- [ ] Scene IDs are generated stably from filenames
- [ ] Chapter/part inference works for documented patterns
- [ ] Collisions are detected and reported without overwriting
- [ ] Dry-run preview is accurate and user can confirm before write
- [ ] All unit and integration tests pass

**Known Risks:**
- High complexity; requires careful handling of edge cases
- Filename changes after import will break stable ID assumption
- Need to validate effort estimate before proceeding

---

### 1b.2: Full Setup State Persistence Schema

**Owner:** Backend/Runtime  
**Dependencies:** 1a complete, decision on state schema from 1a.4

**Tasks:**
- [ ] Define `.mcp-writing/onboarding-state.json` schema
  - [ ] `schema_version` (number)
  - [ ] `project_id` (string)
  - [ ] `setup_status` (enum: not_started, in_progress, complete)
  - [ ] `last_updated_at` (ISO timestamp)
  - [ ] `steps` (array of step objects)
  - [ ] Each step: id, status, blocking, applicable, reason, next_action

- [ ] Implement setup state write/read
  - [ ] Create state file on first setup action
  - [ ] Update state as steps complete
  - [ ] Validate state integrity on read

- [ ] Implement setup state query functions
  - [ ] `getOnboardingState(projectId)` → returns current state
  - [ ] `isOnboardingComplete(projectId)` → boolean
  - [ ] `getBlockingSteps(projectId)` → array of incomplete blocking steps
  - [ ] `getNextRequiredStep(projectId)` → step or null

- [ ] Migration from Phase 1a lightweight state
  - [ ] Detect missing state file or old format
  - [ ] Bootstrap from file system checks (config exists? scenes exist?)
  - [ ] Create initial state with backward-compatible defaults

**Deliverables:**
- [ ] `.mcp-writing/onboarding-state.json` schema definition
- [ ] State management functions (write, read, query)
- [ ] Migration logic from Phase 1a state
- [ ] Unit tests for state operations
- [ ] Integration test: state persistence across sessions

**Success Criteria:**
- [ ] State persists across sessions correctly
- [ ] Query functions return accurate results
- [ ] Migration from Phase 1a does not lose information
- [ ] All unit and integration tests pass

---

### 1b.3: Workflow Discovery Integration with Setup Reminders

**Owner:** Backend/Runtime  
**Dependencies:** Full setup state persistence (1b.2)

**Tasks:**
- [ ] Update `describe_workflows` tool to use full setup state
  - [ ] Query onboarding state for project
  - [ ] Return setup-completion summary:
    - [ ] `setup_complete: bool`
    - [ ] `blocking_steps_remaining: [{ id, next_action, reason }]`
    - [ ] `next_required_step: { id, next_action, reason } | null`
  - [ ] When setup incomplete, highlight onboarding workflows in response

- [ ] Define step IDs for all onboarding phases
  - [ ] `sync_root_defined` (blocking)
  - [ ] `project_identity_selected` (blocking)
  - [ ] `import_branch_selected` (blocking)
  - [ ] `required_structure_ready` (blocking)
  - [ ] `initial_ingest_completed` (blocking when applicable)
  - [ ] `styleguide_config_ready` (non-blocking)
  - [ ] `styleguide_skill_ready_sync_root` (non-blocking, sync-root only)
  - [ ] (Phase 1b additions: native_markdown_import_ready, workspace_scaffolded, etc.)

- [ ] Implement blocking vs. non-blocking logic
  - [ ] Blocking steps: flag in workflow as "cannot proceed without this"
  - [ ] Non-blocking steps: advisory; e.g., styleguide in `warn` mode
  - [ ] When blocking steps incomplete, recommend specific next workflows

**Deliverables:**
- [ ] Updated `describe_workflows` tool with setup state integration
- [ ] Step ID definitions in code
- [ ] Integration test: workflow discovery returns setup reminders

**Success Criteria:**
- [ ] `describe_workflows` correctly identifies blocking/non-blocking steps
- [ ] Workflow recommendations are contextual (only suggest relevant workflows)
- [ ] Step reminders include clear `next_action` guidance

---

### 1b.4: Import Branch A & B Workflow Discovery

**Owner:** Backend/Workflows  
**Dependencies:** Native markdown import (1b.1)

**Tasks:**
- [ ] Add workflow catalogue entries for each branch
  - [ ] `onboarding_branch_a_start_scratch` — create from empty, run sync
  - [ ] `onboarding_branch_b_adopt_existing` — adopt markdown folder with dry-run
  - [ ] `onboarding_branch_c1_scrivener` (enhance existing) — integrate with discovery
  - [ ] `onboarding_branch_c2_scriv_metadata` (post-setup) — advanced path

- [ ] Each workflow includes:
  - [ ] Branch description (what kind of import)
  - [ ] Prerequisites (sync folder defined? project identity selected?)
  - [ ] Step-by-step tool invocations
  - [ ] Success criteria and next steps

- [ ] Update `describe_workflows` to suggest branches
  - [ ] When `import_branch_selected` step is not done, show all branch options
  - [ ] Include brief description of each branch for user to choose

**Deliverables:**
- [ ] Workflow catalogue entries for all branches
- [ ] Updated `describe_workflows` branch recommendation logic
- [ ] Integration test: branch selection workflow

**Success Criteria:**
- [ ] All four branches are discoverable as workflows
- [ ] Users can select appropriate branch during onboarding
- [ ] Branch selection is recorded in setup state

---

### 1b.5: Workspace Scaffolding (Folder Creation + Starter Files)

**Owner:** Backend/Sync  
**Dependencies:** Project path convention selection (1a.2), workspace structure is understood

**Tasks:**
- [ ] Implement scaffolding tool
  - [ ] Create folder structure for selected path convention
    - [ ] `/projects/<project>/scenes/` (standalone)
    - [ ] `/universes/<series>/<book>/scenes/` (universe)
  - [ ] Create subdirectories: `characters/`, `places/`, `reference/`, `skills/`
  - [ ] Optional: generate starter files (e.g., `README.md`, `.gitkeep`)

- [ ] Add scaffolding as workflow step
  - [ ] Tool: `scaffold_workspace(project_id, path_convention, create_starter_files)`
  - [ ] Idempotent: can run multiple times safely
  - [ ] Warn if folders already exist (do not overwrite)

- [ ] Update `onboarding_branch_a_start_scratch` workflow
  - [ ] Add scaffolding step before user creates scene files

**Deliverables:**
- [ ] `scaffold_workspace` tool
- [ ] Unit tests for scaffolding
- [ ] Integration test: workspace created with correct structure

**Success Criteria:**
- [ ] Folders are created correctly per path convention
- [ ] Tool is idempotent and safe
- [ ] Starter files (if requested) are generated

---

### 1b.6: Atomic Config Write Refactoring

**Owner:** Backend/Styleguide  
**Dependencies:** None (can be done in parallel)

**Tasks:**
- [ ] Refactor config writes to use temp-file-rename pattern
  - [ ] `setup_prose_styleguide_config`: write to temp file, rename into place
  - [ ] `update_prose_styleguide_config`: write to temp file, rename into place
  - [ ] `setup_prose_styleguide_skill`: already uses backup/rollback; verify works

- [ ] Boot file writes use per-file status reporting
  - [ ] Attempt to write each boot file
  - [ ] Report success/failure for each
  - [ ] Do not fail entire operation if one boot file fails

- [ ] Add unit tests for atomic writes
  - [ ] Test write success
  - [ ] Test interrupted write recovery (temp file cleanup)
  - [ ] Test partial boot file failure

**Deliverables:**
- [ ] Refactored config/skill write functions
- [ ] Updated tool documentation (write semantics)
- [ ] Unit tests for atomic writes and boot file status

**Success Criteria:**
- [ ] Config writes are atomic (temp-file-rename)
- [ ] Boot files report per-file status
- [ ] Interrupted writes leave no orphaned temp files

---

### 1b.7: All Tier A/B/C Questions Applied Across Setup

**Owner:** Product/Backend  
**Dependencies:** Tier framework (1a.1), all import branches implemented

**Tasks:**
- [ ] Review all onboarding questions against tier assignments:
  - [ ] Sync root definition (Tier A)
  - [ ] Project path convention (Tier A)
  - [ ] Import branch selection (Tier A)
  - [ ] Project identity/project_id (Tier A)
  - [ ] Language, spelling, quotation_style (Tier B)
  - [ ] Other styleguide fields (Tier B/C per table in PRD)

- [ ] Implement confirmation flow for each tier
  - [ ] Tier A: always ask, show options, require confirmation
  - [ ] Tier B: propose value with reasoning, require confirmation
  - [ ] Tier C: propose value, allow default acceptance

- [ ] Add summary before any writes
  - [ ] Show user all decisions made
  - [ ] Allow final confirmation before persisting any state

**Deliverables:**
- [ ] Updated all onboarding workflows with tier patterns
- [ ] Confirmation flow UI spec and implementation
- [ ] Integration tests for tier patterns

**Success Criteria:**
- [ ] All questions follow their assigned tier pattern
- [ ] Users review full summary before any writes
- [ ] No silent defaults; all high-impact decisions require confirmation

---

### 1b.8: Phase 1b Testing & Documentation

**Owner:** QA/Docs  
**Dependencies:** All 1b.1–1b.7 tasks complete

**Tasks:**
- [ ] End-to-end test scenarios (all branches):
  - [ ] Branch A: Start from scratch, create scenes, setup styleguide
  - [ ] Branch B: Adopt existing markdown folder, dry-run, import, setup styleguide
  - [ ] Branch C1: Scrivener import, setup styleguide (same as Phase 1a)
  - [ ] Branch C2: Post-setup `.scriv` merge (advanced path)
  - [ ] All branches: Verify setup state persists and workflows don't repeat

- [ ] Documentation:
  - [ ] "Onboarding guide" expanded to cover all branches
  - [ ] Per-branch how-to guides
  - [ ] FAQ and troubleshooting
  - [ ] Setup state reference (step definitions, blocking rules)

- [ ] Release notes for Phase 1b

**Deliverables:**
- [ ] Comprehensive integration test suite
- [ ] Updated onboarding documentation
- [ ] Release notes

**Success Criteria:**
- [ ] All Phase 1b test scenarios pass
- [ ] Users can follow documentation for any import branch
- [ ] Setup state correctly tracks progress across all branches

---

### 1b Definition of Done Checklist

- [ ] Native markdown import (Branch B) fully implemented with dry-run preview (1b.1)
- [ ] Full setup state persistence schema in `.mcp-writing/onboarding-state.json` (1b.2)
- [ ] Workflow discovery integration returns setup reminders and blocking steps (1b.3)
- [ ] All four import branches discoverable as workflows (1b.4)
- [ ] Workspace scaffolding creates folders and optional starter files (1b.5)
- [ ] Config writes use atomic temp-file-rename pattern; boot files report per-file status (1b.6)
- [ ] All questions follow Tier A/B/C patterns with confirmation flows (1b.7)
- [ ] All Phase 1b test scenarios pass; documentation is complete (1b.8)
- [ ] Users can complete full project initialization using any branch
- [ ] Setup state persists and prevents repeated onboarding steps

---

## Phase 2+: Future Enhancements & Multi-Feature Onboarding

**Timeline Estimate:** TBD (after Phase 1a & 1b feedback)

### 2.1: Multi-Feature Onboarding Framework

Apply the onboarding framework to other config-driven writing features (beyond styleguide).

**Scope (to be detailed after Phase 1):**
- Identify next config-driven feature with setup needs
- Apply established tier framework and setup state model
- Extend workflow discovery to surface feature-specific setup
- Ensure consistent UX across all setup workflows

---

### 2.2: Advanced Recovery & Rollback

Support for users who need to recover from setup mistakes or migrate between states.

**Scope (to be detailed):**
- Rollback: revert to previous config or state
- State migration: upgrade from Phase 1a to Phase 1b state
- Recovery: repair corrupted or incomplete setup state

---

### 2.3: User Research & Refinement

Based on Phase 1 feedback, refine tier framework, question depth, and UX patterns.

**Expected Improvements:**
- Adaptive question depth (expert users skip confirmations)
- Better confidence reporting for inferred defaults
- Voice customization assistance (embedding-based or pattern-based)
- Form-based setup wizard alternative to conversational mode

---

### 2.4: Workspace Templates & Archetypes

Expand scaffolding to support project templates and writing archetypes.

**Examples:**
- Novel template: standard structure for long-form fiction
- Short story collection template: different structure for anthology
- Novella template: compact structure for under-50k words
- Custom templates: users define their own project archetype

---

## Cross-Phase Considerations

### Testing Strategy

- **Unit tests:** Core functions (scene ID generation, state management, tier validation)
- **Integration tests:** End-to-end workflows for each branch and phase
- **Manual QA:** User acceptance testing for each phase release
- **Documentation tests:** Verify guide examples work as documented

### Dependency Management

```
Phase 1a (no dependencies)
    ↓
Phase 1b (depends on Phase 1a complete & stable)
    ↓
Phase 2+ (depends on Phase 1b complete & user feedback)
```

**Never start Phase 1b before Phase 1a is fully tested and released.**

### Risk Management

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Branch B complexity underestimated | Medium | High | Proof-of-concept dry-run preview in Phase 1a if possible |
| State schema too complex | Low | Medium | User research on state tracking needs before finalizing schema |
| Tier framework doesn't match user expectations | Medium | Medium | Gather user feedback during Phase 1a; refine for Phase 1b |
| Workspace scaffolding conflicts with user files | Low | High | Use idempotent tool; always warn before overwriting |
| Boot file wiring breaks for new AI assistants | Low | Medium | Design boot file generation for extensibility; document pattern |

### Success Metrics

**Phase 1a Success:**
- [ ] Styleguide setup + Scrivener import can be completed by new users without manual YAML editing
- [ ] Setup recommendations appear in `describe_workflows` when config is missing
- [ ] Tier patterns are applied consistently (question types match assignments)
- [ ] No silent writes; all decisions require explicit confirmation

**Phase 1b Success:**
- [ ] All four import branches are discoverable and functional
- [ ] Setup state correctly tracks progress across all branches
- [ ] Workspace scaffolding reduces friction for new projects
- [ ] Setup state persists across sessions; users don't repeat onboarding

**Phase 2+ Success:**
- [ ] Framework successfully applied to at least one additional config-driven feature
- [ ] User feedback shows improved onboarding experience
- [ ] Support tickets related to setup decrease by >30%

---

## Frequently Asked Questions

**Q: Can Phase 1a and 1b be delivered in the same release?**  
A: Technically yes, but not recommended. Phase 1a should be validated with users first. Branch B (native markdown import) adds significant complexity and risk; phasing allows for failure recovery if needed.

**Q: Can we skip the tier framework and use simpler UX?**  
A: Possible, but tier framework prevents overwhelming new users with too many questions. It's a design best practice; skipping risks poor user experience.

**Q: What happens if a user starts Phase 1a setup and needs to migrate to Phase 1b later?**  
A: Migration logic in 1b.2 bootstraps state from Phase 1a file system checks. User data is preserved; they may need to confirm setup steps again.

**Q: Do we need VS Code integration in Phase 1a?**  
A: No. Phase 1a focuses on MCP tooling. VS Code integration can be added as a phase 1b or 2 enhancement.

**Q: Can users defer styleguide setup and add it later?**  
A: Yes. Styleguide is mode-gated (default `warn` mode is non-blocking). Users can import scenes and add styleguide setup later using the same workflow.

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-05-04 | 1.0 | Initial implementation plan for all phases |
| TBD | 1.1 | Updates after Phase 1a decisions |
| TBD | 2.0 | Phase 1b detailed tasks after Phase 1a complete |

