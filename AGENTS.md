# AGENT.md

Purpose: Persist project-specific operating context for future AI sessions.

Canonical release setup and maintainer operations live in `MAINTAINERS.md`.

## Ways of working

- Always review the `PRD.md` for related notes to the functionality discussed to maintain consistency over time, and avoid unnecessary scope creep.
- Don't implement features immediately. First, discuss potential tradeoffs with the user.
  - Consider if a feature is in line with the established design principles of the tool, as established in the PRD.
  - Consider if the added scope and maintenance is proportional to the added value of new functionality.
  - Critically analyze not only the new feature, but how it relates to existing features.
  - Always consider unit tests and integration tests as part of changes.
- All changes should start with a new branch from `main`.
- Always open a PR at the end
  - Write an appropriate description that helps the reviewer effectively.

## Repo workflow defaults

- Branch strategy: PR-only into main.
- Merge preference: linear history.
  - Default: squash merge.
  - Optional: rebase merge when preserving multiple meaningful commits.
  - Avoid merge commits unless explicitly needed.
- Direct pushes to main are not part of normal workflow.

## Session hygiene

- Never commit runs.json.
- Keep release changes in focused PRs with one concern each.
- If branch has already merged, create a new branch for follow-up fixes.

> Specialized workflows and release debugging procedures live in `.github/instructions/`.
