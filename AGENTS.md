# AGENTS.md

Purpose: Persist project-specific operating context for future AI sessions.

Canonical release setup and maintainer operations live in `MAINTAINERS.md`.

---

## Ways of working

- Always review `PRD.md` before proposing or implementing changes.
- Do not implement immediately. First:
  - Identify tradeoffs
  - Validate alignment with design principles
  - Evaluate scope vs value
  - Consider impact on existing features
- Always include test strategy (unit + integration) in proposals.
- If required context is missing or unclear, STOP and ask before proceeding.

---

## Development workflow (strict)

All changes MUST follow this sequence:

- Do not skip, reorder, or parallelize workflow steps.

### 1. Discussion phase

- MUST review `PRD.md` before proceeding
- No code changes before tradeoffs are discussed and approved
- If approval is unclear, do not proceed

### 2. Branch creation

- Create a new branch from `main`
- Naming: follow `.github/instructions/contribution-workflow.instructions.md`
  - `feat/<short-description>`
  - `fix/<short-description>`
  - `docs/<short-description>`
  - `chore/<short-description>`
  - `refactor/<short-description>`

### 3. Implementation

- Keep changes scoped to a single concern
- Write tests alongside implementation
- Do not include unrelated changes

### 4. Commit

- MUST use `skills/commit-writing/SKILL.md`
- Do not proceed to PR until commits are clean and scoped

### 5. Pull Request (required)

- ALWAYS open a PR after implementation and commit preparation (no direct merges)
- MUST use `skills/pr-description/SKILL.md`
- PR must accurately reflect the actual implementation

### 6. Review handling

- MUST use `skills/code-review/SKILL.md`
- Do not blindly apply all feedback
- Group feedback into:
  - correctness issues
  - improvements
  - opinions
- Ask for clarification if feedback is ambiguous or conflicting
- Do not consider the PR complete or merged unless explicitly instructed

### 7. Completion

A change is considered complete when:

- All blocking issues are resolved
- Tests are passing or explicitly not run with a valid reason
- PR description matches final implementation

### 8. Follow-up changes

- Apply fixes in new commits (do not rewrite history unless explicitly requested)
- Update PR description if behavior or scope changes

---

## Skills

Use these specialized skills:

- `skills/commit-writing/SKILL.md` (used during Commit step)
- `skills/pr-description/SKILL.md` (used during Pull Request step)
- `skills/code-review/SKILL.md` (used during Review handling step)

These define execution details. This file defines workflow and constraints.

---

## Repo workflow defaults

- Branch strategy: PR-only into main
- Merge preference:
  - Default: squash merge
  - Optional: rebase merge for meaningful commit history
  - Avoid merge commits unless necessary

---

## Hard constraints

- Never push directly to `main`
- Always isolate changes to a single concern per PR
- If a branch is already merged, create a new branch for fixes

---

## Session hygiene

- Prefer clarity over speed
- If uncertain, ask instead of assuming
- Avoid partial implementations without explicit acknowledgment

---

> Specialized workflows and release debugging procedures live in `.github/instructions/`.
