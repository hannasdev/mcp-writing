# Writing MCP — PRD

## Concept

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: a two-phase retrieval pattern where metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for the specific scenes that are relevant.

The writing environment is a plain-text sync folder. Scrivener is the primary integration path (via External Folder Sync), but not a hard dependency. This service is for **reasoning and editing**, not writing or compiling. The AI works on content in files, regardless of editor.

---

## Source of Truth: Plain-Text Sync Folder (Scrivener-Compatible)

Scrivener's built-in External Folder Sync (File → Sync → With External Folder) mirrors each document as a plain `.txt` or `.md` file in a controlled directory. One file per scene/chapter. Scrivener manages the prose; the MCP service reads from and writes to the sync folder.

This avoids coupling to Scrivener's internal `.scriv` format (XML/RTF bundle, version-sensitive). The sync folder is the stable interface.

### Metadata tiers

To balance adoption and flexibility, metadata is split into two tiers:

1. **Tier 1 (structural, low-friction):** file path hierarchy, scene ordering, and word count inferred directly from files. Optional Scrivener standard fields can be mapped when present: Synopsis → `logline`, Labels → `pov`, Keywords → `tags`.
2. **Tier 2 (editorial, explicit convention):** custom analysis metadata (`characters`, `save_the_cat_beat`, `scene_change`, `causality`, `stakes`, `scene_functions`, `threads`, relationship state, continuity notes) stored in sidecars and maintained deliberately.

Tier 1 is intended to work immediately for existing manuscripts. Tier 2 is progressively authored and refined over time.

### Guiding principle: automate structure, preserve authorship

The service should automate what is deterministic and mechanical, and avoid automating what is editorial and interpretive.

- **Automate deterministic inference:** file/path-derived project scope, word counts, checksum/staleness detection, sync reconciliation warnings.
- **Do not force editorial decisions:** scene meaning, thematic role, arc membership, causality, stakes, beat interpretation, and similar creative judgments remain user-owned.

When uncertain, the service should prefer **advisory suggestions** over automatic write-back.

---

## Design Decision: Metadata Ownership

### The problem with YAML frontmatter

The initial implementation stores metadata in a YAML header block inside each `.md` file (frontmatter). This is a well-established pattern (Jekyll, Hugo, Obsidian), but it creates a shared-ownership problem: Scrivener owns the prose below the `---` delimiter, and the MCP service owns the metadata above it — but they live in the same file.

This causes two issues:

1. **Fragile co-ownership.** Scrivener could corrupt the header accidentally (e.g. if its sync behaviour changes). There is nothing enforcing that the two sections stay separate.
2. **Implicit position mismatch.** `part` and `chapter` live in metadata and must be manually maintained. Nothing prevents a file from being stored in `Part 2/Chapter 3/` while its header still says `part: 1, chapter: 1`. The mismatch is silent.

### Decision: sidecar files for metadata (Phase 2)

From Phase 2 onward, metadata lives in a `.meta.yaml` sidecar file alongside each scene:

```sh
scenes/
  sc-001.md           ← Scrivener owns (prose only, no header)
  sc-001.meta.yaml    ← MCP service owns (metadata only)
```

Scrivener's External Folder Sync only touches `.md`/`.txt` files — it will never read or write a `.meta.yaml`. This gives clean, enforced ownership: Scrivener manages prose; the service manages metadata. Metadata changes require explicitly running a tool or editing the sidecar, so they are always intentional, never coincidental.

`part` and `chapter` are currently read from metadata values (frontmatter/sidecar). Path-derived normalization and mismatch warnings are planned work (see Phase 2).

### Migration path (Phase 1 → Phase 2)

Phase 1 continues using frontmatter as a bootstrap source when present. On the first Phase 2 sync, if no sidecar exists but the `.md` file has frontmatter, the service auto-generates the sidecar from that data. **The frontmatter header is not stripped from the `.md` file.** Frontmatter is treated as read-only legacy; the sidecar always wins when both exist.

