# Architecture Alignment Follow-up — Metadata Ownership Inventory

**Status:** Accepted for M1 sequencing

This inventory names the current owner, compatibility role, and follow-up
decision for metadata families touched by the sidecar and snapshot alignment
work. It is implementation-backed by the current SQLite schema, metadata lint
schemas, sync indexers, and MCP write tools.

## Ownership Categories

- **SQLite-canonical:** durable structured state is stored in SQLite and should
  be mutated through sanctioned workflows.
- **Prose-authored:** authored manuscript or notes content remains file-based.
- **Generated view:** derived output for transparency, review, or diagnostics.
- **Import-only compatibility input:** accepted during setup, import, or legacy
  migration; not daily-work authority.
- **Review snapshot:** proposed before/after material for dry runs and review.
- **Recovery snapshot:** durable rollback or rebuild input tied to backup and
  restore workflows.
- **Deprecated:** retained only until migration/removal is explicitly planned.

## Current Ownership Matrix

| Metadata family | Current implementation | Current owner | Compatibility role | M0 decision |
| --- | --- | --- | --- | --- |
| Project and universe identity | `projects`, `universes` | SQLite-canonical | Path inference and import may seed records | Keep SQLite-canonical; path inference remains import/sync support. |
| Scene identity and core metadata | `scenes.scene_id`, `project_id`, `title`, `pov`, `logline`, `scene_change`, `causality`, `stakes`, `scene_functions`, `save_the_cat_beat`, `story_time`, `word_count`, `metadata_stale` | SQLite-canonical after sync/tool writes | Sidecar/frontmatter remains compatibility input | Keep SQLite-canonical; M3 decides how generic metadata tools stop treating sidecars as active authority. |
| Scene structural placement | `scenes.chapter_id`, `scene_role`, `part`, `chapter`, `chapter_title`, `timeline_position`; `chapters` | SQLite-canonical | Folder names and numeric chapter fields are compatibility hints/read aliases | Keep SQLite-canonical; M2/M3 preserve structure unless explicit workflows mutate it. |
| Scene prose | Markdown/text scene files | Prose-authored | Sync computes checksum and stale state | Keep prose-authored and file-based. |
| Scene workflow status | Accepted by scene sidecar schema and `update_scene_metadata`; no SQLite column | Sidecar-only today | Daily metadata field, not import-only | Needs decision: migrate-to-schema or intentionally deprecated/replaced by review workflow status. |
| Scene source identifiers | `external_source`, `external_id` accepted by scene sidecar schema; Scrivener import/merge uses them | Import-only compatibility input today | Scrivener/import reconciliation | Mark import-only unless a future provenance model adds SQLite columns. |
| Scene flags/review notes | `flag_scene` appends `flags` to sidecar; not in lint schema or SQLite | Sidecar-only today | Review note scratchpad | Needs decision: migrate to outcome workflow/review snapshot or deprecate sidecar flag authority. |
| Scene characters | `scene_characters`; populated by sync from sidecar and by enrichment apply/sync | SQLite-canonical index, sidecar-first writes in some workflows | Sidecar `characters` is compatibility input and current write surface | M4 should move active relationship changes to SQLite-first outcome workflows. |
| Scene places | `scene_places`; populated by sync from sidecar | SQLite-canonical index, sidecar-first writes in generic metadata | Sidecar `places` is compatibility input and current write surface | M4 should define outcome workflow or deprecation path for active place associations. |
| Scene tags | `scene_tags`; populated by sync from sidecar `tags` and `versions` | SQLite-canonical index, sidecar-first writes in generic metadata | Sidecar `tags` remains current write surface | Needs schema/semantics decision for tags as canonical metadata rather than sidecar authority. |
| Scene versions | Sidecar `versions`; indexed into `scene_tags`; legacy script splits version markers out of characters | Generated/import compatibility today | Search keyword continuity and legacy cleanup | Decide whether versions become first-class schema, ordinary tags, or deprecated import cleanup. |
| Threads and scene-thread beats | `threads`, `scene_threads`; `upsert_thread_link` writes SQLite-first | SQLite-canonical | Sidecar `threads` is lint-accepted but not active authority | Keep SQLite-canonical; treat sidecar `threads` as deprecated/import-only unless M4 defines migration. |
| Chapters | `chapters` | SQLite-canonical | Folder-derived structure can seed or diagnose | Keep SQLite-canonical. |
| Epigraphs | `epigraphs`, `epigraph_characters`, `epigraph_tags` | SQLite-canonical for indexed metadata; prose body file-based | Epigraph metadata/frontmatter and folder placement are compatibility input | Keep SQLite-canonical for placement/relationships; prose remains file-based. |
| Characters | `characters`, `character_traits`; sheet files plus sidecars | Mixed: SQLite-canonical for indexed fields, file sidecars as current write surface | Character sidecars seed/update SQLite | M4 should decide whether character metadata updates become SQLite-first with generated compatibility output. |
| Character group | Accepted by character sidecar schema; no SQLite column | Sidecar-only today | Potential organization metadata | Needs decision: migrate-to-schema, deprecate, or intentionally prose/file-owned. |
| Character tags | Accepted by character sidecar schema; no SQLite table | Sidecar-only today | Search/classification candidate | Needs decision: migrate-to-schema, deprecate, or generated/import-only. |
| Character prose notes | `sheet.md` and adjacent support notes | Prose-authored | Search/detail tools read notes on demand | Keep prose-authored and file-based. |
| Character relationships | `character_relationships` | SQLite-canonical table exists | No clear public outcome workflow in this initiative yet | Include in M0/M4 relationship ownership; decide if workflow surface is needed. |
| Places | `places`; sheet files plus sidecars | Mixed: SQLite-canonical for indexed fields, file sidecars as current write surface | Place sidecars seed/update SQLite | M4 should decide whether place metadata updates become SQLite-first with generated compatibility output. |
| Place associated characters | Accepted/read from place sidecar; no SQLite relationship table | Sidecar-only today | Place detail output and current update surface | Needs schema decision: likely migrate-to-schema as relationship metadata or deprecate. |
| Place tags | Accepted/read from place sidecar; no SQLite table | Sidecar-only today | Place classification/search candidate | Needs decision: migrate-to-schema, deprecate, or generated/import-only. |
| Reference docs | `reference_docs`, `reference_doc_tags`, `reference_docs_fts` | SQLite-canonical index over file-authored docs | Reference file frontmatter seeds index | Keep SQLite-canonical index; source doc prose remains file-based. |
| Reference links | `reference_links` with `origin`; sidecar/frontmatter aliases `reference_ids`, `references`, `related_reference_ids`, `related_references`, `related_docs`, `related`, `reference_links`, `explicit_reference_links`, `related_reference_links` | SQLite-canonical target state, but sidecar/file aliases are active inputs and some tool writes are sidecar-first | Legacy aliases and compatibility output | M4 must make apply workflows SQLite-first or transactionally couple compatibility output. |
| FTS indexes | `scenes_fts`, `reference_docs_fts` | Generated view | Rebuildable derived search surface | Keep generated/rebuildable, never authority. |
| Project backups | `project-backups/<project_id>/manifest.json`, `canonical.snapshot.json`, `operations.jsonl` | Recovery snapshot plus advisory operation history | Git-reviewable generated artifacts | Keep recovery snapshot; canonical mutations must refresh or document why not. |
| Structure exports | Structure snapshot/export artifacts | Generated view and explicit restore input when invoked | Review/recovery support | Keep generated; not daily-work authority. |
| Async jobs | `async_jobs` plus runtime job state | Runtime operational state | Not project metadata authority | Keep out of manuscript metadata ownership. |

