# Scene-Character Batch Follow-Up Polish

**Status:** ✅ Done

## Motivation

PR review feedback identified several non-blocking improvements for `enrich_scene_characters_batch` that can improve performance, maintainability, and test ergonomics without changing v1 behavior.

These items are intentionally scoped as follow-up polish, not release blockers.

## Scope

This PRD covers only non-mandatory improvements:

1. Reduce repeated per-scene matching setup work.
2. Centralize async progress prefix constants used by parent/worker plumbing.
3. Improve cancellation test polling ergonomics.

Out of scope:
- v1 must-fix correctness bugs
- changes to matching semantics or output contract
- alias support

## Proposed Improvements

### 1) ✅ Matching Setup Reuse (Performance)

Current behavior recomputes normalized character token structures for each scene.

Proposed change:
- Normalize character rows once per batch run.
- Reuse precomputed structures across all scene inference calls.

Expected impact:
- Lower CPU overhead for large batches.
- No output contract changes.

### 2) ✅ Shared Async Progress Prefix Constant (Maintainability)

Current behavior defines the progress prefix string in multiple modules.

Proposed change:
- Move the progress prefix literal into one shared constant module.
- Import it from both async parent (`index.js`) and worker (`scripts/async-job-runner.mjs`).

Expected impact:
- Reduced drift risk if prefix ever changes.
- No runtime behavior changes.

### 3) ✅ Cancellation Polling Test Ergonomics (Test Stability)

Current integration cancellation test already gates cancellation on observed progress.

Proposed change:
- Add small pacing delay inside polling loops to reduce tight-loop churn.
- Optionally extract polling logic into a reusable test helper.

Expected impact:
- Cleaner test code.
- Lower transient load in CI.
- Behavior assertions unchanged.

## Acceptance Criteria

1. `npm test` remains green with no contract regressions.
2. Batch results remain identical for equivalent inputs.
3. Async progress pipeline still interoperates with existing job polling tools.
4. Cancellation integration test remains deterministic and easier to maintain.

## Rollout

1. PR-1: matching setup reuse
2. PR-2: shared async progress constant
3. PR-3: cancellation test helper/pacing cleanup

## Related

- [scene-character-linking-batch.md](../done/scene-character-linking-batch.md)
- [scene-character-linking-batch-implementation.md](../done/scene-character-linking-batch-implementation.md)