`scene_id` must currently be present in frontmatter or sidecar metadata for a scene to be indexed. Files without `scene_id` are skipped and reported in sync summaries.

### Orphaned sidecars

If a scene file is deleted (in Scrivener), the sidecar is orphaned. On sync, the service detects `.meta.yaml` files with no corresponding `.md` and logs a warning. It does not auto-delete them — that is an explicit user action.

### Design Decision: Stable Identity vs Mutable Order

When Scrivener is the source of truth, binder order is mutable. Reordering scenes, moving a scene to another chapter, or restructuring acts should not create a new logical scene in `mcp-writing`.

The service therefore needs to treat identity and position as separate concepts:

- **External source identity:** a stable identifier supplied by the source tool. For Scrivener external sync, this should be the binder ID from the exported filename (the `[10]` portion of `011 Scene Sebastian [10].txt`), not the visible sequence prefix (`011`).
- **Internal MCP identity:** a stable `scene_id` used by the index, sidecars, references, and tools.
- **Mutable structural fields:** filename, path, `timeline_position`, `part`, `chapter`, and adjacent beat carry can all change over time without implying a new scene.

This means a reorder in Scrivener should normally reconcile as an update, not an insertion:

- same Scrivener binder ID
- same internal `scene_id`
- updated filename/path
- updated `timeline_position`
- possibly updated path-derived `part` / `chapter`

Only ambiguous lifecycle events should require user review, for example:

- a previously known external ID disappears entirely
- an external ID remains but the prose/title changes so radically that a split/merge/replacement is plausible
- two imported records claim the same external ID
- a new scene appears with no known external ID match and no deterministic mapping

**Design principle:** the service should reconcile simple reorder/move operations automatically, and escalate only when the source-of-truth change is ambiguous.

For non-Scrivener projects, `scene_id` may still be user-authored and primary. The external/internal split is required specifically for importer-backed workflows where exported ordering is not stable.

---

## Content Structure

### Scope: Universes and Projects

Two top-level concepts:

- **Universe** — a shared world used by one or more books in a series. Characters, places, and reference material that span books live here. A universe is optional; standalone projects don't use one.
- **Project** — one book. Either belongs to a universe (series entry) or is standalone (independent project).

This gives clean isolation: standalone projects don't see each other's characters or places. Series books share a universe's world layer while keeping their own scenes.

### Hierarchy

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

### Design Decision: Non-Draft Data Contract (consistent world/notes handling)

The `Draft` folder should not be the only source of useful knowledge. Projects also contain character notes, place notes, research, continuity scratchpads, and style/process notes. These have mixed structure and should not all be forced into database entities.

Decision: treat non-draft data as two classes:

- **Canonical world entities** (structured, indexed): character sheets and place sheets that power filtering, joins, and arc retrieval.
- **Supporting notes** (unstructured, file-first): any related material that is useful to read but not required for structured queries.

#### Folder taxonomy

- `.../world/characters/` — character entities and character-adjacent notes
- `.../world/places/` — place entities and place-adjacent notes
- `.../world/reference/` — universe/project lore, systems, research, style guides, continuity notes
- `.../Notes/` (or similar) — scratch/process material, drafts, feedback, temporary planning

This applies at both scopes:

- **Universe scope** for cross-book canon: `universes/<universe-id>/world/...`
- **Project scope** for book-local canon: `.../<project>/world/...`

Queries for a project should include both project-local entities and universe-shared entities when the project belongs to a universe.

#### Canonical-file rule inside character/place folders

Character and place folders may contain many files, but exactly one file should be canonical for the entity row.

- Recommended canonical filename: `sheet.md` or `sheet.txt`
- Canonical sidecar: `sheet.meta.yaml`
- Supporting files (for example `arc.md`, `relationships.md`, `biology-notes.md`) are allowed and remain file-first

Canonical sidecar minimums:

- Character: `character_id`, optional `name`, `role`, `arc_summary`, `first_appearance`, `traits`
- Place: `place_id`, optional `name`, `associated_characters`, `tags`

