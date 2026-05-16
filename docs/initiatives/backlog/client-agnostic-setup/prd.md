# PRD: Client-Agnostic Setup Contract

**Status:** 📋 Deferred backlog (not active)

This work is intentionally deferred while product focus shifts to structural manuscript state boundaries and workflow doctrine.
The setup contract direction remains available for future pickup, but it should not be treated as active implementation scope.

## Goal

Define a client-agnostic setup contract for configuration-driven writing features so setup can be presented through client-native UI surfaces without expanding the MCP tool list with onboarding-only commands.

The product goal is:
- one shared setup contract
- multiple client-specific setup UIs
- the same canonical project files regardless of which client was used

This PRD supersedes the broader "onboarding framework" direction for future implementation planning. The old proposal tried to model more of first-run setup inside the MCP workflow surface. This proposal keeps durable capabilities in MCP and moves guided setup UX to clients.

## Problem

The current product has durable setup-related capabilities, but the user experience for reaching them is awkward:
- a raw tool list is already hard to navigate
- first-run setup is structurally different from day-to-day usage
- setup questions are better expressed as structured UI than as tool-parameter discovery
- adding more onboarding-only tools creates long-term surface area for short-lived tasks
- first-run project setup still expects too many manual steps such as git initialization, folder preparation, and Scrivener sync configuration
- runtime permission problems are diagnosable today, but recovery guidance is still more operational than guided

This is especially true for prose styleguide setup and related project conventions:
- the resulting config matters continuously after setup
- the setup wizard itself matters mostly on first run and during occasional maintenance

We want to improve setup without permanently increasing MCP complexity.

## Product Boundary

This work is about setup architecture and config lifecycle, not about changing feature behavior.

In scope:
- a shared setup contract that is not tied to any one IDE or desktop client
- client-native setup entry points such as command palette flows, forms, or desktop dialogs
- canonical output files written into the project
- validation, preview, and confirmation rules shared across clients
- setup triggers for missing or invalid configuration
- migration guidance for existing styleguide setup flows

Out of scope:
- a new MCP onboarding tool that owns the full wizard
- client-specific UI implementation details for every host
- adding new feature-specific config domains without a present product need
- replacing feature PRDs that define the actual writing rules

## Design Principles

1. **Durable in MCP, transient in clients**
   The MCP surface should expose reusable capabilities, not one-time ceremony.

2. **One contract, many UIs**
   VS Code, Cursor, Claude Desktop, and future clients may present setup differently, but they should all follow the same setup contract.

3. **Canonical files are the source of truth**
   Setup is complete when the real config artifacts exist and validate, not when a wizard says it ran.

4. **Prefer derivation over wizard state**
   "Is setup complete?" should usually be derived from actual project files and runtime checks.

5. **Structured questions beat conversational guessing**
   High-leverage setup choices should be defined declaratively so clients can render them deterministically.

6. **Do not grow the tool list for first-run-only value**
   Add MCP surface only when the underlying capability remains useful outside onboarding.

## Proposed Architecture

The setup system has three layers.

### 1. Shared setup contract

A declarative contract defines:
- which setup flows exist
- which questions each flow asks
- which values are required, inferred, or optional
- which validations apply
- which files are produced or updated
- which follow-up actions are suggested after completion

This contract is implementation-neutral. It is not a VS Code wizard, a Cursor dialog, or a Claude Desktop sheet. It is the shared definition those clients consume.

Suggested artifact:
- `docs/onboarding/setup-contract.json`

The exact file name can change, but the important part is that the schema is stable and versioned.

### 2. Client-specific setup UI

Each client renders the shared contract in its own native UX:
- VS Code: command palette entry plus structured quick-pick/input flow
- Cursor: command palette or settings workflow
- Claude Desktop: setup panel, prompt flow, or missing-config action
- other hosts: any equivalent guided UI

Client responsibilities:
- launch the appropriate setup flow
- render questions in the right order
- show previews and confirmations
- collect user overrides
- write canonical output files or call shared write helpers
- surface validation errors clearly

The client owns the presentation layer. It does not invent the rules.

### Question model expectations

The shared contract should preserve a few useful onboarding behaviors from the earlier styleguide-focused proposal:

- ask writing language first when language meaningfully affects defaults
- turn inferred defaults into explicit reviewable "keep or change" decisions rather than silent automation
- reserve fully explicit questions for values that are not meaningfully inferable, such as tense, POV, number style, ellipsis style, and sentence-fragment tolerance
- allow project-specific freeform notes where a client needs to capture voice or nuance that does not belong in enumerated convention fields

For prose styleguide setup, language-aware defaults should reduce blank-form fatigue without pretending they are authoritative. Nested quotation behavior and related convention details may be inferred from the primary quotation choice, but should remain overridable.

### 3. Canonical project artifacts

Regardless of client, setup produces the same durable files.

For prose styleguide V1, the primary artifacts remain:
- `prose-styleguide.config.yaml`
- `skills/prose-styleguide/SKILL.md` when sync-root skill generation is applicable
- vendor wiring files only where needed by the chosen client/tooling environment

The source of truth is still the actual project config, not an onboarding session record.

## Why Not "Just One config.json"?

A shared JSON file is useful, but only if it represents a formal setup contract rather than becoming a second source of truth.

The important distinction:
- good: a schema or contract file that defines questions, defaults, tiers, and validation
- risky: a generic wizard-state file that clients write however they want

The setup contract should describe the flow. The final output should still live in the canonical project config files that the runtime already uses.

## MCP Boundary

The MCP should keep exposing durable primitives such as:
- config creation and update operations
- bootstrap analysis from existing prose
- validation and drift detection
- sync/import operations
- workflow discovery and runtime diagnostics

