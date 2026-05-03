# PRD: Prose Styleguide Skill & Assistant

## Overview

Provide a reusable system that helps authors maintain consistent prose quality, narrative structure, and stylistic integrity across a repository.

This PRD covers the styleguide runtime and editing behavior components:
- `prose-styleguide.config.yaml` — author-selected conventions (enumerable, config-driven)
- `skills/prose-styleguide/SKILL.md` — universal craft rules + voice notes injected from config

Onboarding and config lifecycle UX (wizard, bootstrap flow, and ongoing updates) are tracked in:
- `docs/prd/todo/onboarding-framework.md`

---

## Implementation Status (2026-05-03)

Current state: **partially delivered**.

### Confirmed complete

- Onboarding and config lifecycle implementation details are tracked in `docs/prd/todo/onboarding-framework.md`.
- Skill generation is implemented via `setup_prose_styleguide_skill`, writing to `skills/prose-styleguide/SKILL.md`.
- Editing enforcement is integrated in `propose_edit`:
  - requires config/skill in required mode
  - supports explicit bypass with required `bypass_reason`
  - blocks on styleguide violations when enforcement mode is `required`
- Runtime diagnostics are implemented for invalid `PROSE_STYLEGUIDE_ENFORCEMENT_MODE`:
  - invalid values fall back to `warn`
  - warning is surfaced in startup diagnostics and `get_runtime_config`
- Unit/integration tests exist for config resolution, skill generation, editing enforcement, and runtime mode validation.

### Remaining before this PRD is complete

- Formalize and lock the user-facing output contract for Review Mode beyond internal tool behavior.
- Validate and document completion against success criteria (currently defined but not marked as met).
- Decide closure path for this PRD (move to `done/` or keep in `in-progress/` with explicit milestone gates).

---

## Problem

Writers and developers using AI tools face:

- Inconsistent prose style across documents or scenes
- AI rewriting that flattens voice and tone
- Lack of structural rigor in scenes (no clear purpose or transformation)
- Difficulty maintaining narrative continuity over time
- High cognitive load when editing large bodies of text

Non-expert users especially struggle to encode their style into reusable instructions.

---

## Goals

- Maintain consistent prose style across the repository
- Preserve author voice while improving clarity and structure
- Ensure every scene or section has purpose and transformation
- Provide structured critique, not just rewriting
- Enable non-expert users to benefit from strong writing principles without writing prompts by hand

---

## Non-Goals

- Fully autonomous rewriting of prose
- Enforcing a single "correct" writing style across all projects
- Replacing author intent or creative control
- Acting as a grammar-only tool

---

## Core Principles

1. Preserve voice over optimizing clarity
2. Prefer critique over rewrite
3. Enforce structure before style
4. Require intent (scene purpose, transformation)
5. Allow controlled stylistic deviation when intentional

---

## Invocation Model

The styleguide is a **standing order**, not an on-demand command. Whenever the AI edits prose — whether via `propose_edit`, `commit_edit`, or direct in-scene editing — it loads `skills/prose-styleguide/SKILL.md` and the resolved config automatically as part of its working context. The author does not need to invoke it explicitly.

This means:
- Every prose edit applies the styleguide by default
- Review Mode and Edit Mode are not separate commands; they describe the posture the AI takes depending on whether the user asks for critique or asks for changes
- The styleguide can be bypassed for a specific request by saying so explicitly ("ignore the styleguide for this edit")

If no config file is found at session start, the AI prompts the user to run the setup wizard before proceeding with any prose editing.

---

## File Location

There is no vendor-neutral standard for AI instruction files. To avoid duplicating content across tools, the styleguide lives in a canonical `skills/` directory at the project root, and vendor-specific configs reference it from there.

```
{WRITING_SYNC_DIR}/
  skills/
    prose-styleguide/
      SKILL.md                   ← single source of truth
  prose-styleguide.config.yaml   ← author conventions (project root)
```

`prose-styleguide.config.yaml` follows the `.editorconfig` convention of living at the root and cascading — a config at the universe root applies as the default; a config inside a project subdirectory overrides it for that project.

### Vendor integration

Each AI tool references the canonical file rather than duplicating its content:

- **Claude Code** — `CLAUDE.md` imports the file via `@skills/prose-styleguide/SKILL.md`
- **GitHub Copilot** — `.github/copilot-instructions.md` references it; since Copilot does not support file imports, the content must be inlined at setup time and kept in sync manually
- **Other tools** — reference or inline as needed; the canonical file is always `skills/prose-styleguide/SKILL.md`

If the `.ai/` directory becomes an adopted neutral standard, `skills/` can migrate there without changing the canonical filename.

Both the skill file and the config are version-controlled alongside the prose. Changes to conventions are tracked in git history like any other project file.

---

## Architecture: Two-Layer Design

The styleguide is split into two distinct layers that serve different purposes.

