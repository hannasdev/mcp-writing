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

## Final response after opening PR

After opening or updating a PR, summarize:

- PR title
- PR URL
- Main change
- Testing status
-Any known risks