If a file is under `/characters/` without `character_id`, or under `/places/` without `place_id`, it should be treated as supporting notes and skipped for entity indexing.

Canonical Markdown scaffolds should follow one formatting contract:

- first line is a top-level title (`# Name`)
- every heading is followed by a blank line
- every generated `.md` document ends with a trailing blank line

This structure is user-curated. The system should not attempt to infer canonical entities from freeform `Notes/` exports.

#### Database inclusion policy

Only promote data to entities when stable identifiers and structured queries are needed.

- **Must be entities:** scenes, characters, places, threads, scene links (scene_characters, scene_places, scene_tags, scene_threads)
- **File-first by default:** character-adjacent meta, relationship brainstorming, lore fragments, editorial guidance, feedback, process notes

Promotion trigger from file-first to entity-backed metadata:

- repeated query need across many scenes/books
- stable identifier is known
- field semantics are stable enough to validate

#### Naming and identity conventions

- IDs are stable and never derived from mutable ordering
- Character IDs: `char-<slug>`
- Place IDs: `place-<slug>`
- Folder rename is allowed; ID must not change

#### Promotion path: local to shared canon

When a previously book-local character/place becomes cross-book canon:

1. Move canonical entity file from project world folder to universe world folder.
2. Keep the same `character_id`/`place_id`.
3. Leave project-specific supporting notes local, or copy only what is canon-relevant.
4. Re-run `sync()`.

This preserves continuity without rewriting scene links or historical references.

#### Operational principle

Automate deterministic structure, not editorial interpretation:

- deterministic: folder scope, ID presence checks, canonical-file detection, inclusion/exclusion behavior
- editorial: what is canon, what belongs in sheet vs supporting notes, when to promote local notes to shared canon

#### Implementation checklist (non-draft content)

1. **Indexer classification rules**
  - Treat files under `/world/characters/` as character candidates.
  - Treat files under `/world/places/` as place candidates.
  - Treat files under `/world/reference/` and `/Notes/` as non-entity by default.
  - Keep universe/project scope inference path-based.

2. **Canonical file detection**
  - In character/place folders, prefer `sheet.meta.yaml` + `sheet.md|txt` as canonical.
  - If no canonical `sheet.*` exists, allow explicit opt-in via sidecar field (for example `canonical: true`).
  - Ignore non-canonical files for entity row updates (they remain retrievable prose/reference files).

3. **ID requirements and fallback behavior**
  - Character entity indexing requires `character_id`.
  - Place entity indexing requires `place_id`.
  - Missing IDs do not fail sync; emit warnings and skip entity insert/update.
  - Optional future fallback: derive ID from folder slug only when explicitly enabled by config.

4. **Entity update semantics**
  - Only canonical files may upsert `characters`/`places` rows.
  - Preserve stable IDs even if file/folder names change.
  - Keep support for project-local and universe-shared entities simultaneously.

5. **Validation and linting**
  - Add lint checks for multiple canonical files in one character/place folder.
  - Add lint checks for duplicate `character_id` / `place_id` across canonical files in same scope.
  - Add lint warning when canonical file exists without required ID field.

6. **Importer behavior**
  - Import only Draft scene prose automatically.
  - Do not infer non-draft entities from Scrivener `Notes/` structure.
  - Require users to place character/place/reference files into the predetermined `world/` structure directly.
  - Keep sync/index behavior deterministic once files are placed correctly.
  - Expose importer via MCP as a first-class tool (`import_scrivener_sync`) so first-time setup can run end-to-end without manual shell commands.
  - MCP importer should accept `source_dir` + optional `project_id`, support `dry_run`, and reconcile by stable Scrivener binder ID.
  - MCP importer should support optional auto-sync and return machine-readable counts (`created`, `existing`, `skipped`, `beat_markers_seen`).

7. **Tooling behavior**
  - Entity tools (`list_characters`, `get_character_sheet`, `list_places`) read only canonical entity rows.
  - Retrieval tools for prose/reference remain file-based and can include support notes when requested.

