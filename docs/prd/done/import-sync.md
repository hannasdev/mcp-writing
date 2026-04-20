# Import & Sync Operations

**Status:** ✅ Complete (Phase 1-2)

## Scrivener Integration

The sync folder is a plain-text directory populated by Scrivener's built-in External Folder Sync (File → Sync → With External Folder). One file per scene/chapter. Scrivener manages prose; the MCP service reads from and writes to the sync folder.

This avoids coupling to Scrivener's internal `.scriv` format (XML/RTF bundle, version-sensitive). The sync folder is the stable interface.

## Identity & Reconciliation

### External vs Internal Identity

When Scrivener is the source of truth, binder order is mutable. Reordering, moving between chapters, or restructuring should not create new logical scenes.

- **External source identity:** stable identifier from the source tool. For Scrivener external sync, this is the binder ID from the exported filename (`[10]` in `011 Scene Sebastian [10].txt`), not the visible sequence prefix (`011`).
- **Internal MCP identity:** stable `scene_id` used by the index, sidecars, and tools.
- **Mutable structural fields:** filename, path, `timeline_position`, `part`, `chapter` can all change without implying a new scene.

### Reconciliation Behavior

A reorder in Scrivener should reconcile as an update, not an insertion:
- same Scrivener binder ID
- same internal `scene_id`
- updated filename/path
- updated `timeline_position`
- possibly updated path-derived `part` / `chapter`

Only ambiguous lifecycle events require user review:
- a previously known external ID disappears entirely
- an external ID remains but prose/title changes radically (possible split/merge/replacement)
- two imported records claim the same external ID
- a new scene appears with no known external ID match

**Design Principle:** Automatically reconcile simple reorder/move operations. Escalate only when the source-of-truth change is ambiguous.

For non-Scrivener projects, `scene_id` may be user-authored and primary. The external/internal split is required specifically for importer-backed workflows where exported ordering is not stable.

## Content Structure

### Universes and Projects

Two top-level concepts:

- **Universe** — a shared world used by one or more books in a series. Characters, places, reference material span books. Optional; standalone projects don't use one.
- **Project** — one book. Either belongs to a universe (series entry) or is standalone (independent project).

This gives clean isolation: standalone projects don't see each other's characters or places. Series books share a universe's world layer while keeping their own scenes.

### Folder Hierarchy

```bash
/sync-root/
  /universes/
    /my-series/                  ← shared world for a series
      /world/
        characters/
          elena.md
          marcus.md
        places/
          harbor-district.md
        reference/
          history-notes.md
      /book-1/
        /part-1/
          /chapter-1/
            scene-001.md
      /book-2/
        /part-1/
          ...
  /projects/
    /standalone-project-a/       ← independent book, no shared universe
      /world/
        characters/
        places/
        reference/
      /part-1/
        /chapter-1/
          scene-001.md
```

### World Folder Structure

The Draft folder is not the only source of useful knowledge. Projects contain character notes, place notes, research, continuity notes, and process notes — mixed structure, not all forced into database entities.

#### Folder taxonomy

- `.../world/characters/` — character entities and character-adjacent notes
- `.../world/places/` — place entities and place-adjacent notes
- `.../world/reference/` — universe/project lore, systems, research, style guides, continuity notes
- `.../Notes/` (or similar) — scratch/process material, drafts, feedback, temporary planning

This applies at both scopes:
- **Universe scope** for cross-book canon: `universes/<universe-id>/world/...`
- **Project scope** for book-local canon: `.../<project>/world/...`

Queries for a project automatically include both project-local entities and universe-shared entities when the project belongs to a universe.

#### Canonical-File Rule

Character and place folders may contain many files, but exactly one should be canonical for the entity row.

- Recommended canonical filename: `sheet.md` or `sheet.txt`
- Canonical sidecar: `sheet.meta.yaml`
- Supporting files (e.g. `arc.md`, `relationships.md`, `biology-notes.md`) are allowed and remain file-first

Canonical sidecar minimums:
- Character: `character_id`, optional `name`, `role`, `arc_summary`, `first_appearance`, `traits`
- Place: `place_id`, optional `name`, `associated_characters`, `tags`

