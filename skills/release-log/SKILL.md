---
name: release-log
description: Use when preparing a PR that changes user or maintainer behavior and you want a human-readable release entry focused on value, impact, and action.
---

# Release Log Skill

## Purpose

Capture user-facing value from each relevant PR in a concise, non-technical release log so merged work stays understandable after review context is gone.

## When to use

Use this skill during PR creation or PR updates when the change affects:
- user workflows;
- maintainer workflows;
- configuration defaults;
- output shape or behavior;
- setup, migration, or operational expectations.

Skip for strictly internal refactors with no external impact.

## Required process

Before writing the release log entry:

1. Review the PR diff against `main`.
2. Review the PR description (`Summary`, `Motivation`, `Implementation`, `Testing`, `Risks and tradeoffs`, `Follow-up`).
3. Identify concrete user or maintainer value.
4. Identify who is affected and whether any action is required.
5. Add/update one entry in `docs/release-log.md` under `## Unreleased`.

## Entry format

Use this structure:

```markdown
### YYYY-MM-DD — Short title

- What changed: <plain-language change summary>
- Why it matters: <value/outcome for users or maintainers>
- Who is affected: <audience>
- Action needed: <explicit action or `None`>
- PR: <link or #number>
```

Rules:
- Newest entries first under `## Unreleased`.
- Use plain language; avoid internal implementation detail unless it changes behavior.
- Keep bullets outcome-focused.
- If no action is required, write `Action needed: None`.
- Do not duplicate technical changelog wording.

## Quality bar

Good:
- Explains the benefit, not only the code movement.
- Makes impact clear in under 5 bullets.
- Mentions required user action only when relevant.

Bad:
- "Refactored module paths and updated exports."
- Vague statements with no value framing.

## Final response after updating release log

After updating `docs/release-log.md`, summarize:
- the new release-log entry title/date;
- intended audience;
- any required user action (or `None`).
