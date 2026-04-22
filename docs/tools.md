# Tool Reference

> Auto-generated from `index.js`.
> Do not edit manually — run `npm run docs` to regenerate.

## Tools

- [`sync`](#sync)
- [`import_scrivener_sync`](#import_scrivener_sync)
- [`merge_scrivener_project_beta`](#merge_scrivener_project_beta)
- [`import_scrivener_sync_async`](#import_scrivener_sync_async)
- [`merge_scrivener_project_beta_async`](#merge_scrivener_project_beta_async)
- [`enrich_scene_characters_batch`](#enrich_scene_characters_batch)
- [`get_async_job_status`](#get_async_job_status)
- [`list_async_jobs`](#list_async_jobs)
- [`cancel_async_job`](#cancel_async_job)
- [`get_runtime_config`](#get_runtime_config)
- [`find_scenes`](#find_scenes)
- [`get_scene_prose`](#get_scene_prose)
- [`get_chapter_prose`](#get_chapter_prose)
- [`get_arc`](#get_arc)
- [`list_characters`](#list_characters)
- [`get_character_sheet`](#get_character_sheet)
- [`create_character_sheet`](#create_character_sheet)
- [`list_places`](#list_places)
- [`create_place_sheet`](#create_place_sheet)
- [`get_place_sheet`](#get_place_sheet)
- [`search_metadata`](#search_metadata)
- [`list_threads`](#list_threads)
- [`get_thread_arc`](#get_thread_arc)
- [`upsert_thread_link`](#upsert_thread_link)
- [`enrich_scene`](#enrich_scene)
- [`update_scene_metadata`](#update_scene_metadata)
- [`update_character_sheet`](#update_character_sheet)
- [`update_place_sheet`](#update_place_sheet)
- [`flag_scene`](#flag_scene)
- [`get_relationship_arc`](#get_relationship_arc)
- [`propose_edit`](#propose_edit)
- [`commit_edit`](#commit_edit)
- [`discard_edit`](#discard_edit)
- [`snapshot_scene`](#snapshot_scene)
- [`list_snapshots`](#list_snapshots)

---

## sync

Re-scan the sync folder and update the scene/character/place index from disk. Call this after making edits in Scrivener or updating sidecar files outside the MCP.

_No parameters._

---

## import_scrivener_sync

Import Scrivener External Folder Sync Draft files into this server's WRITING_SYNC_DIR by generating scene sidecars and reconciling by Scrivener binder ID. Use this for first-time setup before sync().

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `source_dir` | `string` | ✓ | Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself). |
| `project_id` | `string` |  | Project ID override (e.g. 'the-lamb'). Defaults to a slug derived from WRITING_SYNC_DIR. |
| `dry_run` | `boolean` |  | If true, reports planned writes without changing files. |
| `auto_sync` | `boolean` |  | If true (default), runs sync() after import when not dry-run. |
| `preflight` | `boolean` |  | If true, returns a list of files that would be processed without doing any work. Use to verify scope before a large import. |
| `ignore_patterns` | `string[]` |  | Array of regex patterns matched against filenames. Files matching any pattern are excluded from import. Useful to skip fragments, beat-sheet notes, or feedback files. |

---

## merge_scrivener_project_beta

[BETA] Merge metadata directly from a Scrivener .scriv project into existing scene sidecars. This path is opt-in and may be sensitive to Scrivener internal format changes. Requires scenes sidecars to already exist (for example, from import_scrivener_sync).

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `source_project_dir` | `string` | ✓ | Path to a Scrivener .scriv bundle directory. |
| `project_id` | `string` |  | Project ID containing existing sidecars (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). Defaults to a slug derived from WRITING_SYNC_DIR. |
| `scenes_dir` | `string` |  | Absolute path to the scenes directory containing .meta.yaml sidecars. Overrides the path derived from project_id. Use this for non-standard sync layouts. |
| `dry_run` | `boolean` |  | If true (default), reports planned merges without writing files. |
| `auto_sync` | `boolean` |  | If true (default), runs sync() after a non-dry-run merge. |

---

## import_scrivener_sync_async

Start an asynchronous Scrivener External Folder Sync import job. Returns immediately with a job_id to poll via get_async_job_status.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `source_dir` | `string` | ✓ | Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself). |
| `project_id` | `string` |  | Project ID override (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `dry_run` | `boolean` |  | If true, reports planned writes without changing files. |
| `auto_sync` | `boolean` |  | If true, runs sync() after a non-dry-run async import finishes. |
| `preflight` | `boolean` |  | If true, returns a list of files that would be processed without doing any work. |
| `ignore_patterns` | `string[]` |  | Array of regex patterns matched against filenames. Files matching any pattern are excluded from import. |

---

## merge_scrivener_project_beta_async

Start an asynchronous beta Scrivener metadata merge job. Returns immediately with a job_id to poll via get_async_job_status.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `source_project_dir` | `string` | ✓ | Path to a Scrivener .scriv bundle directory. |
| `project_id` | `string` |  | Project ID containing existing sidecars (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `scenes_dir` | `string` |  | Absolute path to the scenes directory containing .meta.yaml sidecars. Overrides the path derived from project_id. |
| `dry_run` | `boolean` |  | If true (default), reports planned merges without writing files. |
| `auto_sync` | `boolean` |  | If true, runs sync() after a non-dry-run async merge finishes. |

---

## enrich_scene_characters_batch

Start an asynchronous batch job that infers scene character mentions and updates scene metadata links. Defaults to dry_run=true.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` | ✓ | Project ID (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `scene_ids` | `string[]` |  | Optional allowlist of scene IDs to process before other filters are applied. |
| `part` | `integer` |  | Optional part number filter. |
| `chapter` | `integer` |  | Optional chapter number filter. |
| `only_stale` | `boolean` |  | If true, only process scenes currently marked metadata_stale. |
| `dry_run` | `boolean` |  | If true (default), returns preview results without writing sidecars. |
| `replace_mode` | `enum("merge","replace")` |  | merge (default): add inferred IDs; replace: overwrite characters with inferred IDs. |
| `max_scenes` | `integer` |  | Hard guardrail for resolved scene count (default: 200). |
| `include_match_details` | `boolean` |  | If true, include extra match diagnostics per scene. |
| `confirm_replace` | `boolean` |  | Must be true when replace_mode=replace. |

---

## get_async_job_status

Get status and result for an asynchronous job started by async tools such as import_scrivener_sync_async, merge_scrivener_project_beta_async, or enrich_scene_characters_batch.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `job_id` | `string` | ✓ | Job ID returned by an async start tool. |
| `include_result` | `boolean` |  | If true (default), includes completed result payload when available. |

---

## list_async_jobs

List asynchronous jobs currently known to this server.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `include_results` | `boolean` |  | If true, includes completed result payloads. |

---

## cancel_async_job

Cancel a running asynchronous job.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `job_id` | `string` | ✓ | Job ID returned by an async start tool. |

---

## get_runtime_config

Show the active runtime paths and capabilities for this server instance (sync dir, database path, writability, permission diagnostics, and git availability). Use this to verify which manuscript location is currently connected.

_No parameters._

---

## find_scenes

Find scenes by filtering on character, Save the Cat beat, tags, part, chapter, or POV. Returns ordered scene metadata only — no prose. All filters are optional and combinable. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Warns if any matching scenes have stale metadata.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` |  | Project ID (e.g. 'the-lamb'). Use to scope results to one project. |
| `character` | `string` |  | A character_id (e.g. 'char-mira-nystrom'). Returns only scenes that character appears in. Use list_characters first to find valid IDs. |
| `beat` | `string` |  | Save the Cat beat name (e.g. 'Opening Image'). Exact match. |
| `tag` | `string` |  | Scene tag to filter by. Exact match. |
| `part` | `integer` |  | Part number (integer, e.g. 1). Chapters are numbered globally across the whole project. |
| `chapter` | `integer` |  | Chapter number (integer, e.g. 3). Chapters are numbered globally across the whole project — do not reset per part. |
| `pov` | `string` |  | POV character_id. Use list_characters first to find valid IDs. |
| `page` | `integer` |  | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` |  | Optional page size for paginated responses (default: 20, max: 200). |

---

## get_scene_prose

Load the full prose text of a single scene. Use this for close reading, continuity checks, or when you need the actual writing. For overview or filtering, use find_scenes instead — it is much cheaper. Optionally retrieve a past version from git history.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to retrieve (e.g. 'sc-001-prologue'). Get this from find_scenes or get_arc. |
| `commit` | `string` |  | Optional git commit hash to retrieve a past version. Use list_snapshots to find valid hashes. If omitted, returns the current prose. |

---

## get_chapter_prose

Load the full prose for every scene in a chapter, concatenated in order. Expensive — only use when you need to read an entire chapter. Capped at 10 scenes. Use find_scenes first to confirm the chapter exists.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` | ✓ | Project ID (e.g. 'the-lamb'). |
| `part` | `integer` | ✓ | Part number (integer). |
| `chapter` | `integer` | ✓ | Chapter number (integer, globally numbered across the whole project). |

---

## get_arc

Get every scene a character appears in, ordered by part/chapter/position. Returns scene metadata only — no prose. Use this to trace a character's arc through the story. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Call list_characters first to get the character_id.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `character_id` | `string` | ✓ | The character_id to trace (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs. |
| `project_id` | `string` |  | Limit to a specific project (e.g. 'the-lamb'). |
| `page` | `integer` |  | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` |  | Optional page size for paginated responses (default: 20, max: 200). |

---

## list_characters

List all indexed characters with their character_id, name, role, and arc_summary. Call this first whenever you need to filter scenes by character or look up a character sheet — it gives you the character_id values required by other tools.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` |  | Limit to a specific project (e.g. 'the-lamb'). |
| `universe_id` | `string` |  | Limit to a specific universe (if using cross-project world-building). |

---

## get_character_sheet

Get full character details: role, arc_summary, traits, the canonical sheet content, and any adjacent support notes when the character uses a folder-based layout. Use list_characters first to get the character_id.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `character_id` | `string` | ✓ | The character_id to look up (e.g. 'char-sebastian'). Use list_characters to find valid IDs. |

---

## create_character_sheet

Create or reuse a canonical character sheet folder with sheet.md and sheet.meta.yaml so the character can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `name` | `string` | ✓ | Display name of the character (e.g. 'Mira Nystrom'). |
| `project_id` | `string` |  | Project scope for a book-local character (e.g. 'universe-1/book-1-the-lamb' or 'test-novel'). |
| `universe_id` | `string` |  | Universe scope for a cross-book shared character (e.g. 'universe-1'). |
| `notes` | `string` |  | Optional starter prose content for sheet.md. |
| `fields` | `object` |  | Optional starter metadata fields for the character sidecar. |

---

## list_places

List all indexed places with their place_id and name. Use this to find place_id values for scene filtering or to get an overview of the story's locations.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` |  | Limit to a specific project (e.g. 'the-lamb'). |
| `universe_id` | `string` |  | Limit to a specific universe. |

---

## create_place_sheet

Create or reuse a canonical place sheet folder with sheet.md and sheet.meta.yaml so the place can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `name` | `string` | ✓ | Display name of the place (e.g. 'University Hospital'). |
| `project_id` | `string` |  | Project scope for a book-local place (e.g. 'universe-1/book-1-the-lamb' or 'test-novel'). |
| `universe_id` | `string` |  | Universe scope for a cross-book shared place (e.g. 'universe-1'). |
| `notes` | `string` |  | Optional starter prose content for sheet.md. |
| `fields` | `object` |  | Optional starter metadata fields for the place sidecar. |

---

## get_place_sheet

Get full place details: associated_characters, tags, the canonical sheet content, and any adjacent support notes when the place uses a folder-based layout. Use list_places first to get the place_id.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `place_id` | `string` | ✓ | The place_id to look up (e.g. 'place-harbor-district'). Use list_places to find valid IDs. |

---

## search_metadata

Full-text search across scene titles, loglines (synopsis/logline text fields), and metadata keywords (tags/characters/places/versions). Use this when you don't know the exact scene_id or chapter but want to find scenes by topic, theme, or metadata keyword. Not a prose search — use get_scene_prose to read actual text. Supports pagination via page/page_size and auto-paginates large result sets with total_count.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `query` | `string` | ✓ | Search terms (e.g. 'hospital' or 'Sebastian feeding'). FTS5 syntax supported. |
| `page` | `integer` |  | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` |  | Optional page size for paginated responses (default: 20, max: 200). |

---

## list_threads

List all subplot/storyline threads for a project. Returns a structured JSON envelope with results and total_count. Supports pagination via page/page_size.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` | ✓ | Project ID. |
| `page` | `integer` |  | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` |  | Optional page size for paginated responses (default: 20, max: 200). |

---

## get_thread_arc

Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat. Returns a structured JSON envelope with thread metadata, results, and total_count. Supports pagination via page/page_size.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `thread_id` | `string` | ✓ | Thread ID. |
| `page` | `integer` |  | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` |  | Optional page size for paginated responses (default: 20, max: 200). |

---

## upsert_thread_link

Create or update a thread and link it to a scene. Idempotent: if the link already exists, updates its beat. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `project_id` | `string` | ✓ | Project the thread belongs to (e.g. 'the-lamb'). |
| `thread_id` | `string` | ✓ | Thread ID (e.g. 'thread-reconciliation'). |
| `thread_name` | `string` | ✓ | Thread display name. |
| `scene_id` | `string` | ✓ | Scene to link to the thread (e.g. 'sc-011-sebastian'). |
| `beat` | `string` |  | Optional thread-specific beat label for this scene. |
| `status` | `string` |  | Thread status (e.g. 'active', 'resolved'). Defaults to 'active'. |

---

## enrich_scene

Re-derive lightweight scene metadata from current prose (logline and character mentions) and clear metadata_stale for that scene. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | Scene to enrich (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` |  | Project ID. Required when scene_id is duplicated across projects. |

---

## update_scene_metadata

Update one or more metadata fields for a scene. Writes to the .meta.yaml sidecar — never modifies prose. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to update (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` | ✓ | Project the scene belongs to (e.g. 'the-lamb'). |
| `fields` | `object` |  | Fields to update. Only supplied keys are changed. |

---

## update_character_sheet

Update structured metadata fields for a character (role, arc_summary, traits, etc). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `character_id` | `string` | ✓ | The character_id to update (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs. |
| `fields` | `object` |  | Fields to update. Only supplied keys are changed. |

---

## update_place_sheet

Update structured metadata fields for a place (name, associated_characters, tags). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `place_id` | `string` | ✓ | The place_id to update (e.g. 'place-harbor-district'). Use list_places to find valid IDs. |
| `fields` | `object` |  | Fields to update. Only supplied keys are changed. |

---

## flag_scene

Attach a continuity or review note to a scene. Flags are appended to the sidecar file and accumulate over time — they are never overwritten. Use this to record continuity problems, revision notes, or questions you want to revisit.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to flag (e.g. 'sc-012-open-to-anyone'). |
| `project_id` | `string` | ✓ | Project the scene belongs to (e.g. 'the-lamb'). |
| `note` | `string` | ✓ | The flag note (e.g. 'Victor knows Mira’s name here, but they haven’t been introduced yet — contradicts sc-006'). |

---

## get_relationship_arc

Show how the relationship between two characters evolves across scenes, in order. Uses explicitly recorded relationship entries — returns nothing if no entries exist yet. Use list_characters to get character_id values.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `from_character` | `string` | ✓ | character_id of the first character (e.g. 'char-sebastian'). |
| `to_character` | `string` | ✓ | character_id of the second character (e.g. 'char-mira-nystrom'). |
| `project_id` | `string` |  | Limit to a specific project (e.g. 'the-lamb'). |

---

## propose_edit

Generate a proposed revision for a scene. Returns a proposal_id and a diff preview. Nothing is written yet — you must call commit_edit to apply the change. This tool requires git to be available.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to revise (e.g. 'sc-011-sebastian'). |
| `instruction` | `string` | ✓ | A brief instruction for the edit (e.g. 'Tighten the opening paragraph'). Used in the git commit message. |
| `revised_prose` | `string` | ✓ | The complete revised prose text for the scene. |

---

## commit_edit

Apply a proposed edit and commit it to git. First creates a pre-edit snapshot, then writes the revised prose and metadata back to disk. The scene metadata stale flag is cleared.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id being revised. |
| `proposal_id` | `string` | ✓ | The proposal_id returned by propose_edit. |

---

## discard_edit

Discard a pending proposal without applying it. The proposal is deleted and the prose remains unchanged.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `proposal_id` | `string` | ✓ | The proposal_id to discard (from propose_edit). |

---

## snapshot_scene

Manually create a git commit (snapshot) for the current state of a scene. Use this to mark important editing checkpoints outside of the propose/commit workflow.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to snapshot. |
| `project_id` | `string` | ✓ | Project the scene belongs to. |
| `reason` | `string` | ✓ | A brief reason for the snapshot (e.g. 'Character arc milestone reached'). |

---

## list_snapshots

List git commit history for a scene, with timestamps and commit messages. Use this to find commit hashes for get_scene_prose historical retrieval.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `scene_id` | `string` | ✓ | The scene_id to list snapshots for. |

---