## Current Write-Order Inventory

| Workflow/path | Current write order | Owner risk | Follow-up milestone |
| --- | --- | --- | --- |
| `syncAll` ordinary scene indexing | Reads sidecars/frontmatter/files, writes SQLite, then prunes unseen canonical rows | Filesystem absence can delete canonical state | M2. |
| `update_scene_metadata` | Reads normalized sidecar metadata, writes sidecar, reindexes SQLite, refreshes backup | Sidecar-first and may mirror normalized structural fields | M3. |
| `update_character_sheet` | Reads/writes character sidecar, updates SQLite character rows/traits, refreshes backup | Sidecar-first for canonical character metadata | M4. |
| `update_place_sheet` | Reads/writes place sidecar, updates SQLite place name, refreshes backup | Sidecar-first; associated characters/tags stay sidecar-only | M4. |
| `flag_scene` | Appends sidecar `flags`; no SQLite or backup refresh | Sidecar-only review state | M0/M4 decision required. |
| `upsert_thread_link` | Writes `threads` and `scene_threads` in SQLite, refreshes backup | Mostly aligned; tool name is CRUD-shaped | M4 outcome-oriented replacement/rename guidance. |
| `upsert_reference_link` | Persists sidecar/frontmatter compatibility first, then upserts `reference_links`, refreshes backup | Sidecar-first split before canonical write | M4. |
| `suggest_scene_references` with apply | Uses SQLite/reference context, applies accepted links and refreshes backup | Needs confirmation of SQLite-first/coupled ordering | M4. |
| `enrich_scene_characters_batch` apply | Batch writes sidecar character links, runs `syncAll`, clears stale flags, refreshes backup | Prose-derived enrichment is outcome-oriented but sidecar-first | M4. |
| Scrivener import and direct merge | Creates/updates/relocates sidecars, optional sync indexes SQLite | Valid import compatibility path, risky if treated as daily authority | M1/M5 preserve as special import mode. |
| World/reference sync indexing | Reads world/reference files and metadata, writes SQLite indexes and relationship rows | Mostly indexing; can prune reference docs | M0/M2 for pruning/ownership classification. |
| Structure workflows | Mutate SQLite canonical structure and may update sidecar mirrors/backups | Intended explicit mutation surface | M2/M3 preserve as sanctioned owner. |

