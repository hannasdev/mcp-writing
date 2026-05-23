# PRD: Docker, CI, and Deployment Workflow

**Status:** ✅ Done

This initiative defines a general containerized development, validation, and deployment workflow for `mcp-writing`.
It is separate from OpenClaw-specific integration work: Docker should become a reliable product delivery path for local development, CI, homeserver use, and MCP gateways, while OpenClaw remains one possible consumer.

## Goal

Make Docker a consistently supported workflow for building, testing, running, and deploying Writing MCP.

The product goal is:

- one container image shape that can run the MCP server reliably;
- one local Compose workflow that mirrors deployment assumptions;
- CI checks that prove the image still builds and starts;
- clear deployment guidance for persistent `/sync` and `/data` mounts;
- fewer local-machine surprises around Node, npm, SQLite, Git, SSH, and ownership.

## Problem

Writing MCP already has Docker-related artifacts and documentation, but the container story is not yet productized.
The current state is enough to sketch deployment, but not enough to depend on Docker as a routine workflow.

Known gaps:

- the Dockerfile is not validated in CI as a first-class build target;
- container startup, health checks, and MCP transport behavior are not smoke-tested;
- runtime dependencies such as Git and SSH need explicit container treatment;
- mounted manuscript ownership, Git safe-directory setup, and SQLite persistence are operationally important but not automated or verified;
- local development and deployment may use different Node/npm paths, which hides environment drift;
- Docker docs are currently tied closely to OpenClaw instead of describing a general container contract first.

## Product Boundary

This initiative is about delivery infrastructure and repeatable runtime operation.
It should not change manuscript indexing, metadata behavior, prose editing semantics, or MCP tool contracts.

In scope:

- production-ready Dockerfile design;
- Docker Compose workflow for local and homeserver use;
- CI jobs for image build, smoke startup, health check, and selected MCP validation;
- deployment guidance for local Docker, Compose, and MCP gateways;
- runtime dependency decisions for Node, SQLite, Git, SSH, and certificates;
- environment variable and volume contracts for `/sync`, `/data`, and optional SSH material;
- ownership and permission diagnostics for mounted sync directories;
- documentation that separates generic Docker usage from OpenClaw-specific registration.

Out of scope:

- rewriting the app as a different service architecture;
- making Docker the only supported local workflow;
- changing MCP tool behavior to fit a container runtime;
- introducing cloud-provider-specific deployment templates before the general container contract is stable;
- replacing OpenClaw integration planning.

## Design Principles

1. **Containerization should reduce drift**
   Docker should make the expected runtime boring and reproducible, not add a second unofficial setup path.

2. **Keep MCP as the product contract**
   The same tools and transports should work whether the server runs from npm, source, or a container.

3. **Mounts are explicit product boundaries**
   `/sync` is manuscript state, `/data` is durable runtime state, and optional SSH mounts are credentials.
   The image should make those boundaries obvious.

4. **CI proves the promise**
   If the Docker workflow is documented as supported, CI should build and smoke-test it.

5. **General first, adapters second**
   Docker docs should describe the generic container workflow first.
   OpenClaw, homeserver, and other gateway notes can layer on top.

## Proposed Architecture

### 1. Production image

Build a runtime image that:

- installs production npm dependencies deterministically;
- copies the full runtime surface needed by package exports and the `mcp-writing` binary;
- includes required runtime tools such as Git, SSH client, and CA certificates;
- runs as a non-root user by default or supports explicit host UID/GID mapping;
- exposes HTTP/SSE mode and supports stdio mode where relevant;
- defines a health check against `/healthz`;
- documents Node version and SQLite expectations.

### 2. Compose workflow

Provide a Compose file or example that:

- mounts a manuscript sync repository to `/sync`;
- mounts persistent SQLite/runtime data to `/data`;
- optionally mounts SSH material read-only;
- maps the MCP HTTP port only when HTTP/SSE mode is used;
- sets `WRITING_SYNC_DIR`, `DB_PATH`, `HTTP_PORT`, and ownership guard settings explicitly;
- supports a local smoke test without requiring OpenClaw.

