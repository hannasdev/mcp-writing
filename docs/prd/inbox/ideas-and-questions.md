# Ideas & Open Questions

**Status:** 📥 Inbox

Unresolved design questions, feature ideas, and edge cases that haven't yet been promoted to a specific PRD theme.

## Open Questions

> Resolved questions have been moved to [done/resolved-design-questions.md](../done/resolved-design-questions.md).

### C. Proposal Persistence (OPEN)

**Q:** Where do pending `propose_edit` proposals live? In-memory (lost on restart) or persisted in SQLite?

**Status:** In-memory is simpler but means a restart between propose and commit loses the proposal. Acceptable for Phase 3.

**Future:** Consider persistent proposal storage if users report frequent restarts losing work.

## Edge Cases — Deferred

### Scenario: Mass Reorder in Scrivener

If a user reorders 20 scenes in Scrivener, sync should reconcile them as moved, not deleted-and-recreated. Current importer logic may not handle this gracefully.

**Tracking:** [import-sync.md](../done/import-sync.md#10--re-import-after-scrivener-reorder-creates-duplicates-must-fix) — Issue #10.

### Scenario: Circular Character Relationships

If character A influences B, B influences C, and C influences A, how do we represent causality in `character_relationships` without creating a loop?

**Status:** Deferred pending real-world example.

### Scenario: Multi-Book Character Arc

When a character appears across multiple books (series with shared universe), should `get_arc` show their full arc or per-book arc?

**Status:** Deferred pending multi-book series testing.

## Feature Ideas

### Tagging System Enhancement

Current tags are free-form strings. Could benefit from:
- Predefined tag categories (tone, pacing, theme, etc.)
- Tag autocomplete during metadata edits
- Tag migration/renaming tools

**Priority:** Low — can be added without API changes.

### Relationship Strength Indicators

Currently `character_relationships` stores strength as low/medium/high. Could be enhanced to:
- Show strength trend over time (strengthening? weakening?)
- Visualize relationship web as a graph
- Query by relationship type

**Priority:** Low — requires embedding or graph visualization.

### Continuity Checker

Tool to surface potential continuity issues:
- Character appears in scene but not in character list
- Place mentioned in prose but not in places list
- Timeline gaps or inconsistencies

**Priority:** Medium — valuable for draft cleanup.

### Comparative Scene Analysis

Tool to compare two scenes:
- Prose style similarity
- Character behavior consistency
- Setting/atmosphere contrast

**Priority:** Low — deferred to Phase 4+ with embeddings.

## Operational Notes

### First-Time Setup Friction

Users report initial sync folder setup requires:
1. Manual git init
2. Manual folder structure creation
3. Manual Scrivener External Folder Sync configuration

**Potential improvement:** Add an `init_project` tool that scaffolds folder structure and guides Scrivener setup. (Phase 4A candidate)

### Permission Warnings

Current behavior: `get_runtime_config` surfaces permission issues but doesn't help fix them. Could provide:
- Suggested `chmod` commands
- Volumes that need remounting
- Folder initialization steps

**Status:** Deferred to Phase 4A improvements.

## Related

- [done/metadata.md](../done/metadata.md)
- [done/import-sync.md](../done/import-sync.md)
- [done/editing.md](../done/editing.md)
- [done/search-analysis.md](../done/search-analysis.md)
