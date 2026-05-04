# PRD: Writing Assistant Onboarding Framework

## Overview

Define an onboarding framework for writing-assistant features that need configurable project conventions.

This PRD covers:
- First-time setup (wizard)
- Optional bootstrap from existing prose corpus
- Ongoing config review and update

It is intended to keep onboarding concerns separate from feature rule logic.

This PRD defines the full onboarding framework scope, which spans **project initialization** (folder structure, branch selection, import mechanism) and **config-driven setup** (styleguide, future config systems). Implementation will be phased across releases to avoid over-scoping any single delivery.

**Release phasing strategy:**
- **Phase 1 (Iteration 1a):** Styleguide-only setup + at least one complete end-to-end import branch (likely Scrivener/Branch C1)
- **Phase 2 (Iteration 1b):** Full project initialization (all branches A/B/C1/C2, setup state persistence, discovery integration)
- **Phase 3+ (Iteration 2+):** Enhancement, optimization, and application to other config-driven features

Phasing details are in the **Release Phasing** section below.

Related PRD:
- `docs/prd/done/guideline-generation.md` (style rules and in-edit behavior)

---

## Problem

Authors need high-quality defaults and low-friction setup, but current onboarding concerns are often mixed with feature-specific rule logic.

This creates:
- High cognitive load during initial setup
- Inconsistent setup experiences across tools/features
- Ambiguous ownership between onboarding flow and style/rule definitions

---

## Goals

- Standardize onboarding flow for config-driven writing features
- Reduce setup friction with language-aware default inference
- Support both manual setup and corpus-assisted bootstrap
- Make config updates easy over time (not one-time only)
- Keep onboarding concerns separate from feature rule PRDs
- Help users make key setup decisions once, early, so they do not need to repeatedly revisit low-level config choices

---

## Purpose (V1)

Provide a guided first-run and ongoing config lifecycle that helps users establish required project setup and high-value defaults before editing, with explicit confirmation and low configuration burden.

This purpose is prioritized for users who are not comfortable editing JSON/YAML directly.

---

## Scope Contract

This framework applies to config-driven writing features that exist in the current product and have concrete setup needs today.

**Full Scope (across all phases):**
- Full project initialization (sync root validation, folder scaffolding, path convention selection, branch selection)
- All four import branches (A: scratch, B: adopt existing, C1: Scrivener, C2: post-setup merge)
- Styleguide and other config-driven feature setup
- Setup state persistence and workflow discovery integration
- Language-aware default conventions
- Optional bootstrap from existing prose
- Ongoing config review/update flows

**Phase 1 (Iteration 1a) — MVP Scope:**
- Styleguide setup (already largely built)
- At least one complete end-to-end import branch (Scrivener/Branch C1 preferred since largely built)
- Language-aware defaults and bootstrap for styleguide
- Proof-of-concept for project path convention selection
- Initial setup state tracking (lightweight, may not use full .mcp-writing schema)

**Phase 2+ (Iteration 1b, 2+) — Full Scope:**
- All four import branches fully functional
- Full setup state persistence schema (.mcp-writing/onboarding-state.json)
- Native markdown import (Branch B) with dry-run preview
- Workspace scaffolding (folder creation, optional starter files)
- Workflow discovery integration for setup reminders
- All Tier A/B/C question framework applied
- Other config-driven features (non-styleguide)

Out of scope for any iteration:
- New onboarding steps for hypothetical future features
- New config surfaces without a present, verified product need
- Replacing feature-specific rule PRDs

---

## Contracts (V1)

### 1. Blocking vs Deferred Onboarding Contract

Onboarding is selectively blocking. The two categories of blocking behavior must be kept distinct.

**Hard blocks — application cannot function without these:**
1. Sync root (`WRITING_SYNC_DIR`) is defined and writable where writes are needed
2. Required folder structure exists or is created through guided setup
3. Import path is selected (one of three branches: see Import Branch Contract)
4. Project identity and path convention is selected when creating or importing project-scoped content: standalone (`/projects/<project>/...`) or universe (`/universes/<series>/<book>/...`)

