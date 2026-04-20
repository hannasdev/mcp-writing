# Reference Document Querying

**Status:** 📋 Deferred (Phase 4)

## Motivation

Projects contain world-building notes, research, continuity scratchpads, and style guides in `/world/reference/` and `/Notes/` folders. These are currently file-first (not indexed as entities). Users may want to:
- Search research notes for a specific historical detail
- Find all continuity notes mentioning a character
- Query world-building systems (magic rules, geography, etc.)

## Design Decisions

### What Qualifies for Querying?

Currently, only scenes and entities (characters, places, threads) are indexed. Supporting notes remain file-first.

Options:
1. **File-first (current):** keep reference docs unindexed; users browse folders manually
2. **Lightweight indexing:** index reference docs by folder/filename and title, allow keyword search but not structural queries
3. **Full indexing:** promote common reference types (world systems, continuity notes) to a `reference_docs` table with tags and FTS

### Tool Design

If we add querying, it should be symmetric with prose search:

```
search_reference(query, type?, tag?)
  - type: 'world', 'continuity', 'style', 'research'
  - tag: optional tag filter
  - returns: file metadata + logline/summary
  - does not load full content (use read_file for that)
```

### Integration with Scenes

When reasoning about a scene, should the AI automatically see related reference docs?

Options:
1. No — AI must explicitly call `search_reference` if needed
2. Yes — include reference snippets in `find_scenes` results when relevant tags match

Option 1 is safer; Option 2 requires careful token budgeting.

## Implementation Path

1. Define minimal schema for `reference_docs(doc_id, project_id, universe_id, title, tags, file_path)`
2. Add folder-based type inference (`/world/reference/` → type 'world', `/Notes/continuity/` → type 'continuity')
3. Implement lightweight FTS indexing on doc titles and tags (not prose content)
4. Implement `search_reference(query, type?, tag?)` tool
5. Add `sync()` support for detecting and indexing reference docs

## Rollout

- Phase 4A: Lightweight FTS indexing
- Phase 4B: Optional integration with scene queries (careful token budgeting)

## Known Gaps

- No way to track which world-building system applies to which scenes
- No way to query "what research informed this scene"
- Supporting notes cannot be tagged at index time (must edit file metadata or folder structure)

## Related

- [import-sync.md](../done/import-sync.md) — World folder structure
- [search-analysis.md](../done/search-analysis.md) — Current search capabilities
