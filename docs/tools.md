# Tool Reference

> Auto-generated from `src/index.js`.
> Do not edit manually — run `npm run docs` to regenerate.

## Tools

- [`describe_workflows`](#describe_workflows)
- [`sync`](#sync)
- [`import_scrivener_sync`](#import_scrivener_sync)
- [`import_scrivener_sync_async`](#import_scrivener_sync_async)
- [`merge_scrivener_project_beta`](#merge_scrivener_project_beta)
- [`enrich_scene_characters_batch`](#enrich_scene_characters_batch)
- [`get_async_job_status`](#get_async_job_status)
- [`list_async_jobs`](#list_async_jobs)
- [`cancel_async_job`](#cancel_async_job)
- [`enrich_scene`](#enrich_scene)
- [`find_scenes`](#find_scenes)
- [`get_scene_prose`](#get_scene_prose)
- [`get_chapter_prose`](#get_chapter_prose)
- [`get_arc`](#get_arc)
- [`list_characters`](#list_characters)
- [`get_character_sheet`](#get_character_sheet)
- [`list_places`](#list_places)
- [`get_place_sheet`](#get_place_sheet)
- [`search_metadata`](#search_metadata)
- [`search_reference`](#search_reference)
- [`list_scene_references`](#list_scene_references)
- [`get_reference_doc`](#get_reference_doc)
- [`list_threads`](#list_threads)
- [`get_thread_arc`](#get_thread_arc)
- [`get_relationship_arc`](#get_relationship_arc)
- [`suggest_scene_references`](#suggest_scene_references)
- [`create_character_sheet`](#create_character_sheet)
- [`create_place_sheet`](#create_place_sheet)
- [`upsert_thread_link`](#upsert_thread_link)
- [`upsert_reference_link`](#upsert_reference_link)
- [`update_scene_metadata`](#update_scene_metadata)
- [`update_character_sheet`](#update_character_sheet)
- [`update_place_sheet`](#update_place_sheet)
- [`flag_scene`](#flag_scene)
- [`preview_review_bundle`](#preview_review_bundle)
- [`create_review_bundle`](#create_review_bundle)
- [`setup_prose_styleguide_config`](#setup_prose_styleguide_config)
- [`get_prose_styleguide_config`](#get_prose_styleguide_config)
- [`summarize_prose_styleguide_config`](#summarize_prose_styleguide_config)
- [`bootstrap_prose_styleguide_config`](#bootstrap_prose_styleguide_config)
- [`update_prose_styleguide_config`](#update_prose_styleguide_config)
- [`preview_prose_styleguide_config_update`](#preview_prose_styleguide_config_update)
- [`check_prose_styleguide_drift`](#check_prose_styleguide_drift)
- [`setup_prose_styleguide_skill`](#setup_prose_styleguide_skill)
- [`propose_edit`](#propose_edit)
- [`commit_edit`](#commit_edit)
- [`discard_edit`](#discard_edit)
- [`snapshot_scene`](#snapshot_scene)
- [`list_snapshots`](#list_snapshots)
- [`get_runtime_config`](#get_runtime_config)

---

## describe_workflows

Return the default workflow map and current project context for this server. Call this first in most sessions and again whenever you are unsure what to do next. Never write scripts to invoke tools — call them directly.

_No parameters._

---

## sync

Re-scan the sync folder and update the scene/character/place index from disk. Call this after making edits in Scrivener or updating sidecar files outside the MCP.

_No parameters._

---

## import_scrivener_sync

[STABLE] Import Scrivener External Folder Sync Draft files into this server's WRITING_SYNC_DIR by generating scene sidecars and reconciling by Scrivener binder ID. This is the recommended default path for first-time setup before sync().

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `source_dir` | `string` | Yes | Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself). |
| `project_id` | `string` | No | Project ID override (e.g. 'the-lamb'). Defaults to a slug derived from WRITING_SYNC_DIR. |
| `dry_run` | `boolean` | No | If true, reports planned writes without changing files. |
| `auto_sync` | `boolean` | No | If true (default), runs sync() after import when not dry-run. |
| `preflight` | `boolean` | No | If true, returns a list of files that would be processed without doing any work. Use to verify scope before a large import. |
| `ignore_patterns` | `string[]` | No | Array of regex patterns matched against filenames. Files matching any pattern are excluded from import. Useful to skip fragments, beat-sheet notes, or feedback files. |

---

## import_scrivener_sync_async

[STABLE] Start an asynchronous Scrivener External Folder Sync import job. This is the recommended default import path when the sync tree is large. Returns immediately with a job_id to poll via get_async_job_status.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `source_dir` | `string` | Yes | Path to Scrivener external sync folder (the folder that contains Draft/, or Draft/ itself). |
| `project_id` | `string` | No | Project ID override (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `dry_run` | `boolean` | No | If true, reports planned writes without changing files. |
| `auto_sync` | `boolean` | No | If true, runs sync() after a non-dry-run async import finishes. |
| `preflight` | `boolean` | No | If true, returns a list of files that would be processed without doing any work. |
| `ignore_patterns` | `string[]` | No | Array of regex patterns matched against filenames. Files matching any pattern are excluded from import. |

---

## merge_scrivener_project_beta

Merge metadata directly from a Scrivener .scriv project into existing scene sidecars by starting a background job. This path is opt-in and requires sidecars to already exist (for example, from import_scrivener_sync). Returns immediately with a job_id to poll via get_async_job_status.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `source_project_dir` | `string` | Yes | Path to a Scrivener .scriv bundle directory. |
| `project_id` | `string` | No | Project ID containing existing sidecars (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `scenes_dir` | `string` | No | Absolute path to the scenes directory containing .meta.yaml sidecars. Overrides the path derived from project_id. |
| `dry_run` | `boolean` | No | If true (default), reports planned merges without writing files. |
| `auto_sync` | `boolean` | No | If true, runs sync() after a non-dry-run async merge finishes. |
| `organize_by_chapters` | `boolean` | No | If true (default false), relocate scene files into chapter-based folder hierarchies. Chapter metadata is always extracted to sidecars. |

---

## enrich_scene_characters_batch

Start an asynchronous batch job that infers scene character mentions and updates scene metadata links. Version 1 uses canonical character names only (no aliases). Defaults to dry_run=true.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID (e.g. 'the-lamb' or 'universe-1/book-1-the-lamb'). |
| `scene_ids` | `string[]` | No | Optional allowlist of scene IDs to process before other filters are applied. |
| `part` | `integer` | No | Optional part number filter. |
| `chapter` | `integer` | No | Optional chapter number filter. |
| `only_stale` | `boolean` | No | If true, only process scenes currently marked metadata_stale. |
| `dry_run` | `boolean` | No | If true (default), returns preview results without writing sidecars. |
| `replace_mode` | `enum("merge","replace")` | No | merge (default): add inferred IDs; replace: overwrite characters with inferred IDs. |
| `max_scenes` | `integer` | No | Hard guardrail for resolved scene count (default: 200). |
| `include_match_details` | `boolean` | No | If true, include extra match diagnostics per scene. |
| `confirm_replace` | `boolean` | No | Must be true when replace_mode=replace. |

---

## get_async_job_status

Get status and result for an asynchronous job started by async tools such as import_scrivener_sync_async, merge_scrivener_project_beta, or enrich_scene_characters_batch. Use this to poll job progress after receiving a job_id. Common next step: if status is still running, call this tool again; if status is completed inspect result, and if status is failed or cancelled inspect job/result diagnostics.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `job_id` | `string` | Yes | Job ID returned by an async start tool. |
| `include_result` | `boolean` | No | If true (default), includes completed result payload when available. |

---

## list_async_jobs

List asynchronous jobs currently known to this server. Use this when you lost a job_id or need a dashboard view of running/completed jobs. Returns an object envelope containing a jobs array of job objects sorted by newest first.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `include_results` | `boolean` | No | If true, includes completed result payloads. |

---

## cancel_async_job

Cancel a running asynchronous job. Use this when an import/merge/batch run was started with overly broad scope or is no longer needed. Returns the updated job state; cancellation is cooperative and may transition through 'cancelling' before 'cancelled'.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `job_id` | `string` | Yes | Job ID returned by an async start tool. |

---

## enrich_scene

Re-derive lightweight scene metadata from current prose (logline and character mentions) and clear metadata_stale for that scene. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | Scene to enrich (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` | No | Project ID. Required when scene_id is duplicated across projects. |

---

## find_scenes

Find scenes by filtering on character, Save the Cat beat, tags, part, chapter, or POV. Returns ordered scene metadata only — no prose. All filters are optional and combinable. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Warns if any matching scenes have stale metadata. Response shape note: always returns a structured envelope (`results`, `total_count`, with pagination fields when paging is active).

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Project ID (e.g. 'the-lamb'). Use to scope results to one project. |
| `character` | `string` | No | A character_id (e.g. 'char-mira-nystrom'). Returns only scenes that character appears in. Use list_characters first to find valid IDs. |
| `beat` | `string` | No | Save the Cat beat name (e.g. 'Opening Image'). Exact match. |
| `tag` | `string` | No | Scene tag to filter by. Exact match. |
| `part` | `integer` | No | Part number (integer, e.g. 1). Chapters are numbered globally across the whole project. |
| `chapter` | `integer` | No | Chapter number (integer, e.g. 3). Chapters are numbered globally across the whole project — do not reset per part. |
| `pov` | `string` | No | POV character_id. Use list_characters first to find valid IDs. |
| `page` | `integer` | No | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` | No | Optional page size for paginated responses (default: 20, max: 200). |

---

## get_scene_prose

Load the full prose text of a single scene. Use this for close reading, continuity checks, or when you need the actual writing. For overview or filtering, use find_scenes instead — it is much cheaper. Optionally retrieve a past version from git history. If scene IDs are reused across projects, omitting project_id returns CONFLICT with candidate project_ids.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to retrieve (e.g. 'sc-001-prologue'). Get this from find_scenes or get_arc. |
| `project_id` | `string` | No | Optional project ID to disambiguate duplicate scene IDs across projects. |
| `commit` | `string` | No | Optional git commit hash to retrieve a past version. Use list_snapshots to find valid hashes. If omitted, returns the current prose. |

---

## get_chapter_prose

Load the full prose for every scene in a chapter, concatenated in order. Expensive — only use when you need to read an entire chapter. Capped at 10 scenes. Use find_scenes first to confirm the chapter exists.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID (e.g. 'the-lamb'). |
| `part` | `integer` | Yes | Part number (integer). |
| `chapter` | `integer` | Yes | Chapter number (integer, globally numbered across the whole project). |

---

## get_arc

Get every scene a character appears in, ordered by part/chapter/position. Returns scene metadata only — no prose. Use this as the primary structural entry point when the question is about a character's progression through the manuscript. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Use list_characters only when you need help finding a character_id. Response shape note: always returns a structured envelope (`results`, `total_count`, with pagination fields when paging is active).

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `character_id` | `string` | Yes | The character_id to trace (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs. |
| `project_id` | `string` | No | Limit to a specific project (e.g. 'the-lamb'). |
| `page` | `integer` | No | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` | No | Optional page size for paginated responses (default: 20, max: 200). |

---

## list_characters

List indexed characters with their character_id, name, role, and arc_summary. Use this mainly as a lookup and disambiguation helper when you need to find a character_id for a broader reasoning task. Response shape note: returns a structured envelope (`results`, `total_count`).

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Limit to a specific project (e.g. 'the-lamb'). |
| `universe_id` | `string` | No | Limit to a specific universe (if using cross-project world-building). |

---

## get_character_sheet

Get full character details: role, arc_summary, traits, the canonical sheet content, and any adjacent support notes when the character uses a folder-based layout. Use this when the reasoning task needs the character's canonical profile rather than only their scene progression. Response shape note: returns a structured envelope (`results`, `total_count`) with one result row.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `character_id` | `string` | Yes | The character_id to look up (e.g. 'char-sebastian'). Use list_characters to find valid IDs. |

---

## list_places

List indexed places with their place_id and name. Use this mainly as a lookup and disambiguation helper when place context becomes relevant to the current reasoning task. Response shape note: returns a structured envelope (`results`, `total_count`).

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Limit to a specific project (e.g. 'the-lamb'). |
| `universe_id` | `string` | No | Limit to a specific universe. |

---

## get_place_sheet

Get full place details: associated_characters, tags, the canonical sheet content, and any adjacent support notes when the place uses a folder-based layout. Use this when the current scene or question makes the place itself materially relevant. Response shape note: returns a structured envelope (`results`, `total_count`) with one result row.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `place_id` | `string` | Yes | The place_id to look up (e.g. 'place-harbor-district'). Use list_places to find valid IDs. |

---

## search_metadata

Full-text search across scene titles, loglines (synopsis/logline text fields), and metadata keywords (tags/characters/places/versions). Use this when you don't know the exact scene_id or chapter but want to find scenes by topic, theme, or metadata keyword. Not a prose search — use get_scene_prose to read actual text. Supports pagination via page/page_size and auto-paginates large result sets with total_count.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `query` | `string` | Yes | Search terms (e.g. 'hospital' or 'Sebastian feeding'). FTS5 syntax supported. |
| `page` | `integer` | No | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` | No | Optional page size for paginated responses (default: 20, max: 200). |

---

## search_reference

Full-text search across indexed reference document titles, summaries, and tags. Use this to discover world-building notes, continuity references, research docs, and other reference material without loading full file contents. Response shape note: returns a structured envelope (`results`, `total_count`).

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `query` | `string` | Yes | Search terms (e.g. 'vampirism' or 'blood replacement'). FTS5 syntax supported. |
| `type` | `string` | No | Optional reference type filter (for example: 'world', 'continuity', 'research', 'style'). |
| `tag` | `string` | No | Optional exact tag filter. |

---

## list_scene_references

List direct reference documents linked from a scene via metadata (for example, reference_ids). Returns only one-hop scene -> reference links and does not recursively traverse related references. If scene IDs are reused across projects, omitting project_id returns CONFLICT with candidate project_ids. Response shape note: returns a structured envelope (`results`, `total_count`) plus the resolved `scene_id` and `project_id` context.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | Scene ID to inspect. |
| `project_id` | `string` | No | Optional project ID to disambiguate duplicate scene IDs across projects. |

---

## get_reference_doc

Get metadata for a reference document by doc_id. Optionally includes exactly one hop of related reference docs.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `doc_id` | `string` | Yes | Reference document ID. |
| `include_related` | `boolean` | No | If true, include one-hop related reference docs. |

---

## list_threads

List subplot/storyline threads for a project. Returns a structured JSON envelope with results and total_count. Use this mainly as a lookup and disambiguation helper before deeper thread reasoning with get_thread_arc. Supports pagination via page/page_size.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID. |
| `page` | `integer` | No | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` | No | Optional page size for paginated responses (default: 20, max: 200). |

---

## get_thread_arc

Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat. Returns a structured JSON envelope with thread metadata, results, and total_count. Use this when the question is about subplot movement, continuity, or recurring storyline structure across scenes. Supports pagination via page/page_size.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `thread_id` | `string` | Yes | Thread ID. |
| `page` | `integer` | No | Optional page number for paginated responses (1-based). |
| `page_size` | `integer` | No | Optional page size for paginated responses (default: 20, max: 200). |

---

## get_relationship_arc

Show how the relationship between two characters evolves across scenes, in order. Uses explicitly recorded relationship entries — returns nothing if no entries exist yet. Use list_characters to get character_id values. Response shape note: returns a structured envelope { results, total_count, from_character, to_character }.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `from_character` | `string` | Yes | character_id of the first character (e.g. 'char-sebastian'). |
| `to_character` | `string` | Yes | character_id of the second character (e.g. 'char-mira-nystrom'). |
| `project_id` | `string` | No | Limit to a specific project (e.g. 'the-lamb'). |

---

## suggest_scene_references

Suggest reference documents for a scene by aggregating links from the scene's characters and places. Returns weighted candidates ranked by how many entities in the scene link to each reference. Excludes any explicit scene → reference links already present. In apply mode, can persist selected suggestions as explicit scene links in one call.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | Scene ID (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` | No | Optional project scope to disambiguate an ambiguous scene_id across projects. |
| `mode` | `enum("preview","apply")` | No | Use 'preview' (default) to list candidates only, or 'apply' to persist selected suggestions as explicit scene links. |
| `selected_doc_ids` | `string[]` | No | Optional allowlist of doc_ids to apply when mode='apply'. If omitted, applies top-ranked candidates. |
| `max_apply` | `integer` | No | Optional cap for how many candidates to apply when mode='apply'. |
| `min_score` | `integer` | No | Optional minimum candidate score. Candidates below this are excluded from preview/apply. Defaults to 1. |

---

## create_character_sheet

Create or reuse a canonical character sheet folder with sheet.md and sheet.meta.yaml so the character can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `name` | `string` | Yes | Display name of the character (e.g. 'Mira Nystrom'). |
| `project_id` | `string` | No | Project scope for a book-local character (e.g. 'universe-1/book-1-the-lamb' or 'test-novel'). |
| `universe_id` | `string` | No | Universe scope for a cross-book shared character (e.g. 'universe-1'). |
| `notes` | `string` | No | Optional starter prose content for sheet.md. |
| `fields` | `object` | No | Optional starter metadata fields for the character sidecar. |

---

## create_place_sheet

Create or reuse a canonical place sheet folder with sheet.md and sheet.meta.yaml so the place can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `name` | `string` | Yes | Display name of the place (e.g. 'University Hospital'). |
| `project_id` | `string` | No | Project scope for a book-local place (e.g. 'universe-1/book-1-the-lamb' or 'test-novel'). |
| `universe_id` | `string` | No | Universe scope for a cross-book shared place (e.g. 'universe-1'). |
| `notes` | `string` | No | Optional starter prose content for sheet.md. |
| `fields` | `object` | No | Optional starter metadata fields for the place sidecar. |

---

## upsert_thread_link

Create or update a thread and link it to a scene. Idempotent: if the link already exists, updates its beat. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project the thread belongs to (e.g. 'the-lamb'). |
| `thread_id` | `string` | Yes | Thread ID (e.g. 'thread-reconciliation'). |
| `thread_name` | `string` | Yes | Thread display name. |
| `scene_id` | `string` | Yes | Scene to link to the thread (e.g. 'sc-011-sebastian'). |
| `beat` | `string` | No | Optional thread-specific beat label for this scene. |
| `status` | `string` | No | Thread status (e.g. 'active', 'resolved'). Defaults to 'active'. |

---

## upsert_reference_link

Create or update an explicit reference link from a scene, character, place, or reference doc to a target reference doc. If a link already exists between the same source and target, this updates the relation. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `source_kind` | `enum("scene","character","place","reference")` | Yes | Link source kind. |
| `source_id` | `string` | Yes | Source scene_id, character_id, place_id, or reference doc_id. |
| `source_project_id` | `string` | No | Optional project scope for the source. For scene/character/place sources, use this to disambiguate an ambiguous source_id across projects. For reference sources, when provided, it is treated as an ownership check and must match the source reference doc's project. |
| `target_doc_id` | `string` | Yes | Target reference doc_id. |
| `relation` | `string` | Yes | Relationship label (for example: 'informs', 'related', 'history_of'). The value is trimmed and lowercased before validation. |

---

## update_scene_metadata

Update one or more metadata fields for a scene. Writes to the .meta.yaml sidecar — never modifies prose. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to update (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` | Yes | Project the scene belongs to (e.g. 'the-lamb'). |
| `fields` | `object` | No | Fields to update. Only supplied keys are changed. |

---

## update_character_sheet

Update structured metadata fields for a character (role, arc_summary, traits, etc). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `character_id` | `string` | Yes | The character_id to update (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs. |
| `fields` | `object` | No | Fields to update. Only supplied keys are changed. |

---

## update_place_sheet

Update structured metadata fields for a place (name, associated_characters, tags). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `place_id` | `string` | Yes | The place_id to update (e.g. 'place-harbor-district'). Use list_places to find valid IDs. |
| `fields` | `object` | No | Fields to update. Only supplied keys are changed. |

---

## flag_scene

Attach a continuity or review note to a scene. Flags are appended to the sidecar file and accumulate over time — they are never overwritten. Use this to record continuity problems, revision notes, or questions you want to revisit.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to flag (e.g. 'sc-012-open-to-anyone'). |
| `project_id` | `string` | Yes | Project the scene belongs to (e.g. 'the-lamb'). |
| `note` | `string` | Yes | The flag note (e.g. 'Victor knows Mira’s name here, but they haven’t been introduced yet — contradicts sc-006'). |

---

## preview_review_bundle

Dry-run planning tool for review bundles. Resolves scene scope, deterministic ordering, warnings, and planned output filenames without writing files. Rendering options are accepted for API consistency and reflected in resolved_scope.options, but do not change planning output.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID to scope the review bundle (e.g. 'test-novel'). |
| `profile` | `enum` | Yes | Bundle profile: outline_discussion, editor_detailed, or beta_reader_personalized. |
| `part` | `integer` | No | Optional part filter. |
| `chapter` | `integer` | No | Optional chapter filter. |
| `chapters` | `number[]` | No | Optional chapter-set filter. Use this for one/few specific chapters. Do not combine with chapter. |
| `tag` | `string` | No | Optional tag filter (exact match). |
| `scene_ids` | `string[]` | No | Optional explicit scene_id allowlist. Intersects with other filters. |
| `strictness` | `enum` | No | Strictness mode: warn (default) or fail. |
| `include_scene_ids` | `boolean` | No | Rendering option (default true). Echoed in resolved_scope.options for downstream rendering; does not change planning results. |
| `include_metadata_sidebar` | `boolean` | No | Rendering option (default false). Echoed in resolved_scope.options for downstream rendering; does not change planning results. |
| `include_paragraph_anchors` | `boolean` | No | Rendering option (default false). Echoed in resolved_scope.options for downstream rendering; does not change planning results. |
| `recipient_name` | `string` | No | Optional recipient display name for beta_reader_personalized profile. |
| `beta_accountability` | `boolean` | No | Enable accountability footer + fingerprint metadata for beta_reader_personalized output (default true for beta profile). |
| `bundle_name` | `string` | No | Optional output bundle base name override (slugified in planned outputs). |
| `format` | `enum("pdf","markdown","both")` | No | Planned output format: pdf (default), markdown, or both. Affects planned_outputs filenames only; preview_review_bundle does not render artifacts. |

---

## create_review_bundle

Generate review bundle artifacts (PDF/markdown) from planned scene scope. Writes files only under output_dir and returns manifest/provenance details.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID to scope the review bundle (e.g. 'test-novel'). |
| `profile` | `enum` | Yes | Bundle profile: outline_discussion, editor_detailed, or beta_reader_personalized. |
| `output_dir` | `string` | Yes | Directory path to write bundle artifacts into. |
| `part` | `integer` | No | Optional part filter. |
| `chapter` | `integer` | No | Optional chapter filter. |
| `chapters` | `number[]` | No | Optional chapter-set filter. Use this for one/few specific chapters. Do not combine with chapter. |
| `tag` | `string` | No | Optional tag filter (exact match). |
| `scene_ids` | `string[]` | No | Optional explicit scene_id allowlist. Intersects with other filters. |
| `strictness` | `enum` | No | Strictness mode: warn (default) or fail. |
| `include_scene_ids` | `boolean` | No | Include scene IDs in headings (default true). Applies to both PDF and markdown. |
| `include_metadata_sidebar` | `boolean` | No | Include metadata sidebar in markdown output (default false). Markdown only — no effect on PDF. |
| `include_paragraph_anchors` | `boolean` | No | Include paragraph anchors in markdown output (default false). Markdown only — no effect on PDF. |
| `recipient_name` | `string` | No | Optional recipient display name for beta_reader_personalized profile. |
| `beta_accountability` | `boolean` | No | Enable accountability footer + fingerprint metadata for beta_reader_personalized output (default true for beta profile). |
| `bundle_name` | `string` | No | Optional output bundle base name override (slugified in filenames). |
| `source_commit` | `string` | No | Optional explicit source commit for provenance. Defaults to current HEAD when available. |
| `format` | `enum("pdf","markdown","both")` | No | Output format: pdf (default), markdown, or both. |

---

## setup_prose_styleguide_config

Create prose-styleguide.config.yaml at sync root or project root using language defaults plus optional explicit overrides.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scope` | `enum("sync_root","project_root")` | No | Config write target scope. Defaults to project_root when project_id is supplied, otherwise sync_root. |
| `project_id` | `string` | No | Project ID when writing project_root config (e.g. 'the-lamb' or 'universe-1/book-1'). |
| `language` | `enum` | Yes | Primary writing language. Seeds language-specific defaults. |
| `overrides` | `object` | No | Optional overrides layered on top of language defaults. |
| `voice_notes` | `string` | No | Optional freeform voice notes to include in config. |
| `overwrite` | `boolean` | No | If true, replaces an existing config file at the target location. |

---

## get_prose_styleguide_config

Resolve prose-styleguide.config.yaml with cascading precedence (sync root, then universe root, then project root). Applies language-derived defaults and nested quotation defaults when omitted.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1'). |

---

## summarize_prose_styleguide_config

Summarize the currently resolved prose styleguide config in plain language for review or confirmation.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Optional project ID for project-scoped resolution (e.g. 'the-lamb' or 'universe-1/book-1'). |

---

## bootstrap_prose_styleguide_config

Detect dominant prose conventions from existing scenes and suggest initial prose-styleguide config values.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1'). |
| `scene_ids` | `string[]` | No | Optional scene_id allowlist to analyze. |
| `part` | `integer` | No | Optional part filter. |
| `chapter` | `integer` | No | Optional chapter filter. |
| `max_scenes` | `integer` | No | Maximum number of scenes to analyze (default: 50). |
| `min_agreement` | `number` | No | Minimum agreement ratio for suggested fields (default: 0.6). |
| `min_evidence` | `integer` | No | Minimum number of observed scenes per field before suggesting it (default: 3). |
| `include_scene_signals` | `boolean` | No | If true, include per-scene detected signals in the response. |

---

## update_prose_styleguide_config

Update an existing prose-styleguide.config.yaml at sync-root or project-root scope by writing only explicit field changes.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scope` | `enum("sync_root","project_root")` | Yes | Config scope to update. |
| `project_id` | `string` | No | Project ID when updating project_root config (e.g. 'the-lamb' or 'universe-1/book-1'). |
| `updates` | `object` | No | Explicit config field changes to write at the selected scope. |

---

## preview_prose_styleguide_config_update

Preview how explicit updates would change an existing prose-styleguide.config.yaml without writing any files.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scope` | `enum("sync_root","project_root")` | Yes | Config scope to preview updates for. |
| `project_id` | `string` | No | Project ID when previewing project_root config updates (e.g. 'the-lamb' or 'universe-1/book-1'). |
| `updates` | `object` | No | Explicit config field changes to preview at the selected scope. |

---

## check_prose_styleguide_drift

Detect styleguide drift by comparing declared config conventions against observed signals in scene prose.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | Yes | Project ID to analyze (e.g. 'the-lamb' or 'universe-1/book-1'). |
| `scene_ids` | `string[]` | No | Optional scene_id allowlist to analyze. |
| `part` | `integer` | No | Optional part filter. |
| `chapter` | `integer` | No | Optional chapter filter. |
| `max_scenes` | `integer` | No | Maximum number of scenes to analyze (default: 50). |
| `min_agreement` | `number` | No | Minimum agreement ratio for suggested updates (default: 0.6). |
| `include_clean_scenes` | `boolean` | No | If true, include scenes with no detected drift in scene_results. |

---

## setup_prose_styleguide_skill

Generate skills/prose-styleguide/SKILL.md from the resolved prose styleguide config and universal craft rules. Optionally publish AI boot files (CLAUDE.md and .github/copilot-instructions.md) when using sync-root config scope.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `project_id` | `string` | No | Project-scoped skill generation is unsupported because this tool writes a shared sync-root skills/prose-styleguide/SKILL.md file. |
| `overwrite` | `boolean` | No | If true, replaces an existing skills/prose-styleguide/SKILL.md file. |
| `publish_boot_files` | `boolean` | No | If true, also upserts CLAUDE.md and .github/copilot-instructions.md at sync root. Defaults to true. |
| `boot_files_overwrite` | `boolean` | No | If true, rewrites existing boot files instead of in-place updates. |

---

## propose_edit

Generate a proposed revision for a scene. Returns a proposal_id and a diff preview. Nothing is written yet — you must call commit_edit to apply the change. This tool requires git to be available. If scene IDs are reused across projects, omitting project_id returns CONFLICT with candidate project_ids.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to revise (e.g. 'sc-011-sebastian'). |
| `project_id` | `string` | No | Optional project ID to disambiguate duplicate scene IDs across projects. |
| `instruction` | `string` | Yes | A brief instruction for the edit (e.g. 'Tighten the opening paragraph'). Used in the git commit message. |
| `revised_prose` | `string` | Yes | The complete revised prose text for the scene. |
| `bypass_styleguide` | `boolean` | No | If true, bypasses automatic styleguide checks for this proposal. |
| `bypass_reason` | `string` | No | Required when bypass_styleguide=true. Explains why this edit should ignore styleguide checks. |

---

## commit_edit

Apply a proposed edit and commit it to git. First creates a pre-edit snapshot, then writes the revised prose and metadata back to disk. The scene metadata stale flag is cleared.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id being revised. |
| `project_id` | `string` | No | Optional project ID. Required when scene IDs are duplicated across projects. |
| `proposal_id` | `string` | Yes | The proposal_id returned by propose_edit. |

---

## discard_edit

Discard a pending proposal without applying it. The proposal is deleted and the prose remains unchanged.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `proposal_id` | `string` | Yes | The proposal_id to discard (from propose_edit). |

---

## snapshot_scene

Manually create a git commit (snapshot) for the current state of a scene. Use this to mark important editing checkpoints outside of the propose/commit workflow.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to snapshot. |
| `project_id` | `string` | Yes | Project the scene belongs to. |
| `reason` | `string` | Yes | A brief reason for the snapshot (e.g. 'Character arc milestone reached'). |

---

## list_snapshots

List git commit history for a scene, with timestamps and commit messages. Use this to find commit hashes for get_scene_prose historical retrieval.

| Parameter | Type | Required | Description |
| --- | --- | :---: | --- |
| `scene_id` | `string` | Yes | The scene_id to list snapshots for. |
| `project_id` | `string` | No | Optional project ID to disambiguate duplicate scene IDs across projects. |

---

## get_runtime_config

Show the active runtime paths and capabilities for this server instance (server version, sync dir, database path, writability, permission diagnostics, and git availability). Use this to verify which manuscript location is currently connected.

_No parameters._

---