8. **Migration and rollout**
  - Phase A: adopt conventions with warnings only (non-breaking).
  - Phase B: enable canonical-file enforcement once repositories are cleaned up.
  - Provide a one-time migration script to mark or generate canonical sheets where missing.

### Scene file format — prose-first with optional legacy frontmatter

```markdown
---
title: The Arrival
logline: Elena arrives at the harbor and meets Marcus for the first time.
pov: elena
tags: [first-meeting, tension, harbor]
---

Prose starts here...
```

Frontmatter is optional and treated as bootstrap/legacy input. In Phase 2+, canonical editorial metadata lives in `.meta.yaml` sidecars.

### Character file format

```markdown
---
character_id: elena
name: Elena Voss
role: protagonist
traits: [driven, guarded, perceptive, self-sabotaging]
arc_summary: Learns to trust others without losing herself.
first_appearance: p1-ch1-sc1
tags: [main-cast]
---

Extended notes, backstory, relationships...
```

### Place file format

```markdown
---
place_id: harbor-district
name: The Harbor District
associated_characters: [marcus, elena]
tags: [urban, working-class, recurring]
---

Description, atmosphere, history...
```

---

## Index Layer

On ingest (first run and on sync), the service builds a SQLite index from sidecars/frontmatter plus path-derived project/universe scope. All queries hit the index. Prose is never loaded unless a tool explicitly requests a specific scene.

**Schema:**

```sql
universes(universe_id, name)
projects(project_id, universe_id, name)   -- universe_id nullable for standalone projects

scenes(scene_id, project_id, title, part, chapter, pov, logline, save_the_cat_beat,
       timeline_position, story_time, word_count, file_path,
       prose_checksum, metadata_stale, updated_at)

-- No snapshots table -- version history is managed by git (see Version Control section)

scene_characters(scene_id, character_id)
scene_places(scene_id, place_id)
scene_tags(scene_id, tag)
scene_threads(scene_id, thread_id, beat)  -- beat per thread per scene (threads have own beat structure)

-- characters and places belong to a project OR a universe (shared)
characters(character_id, project_id, universe_id, name, role, arc_summary,
           first_appearance, file_path)
character_traits(character_id, trait)

places(place_id, project_id, universe_id, name, file_path)

threads(thread_id, project_id, name, status)  -- subplot/storyline threads; status: active/resolved/dormant

reference_docs(doc_id, project_id, universe_id, title, tags, file_path)

character_relationships(
  from_character, to_character,
  relationship_type,  -- e.g. TRUST, CONFLICT, DEPENDENCY, AFFECTION
  strength,           -- low / medium / high
  scene_id,           -- story point at which this state applies
  note                -- optional: what caused the change
)
```

`prose_checksum` is a hash of prose content for a scene file. `metadata_stale` is set when sync detects the checksum has changed since last ingest.

Characters and places with a `universe_id` are shared across all projects in that universe. Characters with only a `project_id` are local to that book. Queries automatically include both universe-level and project-level entities when a project belongs to a universe.

---

## Prose / Metadata Consistency

Editing is a primary use case. When prose changes, metadata that was derived from or annotated against that prose may no longer be accurate — loglines, tags, beat assignments, relationship state, continuity flags. The two must be kept aligned.

### Stale detection on sync

When `sync()` runs, it compares the current prose checksum against the stored `prose_checksum` for each scene. If they differ, it sets `metadata_stale = true` and updates the checksum. It does not automatically re-enrich — that is a separate, explicit step.

### Staleness enforcement in tools

Tools that reason against metadata (`find_scenes`, `get_arc`, `get_relationship_arc`) warn the caller if any of the returned scenes have `metadata_stale = true`. The AI should surface this to the user before proceeding with analysis — reasoning against stale metadata produces unreliable results.

### Re-enrichment on demand

`enrich_scene(scene_id)` is an advisory tool — it re-runs lightweight prose analysis (logline extraction, character name matching) and clears the stale flag. Output is a best-effort draft; the user reviews and applies what is useful. It does not run automatically and does not overwrite manually-authored metadata without the user explicitly calling it.