These must be resolved before any prose workflow proceeds.

**Mode-gated blocks — styleguide-specific, dependent on `PROSE_STYLEGUIDE_ENFORCEMENT_MODE`:**
- Missing `prose-styleguide.config.yaml`: blocks `propose_edit` only when enforcement mode is `required`; emits a warning and continues in `warn` mode (the default)
- Missing `skills/prose-styleguide/SKILL.md`: same behavior as above

The application defaults to `warn` mode. Onboarding should encourage completing styleguide setup but must not misrepresent it as a hard block when the runtime does not enforce it as one. The wizard should communicate this distinction honestly: "Your project will work without a styleguide config, but editing quality will be lower until you complete setup."

Note on project mode: the application has no persistent "current project" setting. `WRITING_SYNC_DIR` is the sync root; project paths are derived from `project_id` at call time with either `<project>` or `<universe>/<project>` shape. The `project_id` in workflow context is best-effort. Onboarding must not imply a persistent project root selection beyond what the runtime model supports.

Note on sync folder: not a universal hard block. Users starting from native sync format may create the structure themselves or use onboarding scaffolding. Defining an import/sync source path is required on Branch B and Branch C1.

**Scaffolding status (phased):**
- Phase 1: Not required; users can create folder structure manually or onboarding can guide manual creation
- Phase 2+: Implement automatic folder scaffolding and optional starter files

**Deferred (non-blocking in any phase):**
- Non-critical stylistic preferences that can be added safely later
- Styleguide config and skill file in default `warn` mode (mode-gated, not hard-blocked)

### 2. Defaults and Bootstrap Precedence Contract

When inferred bootstrap candidates conflict with language defaults:
- Language defaults are primary
- Deviations must be explicit user choices

If a setting has no strong language convention:
- Ask explicitly, or infer with lower authority and clear confirmation

Precedence enforcement note: `bootstrap_prose_styleguide_config` returns suggestions and instructs the caller to create config, then apply accepted fields via `update`. The tool itself has no visibility into which suggestions are explicit user deviations vs. accepted defaults. Precedence enforcement belongs to the onboarding workflow/client orchestration, not to raw bootstrap suggestion generation. Implementing the bootstrap tool alone does not satisfy this contract.

Scope alignment note:
- Setup/update write scopes in V1 are `sync_root` and `project_root`
- `universe_root` participates in cascading resolution only (read/resolve precedence), not direct setup/update writes in current tool contracts
- PRD wording must not imply that setup/update tools can target `universe_root` directly unless that is introduced as an explicit product change

### 3. Import Branch Contract

Onboarding uses four import paths in the decision model, with only three intended for first-time scene creation:

**Branch A: Start from native sync format**
- Start from native sync format: user creates or places markdown scene files under documented sync-root structure, then runs `sync`
- Onboarding may scaffold required folders and optional starter files for either supported convention (`/projects/...` or `/universes/...`) if the structure does not exist
- No import source path is required at setup time

**Branch B: Adopt existing native sync folder**
- **Explicit new V1 scope.** User already has prose files arranged in documented native sync format; onboarding validates the structure and runs `sync`.
- Wizard guides folder path selection, validates structure, then runs `sync`.
- Optional corpus-assisted bootstrap is available on this branch after first sync.

**Branch B scope contract — expected input format:**
- Scene files are plain `.md` files
- Metadata may live in YAML frontmatter within the prose file, or in a sidecar file named `<scene-file>.meta.yaml` alongside it
- If both frontmatter and sidecar exist, sidecar wins (existing sidecar-ownership contract applies)
- Files that do not conform to the expected structure are skipped with warnings, not errors, unless the folder contains no valid scene files at all

**Filename mapping:**
- No required filename pattern; any `.md` file in the project directory tree is a candidate
- `scene_id` is taken from frontmatter/sidecar `scene_id` field if present
- If `scene_id` is absent, it is generated from the relative file path (slugified), not from a binder ID (no Scrivener identity chain on this branch)
- Generated IDs must be stable: same file path always produces same ID; onboarding must document this and warn the user if file paths change

