# AGENT.md

Purpose: Persist project-specific operating context for future AI sessions.

## Repo workflow defaults

- Branch strategy: PR-only into main.
- Merge preference: linear history.
  - Default: squash merge.
  - Optional: rebase merge when preserving multiple meaningful commits.
  - Avoid merge commits unless explicitly needed.
- Direct pushes to main are not part of normal workflow.

## Release automation model (current)

This repo uses release-it automation (not Release Please).

- Workflow: .github/workflows/release.yml
- Trigger: push to main
- Publish workflow: .github/workflows/publish.yml (on v*.*.* tags)

Release flow:
1. PR merges to main.
2. Release workflow infers increment from commit messages since last tag.
3. release-it creates release commit and tag.
4. Tag triggers npm publish workflow.

## Branch rules and auth model

- Main branch is protected with PR-based rules.
- Release workflow uses SSH deploy key auth (not PAT user bypass).
- Ruleset must include Deploy Key bypass actor for release commit/tag push.

## Required secrets

- RELEASE_DEPLOY_KEY: private SSH key for write-enabled deploy key.
- RELEASE_DEPLOY_KNOWN_HOSTS: optional extra known_hosts entries.
- NPM_TOKEN: npm publish token used by publish workflow.

Important key split:
- Deploy Keys page requires PUBLIC key (single line ssh-ed25519 ...).
- Actions secret RELEASE_DEPLOY_KEY requires PRIVATE key block.

## Versioning conventions used by release workflow

- major: commit body/title includes BREAKING CHANGE or !:
- minor: commit starts with feat:
- patch: everything else

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
