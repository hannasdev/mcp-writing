# PRD: Filesystem Boundary Hardening

**Status:** 🚧 Active implementation

This initiative captures follow-up work discovered while adding security linting to the development workflow.
It is not part of the current ESLint plugin setup branch unless explicitly selected as active implementation scope.

## Document Relationship

This PRD defines the product goal, boundary, and design principles for filesystem boundary hardening.

Use [architecture.md](architecture.md) when:

- reasoning about the filesystem boundary module shape;
- checking the application architecture overview graph;
- answering filesystem policy questions such as symlink, overwrite, import/source, runtime-temp, and artifact-class behavior.

Use [milestones.md](milestones.md) when:

- sequencing implementation work;
- checking high-risk mutation surfaces;
- validating milestone acceptance criteria and test strategy.

## Goal

Centralize filesystem access rules so features can read, create directories, write, copy, move, and delete manuscript artifacts through application-aware helpers instead of repeating path-safety logic in each workflow.

The product goal is:

- fewer review-missable filesystem safety checks;
- one clear place for sync-root containment, runtime-temp containment, import/source-path, symlink, overwrite, directory-creation, copy, move-fallback, partial-write, and deletion policy;
- security linting that warns about application-relevant risks rather than core product concepts;
- simpler feature code when adding new file-backed workflows.

## Problem

Writing MCP intentionally works with local manuscript files.
Generic security lint rules such as "non-literal filesystem path" produce broad warnings because dynamic file paths are central to the product.
Those warnings are too noisy to enforce directly, but the underlying risk is real:

- directory creation, write, copy, delete, and move operations appear in multiple feature modules;
- each module must remember sync-root containment, runtime-temp containment, project ID validation, symlink behavior, directory-creation behavior, copy/move behavior, read-only runtime behavior, and output filename safety;
- reviewers have to reconstruct the path-safety story from local code instead of recognizing a shared boundary API;
- future workflows could introduce raw filesystem mutation that bypasses existing guard patterns.

The current codebase already has several good guard patterns, including sync-root output validation and structure restore path checks.
The issue is distribution, not absence of care.

## Product Boundary

This initiative is about hardening local filesystem boundaries for existing file-backed workflows.
It should preserve current product behavior unless a later implementation PR explicitly calls out a behavior change.

This initiative is not a local sandbox or adversarial same-user security boundary.
Writing MCP runs locally without authentication and with access to the same manuscript files and database as the user.
It cannot defend against a malicious local process, a compromised same-user AI agent, or arbitrary concurrent filesystem mutation.
The goal is application-boundary hardening: reducing accidental damage, prompt-injection-amplified misuse, path traversal mistakes, symlink surprises, and review-missable raw mutation in normal local workflows.

In scope:

- shared helpers for resolving paths inside `WRITING_SYNC_DIR`;
- shared helpers for runtime-owned temporary directories and request/result files;
- shared helpers or guard functions for import/source paths that may legitimately live outside `WRITING_SYNC_DIR`;
- shared helpers for output directories and generated filenames;
- shared wrappers or guard functions for directory creation, text writes, copies, deletes, moves, and regular-file checks;
- artifact-class-aware mutation paths for authored prose, sidecars, generated exports, styleguide config, AI boot/instruction files, import sources, runtime temp files, and support scripts;
- clear symlink policy per operation type;
- migration of high-risk call sites to the shared boundary;
- project-specific linting to discourage new raw filesystem mutation outside approved modules;
- characterization tests around existing behavior before refactoring risky paths.

Out of scope:

- changing authored prose storage away from files;
- replacing SQLite or sidecar metadata architecture;
- changing Scrivener import semantics;
- introducing remote filesystem or cloud storage support;
- making every read operation go through a heavy abstraction when simple reads are already constrained by indexed paths;
- treating Git and SQLite writes as part of the shared filesystem boundary module;
- defending against malicious same-user local processes or arbitrary concurrent filesystem mutation;
- enabling generic `security/detect-non-literal-fs-filename` warnings as a PR gate.

## Design Principles

1. **Filesystem access is a product feature, not a smell**
   Dynamic paths are expected. Warnings should focus on unsafe mutation or missing boundary checks, not on the existence of file IO.

2. **Centralize policy, keep intent local**
   Feature code should still make workflow intent obvious, but containment and symlink rules should live in one place.

3. **Prefer explicit trust boundaries**
   Helpers should distinguish sync-root paths, generated output paths, existing indexed file paths, import/source paths, and runtime-owned temporary paths.

4. **Make destructive actions recognizable**
   Directory creation, writes, copies, deletes, moves, and removals should be easy to search, review, and lint.

5. **Respect artifact ownership**
   A write inside the sync root is not automatically safe just because it is inside the sync root.
   Helpers should preserve the distinction between authored prose, sidecars, generated views, styleguide config, AI boot/instruction files, migration inputs, and runtime support artifacts.

6. **Refactor before enforcement**
   Add lint restrictions only after approved safe paths exist, so the rule guides future code instead of creating migration noise.

## Related

- [Filesystem Boundary Architecture](architecture.md)
- [Filesystem Boundary Milestones](milestones.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Structural Authority Hardening](../../done/structural-authority-hardening/prd.md)
- [Target Architecture Migration](../../done/target-architecture-migration/prd.md)