**Metadata defaults on Branch B:**
- `title`: taken from frontmatter `title` field, or inferred from the first `# Heading` in the prose, or from filename
- `part`, `chapter`: taken from frontmatter if present; otherwise inferred from folder path depth (see chapter inference below)
- `timeline_position`: not inferred; left unset unless present in frontmatter
- All other fields: not inferred; left unset unless present in frontmatter or sidecar

**Chapter inference from folder path:**
- If the file is at `part-N/chapter-M/<file>.md`, infer `part: N`, `chapter: M` from path segments matching `part-<int>` and `chapter-<int>` patterns
- If the path segments do not match expected patterns, leave `part` and `chapter` unset and emit a warning in the sync report
- Explicit frontmatter values always override inferred path values

**Collision behavior:**
- A collision is defined as two or more `.md` files producing the same `scene_id`
- On collision: skip all conflicting files, emit a warning listing each conflicting path, and continue importing non-conflicting files
- Do not silently overwrite any existing sidecar on collision
- Collisions must be resolved manually before the affected scenes are indexed

**Dry-run behavior:**
- `sync` called during Branch B onboarding must support a dry-run preview mode before any sidecar is written
- Dry-run output must include: file count, detected structure warnings, collision report, and inferred metadata summary for each candidate file
- User must explicitly confirm before onboarding proceeds to write sidecars

**Branch C1: Scrivener External Folder Sync export (supported V1 path)**
- User uses Scrivener External Folder Sync output as the import source
- If External Folder Sync is not yet configured in Scrivener, the wizard guides that setup flow
- User may skip this during initial setup and complete it later using the existing tool directly; no wizard flag or deferred prompt is created
- Wizard validates sync export path and structure
- Optional corpus-assisted bootstrap is available on this branch

**Branch C2: Direct `.scriv` metadata merge (post-setup path, not first-time scene creation)**
- Available only after sidecars already exist
- Not part of first-time onboarding scene creation flow in V1
- Treated as an advanced/maintenance path rather than a first-run import branch

Scrivener handling is split into C1 and C2 to avoid over-scoping first-time onboarding.

### 4. Output Publication Contract

This section defines target V1 write semantics. Where current source behavior differs, this PRD implies explicit implementation changes.

Current behavior snapshot (as implemented today):
- `setup_prose_styleguide_config` writes config directly (no multi-file atomic transaction)
- `update_prose_styleguide_config` writes config directly (no multi-file atomic transaction)
- `setup_prose_styleguide_skill` performs backup/rollback across skill and boot-file targets, so skill + boot-file mutation set is currently transactional rather than best-effort

Target V1 artifact write policy matrix:

| Artifact | Write mode | Rationale |
|---|---|---|
| `prose-styleguide.config.yaml` | Atomic | Partial config produces incorrect editing behavior |
| `skills/prose-styleguide/SKILL.md` | Atomic | Partial skill output is misleading and may silently apply wrong rules |
| Vendor-specific boot/instruction files | Best-effort | Partial wiring degrades gracefully; easily corrected or re-run |

Skill generation scope contract:
- `setup_prose_styleguide_skill` writes a shared sync-root skill file (`skills/prose-styleguide/SKILL.md`)
- Project-scoped skill generation is unsupported in current tooling
- Therefore, skill generation/publication steps run only for sync-root setup flows, not project-root-only setup/update flows
- Project-root configs affect runtime resolution, drift checks, and edit enforcement, but do not produce project-specific assistant instruction files in V1

**V1 write mechanics:**
- Core config (`prose-styleguide.config.yaml`): atomic single-file replace — write to temp file, rename into place; no multi-step transaction needed
- Skill file (`skills/prose-styleguide/SKILL.md`): atomic single-file replace — same pattern
- Boot files (vendor-specific): best-effort per target; return per-file status and error for each attempted write
- Recovery: re-run the failed publication action; no restart-from-step machinery in V1; step-count thresholds are deferred until a genuine multi-step transaction requires them

