# AGENTS.md

Purpose: persist project-specific operating context for future AI sessions.

This file is guidance for agents working in the repository. It is not the
product source of truth.

---

## Documentation map

- `README.md` is for users of the app: what the package does, how to install
  it, how to configure it, and how to use the exposed MCP tools.
- `PRODUCT.md` is the source of truth and starting point for product work,
  including active focus, initiative tracking, design principles, foundations,
  and links to the relevant product and architecture documents.
- `MAINTAINERS.md` is the source of truth for release setup and maintainer
  operations.
- `.github/instructions/` contains specialized GitHub and release-debugging
  procedures.

When product intent, development details, and user-facing docs appear to
overlap, start from `PRODUCT.md` and only update `README.md` when the change
affects app users.

---

## Ways of working

- Always review `PRODUCT.md` before proposing or implementing changes.
- Before substantial product or code changes:
  - Identify tradeoffs
  - Validate alignment with design principles
  - Evaluate scope vs value
  - Consider impact on existing features
- Include a test strategy appropriate to the risk, usually covering unit and
  integration impact when behavior changes.
- If required context is missing or unclear, STOP and ask before proceeding.

---

## Development workflow

- Keep changes scoped to a single concern.
- Write or update tests alongside behavior changes.
- Do not include unrelated changes.
- Use a branch for implementation work; branch naming should follow
  `.github/instructions/contribution-workflow.instructions.md` when creating a
  new branch.
- Open a PR for repository changes that should be reviewed or merged. Do not
  push directly to `main`.
- PR descriptions should accurately reflect the final implementation.
- For user-facing or maintainer-facing behavior changes, include a
  human-readable release note or release-log entry when appropriate.
- Apply follow-up fixes in new commits unless history rewriting is explicitly
  requested.

General Codex skills live outside this repository, under the user's Codex
configuration. Use those general skills when their triggers apply or when the
user explicitly asks for them; do not expect repo-local skill files to exist.

---

## Review handling

- Do not blindly apply all feedback.
- Group feedback into:
  - correctness issues
  - improvements
  - opinions
- Ask for clarification if feedback is ambiguous or conflicting.
- Do not consider a PR complete or merged unless explicitly instructed.

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