**Design principle:** Tier 1 structural metadata is inferred from files and optional standard fields from the source tool (for Scrivener users: Synopsis/Labels/Keywords). Tier 2 editorial metadata is an explicit MCP convention in sidecars. The service never auto-generates custom metadata for scenes that do not already have it.

### After an editing session

At the end of any session where prose was reviewed or changed, the agent should:

1. Call `sync()` to pick up any changes written back
2. For scenes that changed substantially, optionally call `enrich_scene(scene_id)` to refresh derived fields — review the output before accepting
3. Review and update relationship state via `update_scene_metadata` if character dynamics shifted

This keeps the index accurate without automating editorial decisions.

---

## Version Control

The sync folder is a git repository. Version history replaces the `scene_snapshots` SQLite table — git provides better diffing, branching for experimental rewrites, and meaningful commit messages.

### Setup

`git init` the sync folder on first use. The MCP service requires git to be available in the container.

### How it works

- Before any `commit_edit` write, the service runs `git add <file> && git commit -m "pre-edit snapshot: <scene_id> — <instruction>"`
- `list_snapshots(scene_id)` is implemented as `git log <file>`
- `get_scene_prose(scene_id, commit?)` for a past version is implemented as `git show <commit>:<file>`
- Manual snapshots: the AI can call `snapshot_scene(scene_id, reason)` at any time to commit the current state

### Remote (strongly recommended)

The git remote is local-first — the service functions without one. A remote is strongly recommended for redundancy and off-site backup of the manuscript. Any git host works (GitHub, GitLab, Gitea). The service will warn if no remote is configured but will not block operation.

### Branching for experimental rewrites

For structural experiments (e.g. reordering acts, trying an alternate ending), the AI can create a branch, apply changes there, and leave `main` untouched. The user merges or discards the branch in git. This is outside the MCP tool surface for Phase 2 — the user manages branches directly.

---

## Ingestion Modes

### Structured (Tier 1 always, Tier 2 when available)

Every scene contributes Tier 1 structural data from path/content. If frontmatter or sidecar metadata is present, the service indexes those fields too.

### Missing metadata

A scene without frontmatter/sidecar metadata is not a hard failure for sync, but it is currently skipped from scene indexing because `scene_id` is required. The sync summary reports skipped files so the author can add metadata in the source tool or sidecar.

**Degradation:** Full-text search (`search_metadata`) falls back to scanning prose when no structured metadata is available for a scene, but this is slower and less precise. It should be treated as a prompt to fill in metadata, not a permanent mode.

---

## MCP Tools

### Retrieval (metadata only — fast, no prose loaded)

| Tool | Description |
| --- | --- |
| `get_runtime_config()` | Show active runtime paths/capabilities plus diagnostics (`sync_dir_writable`, `permission_diagnostics`, runtime warnings, setup recommendations, git availability/enabled state, `http_port`) |
| `find_scenes(project_id?, character?, beat?, tag?, part?, chapter?, pov?, page?, page_size?)` | Returns matching scene metadata — no prose |
| `get_arc(character_id)` | Ordered scene metadata for all scenes involving a character |
| `list_characters()` | All character entries |
| `get_character_sheet(character_id)` | Character metadata, canonical sheet content, and adjacent support notes |
| `create_character_sheet(name, project_id?|universe_id?, notes?, fields?)` | Create or reuse a canonical character sheet folder. If it already exists, validate sidecar YAML, backfill required canonical files/keys only, preserve existing sidecar text when no backfill is needed, and return `action: exists` |
| `list_places()` | All place entries |
| `get_place_sheet(place_id)` | Place metadata, canonical sheet content, and adjacent support notes |
| `create_place_sheet(name, project_id?|universe_id?, notes?, fields?)` | Create or reuse a canonical place sheet folder with the same idempotent/backfill semantics as `create_character_sheet` |
| `search_metadata(query)` | Lightweight text search across loglines and tags |

### Prose retrieval (loads file content — use targeted)

