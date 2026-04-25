---
name: commit-writing
description: Use when preparing commits, reviewing staged changes, splitting work into commits, or writing commit messages.
---

# Commit Writing Skill

## Purpose

Create clear, reviewable commits with useful history and no accidental noise.

## Required process

Before committing:

1. Inspect the current branch and changed files.
2. Review the diff.
3. Identify whether the changes represent one concern or multiple concerns.
4. Confirm no forbidden or unrelated files are included.
5. Stage only the files relevant to the commit.
6. Write a structured commit message.

## Commit style

Use Conventional Commit style:

- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `test: ...`
- `docs: ...`
- `chore: ...`
- `ci: ...`

Use a scope when it adds clarity:

```text
feat(auth): add token refresh handling
fix(cli): avoid writing runs.json
docs(prd): clarify release workflow
```

## Rules

- Never commit runs.json.
- Never create vague commits such as:
  - misc fixes
  - updates
  - changes
  - wip
- Keep each commit focused on one logical concern.
- Separate unrelated changes into separate commits.
- Separate formatting-only changes from behavioral changes.
- Separate refactors from feature or bug-fix commits unless the refactor is strictly required for the change.
- Include tests in the same commit as the behavior they validate when practical.
- Do not amend or rewrite existing commits unless explicitly asked.

## Commit message format

Prefer:
```text
type(scope): concise imperative summary
```

Examples:
```text
feat(pr): add pull request description template
fix(workflow): prevent direct commits to main
test(cli): cover branch validation
docs(agents): document review handling workflow
```

The summary should:

- Be imperative.
- Be specific.
- Avoid trailing punctuation.
- Explain the outcome, not the activity.

Good:
```text
fix(cli): skip transient run metadata during commit
```

Bad:
```text
fix: stuff
```

## When multiple commits are needed

Use multiple commits when the diff contains:

- More than one feature
- A bug fix plus unrelated cleanup
- Test infrastructure plus product behavior
- Documentation changes unrelated to the implementation
- Generated files mixed with source changes

When splitting commits, explain the proposed grouping before committing.

## Final response after committing

After creating commits, summarize:

- Commit hash and message
- Files included
- Any files intentionally left uncommitted
- Test status