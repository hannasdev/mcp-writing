# MCP Tooling Usability Direction (mcp-writing)

Date: 2026-05-01
Applies to: mcp-writing

## Purpose

Define how the tool surface should support the core value of Writing MCP:

- metadata-first reasoning;
- targeted prose access only when needed;
- explicit, safe editing workflows;
- successful collaboration between the author and the agent using the tool.

This proposal is specific to `mcp-writing`. It is not intended as a general convention system for other MCPs.

## Product Alignment

Writing MCP is valuable because it helps an agent reason over a manuscript without defaulting to loading all prose.

This proposal must stay aligned with the product's primary design principles:

1. Metadata first, prose on demand.
2. Explicit over implicit.
3. Deterministic workflows over hidden orchestration.
4. Safe edits with clear approval points.
5. Low mental overhead for normal use.

The goal is not to expose a neatly organized catalog of everything the server can do. The goal is to make the intended use of the product feel obvious and natural.

## Primary Audience

The primary audience is the agent working with and for the author.

That means the surface should help both sides at once:

- the author should not need to understand the full tool graph;
- the agent should not need to memorize the entire capability set to succeed;
- the interaction should guide both toward the product's intended reasoning model.

The tool surface should reduce coordination burden between user intent and tool selection.

## Operating Contexts

This proposal should account for two common product states:

1. Steady-state usage:
   metadata coverage is already strong, and the system can operate as intended with metadata-first reasoning most of the time.
2. Catch-up usage:
   the manuscript, character notes, place notes, or reference documents exist, but metadata parity is partial, stale, or absent.

The ideal experience is steady-state usage. However, catch-up usage is likely to be common for imported projects and manuscripts already in progress.

The product should therefore be designed not only for efficient use after parity exists, but also for helping users reach that state.

## Core Design Decision

The primary surface should be organized around author outcomes, not around the full tool inventory.

This is the central design choice for this PRD.

Why:

- a large visible tool list increases decision burden for both users and agents;
- many capabilities exist for setup, maintenance, or edge cases rather than daily use;
- the product's value comes from guiding reasoning behavior, not from exposing every internal distinction.

This does not require hiding advanced tools completely. It requires treating them as secondary unless the current task actually calls for them.

It also means the product should actively reduce long-term dependence on full-prose fallback when parity is incomplete.

## Core Author Outcomes

The primary surface should help an agent and author complete a small set of recurring, high-value jobs:

1. Find scenes relevant to a manuscript question.
2. Inspect scene or chapter prose when metadata is not enough.
3. Understand a character, place, or thread in context.
4. Revise a scene safely with explicit approval.
5. Prepare review material for sharing.

These outcomes reflect the product's day-to-day value more accurately than a flat list of tools.

## Primary Surface

The primary surface should consist of:

- workflow discovery for common tasks;
- a small set of direct, high-frequency tools;
- clear next-step guidance when a task needs to escalate from metadata reasoning to prose access or editing.
- parity-recovery guidance when the system detects that metadata coverage is lagging behind the manuscript.

The preferred direction is:

- center the experience on `describe_workflows`;
- support it with a few direct tools for common high-frequency actions;
- avoid making users or agents carry a mental map of the full server surface.

This means usability should be judged less by "how many tools are in core" and more by "can the most common manuscript tasks be completed without needing internal tool knowledge?"

## Workflow Discovery

`describe_workflows` should be the default entry point for navigation and guidance.

It should be assumed to be:

- the first call for most agent sessions;
- the go-to tool when the agent is uncertain what to do next;
- the place where the product's intended workflow model is made explicit.

Its role is to:

- identify the likely user goal;
- present the relevant outcome-oriented workflow;
- recommend the next appropriate step;
- keep low-level sequencing out of the user's way unless needed.

This proposal prefers workflow discovery over a broad "core tool menu" because it better matches the product's reasoning model and lowers decision burden.

Direct tools still matter, but they should support common work rather than define the whole usability strategy.

They are best understood as:

- execution tools for known high-frequency tasks;
- shortcuts when the right next step is already clear;
- secondary to workflow discovery for initial orientation.

## Surface Design Rules

The tool surface should follow these rules:

### 1. Start broad, then drill down

Default to metadata-level reasoning whenever possible. Move to prose only when the current question actually requires it.

### 2. Keep prose access explicit, not burdensome

Fetching prose should be a deliberate step, but not a tiresome one. The product should not require confirmation for every normal read operation.

### 3. Reserve confirmation for edits and meaningful mutations

Approval gates are essential for prose edits and other changes with material impact. They are not the right default for normal inspection or analysis.

### 4. Keep setup and maintenance out of the daily-use core

Configuration, onboarding, admin, and infrequent maintenance flows should not occupy the same prominence as common manuscript reasoning tasks.

### 5. Reveal complexity when relevant

Advanced capabilities should be discoverable, but they should come into view when the task needs them rather than competing for attention by default.

### 6. Use expensive reads as opportunities for parity improvement

When the system already needs to touch full prose or full reference content, that moment should be treated as an opportunity to improve future metadata-first usage.

This does not mean every read should become a forced metadata workflow. It means the product should notice when high-cost reads could also help close parity gaps and surface that help in a timely, scoped, and useful way.

### 7. Optimize for joint success

A good surface is one where the agent can reliably choose the right path and the author can follow what is happening without learning the full system.

## Conceptual Modes

The product still depends on an important internal distinction:

- metadata reasoning is cheap and context-efficient;
- prose access is more expensive and should be targeted;
- edits and structural mutations require stronger safeguards.

That distinction is real and should shape the design.

However, it does not need to become heavy user-facing product language.

Instead:

- use it as an internal design constraint;
- reflect it in workflow guidance and defaults;
- expose it to users in plain language when it matters.

The user-facing message should stay simple:

- start with metadata;
- open prose when needed;
- preview and confirm meaningful changes.

This preserves the product philosophy without requiring users to learn a formal mode system.

## Metadata Parity Recovery

Metadata parity should be treated as a first-class product concern.

The product should assume many users will begin with uneven metadata coverage. Without support for recovery, those users may default to prose-heavy workflows and never experience the full value of the system.

The desired behavior is:

- treat parity recovery primarily as a background design rule across normal workflows;
- use large parity gaps as a reason to recommend a more explicit catch-up flow;
- make recovery feel helpful and momentum-building rather than forceful or bureaucratic.

### Parity signal categories

This proposal recognizes four conceptual parity signal categories:

1. Missing metadata:
   expected metadata fields or structures are absent for scenes or related entities.
2. Stale metadata:
   metadata exists, but source prose or linked documents have changed since it was derived, enriched, or aligned.
3. Missing links:
   scenes, characters, places, and reference documents exist, but meaningful relationships between them are absent.
4. Sparse coverage:
   metadata exists, but it is too thin, weak, or incomplete to support reliable metadata-first reasoning.

Sparse coverage includes both:

- project-level thinness, where too much of the manuscript lacks useful descriptive structure;
- scene-level thinness, where fields technically exist but are too weak to be useful, such as token loglines or shallow descriptors.

These signal categories are not equal in priority:

- missing metadata and stale metadata are the clearest first-line recovery signals;
- missing links and sparse coverage are secondary structural signals that become more important once basic metadata presence exists.

In practice, this means:

- when sync or import reveals many scenes or documents without metadata, the system should surface that clearly and recommend focused catch-up work;
- when a user opens full prose or reference content in a low-parity area, the system should recognize the chance to improve future metadata coverage;
- when a parity gap is small, the product should help chip away at it through ordinary usage rather than demanding a separate maintenance session;
- when the gap is large, the product should be comfortable recommending dedicated recovery time.

The purpose of this behavior is not to maximize metadata generation for its own sake. It is to move the project toward the state where metadata-first reasoning becomes reliable and valuable.

Detailed parity measurement, counts, health scoring, and reporting surfaces are out of scope for this PRD. If needed, those should be defined in a separate parity-tracking PRD later.