Vendor-specific instruction file targeting (which files are generated or updated during best-effort publication) is an implementation detail and should not be surfaced to the user. It is documented in developer documentation, not in the user-facing wizard flow.

This matrix should be reviewed and extended in Iteration 2 based on observed failures.

### 5. Confidence and Prefill Contract

There is no single global confidence threshold. Settings are assigned to tiers, and each tier has a fixed interaction pattern regardless of inferred confidence.

**Tier A — Always ask explicitly**
- These settings are always presented as neutral open questions, never prefilled
- Confidence does not affect behavior; the wizard asks every time
- Used for: decisions where a wrong default cannot be corrected cheaply, or that affect project structure and file layout

**Tier B — Prefill with explicit confirmation**
- Inferred or language-derived value is proposed, user must explicitly accept or override
- Pressing enter without reviewing is not sufficient; confirmation is required
- Used for: high-impact non-blocking settings where a confident default exists but stakes are meaningful

**Tier C — Prefill with keep/change prompt**
- Inferred or language-derived value is proposed with a quick keep/change prompt
- Default acceptance on no response is acceptable
- Used for: low-risk stylistic settings where wrong value is easy to correct later

**Provisional tier assignments (V1):**

| Setting | Tier | Notes |
|---|---|---|
| Import path (Branch A / B / C1) | A | Wrong branch is hard to reverse |
| Sync root / source path | A | Structural; hard to correct after import |
| Project path convention (standalone vs universe) | A | Affects all future path resolution |
| `project_id` / `universe_id` / book slug | A | Identity chain; rename is disruptive |
| Setup scope (`sync_root` vs `project_root`) | A | Determines skill generation; affects all downstream |
| Overwrite behavior (existing config / skill / boot files) | A | Destructive action; always confirm |
| `language` | B | High-impact; drives all other defaults |
| `spelling` | B | High-impact; corpus-wide |
| `quotation_style` | B | Significant prose-wide effect |
| `quotation_style_nested` | B | Inferred from `quotation_style`; meaningful choice |
| `tense` | B | Narrative-structural; no safe default |
| `pov` | B | Narrative-structural; no safe default |
| `numbers` | B | Affects corpus-wide consistency |
| `ellipsis_style` | B | Visible in text; stylistically significant |
| `sentence_fragments` | B | Affects edit enforcement behavior |
| `voice_notes` | B | Freeform; author-defined; high value |
| `em_dash_spacing` | C | Language default available; easy to correct |
| `abbreviation_periods` | C | Language default available; easy to correct |
| `oxford_comma` | C | Language default available; easy to correct |
| `date_format` | C | Language default available; easy to correct |
| `dialogue_tags` | C | Stylistic preference; easy to update |
| `time_format` | C | Ask explicitly or leave unset; low-risk either way |

These assignments are provisional. Adjust based on user testing if a Tier C setting produces frequent corrections.

Every inferred value, regardless of tier, must be presented as reviewable before persistence.

### 6. Workflow Discovery and Orchestration Contract

Onboarding is not a freeform sequence inferred ad hoc by an AI assistant. It must be represented as an explicit workflow that the client can execute deterministically.

V1 orchestration stance:
- Reuse and extend workflow discovery so onboarding and styleguide setup are first-class discoverable workflows
- Define a deterministic step contract (inputs, validations, branching, write points) that clients can render without relying on model interpretation of prose instructions
- Keep conversational AI guidance as an assistive layer, not the sole sequencing authority
- Persist setup completion state in configuration/metadata so workflow discovery can determine whether required setup is incomplete
- When required setup is incomplete, `describe_workflows` should return an explicit reminder with the next required setup action(s) and why they are required

Tooling boundary in V1:
- Do not require a brand-new MCP onboarding tool if workflow discovery + existing setup/update tools can cover the flow
- If gaps remain after workflow-discovery extension, add the smallest possible MCP surface to close those gaps
- Setup-completion reminders should be generated from deterministic state checks, not from best-effort natural-language inference

