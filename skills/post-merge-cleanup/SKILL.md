---
name: post-merge-cleanup
description: Use after a PR merge to standardize local cleanup and post-merge verification.
---

# Post-Merge Cleanup Skill

## Purpose

Run the same post-merge checklist every time so local state stays clean and predictable.

This skill is for actions after a PR is merged into `main`.

## Required process

1. Confirm the PR is merged.
2. Ensure local `main` is checked out.
3. Fast-forward local `main` from `origin/main`.
4. Delete the merged feature branch locally.
5. Optionally delete the remote feature branch.
6. Verify no unresolved review threads remain on the merged PR.
7. Report final state (branch, sync, thread count).

## Non-negotiable rules

- Do not delete a branch before the PR is confirmed merged.
- Do not force-delete local branches by default.
- Do not hard reset local branches in this workflow.
- If cleanup checks fail, stop and report the exact blocker.

## Helper script

Script path:

`skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs`

Usage:

```bash
node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr 185 --branch fix/example
```

Optional remote branch deletion:

```bash
node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr 185 --branch fix/example --delete-remote
```

What it does:

1. Validates PR merged state with `gh pr view`.
2. Switches to `main` and fast-forwards from `origin/main`.
3. Deletes local branch with `git branch -d`.
4. Optionally deletes remote branch.
5. Runs the review thread status helper for the PR.
