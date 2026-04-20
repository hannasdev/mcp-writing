# AGENT.md

Purpose: Persist project-specific operating context for future AI sessions.

Canonical release setup and maintainer operations live in `MAINTAINERS.md`.

## Ways of working

- Always review the `PRD.md` for related notes to the functionality discussed to maintain consistency over time, and avoid unnecessary scope creep.
- Don't implement features immediately, first, discuss potential tradeoffs with the user.
  - Consider if a feature is in line with the established design principles of the tool, as established in the PRD.
  - Consider if the added scope and maintenance is proportional to the added value of new functionality.
  - Critically analyze not only the new feature, but how it relates to existing features.
  - Always consider unit tests and integration tests as part of changes.
- All changes should start with a new branch from `main`.
- Always open a PR at the end
  - Write an appropriate description that helps the reviewer effectively.

## PR description template

Use this template to structure PR descriptions for clarity and consistency:

```
## <Feature/Fix Title>

**What changed:**
Brief summary of the change and which files were modified.

**Why:**
Design rationale, problem context, or architectural decision. Reference PRD.md where relevant.

**Review focus:**
- Key areas/files reviewers should scrutinize
- Non-obvious design choices or tradeoffs
- Anything that deviates from established patterns

**Testing:**
- New tests added (unit, integration, etc.)
- Test coverage (pass count before/after, or statement coverage)
- Manual verification steps if applicable
```

Adjust sections as needed (omit if not applicable), but maintain the structure for consistency.

## Repo workflow defaults

- Branch strategy: PR-only into main.
- Merge preference: linear history.
  - Default: squash merge.
  - Optional: rebase merge when preserving multiple meaningful commits.
  - Avoid merge commits unless explicitly needed.
- Direct pushes to main are not part of normal workflow.

## Known failure modes and fixes

1. actions/checkout input required token
- Cause: workflow expected secret name not present.
- Fix: ensure current workflow auth path and secret names match.

2. Release step shell syntax error near (
- Cause: malformed grep quote in increment step.
- Fix: correct regex quoting in release.yml.

3. Node MODULE_NOT_FOUND for version string path (for example /.../1.4.1)
- Cause: heredoc + node argument order bug.
- Fix: invoke node as: node - "$PACKAGE_VERSION" "$TAG_VERSION" <<'NODE'
  and parse args with process.argv.slice(2).

4. npm publish E403 cannot publish over existing version
- Cause: stale rerun attempted to republish already published version.
- Fix: do not rerun stale release jobs. Trigger from current main only.

5. GH013 rule violation: changes must be made through pull request
- Cause: release push actor not allowed by branch rules.
- Fix: Deploy Key bypass actor must be configured for protected branch ruleset.

## Operator checklist before debugging release failures

1. Confirm release.yml on main is the expected version.
2. Confirm required secrets exist (names only, never print values).
3. Confirm deploy key has write access enabled.
4. Confirm ruleset includes Deploy Key bypass actor.
5. Confirm latest tag and package.json version alignment.
6. Avoid rerunning old release jobs after partial tag/publish success.

## Session hygiene

- Never commit runs.json.
- Keep release changes in focused PRs with one concern each.
- If branch has already merged, create a new branch for follow-up fixes.