Client surface guidance:
- Preferred host UX is a structured client-side guided flow (for example a command-palette entry in VS Code that launches onboarding)
- This guided flow should execute the explicit workflow contract and call MCP tools step-by-step
- The same workflow definition should remain usable by non-VS Code clients

Setup state schema (V1):
- Setup state should be derived from deterministic runtime/filesystem/config checks where possible; persist additional setup metadata only when derived checks cannot distinguish meaningful states
- Persist onboarding state in a dedicated project-root file: `<project_root>/.mcp-writing/onboarding-state.json`
- Do not store onboarding completion state only inside `prose-styleguide.config.yaml`; onboarding must be trackable even before styleguide config exists
- Version the state payload with `schema_version` for forward-compatible migrations

Required V1 state fields:
- `schema_version` (number)
- `project_id` (string)
- `setup_status` (`not_started` | `in_progress` | `complete`)
- `last_updated_at` (ISO timestamp)
- `steps` (array of step objects)

Step object schema:
- `id` (string, stable identifier)
- `status` (`not_started` | `in_progress` | `done` | `deferred` | `skipped`)
- `blocking` (boolean)
- `applicable` (boolean)
- `reason` (string, optional human-readable context)
- `next_action` (string, optional deterministic next step label)

Initial V1 step IDs:
- `sync_root_defined` (blocking)
- `project_identity_selected` (blocking when creating or importing project-scoped content)
- `import_branch_selected` (blocking)
- `required_structure_ready` (blocking)
- `initial_ingest_completed` (blocking when applicable to chosen branch)
- `styleguide_config_ready` (non-blocking in default `warn` mode)
- `styleguide_skill_ready_sync_root` (non-blocking; applicable only to sync-root skill flow)

`describe_workflows` reminder contract (V1):
- When any applicable blocking step is not `done`, return an onboarding reminder payload with:
	- `setup_incomplete: true`
	- `blocking_steps_remaining: [...]`
	- `next_required_step: { id, next_action, reason }`
- When only non-blocking steps remain, return advisory reminders without marking setup as blocking.
- When all applicable blocking steps are done, return `setup_incomplete: false`.

### 7. User Interaction Contract

The setup experience must be guided Q/A-first and understandable without config-file literacy.

Behavior expectations:
- Ask high-leverage structural questions early
- Explain why a question matters when it affects project structure or blocking behavior
- Always request confirmation before writing persistent changes
- Keep deviations from defaults explicit

---

## Release Phasing (Detailed Breakdown)

### Phase 1a (Iteration 1 — MVP)

**Goal:** One complete, end-to-end import workflow + styleguide setup working together.

**In scope:**
- Styleguide config setup (✅ already largely built)
  - `setup_prose_styleguide_config`, `update_prose_styleguide_config`, `bootstrap_prose_styleguide_config`
  - Language defaults and tier-based question guidance (documented)
  - Boot file generation (`CLAUDE.md`, `.github/copilot-instructions.md`)
- Scrivener import (Branch C1) as the primary import path
  - `import_scrivener_sync`, `import_scrivener_sync_async` (✅ already built)
  - Integration with styleguide setup workflow
- Lightweight setup state tracking
  - Basic tracking of "has styleguide config?" and "has scenes?" state
  - Does NOT require full `.mcp-writing/onboarding-state.json` schema
- Project path convention selection (Tier A question)
  - Wizard explicitly asks: "Standalone project or universe+book structure?"
  - Affects how `project_id` is used throughout session
- Proof-of-concept workflow orchestration
  - `describe_workflows` identifies styleguide setup workflow when config is missing
  - Minimal integration; existing workflows remain unchanged

**Out of scope for Phase 1a:**
- Branch A (start from scratch), Branch B (adopt existing), Branch C2 (post-setup merge)
- Native markdown import dry-run preview
- Full setup state persistence schema
- Workspace scaffolding (folder creation)
- Full workflow discovery integration with all step IDs
- Atomic write mechanics refactoring (existing `fs.writeFileSync()` is acceptable)