The MCP should not become the primary UI host for setup.

That means:
- no large new onboarding-only tool family
- no requirement that agents simulate a wizard through repeated tool calls
- no persistent protocol complexity just to support first-run UX

If a capability is only useful for a wizard and not otherwise reusable, it probably belongs outside the MCP tool surface.

## Relationship to `describe_workflows`

`describe_workflows` should remain the MCP navigation layer, not the full onboarding engine.

Its role in this design:
- indicate whether relevant config appears missing or invalid
- point to the recommended setup flow
- explain whether the missing setup is blocking or advisory

Its role is not:
- carrying every branching question for the setup flow
- acting as the main wizard transport
- expanding into a cross-client UI description language

In other words, `describe_workflows` can recommend setup, but clients should host setup.

## Setup Contract Shape

The shared contract should define setup in a way that any client can render.

Suggested sections:
- `schema_version`
- `flows`
- `questions`
- `defaults`
- `validation_rules`
- `artifact_targets`
- `completion_rules`

Each question should specify:
- stable `id`
- label and help text
- whether it is blocking
- whether it is always asked, inferred with confirmation, or low-risk keep/change
- allowed values or input type
- default derivation source
- validation rules
- where accepted values are written

This preserves the useful tiering idea from the previous proposal without requiring the tier logic to be embodied as new MCP tools.

## First Candidate Flow: Prose Styleguide Setup

The first implementation target should remain prose styleguide setup because it already has:
- a real recurring value after setup
- existing write/update/bootstrap capabilities
- clear missing-config behavior
- enough structure to validate the contract approach

The flow should cover:
1. Choose scope and project path context where needed.
2. Choose language.
3. Apply language-aware defaults.
4. Confirm or override high-impact conventions through structured "keep or change" review.
5. Optionally bootstrap from existing prose.
6. Preview the resulting config.
7. Write canonical config artifacts.
8. Optionally publish client- or vendor-specific instruction wiring where applicable.

This is a better fit for a client-side guided flow than for a larger MCP tool family.

## Completion Model

Setup completion should be derived from the real artifacts whenever possible.

For styleguide V1, that means checking:
- does the relevant config file exist?
- is it valid?
- is the required skill file present when the selected scope requires it?
- if a client depends on vendor-specific wiring, is that wiring present?

Only add persisted setup state if resumability or ambiguity proves impossible to solve from actual files and runtime checks.

Default stance:
- no mandatory global `onboarding-state.json`
- derive first, persist second

## Missing-Setup Triggers

Clients should be able to launch the setup flow from:
- explicit command-palette invocation
- first-run detection
- missing config during an editing workflow
- invalid config or drift checks
- permission or ownership diagnostics that indicate the runtime cannot safely write the expected project artifacts

The key behavior distinction:
- blocking setup should interrupt only when the runtime truly cannot proceed
- advisory setup should be offered without pretending the product is unusable

For styleguide setup, default behavior remains advisory in `warn` mode and blocking only when enforcement mode is explicitly `required`.

## Tradeoffs

### Benefits

- keeps first-run ceremony out of the long-lived MCP tool list
- gives users a much better UX for structural setup decisions
- lets different clients provide native-feeling setup without forking the product model
- keeps source of truth in real project files
- makes setup easier to evolve without changing the core protocol each time
- creates a clearer place to surface recovery guidance for permission/ownership problems instead of leaving users with raw diagnostics alone

### Costs

- requires a maintained shared contract/schema
- requires at least one client implementation to realize the UX benefit
- introduces coordination between runtime logic and client adapters
- some cross-client parity work will still be needed

## Non-Goals for V1

- a universal GUI toolkit inside the server
- onboarding flows for hypothetical future features
- a generalized persistence layer for every setup interaction
- replacing the current config files with a new master wizard-state file

## Migration Strategy

This proposal should replace the previous "onboarding inside workflow surface" direction gradually.

Near-term migration:
- keep existing durable tools
- keep existing config artifacts
- stop planning large onboarding-only additions to the MCP surface
- move future setup guidance toward client-hosted flows backed by a shared contract

## Open Questions

1. Where should the shared setup contract live in the repository: product docs, runtime-readable asset, or both?
2. Should clients write config files directly, or should they call a small set of shared write helpers to avoid divergence?
3. Which vendor/client wiring files are truly canonical product concerns versus optional adapters?
4. How much of the current styleguide setup logic should remain in MCP versus move into shared client-agnostic libraries?

## Test Strategy

Unit:
- validate the setup contract schema
- validate question ordering, defaults, and tier metadata
- validate artifact-target mapping from accepted answers to output fields
- validate completion-rule derivation from filesystem/config state

Integration:
- verify the prose styleguide setup flow can be completed from the shared contract to canonical files
- verify `describe_workflows` reports missing/advisory setup accurately without becoming the wizard itself
- verify bootstrap, config update, and drift tools still work independently of any specific client UI
- verify different client adapters produce equivalent final config for the same answers

Manual:
- run the same styleguide setup flow through at least two clients and confirm the resulting project files are equivalent
- confirm first-run, missing-config, and explicit reconfigure entry points all land in the same contract-driven flow

## Definition of Done

1. A versioned client-agnostic setup contract exists for prose styleguide setup.
2. The contract can express required questions, inferred defaults, validation, preview, and artifact targets.
3. At least one client-native setup UI consumes that contract successfully.
4. The flow writes the same canonical project files regardless of client.
5. `describe_workflows` recommends setup when appropriate without becoming the setup transport.
6. No new onboarding-only MCP tool family is introduced to support the flow.
7. Tests cover contract validity, artifact generation, and setup-completion detection.