### Layer 1: Mechanical Conventions (config)

Discrete, enumerable author choices that can be detected from text and selected via wizard.

Stored in `prose-styleguide.config.yaml`. Examples:

```yaml
spelling: uk                      # uk              — British English (colour, realise)
                                  # us              — American English (color, realize)
                                  # au              — Australian English (colour, realize)
                                  # ca              — Canadian English (colour, realize — mixed standard)

quotation_style: single           # double          — US/Australian ("like this")
                                  # single          — UK/inverted commas ('like this')
                                  # guillemets      — French/Italian/Russian/Portuguese (« like this »)
                                  # low9            — German/Dutch/Polish/Czech/Hungarian („like this“)
                                  # dialogue_dash_en — Scandinavian en dash (– like this)
                                  # dialogue_dash_em — Spanish/Irish em dash (— like this)
                                  # corner_brackets — Japanese/Korean/Chinese (「like this」)

quotation_style_nested: double    # The style used for a quote within dialogue.
                                  # double          — inner double quotes ("she said 'hello'")
                                  # single          — inner single quotes ('she said "hello"')
                                  # guillemets_single — inner single guillemets (‹like this›)
                                  # low9_single     — inner single low9 (‚like this‘)
                                  # corner_brackets_double — inner double brackets (『like this』)
                                  # Inferred from quotation_style if not set.

em_dash_spacing: closed           # closed          — no spaces around em dash (US: like—this)
                                  # spaced          — spaces around em dash (UK/EU: like — this)

ellipsis_style: ellipsis_char     # three_periods   — three separate periods (...)
                                  # ellipsis_char   — single ellipsis character (…)
                                  # spaced          — spaced periods (. . .)

abbreviation_periods: without     # with             — US style (Mr., Dr., etc.)
                                  # without          — UK style (Mr, Dr, etc.)

oxford_comma: yes                 # yes              — serial comma before final "and" (a, b, and c)
                                  # no               — no serial comma (a, b and c)

numbers: spell_under_100          # spell_under_10   — numerals for 10 and above
                                  # spell_under_100  — numerals for 100 and above
                                  # always_spell     — always spell out (literary style)
                                  # numerals         — always use numerals

date_format: dmy                  # mdy              — US (April 25, 2026)
                                  # dmy              — UK/EU (25 April 2026)

# Optional override — inferred from spelling/language if not set.
# time_format: 12h               # 12h              — 12-hour clock (3:30 pm)
#                                 # 24h              — 24-hour clock (15:30)

tense: present                    # present | past | present (past for flashbacks)

pov: third_limited                # first | third_limited | third_omniscient
                                  # Sets the default POV for the project. If a scene appears
                                  # to shift POV, the AI flags it as a question rather than
                                  # an error — the author confirms whether it is intentional
                                  # (e.g. a deliberate omniscient passage) or a drift to fix.

dialogue_tags: minimal            # minimal (prefer "said") | expressive
sentence_fragments: intentional   # disallow | intentional
```

Voice notes — stylistic guidance that can't be expressed as discrete options — are included as a freeform field:

```yaml
voice_notes: |
  Fragmented internal monologue for POV characters under stress.
  Understatement preferred over emotional labeling.
```

### Layer 2: Universal Craft Rules (SKILL.md)

Non-negotiable structural and editorial principles that apply regardless of author preferences. The SKILL.md is a template that injects the resolved config at load time.

These rules do not vary by project and are not configurable:
- Scene purpose must be identifiable
- Each scene must include transformation
- Repetition must evolve
- Dialogue must reflect character cognition
- Critique before rewrite

### Config → SKILL.md injection

At load time, the config values are translated into concrete instructions appended to the universal rules. For example:

- `spelling: uk` → "Use UK spelling throughout (colour, realise, etc.)"
- `quotation_style: guillemets` → "Use guillemets « » for all dialogue"
- `quotation_style: dialogue_dash_en` → "Open each line of dialogue with an en dash (–) on a new line; no closing punctuation mark"
- `quotation_style_nested: single` → "Use single quotes for any quotation within dialogue"
- `em_dash_spacing: spaced` → "Place a space on both sides of an em dash ( — )"
- `ellipsis_style: three_periods` → "Write ellipses as three separate periods (...), not the ellipsis character"
- `abbreviation_periods: with` → "Write abbreviated titles with periods (Mr., Dr., Prof.)"
- `oxford_comma: yes` → "Use a serial comma before the final item in all lists"
- `numbers: spell_under_100` → "Spell out numbers below 100; use numerals for 100 and above"
- `date_format: dmy` → "Write dates in day-month-year order (25 April 2026)"
- `tense: present` → "Maintain present tense; flag past tense outside of marked flashbacks"

This keeps the SKILL.md generic and reusable across projects, while the config encodes author-specific choices.

---

## Feature Components

