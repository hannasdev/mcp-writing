# Writing MCP — PRD

## Concept

A purpose-built MCP service for AI-assisted reasoning and editing on long-form fiction projects. Optimized for the context window problem: a two-phase retrieval pattern where metadata is scanned first (cheap, fast, fits in context) and prose is loaded only for the specific scenes that are relevant.

The writing environment stays Scrivener. This service is for **reasoning and editing**, not writing or compiling. The AI works on the content; Scrivener stays the authoring tool.

---

## Source of Truth: Scrivener External Folder Sync

Scrivener's built-in External Folder Sync (File → Sync → With External Folder) mirrors each document as a plain `.txt` or `.md` file in a controlled directory. One file per scene/chapter. Scrivener manages the prose; the MCP service reads from and writes to the sync folder.

This avoids coupling to Scrivener's internal `.scriv` format (XML/RTF bundle, version-sensitive). The sync folder is the stable interface.

---

## Design Decision: Metadata Ownership

### The problem with YAML frontmatter

The initial implementation stores metadata in a YAML header block inside each `.md` file (frontmatter). This is a well-established pattern (Jekyll, Hugo, Obsidian), but it creates a shared-ownership problem: Scrivener owns the prose below the `---` delimiter, and the MCP service owns the metadata above it — but they live in the same file.

This causes two issues:

1. **Fragile co-ownership.** Scrivener could corrupt the header accidentally (e.g. if its sync behaviour changes). There is nothing enforcing that the two sections stay separate.
2. **Implicit position mismatch.** `part` and `chapter` live in metadata and must be manually maintained. Nothing prevents a file from being stored in `Part 2/Chapter 3/` while its header still says `part: 1, chapter: 1`. The mismatch is silent.

### Decision: sidecar files for metadata (Phase 2)

From Phase 2 onward, metadata lives in a `.meta.yaml` sidecar file alongside each scene:

```
scenes/
  sc-001.md           ← Scrivener owns (prose only, no header)
  sc-001.meta.yaml    ← MCP service owns (metadata only)
```

Scrivener's External Folder Sync only touches `.md`/`.txt` files — it will never read or write a `.meta.yaml`. This gives clean, enforced ownership: Scrivener manages prose; the service manages metadata. Metadata changes require explicitly running a tool or editing the sidecar, so they are always intentional, never coincidental.

`part` and `chapter` are derived from the file path at sidecar creation time and stored explicitly. If a scene file is moved and the sidecar no longer matches the path, sync detects and warns. No silent drift.

### Migration path (Phase 1 → Phase 2)

Phase 1 continues using frontmatter as the bootstrap format. On the first Phase 2 sync, if no sidecar exists but the `.md` file has frontmatter, the service auto-generates the sidecar from the frontmatter. **The frontmatter header is not stripped from the `.md` file.** Stripping it would silently remove the `scene_id` from files that Scrivener may later move or duplicate — the scene would then have no identifier and disappear from the index on next sync. Frontmatter is treated as read-only legacy; the sidecar always wins when both exist.

### Orphaned sidecars

If a scene file is deleted (in Scrivener), the sidecar is orphaned. On sync, the service detects `.meta.yaml` files with no corresponding `.md` and logs a warning. It does not auto-delete them — that is an explicit user action.

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

### Scene file format — YAML metadata header + prose

```markdown
---
scene_id: p1-ch2-sc3
title: The Arrival
part: 1
chapter: 2
characters: [elena, marcus]
places: [harbor-district]
logline: Elena arrives at the harbor and meets Marcus for the first time.
save_the_cat_beat: Setup
pov: elena
timeline_position: 4
tags: [first-meeting, tension, harbor]
word_count: 1240
---

Prose starts here...
```

Scrivener's sync does not touch the metadata header — it only updates prose below the `---` delimiter. Metadata is maintained in the header block; the two don't conflict.

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

On ingest (first run and on sync), the service builds a SQLite index from the metadata headers across all files. All queries hit the index. Prose is never loaded unless a tool explicitly requests a specific scene.

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

`prose_checksum` is a hash of the prose content below the metadata header. `metadata_stale` is set when sync detects the checksum has changed since last ingest.

Characters and places with a `universe_id` are shared across all projects in that universe. Characters with only a `project_id` are local to that book. Queries automatically include both universe-level and project-level entities when a project belongs to a universe.

---

## Prose / Metadata Consistency

Editing is a primary use case. When prose changes, metadata that was derived from or annotated against that prose may no longer be accurate — loglines, tags, beat assignments, relationship state, continuity flags. The two must be kept aligned.

### Stale detection on sync

When `sync()` runs, it compares the current prose checksum against the stored `prose_checksum` for each scene. If they differ, it sets `metadata_stale = true` and updates the checksum. It does not automatically re-enrich — that is a separate, explicit step.

### Staleness enforcement in tools

