# Search, Querying & Analysis

**Status:** ✅ Complete (Phase 1-2)

## Retrieval Layer

All queries hit a SQLite index. Prose is never loaded unless a tool explicitly requests a specific scene. This two-phase pattern keeps metadata scans cheap and fast, fitting easily within context windows.

### Fast Metadata-Only Tools

These tools return scene/character/place metadata without loading prose:

| Tool | Description |
| --- | --- |
| `find_scenes(project_id?, character?, beat?, tag?, part?, chapter?, pov?, page?, page_size?)` | Filter scenes by character, beat, tag, part, chapter, or POV. Returns ordered scene metadata — no prose. |
| `get_arc(character_id, page?, page_size?)` | Ordered scene metadata for all scenes involving a character, including loglines and beat tags. |
| `list_characters(project_id?, universe_id?)` | All character entries with basic metadata |
| `get_character_sheet(character_id)` | Full character metadata, traits, notes, and support notes |
| `create_character_sheet(name, project_id\|universe_id, notes?, fields?)` | Create or reuse a canonical character sheet folder with idempotent/backfill semantics. Exactly one of `project_id` or `universe_id` must be provided. |
| `list_places(project_id?, universe_id?)` | All place entries |
| `get_place_sheet(place_id)` | Full place metadata, tags, associated characters, notes, and support notes |
| `create_place_sheet(name, project_id\|universe_id, notes?, fields?)` | Create or reuse a canonical place sheet folder with same semantics as `create_character_sheet` |
| `list_threads(project_id, page?, page_size?)` | All threads with status |
| `get_thread_arc(thread_id, page?, page_size?)` | Ordered scene metadata for all scenes in a thread, including per-thread beat |
| `get_relationship_arc(from_character, to_character, project_id?)` | Ordered relationship entries between two characters, optionally scoped to one project |
| `search_metadata(query, page?, page_size?)` | Lightweight text search across scene titles, loglines, and metadata keywords (tags/characters/places/versions) |
| `get_runtime_config()` | Active runtime paths/capabilities, diagnostics (`sync_dir_writable`, permission diagnostics), warnings, setup recommendations, git availability/enabled state |

### Prose Retrieval Tools

Use these when you need actual text content:

| Tool | Description |
| --- | --- |
| `get_scene_prose(scene_id, commit?)` | Returns prose for a scene; optionally a past git commit hash |
| `get_chapter_prose(project_id, part, chapter)` | Returns all prose for a chapter (use sparingly — see Known Issues) |

### Search Mechanics

#### Full-Text Search (FTS5)

`search_metadata` uses SQLite FTS5 over scene titles, loglines, and metadata keywords. The query uses FTS5 syntax:

- `title AND character` — both words in any field
- `"exact phrase"` — matches phrase boundaries
- `word*` — prefix search
- `-word` — excludes results containing word

Malformed queries (e.g. unmatched quotes) return an `INVALID_QUERY` error envelope instead of crashing.

#### Fallback to Prose Search

When structured metadata is unavailable, `search_metadata` falls back to scanning prose — slower and less precise, treated as a prompt to fill in metadata rather than a permanent mode.

### Pagination

Paginated tools (`find_scenes`, `get_arc`, `list_threads`, `get_thread_arc`, `search_metadata`) accept `page` and `page_size` arguments and return `total_count` / `total_pages` in the response envelope.

## Staleness Warnings

Tools that reason against metadata (`find_scenes`, `get_arc`, `get_relationship_arc`) warn the caller if any returned scenes have `metadata_stale = true`. Reasoning against stale metadata produces unreliable results.

Staleness occurs when prose has been edited since metadata was last updated. Call `enrich_scene()` to refresh derived fields (logline, character mentions) after edits. See [metadata.md](../done/metadata.md) for details.

## Example Reasoning Flows

### 1. Character Arc Consistency Review

1. `get_character_sheet("char-elena")` — load traits, arc summary
2. `get_arc("char-elena")` — ordered scene metadata, loglines, beat tags
3. Model identifies 3 scenes worth examining based on metadata
4. `get_scene_prose(scene_id)` × 3 — load only those scenes
5. Model reasons against character sheet

### 2. Save the Cat Beat Coverage Check

1. `find_scenes()` — all scenes, metadata only
2. Model maps beat distribution, flags missing or doubled beats
3. `get_scene_prose(scene_id)` for flagged scenes only

### 3. "What Happens in the Harbor?"

1. `search_metadata("harbor-district")` — metadata only
2. Model summarizes from loglines — may not need prose at all

### 4. Cross-Scene Continuity Check

1. `find_scenes(character="char-marcus")` — all Marcus scenes
2. `get_relationship_arc("char-marcus", "char-elena")` — their relationship evolution
3. `get_scene_prose(scene_id)` for relationship turning points only
4. Model identifies continuity gaps or inconsistencies

## Phase 1 Completion

- [x] Implement SQLite index with full schema
- [x] Implement `find_scenes`, `get_arc`, `get_character_sheet`, `list_characters`
- [x] Implement `get_scene_prose`, `search_metadata`
- [x] Implement `list_threads`, `get_thread_arc`

## Phase 2 Enhancements

- [x] Implement `update_scene_metadata`, `update_character_sheet` (writes to sidecar)
- [x] Implement stale-scene detection and staleness warnings in retrieval tools
- [x] Implement `enrich_scene` for re-deriving metadata from updated prose
- [x] Implement `get_relationship_arc` (temporal character relationship graph)
- [x] Lint: `DUPLICATE_SCENE_ID` error, `NO_METADATA` warning
- [x] Fix `search_metadata` crash on invalid FTS5 syntax; return `INVALID_QUERY` envelope

## Known Issues & Resolutions

### #3 — Sync Dir Not Writable (RESOLVED)

If `WRITING_SYNC_DIR` is read-only, Phase 2 sidecar writes fail at runtime. The service now detects and warns at startup, exposes permission diagnostics via `get_runtime_config`, and degrades gracefully: read-only tools continue to work while write tools return clear envelopes.

### #4 — `get_chapter_prose` Unbounded Load (IMPORTANT)

A large chapter (e.g. 30 scenes × 3000 words) produces ~90k words in a single response — guaranteed context overflow. Add a configurable `MAX_CHAPTER_SCENES` limit (default: 10) with explicit warning when the limit is hit.

### #7 — `search_metadata` Crash on Malformed FTS5 Query (RESOLVED)

Passing invalid FTS5 expressions (e.g. unmatched `"`) to `search_metadata` previously caused unhandled SQLite exceptions. The tool now catches this and returns an `INVALID_QUERY` error envelope.

## Related Sections

- [metadata.md](../done/metadata.md) — Staleness detection and re-enrichment
- [editing.md](../done/editing.md) — Version control and prose edits
- [import-sync.md](../done/import-sync.md) — Indexing and data structure