### Phase 1b (Iteration 1 Extended — Full Project Initialization)

**Goal:** All four import branches working; full setup state tracking; complete workflow discovery integration.

**In scope (building on Phase 1a):**
- All four import branches (A, B, C1, C2) fully functional
  - Branch A: User creates markdown files, runs sync
  - Branch B: Adopt existing markdown folder with dry-run preview
    - Scene ID generation from filenames
    - Chapter/part inference from folder structure
    - Collision detection and reporting
  - Branch C1: Scrivener import (already done in Phase 1a)
  - Branch C2: Post-setup `.scriv` metadata merge (advanced maintenance path)
- Native markdown import (Branch B) infrastructure
  - Dry-run preview before sidecar generation
  - Filename to scene_id mapping
  - Folder path chapter inference
  - Collision detection/reporting
- Full setup state persistence
  - `.mcp-writing/onboarding-state.json` schema
  - Step tracking (not_started, in_progress, done, deferred, skipped)
  - Blocking vs. non-blocking classification
- Workflow discovery enhancements
  - `describe_workflows` returns setup-completion state
  - Blocking steps trigger workflow recommendations
  - Setup reminders include next_action guidance
- Workspace scaffolding (optional, may be deferred to Phase 2)
  - Automatic folder creation for selected path convention
  - Optional starter files
- Tier framework full application
  - All Tier A/B/C question patterns documented and applied
  - Confirmation flow before persistence
- Atomic write refactoring
  - Config and skill use temp-file-rename pattern
  - Boot files report per-file status

**Out of scope for Phase 1b:**
- Multi-feature onboarding (other config-driven features)
- Advanced recovery/rollback machinery
- Telemetry or usage tracking

### Phase 2+ (Iteration 2+)

**Potential enhancements based on Phase 1 feedback:**
- Multi-feature onboarding framework (apply to other config-driven features)
- Adaptive onboarding depth based on user expertise
- Per-universe and per-project inheritance UX improvements
- Better confidence reporting for inferred defaults
- Optional embedding-based voice characterization (advisory only)
- GUI/form-based setup wizard (if conversational mode proves insufficient)
- Setup migration tooling (legacy → current schema)

---

## Definition of Done

### Phase 1a (MVP)

1. Styleguide setup workflow is discoverable and works end-to-end (setup_prose_styleguide_config → bootstrap → update → skill generation).
2. Scrivener import (Branch C1) integrates with styleguide setup in a single workflow.
3. Project path convention selection is a Tier A question in the setup flow (users explicitly choose standalone vs. universe).
4. Language defaults and tier-based question guidance are documented and applied to styleguide config questions.
5. Setup state tracking (lightweight) allows `describe_workflows` to detect and recommend the styleguide setup workflow when config is missing.
6. Boot file generation for AI assistants works (CLAUDE.md, .github/copilot-instructions.md).
7. Users can complete styleguide setup + Scrivener import without editing YAML/JSON manually.
8. `describe_workflows` notes that "styleguide setup" is optional (not blocking) in default `warn` mode.

### Phase 1b (Full Project Initialization)

9. All four import branches (A, B, C1, C2) are documented and discoverable as workflow options.
10. Branch B (adopt existing markdown folder) is fully implemented with dry-run preview, scene ID mapping, and collision detection.
11. Full setup state persistence schema (.mcp-writing/onboarding-state.json) is implemented with step tracking and blocking status.
12. Workflow discovery (describe_workflows) returns setup-completion state and blocking-step reminders.
13. Workspace scaffolding creates folders and optional starter files for selected path convention.
14. All config settings have assigned Tier A/B/C classifications; tier-based confirmation flow is enforced.
15. Config and skill writes use atomic temp-file-rename pattern; boot files report per-file status.
16. The full workflow contract is defined such that any structured client can execute it deterministically.
17. Onboarding and styleguide setup workflows are explicitly discoverable through workflow discovery.
18. PRD includes a follow-up list for Iteration 2 improvements.

---

