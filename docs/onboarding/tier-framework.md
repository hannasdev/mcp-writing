# Onboarding Tier Framework

This document defines the Phase 1a question model for onboarding flows that set up prose-styleguide behavior.

It turns the tier contract in `docs/prd/in-progress/onboarding-framework.md` into an execution-ready UX spec for structured clients and conversational fallback flows.

---

## Phase 1a Scope

Phase 1a applies the tier framework to the styleguide setup flow and the minimal structural decisions needed to make that flow usable.

In scope for this document:
- Question tiers for styleguide setup
- Confirmation rules before any persistent writes
- Mandatory vs optional decisions for the Phase 1a happy path
- Prompt and form behavior expectations for structured clients

Out of scope for this document:
- Full onboarding-state persistence
- Branch B native markdown import questions
- Workspace scaffolding prompts
- Phase 1b branch selection flow details beyond initial tier classification

---

## Tier Definitions

### Tier A: Explicit Structural Decision

Use Tier A when a wrong answer is expensive to correct or changes project layout.

Rules:
- Always ask explicitly.
- Never auto-fill with an accepted default.
- Show the consequence of each option before the user confirms.
- Require explicit confirmation before moving to the next step.
- If the current filesystem state makes one option invalid, explain why and block that option.

Allowed UI patterns:
- Radio group with help text and an explicit Continue action
- Conversational multiple-choice prompt that requires a named answer

Not allowed:
- Silent default selection
- Implicit acceptance on Enter
- Burying the consequence in secondary help text only

### Tier B: High-Impact Convention With Confirmation

Use Tier B when a sensible proposed value exists but the decision materially affects prose output or editing enforcement.

Rules:
- Present a proposed value with a short reason.
- Require the user to choose Keep or Change.
- If the user chooses Change, collect the replacement value immediately.
- Include the final chosen value in the pre-write summary.

Allowed UI patterns:
- Prefilled field with `Keep` and `Change` actions
- Conversational prompt in the form `Proposed: X because Y. Keep or change?`

Not allowed:
- Treating no response as acceptance
- Applying bootstrap inference without user review

### Tier C: Low-Risk Convention With Quick Review

Use Tier C when the value is easy to change later and a language-derived default is usually sufficient.

Rules:
- Present the proposed value and why it was chosen.
- Allow default acceptance on no response in structured clients.
- In conversational flows, provide a `Keep` shortcut and a `Change` path.
- Still include the accepted value in the pre-write summary.

Allowed UI patterns:
- Prefilled field with optional edit affordance
- Conversational prompt in the form `Defaulting to X for Y language. Keep or change?`

Not allowed:
- Hiding the value entirely because it is low risk
- Writing the value before the summary step

---

## Cross-Tier Interaction Rules

These rules apply to every onboarding question regardless of tier.

1. Ask structural questions before style questions.
2. Show only one high-leverage decision at a time in conversational mode.
3. Persist nothing until the user approves the full summary.
4. Show inferred values as reviewable choices, not facts.
5. Preserve explicit user deviations from language defaults.
6. If bootstrap suggestions conflict with language defaults, present the conflict and require an explicit user choice.

---

## Phase 1a Question Inventory

### Structural Questions

| Question | Tier | Phase 1a status | Why it matters |
|---|---|---|---|
| Project path convention (`projects/<project>` vs `universes/<series>/<project>`) | A | In scope | Determines how `project_id` is interpreted during the session. |
| Setup scope (`sync_root` vs `project_root`) | A | In scope | Determines where config is written and whether shared skill publication is offered. |
| Scrivener import now or later | A | In scope when user starts from Scrivener | Changes the happy-path order for import and bootstrap. |
| Import branch selection beyond Scrivener | A | Deferred to Phase 1b | Full branch matrix is not part of Phase 1a delivery. |

### Styleguide Questions

