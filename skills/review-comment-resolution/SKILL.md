---
name: review-comment-resolution
description: Use when processing PR review comments to triage feedback, apply fixes, validate changes, and resolve addressed threads.
---

# Review Comment Resolution Skill

## Purpose

Handle review comments consistently and safely from intake to closure.

This skill is for the full loop:

1. Collect unresolved comments
2. Assess comment quality and impact
3. Decide what to implement vs question vs decline
4. Implement focused fixes
5. Validate changes
6. Resolve only addressed threads
7. Re-check unresolved count and CI

## Required process

Before applying fixes:

1. Fetch current unresolved review threads for the PR.
2. Group comments by category:
   - correctness issue
   - required improvement
   - optional suggestion
   - opinion/preference
   - ambiguous/conflicting feedback
3. Confirm each comment against actual code/docs behavior.
4. Decide response per comment:
   - implement now
   - ask clarifying question
   - explain why not implementing
5. Keep changes scoped to the reviewed concern.

After applying fixes:

1. Run relevant validation (lint/tests/docs generation as applicable).
2. Commit with a focused message.
3. Push branch updates.
4. Resolve only threads that are fully addressed.
5. Re-check unresolved thread count.
6. Re-check PR checks status.

## Non-negotiable rules

- Do not resolve a thread before the fix is pushed.
- Do not resolve threads that are only partially addressed.
- Do not batch unrelated refactors into review-response commits.
- Do not blindly apply every reviewer request if it conflicts with product intent.
- Do not skip validation when behavior changes.
- If feedback is ambiguous, ask for clarification instead of guessing.

## Assessment rubric

Use this rubric for each comment:

1. Is the claim technically correct?
2. Is the impact real in this repo's workflows?
3. Is the severity blocking, medium, or low?
4. Is there a minimal fix that avoids scope expansion?
5. What test or evidence proves the issue is fixed?

## Implementation guidance

- Prefer minimal, explicit fixes.
- Update tests for regressions and edge cases introduced by the comment.
- Update docs/workflow text when behavior contract changes.
- Keep API behavior backwards compatible unless a guard is necessary for safety.
- If introducing a guard, return a clear error code and next_step guidance.

## Helper script

Use the bundled helper to run the thread workflow consistently:

- Script: `./scripts/review-comments.mjs`
- Behavior: strict (non-zero exit on invalid thread IDs, already-resolved IDs, and failing/pending PR checks)
- Commands:
   - `list` - show unresolved review threads (or all with `--all`)
   - `resolve` - resolve specific thread IDs
   - `status` - print unresolved count and run `gh pr checks`

Examples:

```bash
node skills/review-comment-resolution/scripts/review-comments.mjs list --pr 171
node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr 171 --ids PRRT_xxx,PRRT_yyy
node skills/review-comment-resolution/scripts/review-comments.mjs status --pr 171
```

## Recommended command sequence (GitHub CLI)

Prefer the helper script above. Use raw commands only as fallback.

```bash
# 1) Get unresolved threads
# node skills/review-comment-resolution/scripts/review-comments.mjs list --pr <number>

# 2) Resolve addressed thread IDs
# node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr <number> --ids <id1,id2>

# 3) Verify unresolved count and check status
# node skills/review-comment-resolution/scripts/review-comments.mjs status --pr <number>
```

## Output format for user updates

Use this structure when reporting progress:

```md
Findings
- <comment A>: valid/invalid, severity, planned action
- <comment B>: valid/invalid, severity, planned action

Changes made
- <file>: <what changed>

Validation
- <commands run>
- <results>

Review status
- unresolved threads: <count>
- checks: <pending/passing/failing>
```

## Completion criteria

A review-response pass is complete only when:

- Every blocking/resolved-now comment is fixed and pushed.
- Validation for changed behavior has passed (or clearly documented as not run).
- Only fully addressed threads are resolved.
- Remaining unresolved threads (if any) are clearly called out with rationale.
