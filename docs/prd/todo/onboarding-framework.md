# PRD: Writing Assistant Onboarding Framework

## Overview

Define an onboarding framework for writing-assistant features that need configurable project conventions.

This PRD covers:
- First-time setup (wizard)
- Optional bootstrap from existing prose corpus
- Ongoing config review and update

It is intended to keep onboarding concerns separate from feature rule logic; this draft focuses on prose-styleguide onboarding and can be generalized further before reuse by other writing-assistant features.

Related PRD:
- `docs/initiatives/done/guideline-generation/prd.md` (style rules and in-edit behavior)

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

---

## Non-Goals

- Defining feature-specific writing rules (kept in feature PRDs)
- Replacing author intent with automatic decisions
- Fully autonomous style inference without author confirmation

---

## Onboarding Surface Area

### 1. First-Time Setup Wizard

Interactive setup generates a styleguide config with selectable scope:
- sync-root
- universe-root
- project-root

Setup output includes:
- Enumerated convention choices
- Explicit confirmation/override of inferred defaults
- Freeform notes field (voice or project-specific nuance)

Wizard may run as:
- Conversational Q/A
- Structured form

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

`time_format` should be inferred from language/spelling defaults when possible, with explicit author override available.

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
- Generates `skills/prose-styleguide/SKILL.md` from resolved config
- Publishes AI boot files required for vendor wiring

### Scenario 2: Bootstrap from Existing Corpus

User has existing writing and wants prefill.

System:
- Samples corpus
- Proposes default candidates
- Lets user accept/override each value
- Writes config after confirmation
- Generates `skills/prose-styleguide/SKILL.md` from resolved config
- Publishes AI boot files required for vendor wiring

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