### 3. CI validation

Add CI coverage that:

- builds the Docker image;
- starts the container with fixture mounts;
- waits for `/healthz`;
- runs a minimal MCP/runtime smoke check;
- verifies docs or Compose examples stay in sync with supported environment variables.

The smoke check should be intentionally small.
Full product behavior remains covered by unit and integration tests.

### 4. Deployment documentation

Split documentation into:

- generic Docker workflow: build, run, Compose, mounts, health, logs, upgrades;
- deployment checklist: persistence, ownership, Git, SSH, backups, update flow;
- adapter notes: OpenClaw or other MCP gateway registration examples.

## Milestones

### M1 — Container Contract

- Audit the existing Dockerfile, Compose example, and Docker docs.
- Define the supported environment variables, volumes, user model, and transport modes.
- Document which runtime dependencies belong in the image.

Acceptance criteria:

- A maintainer can explain the container runtime contract without reading source code.
- Generic Docker docs are not dependent on OpenClaw-specific assumptions.

### M2 — Working Runtime Image

- Update the Dockerfile so the image starts from a clean build.
- Include required runtime files and OS dependencies.
- Add or update health check behavior.
- Verify the image can run against a mounted fixture sync directory and persistent `/data` volume.

Acceptance criteria:

- `docker build` succeeds from a clean checkout.
- A container can start, report healthy, and serve MCP HTTP/SSE mode.
- `get_runtime_config` reports expected `/sync` and `/data` paths.

### M3 — Compose and Local Workflow

- Provide a Compose workflow for local development and homeserver deployment.
- Include UID/GID, ownership guard, Git safe-directory, and SSH examples.
- Add a local smoke command for maintainers.

Acceptance criteria:

- A maintainer can run the server through Compose without editing source files.
- Permission and ownership problems have clear diagnostics and recovery steps.

### M4 — CI Enforcement

- Add CI image build.
- Add a container smoke test.
- Add documentation drift checks for Docker examples where practical.

Acceptance criteria:

- Docker regressions fail CI before release.
- The smoke test covers container startup, `/healthz`, and one runtime/MCP sanity check.

### M5 — Deployment Readiness

- Document upgrade, backup, log, and rollback expectations.
- Clarify supported and unsupported deployment targets.
- Fold OpenClaw-specific container registration back into the generic Docker docs as an adapter section.

Acceptance criteria:

- Docker is a supported workflow, not just an example.
- OpenClaw docs can refer to the generic Docker workflow instead of duplicating container operations.

## Test Strategy

Unit tests:

- no new domain unit tests expected unless runtime config parsing changes.

Integration tests:

- container smoke test for build/start/health;
- runtime config call against a containerized server;
- optional read-only mount or ownership-guard characterization if practical in CI.

Manual verification:

- build image locally;
- run Compose with a fixture sync repo;
- confirm `/healthz`;
- call `get_runtime_config`;
- run `sync` on a small fixture;
- verify Git snapshot behavior when `/sync` is a Git repo;
- verify SSH documentation with a non-production test key when available.

## Risks and Tradeoffs

- Docker support can create a false sense of sandboxing. The app still edits mounted local files and relies on filesystem boundary helpers, ownership diagnostics, and Git auditability.
- UID/GID mapping differs across macOS, Linux, and CI. The supported model must be explicit.
- Shipping Git and SSH inside the image increases operational surface but is necessary for snapshot and remote workflows.
- CI smoke tests should stay small so container confidence does not make the normal unit/integration suite slower or more brittle.

## Relationship to Other Work

- Filesystem Boundary Hardening improves confidence in mounted-volume writes, but does not itself make Docker a supported runtime.
- OpenClaw Integration can consume this Docker workflow, but should not own the generic container contract.
- Client-Agnostic Setup may eventually use container diagnostics, but setup UX remains separate from deployment infrastructure.