Tools that reason against metadata (`find_scenes`, `get_arc`, `get_relationship_arc`) warn the caller if any of the returned scenes have `metadata_stale = true`. The AI should surface this to the user before proceeding with analysis — reasoning against stale metadata produces unreliable results.

### Re-enrichment on demand

`enrich_scene(scene_id)` re-runs the enrichment pass for a specific scene, regenerating logline, tags, and beat suggestion from the current prose and clearing the stale flag. This is also the mechanism used after an AI-assisted editing session — the agent calls it for each scene that was modified.

### After an editing session

At the end of any session where prose was reviewed or changed, the agent should:

1. Call `sync()` to pick up any changes written back
2. Call `enrich_scene(scene_id)` for each scene that was substantively edited
3. Review and update relationship state via `update_scene_metadata` if character dynamics shifted

This keeps the index a reliable source of truth rather than a snapshot that drifts.

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

### Mode A: Structured (metadata headers present)

Files have metadata headers. The service indexes what's there. Fast, no enrichment step needed.

### Mode B: Enrichment pass (no or sparse metadata)

Files exist but metadata headers are missing or incomplete. On ingest, the service detects missing metadata and runs an enrichment step:

1. Reads the prose
2. Generates a logline
3. Extracts character name mentions (matched against known character files)
4. Suggests a Save the Cat beat
5. Writes the metadata header back to the file

**Degradation:** A scene without a metadata header is not an error. It degrades to full-text search for that scene only. The system never hard-fails on missing metadata.

**Incremental migration:** You can enrich scenes progressively — prioritize scenes relevant to current work, leave others as full-text fallback. The index fills in over time.

---

## MCP Tools

### Retrieval (metadata only — fast, no prose loaded)

| Tool | Description |
| --- | --- |
| `find_scenes(character?, beat?, tags?, part?, chapter?, pov?)` | Returns matching scene metadata — no prose |
| `get_arc(character_id)` | Ordered scene metadata for all scenes involving a character |
| `list_characters()` | All character entries |
| `get_character_sheet(character_id)` | Character metadata + extended notes |
| `list_places()` | All place entries |
| `search_metadata(query)` | Lightweight text search across loglines and tags |

### Prose retrieval (loads file content — use targeted)

| Tool | Description |
| --- | --- |
| `get_scene_prose(scene_id, commit?)` | Returns prose for a scene; optionally a past git commit hash |
| `get_chapter_prose(part, chapter)` | Returns all prose for a chapter (use sparingly) |
| `list_snapshots(scene_id)` | Lists git commit history for a scene file with timestamps and messages |

### Editing — two-step, confirm before write

The AI can never write prose in a single step. All prose edits require an explicit confirmation.

| Tool | Description |
| --- | --- |
| `propose_edit(scene_id, instruction)` | Generates revised prose + diff; nothing is written; returns a `proposal_id` |
| `commit_edit(scene_id, proposal_id)` | Git-commits current prose as pre-edit snapshot, then writes the proposed revision |
| `discard_edit(proposal_id)` | Discards a pending proposal |
| `snapshot_scene(scene_id, reason)` | Manually git-commits the current state of a scene with a descriptive message |

### Threads

| Tool | Description |
| --- | --- |
| `list_threads(project_id)` | All threads with status |
| `get_thread_arc(thread_id)` | Ordered scene metadata for all scenes in this thread, including per-thread beat |

### Metadata write-back (AI can update the index)

| Tool | Description |
| --- | --- |
| `update_scene_metadata(scene_id, fields)` | Update metadata header fields (logline, tags, beat, etc.) |
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

**A. Enrichment model** — Which model runs the enrichment pass? Should be cheap/fast — a small model is fine for logline extraction and character tagging. Could be a separate call with a lighter model than the reasoning agent.

**B. Write-back safety for metadata** — ~~When the AI calls `update_scene_metadata`, it modifies the sync file. Scrivener will pick up that change on next sync. Is that acceptable, or should metadata writes go to a separate sidecar file to keep Scrivener-managed files read-only?~~ **Resolved:** sidecar files (see Design Decision: Metadata Ownership). The service writes only to `.meta.yaml` files; Scrivener-managed `.md` files are never touched by the service except during `commit_edit` prose writes.

**C. Proposal storage** — Where do pending `propose_edit` proposals live? In-memory (lost on restart) or persisted in SQLite? In-memory is simpler but means a restart between propose and commit loses the proposal.

**D. Embedding-based search** — Deferred. SQLite FTS5 is likely sufficient for Phase 1. Revisit if free-text scene search across prose (e.g. "find scenes with a confrontation near water") proves too weak.

**E. Git remote setup** — Should the service auto-configure a remote on first use (requiring credentials), or is remote setup always manual? Manual is safer for a first version.

---

## Known Edge Cases

These are identified failure modes. Priority indicated: **must fix before Phase 2 ships**, *capture now, fix later*.