| Tool | Description |
| --- | --- |
| `get_scene_prose(scene_id, commit?)` | Returns prose for a scene; optionally a past git commit hash |
| `get_chapter_prose(project_id?, part, chapter)` | Returns all prose for a chapter (use sparingly) |
| `list_snapshots(scene_id)` | Lists git commit history for a scene file with timestamps and messages |

### Editing — two-step, confirm before write

The AI can never write prose in a single step. All prose edits require an explicit confirmation.

| Tool | Description |
| --- | --- |
| `propose_edit(scene_id, instruction, revised_prose)` | Stores a complete revised version, returns a `proposal_id`, and shows a diff preview without writing |
| `commit_edit(scene_id, proposal_id)` | Runs preflight path checks first; if they pass, git-commits current prose as a pre-edit snapshot and then writes the proposed revision. If preflight fails, no snapshot is created. Returns explicit envelopes for stale/misclassified/unwritable paths (`STALE_PATH`, `INVALID_PROSE_PATH`, `PROSE_FILE_NOT_WRITABLE`) |
| `discard_edit(proposal_id)` | Discards a pending proposal |
| `snapshot_scene(scene_id, project_id, reason)` | Manually git-commits the current state of a scene with a descriptive message |

### Threads

| Tool | Description |
| --- | --- |
| `list_threads(project_id)` | All threads with status |
| `get_thread_arc(thread_id)` | Ordered scene metadata for all scenes in this thread, including per-thread beat |

### Metadata write-back (AI can update the index)

| Tool | Description |
| --- | --- |
| `update_scene_metadata(scene_id, fields)` | Update Tier 2 scene metadata in sidecar fields (logline, tags, beat, etc.) |
| `update_character_sheet(character_id, fields)` | Update character metadata or notes |
| `flag_scene(scene_id, note)` | Attach a continuity/review flag to a scene |

### Sync

| Tool | Description |
| --- | --- |
| `sync()` | Re-read sync folder and update index from changed files |

---

## Example Reasoning Flows

### Character arc consistency review

1. `get_character_sheet("elena")` — load traits, arc summary
2. `get_arc("elena")` — ordered scene metadata, loglines, beat tags
3. Model identifies 3 scenes worth examining based on metadata
4. `get_scene_prose(scene_id)` × 3 — load only those scenes
5. Model reasons against character sheet

### Save the Cat beat coverage check

1. `find_scenes()` — all scenes, metadata only
2. Model maps beat distribution, flags missing or doubled beats
3. `get_scene_prose(scene_id)` for flagged scenes only

### "What happens in the harbor?"

1. `find_scenes(places=["harbor-district"])` — metadata only
2. Model summarizes from loglines — may not need prose at all

---

## Integration

- **Service name:** `writing-mcp`
- **Pattern:** Same as `health-mcp` and `pdf-mcp` — Node.js, SSEServerTransport at `/sse`, healthcheck at `/healthz`
- **Volume:** Named Docker volume `writing-mcp-data` for the SQLite index
- **Sync folder:** Mounted via env var `WRITING_SYNC_DIR` → `/sync` in container
- **Agent:** Writing World desk (currently deferred in Desk System PRD — this service could move it up)
- **Tool allow policy:** `writing__*`

---

## Open Questions

**A. Enrichment model** — ~~Which model runs the enrichment pass?~~ **Resolved:** `enrich_scene` uses deterministic heuristics only (first-sentence logline, character name matching). No model call. Advisory output; user reviews before accepting. Tier 2 metadata for new scenes is authored deliberately by the user (source tool or sidecar), not generated automatically by the service.

**B. Write-back safety for metadata** — ~~When the AI calls `update_scene_metadata`, it modifies the sync file. Scrivener will pick up that change on next sync. Is that acceptable, or should metadata writes go to a separate sidecar file to keep Scrivener-managed files read-only?~~ **Resolved:** sidecar files (see Design Decision: Metadata Ownership). The service writes only to `.meta.yaml` files; Scrivener-managed `.md` files are never touched by the service except during `commit_edit` prose writes.

