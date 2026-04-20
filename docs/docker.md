# Docker & OpenClaw Setup

- [Docker Compose snippet](#docker-compose-snippet)
- [Environment setup script](#environment-setup-script)
- [Register with OpenClaw](#register-with-openclaw)
- [Advanced integration notes](#advanced-openclaw--docker-integration-notes)
  - [Required environment and mounts](#required-environment-and-mounts)
  - [Git ownership trust for mounted repos](#git-ownership-trust-for-mounted-repos)
  - [SSH transport hardening](#ssh-transport-hardening)
  - [Separate auth and signing keys](#separate-auth-and-signing-keys)
  - [Git identity and GitHub email privacy](#git-identity-and-github-email-privacy)
  - [Branch safety for automation](#branch-safety-for-automation)
  - [Quick validation](#quick-validation)
- [Troubleshooting](#troubleshooting)

---

## Docker Compose snippet

```yaml
# docker-compose.yml snippet
writing-mcp:
  build: .
  user: "${OPENCLAW_UID:-1000}:${OPENCLAW_GID:-1000}"
  environment:
    WRITING_SYNC_DIR: /sync
    DB_PATH: /data/writing.db
    HTTP_PORT: "3000"
    OWNERSHIP_GUARD_MODE: "${OWNERSHIP_GUARD_MODE:-warn}"
    GIT_SSH_COMMAND: "ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/ssh/known_hosts"
  volumes:
    - ${OPENCLAW_WORKSPACE_DIR:?run scripts/setup-openclaw-env.sh first}/sync:/sync
    - ${OPENCLAW_SSH_DIR:?run scripts/setup-openclaw-env.sh first}:/ssh:ro
    - writing-mcp-data:/data
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 30s
    timeout: 5s
    retries: 5

volumes:
  writing-mcp-data:
```

---

## Environment setup script

Start from `docker-compose.example.yml` and generate `.env` with machine-specific values:

```sh
sh scripts/setup-openclaw-env.sh
```

That script writes `OPENCLAW_UID`, `OPENCLAW_GID`, `OPENCLAW_WORKSPACE_DIR`, and `OPENCLAW_SSH_DIR` to `.env`.
Running Compose without these values is unsupported and may create invalid mount definitions.
It also normalizes `OWNERSHIP_GUARD_MODE` to `warn` or `fail` and preserves an existing valid value when rerun.

---

## Register with OpenClaw

```json
"mcp": {
  "servers": {
    "writing": { "url": "http://writing-mcp:3000/sse" }
  }
}
```

---

## Advanced OpenClaw / Docker integration notes

When `mcp-writing` runs behind OpenClaw (or any Docker MCP gateway), these details prevent common runtime failures.

### Required environment and mounts

- Set `WRITING_SYNC_DIR=/sync`
- Set `DB_PATH=/data/writing.db`
- Set `OWNERSHIP_GUARD_MODE=warn` (or `fail` to block startup on ownership drift)
- Mount your manuscript sync repo to `/sync`
- Mount a persistent path for SQLite data at `/data`
- Mount SSH materials read-only at `/ssh` and use `GIT_SSH_COMMAND` with `/ssh` paths

Debug/test-only runtime override knobs:

- `RUNTIME_UID_OVERRIDE` — test helper to simulate runtime UID during ownership diagnostics
- `ALLOW_RUNTIME_UID_OVERRIDE=1` — explicitly enables the override outside `NODE_ENV=test`

Do not set these in normal production or desktop deployments.

If `/sync` contains raw Scrivener external-sync output, run the importer once before normal `sync` usage:

```sh
node scripts/import.js /path/to/scrivener-export /sync --project my-novel
```

`sync` indexes files that already contain scene metadata. It does not convert Scrivener `Draft/` filenames into scene sidecars by itself.

### Git ownership trust for mounted repos

If host and container ownership differ, git can fail with:

- `fatal: detected dubious ownership in repository`

Mark the mounted repo path as safe in the container image:

```sh
git config --system --add safe.directory /sync
```

### SSH transport hardening

For private remotes, mount SSH materials read-only and enforce strict host checks:

- Auth key for fetch/pull/push
- `known_hosts` with GitHub host key
- `StrictHostKeyChecking=yes`

Example:

```sh
export GIT_SSH_COMMAND="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/ssh/known_hosts"
```

### Separate auth and signing keys

Use dedicated keys for transport and signing:

- Auth key: repository transport (`fetch` / `pull` / `push`)
- Signing key: commit/tag signatures

Recommended git config:

```sh
git config gpg.format ssh
git config user.signingkey /ssh/id_ed25519_signing
git config commit.gpgsign true
git config pull.ff only
```

### Git identity and GitHub email privacy

If GitHub email privacy is enabled, pushes can fail unless `user.email` is a GitHub noreply address:

```sh
git config user.name "Edda"
git config user.email "<id>+<username>@users.noreply.github.com"
```

### Branch safety for automation

For bot-driven edits, prefer branch-per-change flow:

- Push to `edda/*` or `bot/*`
- Merge via pull request
- Protect `main` from direct automation pushes

### Quick validation

```sh
ssh -T git@github.com
git -C /sync fetch origin
git -C /sync pull --ff-only
```

Then create and push a signed smoke commit on a temporary branch.

---

## Troubleshooting

### "OpenClaw can read tools, but scene indexing is empty or incomplete"

You are likely running `sync` on raw Scrivener `Draft/` output that has not been imported yet.

Fix:

1. Run importer once to create scene metadata sidecars:

```sh
node scripts/import.js /path/to/scrivener-export /path/to/sync-dir --project my-novel
```

2. Restart the service (if needed), then call `sync` again.

Note: importer behavior is Draft-aware (`<source>/Draft` if present, else source root), but plain `sync` only indexes already-normalized scene files.

### "Write access to repository denied" (or git push/pull fails in container)

Your container can start and read files, but cannot write metadata, create snapshots, or push branches.

Fix:

1. Check runtime diagnostics via `get_runtime_config`:
  - `sync_dir_writable` must be `true`
  - `runtime_warnings` should be empty for normal editing flows
2. Ensure `/sync` is mounted read-write (no `:ro`) and owned by the container user.
3. For mounted git repos with UID mismatch, mark safe directory:

```sh
git config --system --add safe.directory /sync
```

4. Verify SSH key has write access to the remote and `known_hosts` is mounted.
5. Prefer branch-per-change workflow (`bot/*` or `edda/*`) if `main` is protected.

### "Blocked: file is root-owned" (EACCES / ownership drift)

The runtime user can read but cannot overwrite prose files.

Fix:

1. Repair host ownership once:

```sh
sudo chown -R "$(id -u):$(id -g)" /path/to/sync-dir
```

2. Ensure container user mapping is set from `.env` (`OPENCLAW_UID` / `OPENCLAW_GID`).
3. Optionally set `OWNERSHIP_GUARD_MODE=fail` to catch mismatches at startup.
4. Re-check `get_runtime_config` and confirm ownership warnings are gone.