### 1. Default Prose Styleguide Skill (`SKILL.md`)

A generic, project-agnostic template that embeds universal craft principles and a config injection slot. Shared as a proposed default — authors can override or extend it.

#### A. Structural Rules

- Scene purpose must be identifiable (plot, character, theme, tone)
- Each scene must include transformation (emotional, narrative, relational)
- Repetition must evolve
- Avoid non-functional "bridging" scenes

#### B. Prose Rules

- Use syntax and punctuation for pacing
- Use paragraphing for emphasis
- Replace generic beats with concrete action
- Sentence fragments allowed only when marked intentional in config
- Apply dialect/spelling variant from config

#### C. Dialogue Rules

- Apply quotation style from config
- Prefer dialogue tags from config (default: minimal/"said")
- Use action beats over emotional labeling
- Avoid exposition in dialogue unless justified
- Reflect character cognition in voice

#### D. Controlled Instability

Allow stylistic breakdown only when:
- tied to POV
- temporary
- intentional
- aligned with theme

---

### 2. Review Mode (Primary Interaction)

When invoked, the assistant should:

1. Identify scene purpose
2. Identify transformation (or lack thereof)
3. Flag structural issues
4. Flag prose inconsistencies against the resolved config
5. Suggest improvements

Output should prioritize:
- structural critique
- config violations (tense drift, wrong quotation style, etc.)
- clarity issues

Rewrites should be minimal and justified.

---

### 3. Edit Mode

When editing text:

- Preserve voice and tone
- Apply config conventions (spelling, quotation style, tense) consistently
- Do not shorten unless requested
- Do not simplify nuance
- Apply rules selectively, not mechanically

---

### 4. Onboarding and Config Lifecycle

Onboarding and configuration lifecycle flows are specified in a dedicated, cross-feature PRD:

- `docs/prd/todo/onboarding-framework.md`

This includes:
- First-time setup wizard behavior
- Language inference defaults and override behavior
- MCP-assisted bootstrap from existing corpus
- Ongoing conversational config review and update flows

This PRD remains focused on prose styleguide rules and in-edit behavior.

---

## Config Drift

The config declares intent. Prose may diverge intentionally (flashbacks in a present-tense project, omniscient interjections in a limited-POV project). The system must handle this gracefully:

- Config supports escape-valve notation: `tense: present (past for flashbacks)`
- Review mode flags drift as a question, not an error: "This passage is in past tense — intentional flashback or drift?"
- The author's answer can inform a config update or a `flag_scene` note

---

## User Scenarios

### Scenario 1: Scene Review


User provides a scene.

System (with resolved config loaded):
- Identifies purpose and transformation
- Flags structural issues
- Flags convention violations (tense drift, wrong quotation marks, etc.)
- Suggests improvements

---

### Scenario 2: Editing Assistance

User asks to improve a scene.

System:
- Preserves voice
- Applies config conventions consistently
- Improves structure and clarity
- Explains significant changes

---

## Success Criteria

- Users report improved consistency across writing
- Reduced need for manual rewriting after AI edits
- Resolved config and generated skill are applied consistently during prose edit workflows
- Scenes consistently demonstrate purpose and transformation
- Fewer "flat" or redundant scenes

---

## Risks

- Config drift vs. actual practice (config becomes wrong rather than describing intentional variation)
- Over-constraining creativity via too many rules
- AI over-editing and flattening voice
- Users misunderstanding critique as mandatory rules
- SKILL.md growing too large and competing with prose for context budget (target: under 600 tokens)

---

## Mitigations

- Escape-valve notation in config for known intentional exceptions
- Emphasize "guidelines, not laws"
- Require justification for major edits
- Keep rules structured and grouped; enforce a SKILL.md size ceiling
- Allow opt-out or override behavior per scene

---

## Prerequisites

### Skills directory migration

Before implementing the prose styleguide skill, the existing skills should be moved from `.github/skills/` to the canonical `skills/` location established by this PRD. This keeps `.github/` for GitHub-specific tooling and gives all AI skills a consistent home.

**Scope** (separate branch: `chore/migrate-skills-to-root`):
- Move `.github/skills/code-review/` → `skills/code-review/`
- Move `.github/skills/commit-writing/` → `skills/commit-writing/`
- Move `.github/skills/pr-description/` → `skills/pr-description/`
- Update the three path references in `AGENTS.md`
- Create `CLAUDE.md` at project root, importing all skills so Claude Code auto-discovers them

**Not in scope:** changing the content of any existing skill file.

---

## Future Extensions

- Open-ended style characterization (voice, rhythm) via embedding-based corpus analysis (Phase 4)
- Per-universe vs. per-book config inheritance (shared conventions + book-specific overrides)
- Scene indexing automation ("Scene DNA" generation)
- Character voice modeling
- Narrative consistency tracking across chapters
- Integration with outlining tools