| Setting | Tier | Prompt behavior | Phase 1a requirement |
|---|---|---|---|
| `language` | B | Ask explicitly, then require keep/change confirmation on the proposed language profile | Mandatory |
| `spelling` | B | Propose from language; require explicit keep/change | Mandatory |
| `quotation_style` | B | Propose from language; require explicit keep/change | Mandatory |
| `quotation_style_nested` | B | Propose from outer quotation style; require explicit keep/change | Mandatory |
| `tense` | B | Ask with no silent default; require explicit confirmation | Mandatory |
| `pov` | B | Ask with no silent default; require explicit confirmation | Mandatory |
| `numbers` | B | Propose or ask depending on language; require explicit confirmation | Mandatory |
| `ellipsis_style` | B | Propose from language when available; require explicit confirmation | Mandatory |
| `sentence_fragments` | B | Present enforcement impact; require explicit confirmation | Mandatory |
| `voice_notes` | B | Optional freeform input, but always explicitly offered | Optional prompt |
| `em_dash_spacing` | C | Propose from language; allow quick keep/change | Mandatory review |
| `abbreviation_periods` | C | Propose from language; allow quick keep/change | Mandatory review |
| `oxford_comma` | C | Propose from language; allow quick keep/change | Mandatory review |
| `date_format` | C | Propose from language; allow quick keep/change | Mandatory review |
| `dialogue_tags` | C | Propose project default; allow quick keep/change | Mandatory review |
| `time_format` | C | Ask or leave unset if no confident default; allow quick keep/change when proposed | Optional |

Mandatory review means the value must appear in the summary even if the user accepts the proposal immediately.

---

## Confirmation Flow Spec

Phase 1a confirmation is a four-step sequence.

1. Structural setup
   Capture Tier A decisions first: path convention, setup scope, and whether Scrivener import is part of the flow.
2. Proposed conventions
   Gather Tier B and Tier C values, showing language-based defaults and bootstrap suggestions as proposals.
3. Summary review
   Render one plain-language summary grouped into `Structure`, `Styleguide conventions`, and `Publication targets`.
4. Write approval
   Ask for explicit approval before any config or skill file is written.

Required summary content:
- Selected path convention
- Selected setup scope
- Whether Scrivener import is part of the current flow
- All accepted or overridden Tier B values
- All accepted Tier C values
- Whether boot files will be published
- Any unresolved optional fields left unset

Required approval copy:
- Structured UI: `Confirm and write files`
- Conversational UI: `Review complete. Write these changes? yes/no`

If the user declines at the summary step:
- No files are written.
- The flow returns to the nearest editable section rather than restarting from the beginning.

---

## Prompt Copy Guidelines

Keep prompts short, concrete, and consequence-aware.

Preferred prompt shapes:
- Tier A: `Choose your project layout: standalone project or universe + book. This affects where project content lives.`
- Tier B: `Proposed quotation style: single quotes, based on English (UK). Keep or change?`
- Tier C: `Defaulting Oxford comma to no for English (UK). Keep or change?`

Avoid:
- Abstract labels without examples
- Asking multiple Tier B questions in a single paragraph
- Describing defaults as if they were already final

---

## Decision Record: Phase 1a Question Set

Decision date: 2026-05-04

### Decisions

1. Tier logic remains a workflow-orchestration concern in Phase 1a.
2. The first structural question added to the happy path is `path_convention`.
3. Styleguide setup remains non-blocking in default `warn` mode, but the flow must still surface it proactively when missing.
4. `voice_notes` remains optional, but it must be explicitly offered before summary.
5. `time_format` may remain unset in Phase 1a when no strong default exists.

### Mandatory Questions in Phase 1a

- Project path convention
- Setup scope
- Language
- Spelling
- Quotation style
- Nested quotation style
- Tense
- POV
- Numbers
- Ellipsis style
- Sentence fragments
- Em dash spacing
- Abbreviation periods
- Oxford comma
- Date format
- Dialogue tags

### Optional Questions in Phase 1a

- Scrivener import now or later
- Voice notes
- Time format

### Deferred to Phase 1b

- Full import branch selection across A/B/C1/C2
- Setup-state persistence questions
- Workspace scaffolding choices
- Branch B dry-run review prompts

---

## Implementation Notes

This document is the source specification for milestone `1a.1`.

Follow-on implementation work should update:
- Workflow catalogue step definitions
- `describe_workflows` recommendation copy
- Styleguide setup integration tests covering Tier A/B/C behavior