## Compatibility Paths To Preserve

- Scrivener External Folder Sync import and direct merge need sidecar-shaped
  inputs while import remains a special mode.
- Frontmatter-to-sidecar auto-migration currently preserves older plain-text
  projects.
- Numeric chapter fields and folder-derived chapter names remain read/import
  compatibility, not mutation authority.
- Reference aliases are used by existing metadata files and should remain
  import/read compatibility until M4 defines canonical write workflows.
- Existing dry-run/apply workflows need reviewable output even if writable
  sidecars are removed; M1 should assign those outputs to review snapshots.

## Schema Gap Decisions Needed Before Behavior Changes

- **Migrate-to-schema candidates:** scene workflow status, scene flags/review
  notes if retained, character tags, place tags, place associated characters,
  and possibly character group.
- **Generated/import-only candidates:** `external_source`, `external_id`,
  sidecar `threads`, legacy reference aliases, numeric chapter fields, and
  folder-derived structure.
- **Deprecated candidates:** sidecar `threads` as daily input, version strings
  as a separate scene field if ordinary tags are sufficient, and sidecar-only
  flags if replaced by review snapshots.
- **Intentionally prose/file-owned candidates:** authored scene prose,
  character/place notes, and reference document bodies.

## M0 Gate Assessment

- Scenes, chapters, epigraphs, threads, characters, places, reference links,
  tags, status fields, and source identifiers now have named current owners.
- Sidecar-shaped fields with no SQLite home are identified and assigned a
  required decision path.
- Prose-derived enrichment and apply/dry-run workflows are represented in the
  write-order inventory.
- The schema-gap suggestions are accepted as the decision basis for M1 snapshot
  design.
- Later behavior-changing milestones should either resolve the unresolved
  schema-gap decisions above or split them into focused follow-up issues before
  changing daily-work mutation paths.

## Evidence

- [src/core/db.js](../../../../src/core/db.js)
- [src/sync/metadata-lint.js](../../../../src/sync/metadata-lint.js)
- [src/sync/sync.js](../../../../src/sync/sync.js)
- [src/tools/metadata.js](../../../../src/tools/metadata.js)
- [src/tools/sync.js](../../../../src/tools/sync.js)
- [src/tools/search.js](../../../../src/tools/search.js)
- [src/tools/reference-link-persistence.js](../../../../src/tools/reference-link-persistence.js)