## What Should Not Be Primary

The following capabilities are important, but should not define the primary daily-use surface:

- styleguide setup and configuration;
- onboarding/bootstrap flows;
- runtime and admin tools;
- import and merge operations;
- bulk enrichment and linking operations;
- alias schemes and naming cleanup;
- response envelope and parameter normalization policy.

These support the product, but they are not the product's main everyday value.

Dedicated catch-up operations also belong here:

- they are transitional rather than daily-use workflows;
- they should appear when parity needs attention, not as constant foreground actions;
- they are important because they help users reach the intended steady-state experience.

Styleguide configuration is a good example:

- it matters during setup and intentional reconfiguration;
- it is not expected to be part of normal repeated manuscript work;
- it should be surfaced when missing or when explicitly requested, and otherwise stay in the background.

## Outcome-Oriented Scenarios

The scenario catalog should be rewritten around user outcomes rather than tool families.

Each scenario should answer:

- what the author is trying to accomplish;
- what the agent needs to know to help;
- what the default path should be;
- when escalation to prose or mutation is appropriate;
- what the next likely step is.

It should also capture parity-recovery moments:

- what low-parity signals should be detected;
- when the product should suggest opportunistic enrichment during normal work;
- when the gap is large enough to recommend explicit catch-up work;
- how to present that guidance so it feels useful rather than interruptive.

The purpose of the scenario catalog is not to document internal orchestration in detail. Its purpose is to make the product's intended usage model coherent.

## Tradeoffs

### Outcome-first surface

Pros:

- lower decision burden;
- better alignment with the product's real value;
- easier for agents to use successfully without full tool memorization;
- easier for authors to follow what the system is doing.

Cons:

- some advanced users may want a more direct low-level path;
- discovery must be very clear or users may feel constrained;
- workflow guidance becomes a critical part of the product experience.

### Tool-first surface

Pros:

- maximum transparency;
- easy to compose custom flows;
- low abstraction overhead for power users.

Cons:

- higher cognitive load;
- more ways for the user or agent to miss the intended metadata-first workflow;
- greater risk that the product is used like a generic file reader instead of a reasoning system.

Decision:

- prefer an outcome-first primary surface;
- preserve direct low-level tools as an advanced layer.
- treat parity recovery as a supporting behavior that helps users reach the intended steady-state model.

## Risks In The Current Direction

If this proposal drifts, the main risks are:

1. Treating tool taxonomy as the product rather than as supporting structure.
2. Giving infrequent setup/configuration workflows the same prominence as daily reasoning tasks.
3. Over-explaining internal design concepts in user-facing language.
4. Adding friction to normal reading flows in the name of explicitness.
5. Measuring usability by tool-count reduction instead of by reduction in decision burden.
6. Failing to help imported or in-progress projects climb from low parity to metadata-first usage.

These risks should be used to review future revisions of this PRD.

## Evaluation Criteria

This design should be considered successful if:

- an agent can help with common manuscript tasks without needing a full mental map of all tools;
- an author can understand the system's behavior without learning internal architecture;
- metadata-first reasoning remains the default behavior in real usage;
- prose access feels intentional but not annoying;
- low-parity projects are gradually pulled toward metadata-first operation rather than getting stuck in prose-heavy fallback;
- the system can distinguish between light opportunistic recovery and moments that justify explicit catch-up guidance;
- setup and advanced tools stop competing with daily-use workflows for attention.

## Out Of Scope For This Pass

The following topics should be handled separately after the design direction is settled:

- rollout and release sequencing;
- compatibility window and deprecation policy;
- exact alias naming strategy;
- parameter normalization details;
- response envelope migration strategy.

Those questions matter, but they should follow from the usability model rather than define it.

## Related Planning

Implementation-oriented milestone planning for this PRD lives in [mcp-tooling-usability-milestones.md](./mcp-tooling-usability-milestones.md).

That companion document breaks the direction in this PRD into user-value milestones, related tools, and likely scopes of change so implementation planning can happen without reopening the full conceptual discussion each time.
