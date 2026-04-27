# OpenClaw Availability & Integration

**Status:** 🚧 In Progress

## Goal

Make `mcp-writing` easy for OpenClaw users to discover, install, connect, and use correctly without changing the core product contract.

The product contract remains:
- `mcp-writing` is an MCP server for long-form fiction workflows
- metadata-first retrieval remains the primary interaction model
- prose edits remain explicit and reviewable
- OpenClaw is a first-class adapter, not the primary architecture

## Product Boundary

This work is about **availability and integration**, not a rewrite of the product.

In scope:
- reliable OpenClaw connection paths for local users
- packaging that teaches OpenClaw agents how to use `mcp-writing` correctly
- setup and verification commands that reduce install friction
- clear docs for local, Docker, and homeserver usage

Out of scope:
- rewriting `mcp-writing` as a native OpenClaw plugin
- changing core manuscript, metadata, or editing workflows to fit OpenClaw
- adding OpenClaw-only tool behavior that diverges from the MCP surface
- making OpenClaw the only supported gateway/client

## User Problems

### 1. OpenClaw users can connect an MCP server, but do not automatically know how to use this one well

A raw MCP registration exposes tools, but it does not teach the agent:
- metadata first, prose second
- sync before analysis when files changed externally
- `propose_edit` before `commit_edit`
- review bundles before artifact generation

Desired outcome:
- OpenClaw agents use `mcp-writing` in the intended workflow order
- users get predictable, safe behavior instead of generic file-agent behavior

### 2. Installation is too manual for non-expert users

Today, a user may need to:
- start the server
- choose transport
- register MCP config
- verify connectivity
- understand Docker/localhost/network edge cases
- optionally install skill content separately

Desired outcome:
- a user can get to first successful tool use with one documented path
- common failures are diagnosed automatically

### 3. The current integration story is split across runtime shape, docs, and operational assumptions

The repo already supports OpenClaw-compatible usage, but the experience is fragmented.

Desired outcome:
- one clear OpenClaw integration story
- one recommended path for local use
- one recommended path for Docker/networked use
- one shared verification checklist

## Design Principles

1. **Keep MCP as the core contract**
   `mcp-writing` should remain a standard MCP server usable beyond OpenClaw.

2. **Teach workflow, not just transport**
   Good integration requires both connectivity and skill guidance.

3. **Prefer progressive productization**
   Start with the smallest path that works for real users, then add packaging and automation.

4. **Preserve existing safety model**
   OpenClaw integration must respect metadata-first retrieval and explicit prose-edit confirmation.

5. **Avoid OpenClaw-specific product lock-in**
   Integration should not fork the product into “OpenClaw mode” and “normal mode.”

## Current State

Current confirmed capabilities:
- HTTP/SSE transport at `/sse`
- health endpoint at `/healthz`
- stdio transport via `MCP_TRANSPORT=stdio`
- OpenClaw-oriented Docker documentation
- an in-progress OpenClaw integration planning document

Current gaps:
- no polished OpenClaw bundle/package
- no dedicated OpenClaw install helper
- no OpenClaw-specific doctor/verification flow
- no agent skill that encodes `mcp-writing` usage philosophy
- stdio mode exists but is not yet positioned as a first-class OpenClaw install path

## Recommended Integration Strategy

### Phase 1: Supported manual integration

Provide and document two supported connection paths:

1. **stdio mode (default for local desktop users)**
   Best for OpenClaw-managed child-process execution and low-friction local setup.

2. **HTTP/SSE mode (secondary path)**
   Best for persistent local services, Docker deployments, homeserver setups, and independent runtime debugging.

This phase proves:
- transport compatibility
- configuration examples
- verification workflow
- user-facing setup docs

### Phase 2: OpenClaw bundle / skill packaging

Ship a real OpenClaw-compatible bundle in this repository that includes:
- Codex bundle marker and manifest
- a `skills/` root with `SKILL.md`
- optional `.mcp.json` defaults where appropriate

The skill must teach:
- `describe_workflows` first when uncertain
- `sync` after external file changes
- metadata-query tools before prose tools
- `propose_edit` before `commit_edit`
- `preview_review_bundle` before `create_review_bundle`

This phase improves agent behavior, not just connectivity.

### Phase 3: Installer and doctor UX

Add CLI helpers that reduce setup overhead, for example:
- OpenClaw setup/init helper
- OpenClaw-focused doctor mode
- transport-aware verification output
- clearer error messages for Docker/host networking cases

Setup helpers should support both:
- **automatic write mode** for a simple default path
- **print/review mode** for users who want to inspect the generated config first

This phase improves first-run success rate.

### Phase 4: Native plugin evaluation

Do not build a native OpenClaw plugin unless users clearly need:
- first-class config UI
- service lifecycle management inside OpenClaw
- richer OpenClaw-only commands
- marketplace/distribution constraints that bundles cannot satisfy

This is an evaluation gate, not a committed implementation milestone.

## Packaging Decisions

### Default local transport

Recommended default for local desktop users:
- `stdio`

Rationale:
- no separate long-running service required
- no port selection or localhost debugging needed
- best fit for OpenClaw spawning the MCP server directly

Recommended secondary transport:
- HTTP/SSE

Rationale:
- better for persistent service mode
- better for Docker and homeserver deployments
- easier to probe operationally via `/healthz`

### Bundle location

Recommended default:
- keep the OpenClaw bundle in this repository

Rationale:
- bundle and MCP surface version together
- fewer install-story splits
- lower risk that skill guidance drifts away from actual tool behavior

### Skill installation scope

Recommended default:
- bundle-only scope

Rationale:
- clean install/uninstall story
- skill version stays tied to bundle version
- users do not need to understand OpenClaw skill precedence for the default path