**#1 — Scene moved in Scrivener after sidecar migration (must fix)**
Scrivener restructures freely by moving `.md` files. If the `.md` file has been moved but its sidecar has not, sync detects the mismatch via path/metadata check and warns. The scene is not silently dropped — it falls back to the sidecar's last known `file_path` for prose retrieval and logs a warning that the path is stale. This is why frontmatter is never stripped (see Migration Path above).

**#2 — FTS ambiguity across projects (must fix)**
The `scenes_fts` table indexes `scene_id` without `project_id`. If two projects both contain a `sc-001`, `search_metadata` returns ambiguous results and the join back to `scenes` is incorrect. Fix: include `project_id` in the FTS table and in the `MATCH` query. Tracked as a Phase 1 bug to resolve before Phase 2 begins.

**#3 — Sync dir not writable (important)**
If `WRITING_SYNC_DIR` is a read-only Docker mount or network share, Phase 2 sidecar writes fail at runtime. The service should detect and warn at startup if the sync dir is not writable, and degrade gracefully: Phase 1 read-only tools continue to work; Phase 2 write tools return a clear error rather than crashing.

**#4 — `get_chapter_prose` unbounded load (important)**
A large chapter (e.g. 30 scenes × 3000 words) produces ~90k words in a single tool response — guaranteed context overflow for any model. Add a configurable `MAX_CHAPTER_SCENES` limit (default: 10) with an explicit warning in the response when the limit is hit.

**#5 — Duplicate `scene_id` from copy-paste templates (minor)**
A user duplicates a scene file as a starting point and forgets to change the `scene_id`. On next sync, the second file silently overwrites the first in SQLite. Mitigation: detect duplicate `scene_id` values during sync and log a warning with both file paths.

**#6 — Blank scenes silently skipped (minor)**
Scrivener creates empty documents frequently. Files with no `scene_id` are skipped without any feedback. Currently logged at `stderr` only. Should surface via a sync summary that counts and names skipped files.

---

## Phases

### Phase 1 — Ask questions about your project

**Goal:** You can open the Writing World agent and ask meaningful questions about your manuscript — who is in a scene, what happens in a chapter, what the arc of a character looks like — and get reliable answers without the AI having to read the whole book. Read-only. No edits yet.

- [x] Scaffold `mcp-writing/`: Dockerfile, `package.json`, `index.js`
- [x] Implement SQLite index with full schema above
- [x] Implement `sync()` — walk sync folder, parse metadata headers, build index, detect stale scenes
- [x] Implement `find_scenes`, `get_arc`, `get_character_sheet`, `list_characters`
- [x] Implement `get_scene_prose`, `search_metadata`
- [x] Implement `list_threads`, `get_thread_arc`
- [ ] Add to OpenClaw `docker-compose.yml` with healthcheck and named volume
- [ ] Register in OpenClaw `mcp.servers` config
- [ ] Add `writing__*` to Writing World agent `tools.allow`

### Phase 2 — Answers stay accurate as the manuscript evolves

**Goal:** The analysis doesn't go stale. When you edit scenes in Scrivener, the AI knows which conclusions might no longer hold and tells you before reasoning against outdated information. You can update metadata and character notes directly from a conversation rather than switching tools.

- [ ] Fix FTS ambiguity bug: include `project_id` in `scenes_fts` table and queries (Edge Case #2)
- [ ] Migrate metadata storage to sidecar files (`.meta.yaml`); auto-generate sidecars from frontmatter on first sync; do not strip frontmatter from `.md` files (see Edge Case #1)
- [ ] Detect orphaned sidecars (`.meta.yaml` with no corresponding `.md`) and warn on sync
- [ ] Derive and store `part`/`chapter` from file path at sidecar creation time; detect path/metadata mismatch and warn
- [ ] Implement `update_scene_metadata`, `update_character_sheet`, `flag_scene` (write to sidecar only)
- [ ] Implement Mode B enrichment pass for scenes missing sidecar files
- [ ] Implement stale-scene detection and staleness warnings in retrieval tools
- [ ] Implement `enrich_scene` for re-deriving metadata from updated prose
- [ ] Implement `get_relationship_arc` (temporal character relationship graph)

### Phase 3 — The AI can help you edit prose

**Goal:** You can ask the AI to suggest rewrites. You see what it wants to change before anything is committed. Every AI-assisted edit is automatically saved as a restore point so you can always go back. The manuscript is never silently modified.

- [ ] Ensure git is available in the container; `git init` sync folder on first use
- [ ] Implement `propose_edit`, `commit_edit`, `discard_edit` (git commit as pre-edit snapshot)
- [ ] Implement `snapshot_scene`, `list_snapshots`, `get_scene_prose(scene_id, commit?)`
- [ ] Warn at startup if sync folder has no git remote configured
- [ ] Decide on proposal persistence model (Open Question C)

### Phase 4 — Optional / if needed

**Goal:** Cover the gaps that real use reveals as insufficient.

- [ ] Embedding-based search — if structured metadata queries can't find what you're looking for (e.g. "scenes with a confrontation near water")
- [ ] Reference document querying — if world-building notes and research need to be searchable alongside scenes