**C. Proposal storage** — Where do pending `propose_edit` proposals live? In-memory (lost on restart) or persisted in SQLite? In-memory is simpler but means a restart between propose and commit loses the proposal.

**D. Embedding-based search** — Deferred. SQLite FTS5 is likely sufficient for Phase 1. Revisit if free-text scene search across prose (e.g. "find scenes with a confrontation near water") proves too weak.

**E. Git remote setup** — Should the service auto-configure a remote on first use (requiring credentials), or is remote setup always manual? Manual is safer for a first version.

---

## Known Edge Cases

These are identified failure modes. Priority indicated: **must fix before Phase 2 ships**, *capture now, fix later*.

**#1 — Scene moved in Scrivener after sidecar migration (must fix)**
Scrivener restructures freely by moving `.md` files. If the `.md` file has been moved but its sidecar has not, sync detects the mismatch via path/metadata check and warns. The scene is not silently dropped — it falls back to the sidecar's last known `file_path` for prose retrieval and logs a warning that the path is stale. This is why frontmatter is never stripped (see Migration Path above).

**#2 — FTS ambiguity across projects (resolved)**
Previously, indexing `scenes_fts` by `scene_id` alone could produce ambiguous joins when different projects shared IDs (for example, `sc-001`). This is now fixed by including `project_id` in FTS indexing and query joins.

**#3 — Sync dir not writable (resolved)**
If `WRITING_SYNC_DIR` is a read-only Docker mount or network share, Phase 2 sidecar writes fail at runtime. The service now detects and warns at startup, exposes permission diagnostics via `get_runtime_config`, and degrades gracefully: read-only tools continue to work while write tools return clear envelopes.

**#4 — `get_chapter_prose` unbounded load (important)**
A large chapter (e.g. 30 scenes × 3000 words) produces ~90k words in a single tool response — guaranteed context overflow for any model. Add a configurable `MAX_CHAPTER_SCENES` limit (default: 10) with an explicit warning in the response when the limit is hit.

**#5 — Duplicate `scene_id` from copy/paste templates (resolved)**
If two scene files in the same project share a `scene_id`, sync warns and later inserts can overwrite earlier row state. Lint now errors on duplicate `scene_id` across files, making it easy to catch before syncing. Sync continues to warn at runtime.

**#6 — Blank scenes or notes skipped due to missing `scene_id` (resolved)**
Scrivener often contains empty placeholders or notes that do not carry scene metadata. These are skipped in scene indexing. Sync summaries report skipped files; lint now emits a `NO_METADATA` warning for `.md`/`.txt` files with no sidecar and no frontmatter, so users can decide which files should become indexed scenes.

**#7 — `search_metadata` crash on malformed FTS5 query syntax (resolved)**
Passing an invalid FTS5 expression (e.g. an unmatched `"`) to `search_metadata` previously caused an unhandled SQLite exception. The tool now catches this and returns an `INVALID_QUERY` error envelope.

**#8 — Symlinked subdirectories silently skipped during sync folder walk (resolved)**
`walkFiles` and `walkSidecars` previously skipped symlinks to directories (`entry.isDirectory()` is false for symlinks). Both functions now follow directory symlinks. Broken symlinks are skipped silently.

**#9 — Unguarded IO errors in write tools when prose/character file has moved (resolved)**
`update_scene_metadata`, `update_character_sheet`, and `flag_scene` previously let ENOENT and other IO errors throw as unhandled exceptions when the indexed file path was stale. All three now return a `STALE_PATH` error (with `indexed_path` detail) on ENOENT, and `IO_ERROR` for other failures, consistent with `get_scene_prose`.

**#10 — Re-import after Scrivener reorder creates duplicate logical scenes (must fix)**
The importer currently derives `scene_id` from the exported sequence prefix plus title (for example `011 Scene Sebastian [10].txt` → `sc-011-sebastian`). If the scene is later reordered in Scrivener and exported as `015 Scene Sebastian [10].txt`, the importer treats it as a new scene rather than the same scene at a new position. Re-importing into the same sync target can therefore leave both the old and new imported scenes on disk and in the index. The importer must reconcile by stable external source ID (Scrivener binder ID), not by current visible ordering.