Advanced override:
- document how advanced users can replace or override the bundle-provided skill with workspace or user-scope skills when needed

## Functional Requirements

1. `mcp-writing` must remain usable as a standalone MCP server outside OpenClaw.
2. OpenClaw users must have at least one documented, supported local install path that does not require manual repo patching.
3. OpenClaw users must have at least one documented Docker/network install path.
4. A recommended OpenClaw skill must be available that encodes intended workflow behavior.
5. Stdio mode must be documented as a supported OpenClaw transport path and the default recommendation for local desktop users.
6. Health and connectivity verification must be documented for each supported transport.
7. Setup docs must cover localhost/container hostname differences explicitly.
8. OpenClaw integration must not bypass existing edit-confirmation safeguards.
9. OpenClaw-facing packaging must use real documented bundle conventions rather than ad hoc file layout.
10. Setup helper commands must support both config review and automatic-write modes.

## Non-Functional Requirements

- Installation guidance should be understandable by users who are comfortable with terminal tools but not MCP internals.
- Verification steps should distinguish config-written from server-reachable from tools-usable.
- Bundle/skill naming should keep exposed tool names readable inside OpenClaw.
- The integration should degrade gracefully when Git, permissions, or sync-dir ownership are misconfigured.

## Milestones

### M1 — Manual OpenClaw support is official

Deliverables:
- docs for HTTP/SSE registration
- docs for stdio registration
- verification checklist for both
- explicit recommendation for when to use each transport

Success criteria:
- a user can connect `mcp-writing` to OpenClaw locally using either transport
- docs are sufficient without code inspection

### M2 — Bundle + skill packaging

Deliverables:
- OpenClaw-detectable bundle structure in this repo
- skill content teaching correct workflows
- install instructions for local directory/packaged bundle usage

Success criteria:
- OpenClaw detects the bundle
- the skill is visible to agent sessions
- tool usage becomes more workflow-aligned

### M3 — OpenClaw setup helper

Deliverables:
- CLI helper for initial setup
- ability to emit or install recommended config
- default bundle-only skill path with documented override options

Success criteria:
- setup takes one primary command plus one verification step
- common misconfigurations are surfaced clearly

### M4 — Doctor and operational diagnostics

Deliverables:
- `doctor` coverage for OpenClaw-related checks
- validation for runtime prerequisites, connectivity, and bundle/skill presence
- transport-specific error guidance

Success criteria:
- users can self-diagnose most failed setups
- support/debug burden decreases

### M5 — Evaluate native plugin need

Deliverables:
- explicit decision record based on user demand and bundle limitations

Success criteria:
- no native plugin work starts without evidence of need

## Acceptance Criteria

This initiative is successful when:
- OpenClaw users can install and use `mcp-writing` without reading source code
- both transport and workflow guidance are documented
- OpenClaw agents behave in a way consistent with `mcp-writing` design principles
- bundle packaging works without requiring a native plugin
- stdio and HTTP support are both treated as real product paths where appropriate

Practical acceptance gate:
- from a clean OpenClaw setup, a user can install or connect `mcp-writing`, see the tools, run one metadata query successfully, and complete one proposal-only edit flow without manual config surgery

## Risks & Tradeoffs

### 1. Shipping only raw MCP config is fast but incomplete

Benefit:
- minimal implementation effort

Risk:
- poor agent behavior
- higher support burden
- confusing first-run experience

### 2. Shipping a bundle adds packaging overhead but improves usability

Benefit:
- better tool discoverability and agent behavior
- more polished OpenClaw experience

Risk:
- more packaging surface to maintain

### 3. Building a native plugin too early increases maintenance burden

Benefit:
- richer OpenClaw-specific integration potential

Risk:
- premature lock-in
- duplicated behavior already covered by MCP + skills
- slower delivery of user-visible value

### 4. Supporting both stdio and HTTP adds docs complexity

Benefit:
- better fit across local, managed, and containerized environments

Risk:
- more verification paths to test and document

## Test Strategy

### Unit

- bundle manifest/path validation helpers
- config generation helpers for stdio and HTTP modes
- doctor checks for:
  - Node version
  - Git availability
  - sync dir existence/writability
  - health endpoint checks
  - OpenClaw config detection/parsing
- transport selection and normalization logic
- skill-install path resolution logic

### Integration

- start `mcp-writing` in HTTP mode and verify:
  - `/healthz` responds
  - `/sse` is reachable
  - a sample OpenClaw-compatible config is generated correctly

- start `mcp-writing` in stdio mode and verify:
  - the process can be spawned cleanly
  - MCP initialization succeeds
  - representative tools are callable

- bundle integration smoke:
  - install bundle from local directory
  - verify OpenClaw detects it as a bundle
  - verify skill visibility
  - verify MCP server definitions are loaded as expected

- Docker/network integration:
  - same-network hostname path
  - host-to-container path
  - documented failure cases with expected guidance

### Manual validation

- first-run local setup from a clean machine/workspace
- OpenClaw user flow with no prior MCP config
- OpenClaw user flow with existing workspace skills
- homeserver deployment validation with the real network topology
- regression check that editing safeguards still require explicit approval

## Open Questions

1. Should the bundle include default `.mcp.json` entries for both stdio and HTTP, or only the default stdio path?
2. Should the setup helper prefer writing to workspace-local OpenClaw config or user-level config when both are available?
3. How much automated verification can run in CI versus requiring a manual homeserver smoke test?

## Related

- [PRD.md](../../../PRD.md) — product-level design principles and feature map
- [docs/setup.md](../../setup.md) — runtime setup and prerequisites
- [docs/docker.md](../../docker.md) — OpenClaw and container integration notes
