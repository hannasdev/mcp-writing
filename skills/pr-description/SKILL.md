---
name: pr-description
description: Use when opening a pull request, updating a pull request description, or preparing a summary for review.
---

# PR Description Skill

## Purpose

Write pull request descriptions that help reviewers understand the change quickly and review it effectively.

## Required process

Before writing the PR description:

1. Review the branch diff against `main`.
2. Review relevant notes in `PRD.md`.
3. Identify the user-facing or maintainer-facing purpose of the change.
4. Identify test coverage and validation performed.
5. Identify risks, tradeoffs, and follow-up work.
6. Ensure the PR is scoped to one concern.
7. If user-facing or maintainer-facing behavior changed, update `docs/release-log.md` using `skills/release-log/SKILL.md`.

## PR title

Use a clear title matching the primary change.

Prefer Conventional Commit style:

```text
feat: add pull request description workflow
fix: prevent runs.json from being committed
docs: clarify maintainer release process
```

## PR description template

Use this structure:

```markdown

## Summary

- Briefly describe what changed.
- Keep this concrete and reviewer-oriented.

## Motivation

Explain why the change is needed.

## Implementation

Describe the key technical decisions.

## Testing

List validation performed.

Examples:

- `npm test`
- `npm run lint`
- Manual test of `<specific workflow>`
- Not run: `<reason>`

## Risks and tradeoffs

Call out anything reviewers should pay attention to.

## Follow-up

List any known follow-up work, or write `None`.
```

## Rules

- Do not write vague PR descriptions.
- Do not claim tests were run unless they actually were.
- Do not hide uncertainty. If something was not validated, say so.
- Do not expand the PR scope in the description to make it sound larger than it is.
- Mention any intentional omissions.
- Mention any behavior changes explicitly.
- Mention any migration, release, or compatibility impact if relevant.
- Update the PR description if the implementation scope changes after review.

## Pre-merge checklist

Before marking a PR ready, verify these common failure points:

1. Contract text and sample output match exactly. If a section is named one way in docs or generated output, examples should use the same label verbatim.
2. Tests cover behavior, not only headings or presence checks. Assert representative bullets, examples, and failure paths where relevant.
3. Validation is based on explicit user intent, not just parsed values. If flags or inputs can be malformed, fail fast with a clear error.
4. Detailed roadmap state lives in `PRD.md`; keep `README.md` high-level unless a top-level status snapshot truly needs updating.
5. Keep the PR scoped to one concern. If review uncovers a second feature or workflow, split it into a separate PR.

Use this checklist to tighten the implementation before review and to keep the PR description honest about scope, validation, and follow-up.

## Good summary examples

Good:
```markdown
## Summary

- Adds a reusable PR description skill.
- Documents the required structure for summary, motivation, implementation, testing, risks, and follow-up.
- Aligns PR descriptions with the repo's existing PR-only workflow.
```

Bad:
```markdown
## Summary

Updated some docs and improved workflow.
```

## Testing section rules

If tests were run:
```markdown
## Testing

- `npm test`
- `npm run lint`
```

If tests were not run:
```markdown
## Testing

- Not run: documentation-only change.
```

If validation was manual:
```markdown
## Testing

- Manually reviewed generated PR description against the branch diff.
```

## Reusable PR body examples

For docs-heavy changes:

```markdown
## Summary

- Clarifies contributor-facing documentation for the targeted workflow.
- Keeps the change scoped to docs and alignment updates only.

## Motivation

The current docs leave room for inconsistent reviewer expectations and repeated follow-up comments.

## Implementation

- Updated the relevant skill and supporting docs.
- Kept behavior changes out of scope.

## Testing

- Not run: documentation-only change.

## Risks and tradeoffs

- Low risk: the main risk is wording drift if related docs are updated separately later.

## Follow-up

- None.
```

For code-heavy changes:

```markdown
## Summary

- Tightens validation for the targeted workflow.
- Adds or updates tests for the affected edge cases.

## Motivation

The previous behavior accepted ambiguous or malformed input, which made failures harder to diagnose during review.

## Implementation

- Added explicit validation for the affected input path.
- Updated tests to cover both successful and failing cases.

## Testing

- `node --test src/test/unit/example.test.mjs`

## Risks and tradeoffs

- Validation is stricter than before, so previously tolerated malformed input now fails fast.

## Follow-up

- None.
```

## Final response after opening PR

After opening or updating a PR, summarize:

- PR title
- PR URL
- Main change
- Testing status
- Any known risks