---

## Phases

### Phase 1 — Ask questions about your project

**Goal:** You can open the Writing World agent and ask meaningful questions about your manuscript — who is in a scene, what happens in a chapter, what the arc of a character looks like — and get reliable answers without the AI having to read the whole book. Read-only. No edits yet.

- [x] Scaffold `mcp-writing/`: Dockerfile, `package.json`, `index.js`
- [x] Implement SQLite index with full schema above
- [x] Implement `sync()` — walk sync folder, parse metadata/frontmatter, build index, detect stale scenes
- [x] Implement `find_scenes`, `get_arc`, `get_character_sheet`, `list_characters`
- [x] Implement `get_scene_prose`, `search_metadata`
- [x] Implement `list_threads`, `get_thread_arc`

### Phase 2 — Answers stay accurate as the manuscript evolves

**Goal:** The analysis doesn't go stale. When you edit scenes in Scrivener, the AI knows which conclusions might no longer hold and tells you before reasoning against outdated information. You can update metadata and character notes directly from a conversation rather than switching tools.

- [x] Fix FTS ambiguity bug: include `project_id` in `scenes_fts` table and queries (Edge Case #2)
- [x] Migrate metadata storage to sidecar files (`.meta.yaml`); auto-generate sidecars from frontmatter on first sync; do not strip frontmatter from `.md` files (see Edge Case #1)
- [x] Detect orphaned sidecars (`.meta.yaml` with no corresponding `.md`) and warn on sync
- [x] Derive and store `part`/`chapter` from file path at sidecar creation time; detect path/metadata mismatch and warn
- [x] Implement `update_scene_metadata`, `update_character_sheet`, `flag_scene` (write to sidecar only)
- [x] Implement stale-scene detection and staleness warnings in retrieval tools
- [x] Implement `enrich_scene` for re-deriving metadata from updated prose
- [x] Implement `get_relationship_arc` (temporal character relationship graph)
- [x] Lint: `DUPLICATE_SCENE_ID` error for cross-file duplicates; `NO_METADATA` warning for bare files (Edge Cases #5, #6)
- [x] Fix `search_metadata` crash on invalid FTS5 syntax; return `INVALID_QUERY` envelope (Edge Case #7)
- [x] Follow symlinked subdirectories in sync folder walk (Edge Case #8)
- [x] Guard write tools against ENOENT/IO errors; return `STALE_PATH` envelope (Edge Case #9)

### Phase 3 — The AI can help you edit prose

**Goal:** You can ask the AI to suggest rewrites. You see what it wants to change before anything is committed. Every AI-assisted edit is automatically saved as a restore point so you can always go back. The manuscript is never silently modified.

- [x] Ensure git is available in the container; `git init` sync folder on first use
- [x] Implement `propose_edit`, `commit_edit`, `discard_edit` (git commit as pre-edit snapshot)
- [x] Implement `snapshot_scene`, `list_snapshots`, `get_scene_prose(scene_id, commit?)`
- [ ] Warn at startup if sync folder has no git remote configured
- [ ] Decide on proposal persistence model (Open Question C)

### Phase 4 — Optional / if needed

**Goal:** Cover the gaps that real use reveals as insufficient.

- [ ] Embedding-based search — if structured metadata queries can't find what you're looking for (e.g. "scenes with a confrontation near water")
- [ ] Reference document querying — if world-building notes and research need to be searchable alongside scenes

### Phase 5 — OpenClaw Integration (Optional Deployment)

**Goal:** Integrate with OpenClaw runtime and agent policy once core MCP functionality is tested and usable standalone.

- [ ] Add to OpenClaw `docker-compose.yml` with healthcheck and named volume
- [ ] Register in OpenClaw `mcp.servers` config
- [ ] Add `writing__*` to Writing World agent `tools.allow`
