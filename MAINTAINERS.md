# MAINTAINERS.md

Maintainer-facing operational notes for this repository.

## Release automation

This repository uses a `release-it` workflow (modeled after `n8n-nodes-bambulab`) instead of Release Please.

How it works:

1. A PR is merged into `main`.
2. `.github/workflows/release.yml` runs on that push.
3. The workflow fetches tags and infers version bump type from commits since last tag:
   - `BREAKING CHANGE` or `!:` -> major
   - `feat:` -> minor
   - everything else -> patch
4. `release-it` creates a `Release x.y.z` commit and `vx.y.z` tag.
5. Tag push triggers `.github/workflows/publish.yml` to publish to npm, then publish `server.json` metadata to the MCP Registry.

## Required setup

- Repository secret: `RELEASE_DEPLOY_KEY` (private SSH key for a repo deploy key with write access)
- Environment secret `NPM_TOKEN`: npm publish token required by `.github/workflows/publish.yml` (exposed as `NODE_AUTH_TOKEN` for `npm publish`); define it in the `npm` GitHub Actions environment on the repository (Settings → Environments → npm → Secrets)
- No dedicated MCP Registry secret is required for the default GitHub OIDC flow; the publish workflow authenticates with `mcp-publisher login github-oidc`
- Optional secret: `RELEASE_DEPLOY_KNOWN_HOSTS` (additional strict host keys; GitHub host key is already handled)
- Branch rules must allow the Deploy Key actor to bypass PR-only rule for release commit/tag push
- Repository URL in `package.json` must remain valid for npm provenance
- `package.json:mcpName` and `server.json:name` must stay aligned for MCP Registry validation

Local dry-run (optional):

```sh
npm run release -- --ci --dry-run
```

For release incident debugging (failure modes, operator checklist), see [`.github/instructions/release-debugging.instructions.md`](.github/instructions/release-debugging.instructions.md).