## Remaining Open Questions (Before Implementation Phase 1a)

1. **Lightweight setup state tracking:** For Phase 1a, what is the minimum state needed in `describe_workflows` to recommend the styleguide setup workflow? (Can we defer the full `.mcp-writing/onboarding-state.json` schema to Phase 1b?)
2. **Project path convention UX:** How should the "standalone vs. universe" choice be presented to the user? (Interview/confirmation flow, or part of project_id input?)
3. **Client integration for Phase 1a:** Should Phase 1a focus purely on MCP tooling, with VS Code integration deferred to Phase 1b/2?

## Remaining Open Questions (Before Implementation Phase 1b)

1. **Workflow discovery schema:** Confirm whether existing workflow-discovery payloads can represent onboarding branching/validation/write semantics as-is, or whether a schema extension is needed.
2. **Setup state migration details:** Define migration behavior from missing/lightweight Phase 1a state to full Phase 1b schema (bootstrap defaults, backfill strategy, and failure handling).
3. **Branch B feasibility:** Estimate effort for native markdown import (dry-run, scene ID mapping, chapter inference, collision detection).
4. **Scaffolding priority:** Should workspace scaffolding be in Phase 1b or deferred to Phase 2+ based on demand?

---

## Non-Goals

- Defining feature-specific writing rules (kept in feature PRDs)
- Replacing author intent with automatic decisions
- Fully autonomous style inference without author confirmation

---

## Onboarding Surface Area

**Note:** This section describes the full onboarding system as envisioned. Phase 1a focuses on styleguide setup + Scrivener import; Phase 1b expands to all branches and full project initialization.

### 1. First-Time Setup Wizard (Phase 1+ Implementation)

Interactive setup generates a styleguide config with selectable scope:
- sync-root
- project-root

Note: `universe-root` is part of config resolution cascade, but not a direct setup/update write target in current V1 tooling.

Setup output includes:
- Enumerated convention choices
- Explicit confirmation/override of inferred defaults
- Freeform notes field (voice or project-specific nuance)

Wizard may run as:
- Conversational Q/A
- Structured form

V1 preference: structured guided execution backed by explicit workflow metadata, with conversational mode as fallback/assistive interaction.

### 2. Language Inference Defaults

The first question is writing language. Language determines sensible default conventions so later questions become confirmations instead of blank choices.

| Language | Spelling | Quotation style | Em dash spacing | Abbrev. periods | Oxford comma | Date format |
|---|---|---|---|---|---|---|
| English (US) | us | double | closed | with | yes | mdy |
| English (UK) | uk | single | spaced | without | no | dmy |
| English (AU) | au | double | closed | without | yes | dmy |
| English (CA) | ca | double | spaced | without | yes | dmy |
| Swedish | — | dialogue_dash_en | spaced | — | — | dmy |
| Norwegian | — | dialogue_dash_en | spaced | — | — | dmy |
| Danish | — | dialogue_dash_en | spaced | — | — | dmy |
| Finnish | — | guillemets | spaced | — | — | dmy |
| French | — | guillemets | spaced | — | — | dmy |
| Italian | — | guillemets | spaced | — | — | dmy |
| Russian | — | guillemets | spaced | — | — | dmy |
| Portuguese (PT) | — | guillemets | spaced | — | — | dmy |
| Portuguese (BR) | — | double | closed | — | — | dmy |
| German | — | low9 | spaced | — | — | dmy |
| Dutch | — | low9 | spaced | — | — | dmy |
| Polish | — | low9 | spaced | — | — | dmy |
| Czech | — | low9 | spaced | — | — | dmy |
| Hungarian | — | low9 | spaced | — | — | dmy |
| Spanish | — | dialogue_dash_em | spaced | — | — | dmy |
| Irish | — | dialogue_dash_em | spaced | — | — | dmy |
| Japanese | — | corner_brackets | — | — | — | — |
| Korean | — | corner_brackets | — | — | — | — |
| Chinese (Traditional) | — | corner_brackets | — | — | — | — |
| Chinese (Simplified) | — | double | — | — | — | — |

