---
name: code-review
description: Use when reviewing code changes, PR diffs, reviewer comments, or deciding whether a change is ready to merge.
---

# Code Review Skill

## Purpose

Review changes for correctness, maintainability, scope control, and alignment with project intent.

## Required process

Before giving review feedback:

1. Review the diff against `main`.
2. Review related context in `PRD.md`.
3. Identify the purpose of the change.
4. Check whether the implementation matches that purpose.
5. Check whether the change introduces unnecessary scope.
6. Check tests and validation.
7. Separate blocking issues from suggestions.

## Review priorities

Review in this order:

1. Correctness
2. Safety and data integrity
3. Scope control
4. Maintainability
5. Test coverage
6. Readability
7. Style

Do not spend most of the review on style if correctness or scope is unclear.

## Feedback categories

Use these labels when useful:

- **Blocking:** Must be fixed before merge.
- **Question:** Needs clarification before deciding.
- **Suggestion:** Improvement, but not required.
- **Nit:** Small style/readability issue.

## Rules

- Do not approve changes that contradict `PRD.md`.
- Do not approve hidden scope expansion.
- Do not request unrelated refactors.
- Do not nitpick style unless it affects readability or consistency.
- Do not assume tests passed unless evidence is present.
- Do not treat all reviewer comments as equally important.
- If feedback is ambiguous, ask for clarification instead of guessing.
- Prefer small, focused follow-up PRs over expanding the current PR.

## What to check

### Correctness

- Does the code do what the PR claims?
- Are edge cases handled?
- Are errors handled intentionally?
- Are async/state transitions safe?
- Are assumptions explicit?

### Scope

- Is the change limited to one concern?
- Are unrelated files modified?
- Is there accidental cleanup mixed in?
- Would any part be better as a follow-up PR?

### Tests

- Are tests added or updated for changed behavior?
- Do tests cover important edge cases?
- Are integration tests needed?
- Were tests actually run?

### Maintainability

- Is the logic understandable?
- Are names clear?
- Is duplication acceptable or harmful?
- Is complexity proportional to the value?

### Documentation

- Does user-facing behavior need docs?
- Does `PRD.md` need an update?
- Does the PR description match the actual change?

## Review output format

Prefer this structure:

```md
## Review summary

Brief overall assessment.

## Blocking

- ...

## Questions

- ...

## Suggestions

- ...

## Nits

- ...

## Testing notes

- ...
```

Omit empty sections.

## When reviewing reviewer comments

Group comments into:

- Correctness issues
- Required changes
- Optional improvements
- Opinions / preferences
- Conflicting or unclear feedback

Then recommend what to implement, what to push back on, and what to clarify.

## Final review stance

End with one of:

- Ready to merge
- Ready after minor changes
- Needs changes
- Needs clarification before review can continue