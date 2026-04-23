---
applyTo: ".github/workflows/**"
---

# Release debugging

## Operator checklist before debugging release failures

1. Confirm `release.yml` on `main` is the expected version.
2. Confirm required secrets exist (names only, never print values).
3. Confirm deploy key has write access enabled.
4. Confirm ruleset includes Deploy Key bypass actor.
5. Confirm latest tag and `package.json` version alignment.
6. Avoid rerunning old release jobs after partial tag/publish success.

## Known failure modes and fixes

1. **`actions/checkout` input required token**
   - Cause: workflow expected secret name not present.
   - Fix: ensure current workflow auth path and secret names match.

2. **Release step shell syntax error near `(`**
   - Cause: malformed grep quote in increment step.
   - Fix: correct regex quoting in `release.yml`.

3. **Node `MODULE_NOT_FOUND` for version string path (e.g. `/.../1.4.1`)**
   - Cause: heredoc + node argument order bug.
   - Fix: invoke node as `node - "$PACKAGE_VERSION" "$TAG_VERSION" <<'NODE'` and parse args with `process.argv.slice(2)`.

4. **npm publish `E403 cannot publish over existing version`**
   - Cause: stale rerun attempted to republish already published version.
   - Fix: do not rerun stale release jobs. Trigger from current `main` only.

5. **`GH013` rule violation: changes must be made through pull request**
   - Cause: release push actor not allowed by branch rules.
   - Fix: Deploy Key bypass actor must be configured for protected branch ruleset.