`—` means no language-level default; ask explicitly.

`quotation_style_nested` defaults from `quotation_style` when omitted and should be shown as an inferred value the user can override.

Always explicit author choices:
- tense
- pov
- number style
- ellipsis style
- sentence fragment tolerance

`time_format` is not inferred in V1; ask explicitly or leave unset.

### 3. Corpus-Assisted Bootstrap (Optional)

When existing prose is available, MCP can prefill config candidates by detecting tractable mechanical conventions.

What this mode does:
- Detect likely conventions (spelling, quotation style, tense)
- Propose prefilled values for author confirmation
- Flag drift where prose diverges from declared config
- Suggest config updates when drift appears intentional

What this mode does not do:
- Replace config as source of truth
- Infer open-ended voice/aesthetic intent as final truth
- Persist hidden rules outside version-controlled files

### 4. Ongoing Config Review and Update

After setup, users can:
- Ask for plain-language config summary
- Update values conversationally
- Edit config directly and request validation

The config is a living document, not a one-time output.

---

## Interaction Expectations

- Present inferred defaults as "keep or change" choices
- Ask before writing persistent changes
- Treat drift as a question, not an automatic error
- Preserve explicit escape-valve notation for intentional exceptions

---

## User Scenarios

### Scenario 1: First-Time Setup

User starts a project.

System:
- Asks for language first
- Applies language-based defaults
- Collects explicit values not inferable from language
- Captures freeform notes
- Writes config after confirmation
- If setup scope is sync-root: generates shared `skills/prose-styleguide/SKILL.md` and may publish AI boot files required for vendor wiring
- If setup scope is project-root: skips skill generation/publish steps and only writes project-root config

### Scenario 2: Bootstrap from Existing Corpus

User has existing writing and wants prefill.

System:
- Samples corpus
- Proposes default candidates
- Lets user accept/override each value
- Writes config after confirmation
- If setup scope is sync-root: generates shared `skills/prose-styleguide/SKILL.md` and may publish AI boot files required for vendor wiring
- If setup scope is project-root: skips skill generation/publish steps and only writes project-root config

### Scenario 3: Ongoing Config Changes

User wants to inspect or modify conventions.

System:
- Summarizes current config in plain language
- Applies conversational edits with confirmation
- Validates and saves updated config

---

## Success Criteria

- First-time users complete setup with minimal confusion
- Default acceptance rate is high when language inference is used
- Users can update conventions without manual YAML expertise
- Drift discussions produce either prose fixes or config updates
- Onboarding logic can be reused by multiple writing-assistant features

---

## Risks

- Over-automation causing wrong defaults to appear authoritative
- User fatigue if onboarding asks too many low-value questions
- Bootstrap overfitting to noisy corpus slices
- Scope creep back into feature-specific rule design

---

## Mitigations

- Require explicit confirmation of inferred defaults
- Prioritize only high-impact questions in first run
- Make bootstrap recommendations reviewable and reversible
- Keep feature rule logic in feature PRDs, onboarding logic here

---

## Future Extensions

- Adaptive onboarding depth based on user expertise
- Per-universe and per-project inheritance UX
- Better confidence reporting for inferred defaults
- Optional embedding-based voice characterization (advisory only)

---

## Follow-up for Iteration 2 (Based on Phase 1 Feedback)

This section will be populated after Phase 1a and Phase 1b are complete with observed gaps and improvement opportunities.

**Expected areas for Phase 2 enhancement:**
- Multi-feature onboarding (apply framework to other config-driven features beyond styleguide)
- Advanced recovery and rollback workflows (if Phase 1 encounters missing tooling)
- User research findings on question depth and tier framework effectiveness
- Performance optimizations if setup state tracking becomes a bottleneck
- GUI/form-based alternatives if conversational mode proves insufficient for some users
- Advanced workspace templates or archetypes (beyond basic scaffolding)
- Onboarding state migration tooling (supporting users upgrading from Phase 1a to Phase 1b state)