Files without required ID fields under `/characters/` or `/places/` are treated as supporting notes and skipped for entity indexing.

## Sync Process

### Ingestion Modes

#### Structured (Tier 1 Always, Tier 2 When Available)

Every scene contributes Tier 1 structural data from path/content. If frontmatter or sidecar metadata is present, the service indexes those fields too.

#### Missing Metadata

A scene without frontmatter/sidecar metadata is not a hard failure, but it is skipped from scene indexing because `scene_id` is required. Sync summaries report skipped files so the author can add metadata.

**Degradation:** Full-text search falls back to scanning prose when structured metadata is unavailable — slower and less precise, treated as a prompt to fill in metadata, not a permanent mode.

### Phase 1 Sync Implementation

- [x] Scaffold mcp-writing: Dockerfile, package.json, index.js
- [x] Implement SQLite index with full schema
- [x] Implement `sync()` — walk sync folder, parse metadata/frontmatter, build index, detect stale scenes
- [x] Implement indexing for scenes, characters, places, threads

### Phase 2 Sync Enhancements

- [x] Migrate metadata storage to sidecar files (`.meta.yaml`)
- [x] Auto-generate sidecars from frontmatter on first sync (do not strip frontmatter)
- [x] Detect orphaned sidecars (`.meta.yaml` with no corresponding `.md`) and warn
- [x] Derive and store `part`/`chapter` from file path; detect path/metadata mismatch and warn
- [x] Follow symlinked subdirectories in sync folder walk
- [x] Fix FTS ambiguity by including `project_id` in `scenes_fts` table

## Known Issues & Resolutions

### #1 — Scene Moved After Sidecar Migration (RESOLVED)

Scrivener restructures freely by moving `.md` files. If moved but sidecar hasn't been moved, sync detects the mismatch via path/metadata check and warns. Scene falls back to sidecar's last known `file_path` for prose retrieval and logs a warning. Frontmatter is never stripped, so path recovery is always possible.

### #2 — FTS Ambiguity Across Projects (RESOLVED)

Previously, indexing `scenes_fts` by `scene_id` alone produced ambiguous joins when different projects shared IDs (e.g. `sc-001`). Fixed by including `project_id` in FTS indexing and query joins.

### #5 — Duplicate `scene_id` from Copy/Paste Templates (RESOLVED)

Two scenes in the same project sharing a `scene_id` could cause overwrites. Lint now errors on duplicate `scene_id` across files, making it easy to catch before syncing. Sync continues to warn at runtime.

### #6 — Blank Scenes Skipped Due to Missing `scene_id` (RESOLVED)

Scrivener placeholders or notes without scene metadata are skipped. Sync summaries report skipped files; lint now emits `NO_METADATA` warning for `.md`/`.txt` without sidecar/frontmatter.

### #8 — Symlinked Subdirectories Silently Skipped (RESOLVED)

`walkFiles` and `walkSidecars` now follow directory symlinks. Broken symlinks are skipped silently.

### #10 — Re-import After Scrivener Reorder Creates Duplicates (MUST FIX)

The importer currently derives `scene_id` from sequence prefix + title. After reordering, it treats the scene as new rather than moved, leaving duplicates. The importer must reconcile by stable external source ID (Scrivener binder ID), not current visible ordering.

## Index Schema

Core tables:

```sql
universes(universe_id, name)
projects(project_id, universe_id, name)

scenes(scene_id, project_id, title, part, chapter, pov, logline, save_the_cat_beat,
       timeline_position, story_time, word_count, file_path,
       prose_checksum, metadata_stale, updated_at)

characters(character_id, project_id, universe_id, name, role, arc_summary,
           first_appearance, file_path)
places(place_id, project_id, universe_id, name, file_path)
threads(thread_id, project_id, name, status)

scene_characters(scene_id, character_id)
scene_places(scene_id, place_id)
scene_tags(scene_id, tag)
scene_threads(scene_id, thread_id, beat)
```

Characters and places belong to a project OR a universe (shared). Queries automatically include both universe-level and project-level entities when a project belongs to a universe.

## Related Sections

- [metadata.md](../done/metadata.md) — Metadata ownership and sidecar design
- [editing.md](../done/editing.md) — Version control during sync
