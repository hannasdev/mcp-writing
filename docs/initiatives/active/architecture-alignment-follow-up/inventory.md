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
| Scene identity and core metadata | `scenes.scene_id`, `project_id`, `title`, `pov`, `logline`, `scene_change`, `causality`, `stakes`, `scene_functions`, `save_the_cat_beat`, `story_time`, `word_count`, `metadata_stale` | SQLite-canonical after sync/tool writes | Sidecar/frontmatter remains compatibility input | Keep SQLite-canonical; M3 preserves structural compatibility fields during generic metadata writes. |
| Scene structural placement | `scenes.chapter_id`, `scene_role`, `part`, `chapter`, `chapter_title`, `timeline_position`; `chapters` | SQLite-canonical | Folder names and numeric chapter fields are compatibility hints/read aliases | Keep SQLite-canonical; M2/M3 preserve structure unless explicit workflows mutate it. |
| Scene prose | Markdown/text scene files | Prose-authored | Sync computes checksum and stale state | Keep prose-authored and file-based. |
| Scene workflow status | Accepted by scene sidecar schema and `update_scene_metadata`; no SQLite column | Sidecar-only today | Retained compatibility/review metadata | M5 documents status as compatibility/review metadata until a future schema migration or deprecation decision promotes or removes it. |
| Scene source identifiers | `external_source`, `external_id` accepted by scene sidecar schema; Scrivener import/merge uses them | Import-only compatibility input today | Scrivener/import reconciliation | Mark import-only unless a future provenance model adds SQLite columns. |
| Scene flags/review notes | `flag_scene` appends `flags` to sidecar; not in lint schema or SQLite | Sidecar-only today | Review note scratchpad | M5 documents flags as retained compatibility/review notes, not canonical relationship authority; future schema migration or deprecation remains follow-up scope. |
| Scene characters | `scene_characters`; populated by sync from sidecar, by `connect_character_place_evidence`, and by enrichment apply/sync | SQLite-canonical index; active scene-backed association writes are SQLite-first except retained prose-derived batch repair | Sidecar `characters` is compatibility input/output and retained batch repair output | M4 adds `connect_character_place_evidence`; batch enrichment now documents sidecar output as compatibility before sync-index repair. |
| Scene places | `scene_places`; populated by sync from sidecar and by `connect_character_place_evidence` | SQLite-canonical index; active scene-backed association writes are SQLite-first | Sidecar `places` is compatibility input/output | M5 documents sidecar `places` as compatibility input/output; active scene-backed association work should use `connect_character_place_evidence`. |
| Scene tags | `scene_tags`; populated by sync from sidecar `tags` and `versions` | SQLite-canonical search index; generic tag writes remain retained metadata compatibility | Sidecar `tags` is compatibility input/output for search keywords | M4 does not promote tags to relationship authority; schema/semantics decision remains future scope. |
| Scene versions | Sidecar `versions`; indexed into `scene_tags`; legacy script splits version markers out of characters | Generated/import compatibility today | Search keyword continuity and legacy cleanup | M5 documents versions as compatibility metadata; future work can decide whether to promote them, fold them into ordinary tags, or deprecate import cleanup. |
| Threads and scene-thread beats | `threads`, `scene_threads`; `upsert_thread_link` writes SQLite-first | SQLite-canonical | Sidecar `threads` is lint-accepted but not active authority | Keep SQLite-canonical; treat sidecar `threads` as deprecated/import-only unless M4 defines migration. |
| Chapters | `chapters` | SQLite-canonical | Folder-derived structure can seed or diagnose | Keep SQLite-canonical. |
| Epigraphs | `epigraphs`, `epigraph_characters`, `epigraph_tags` | SQLite-canonical for indexed metadata; prose body file-based | Epigraph metadata/frontmatter and folder placement are compatibility input | Keep SQLite-canonical for placement/relationships; prose remains file-based. |
| Characters | `characters`, `character_traits`; sheet files plus sidecars | SQLite-canonical for indexed fields and traits; sidecars are compatibility input/output | Character sidecars seed import/sync and are refreshed as generated compatibility output after profile updates | M4 reorders `update_character_sheet` to commit SQLite first and refresh compatibility output after backup. |
| Character group | Accepted by character sidecar schema; no SQLite column | Sidecar-only today | Potential organization metadata | Needs decision: migrate-to-schema, deprecate, or intentionally prose/file-owned. |
| Character tags | Accepted by character sidecar schema; no SQLite table | Sidecar-only today | Compatibility/review note surfaced by `audit_relationship_metadata` | M4 classifies as non-authoritative compatibility/review notes; migrate/deprecate decision remains future scope. |
| Character prose notes | `sheet.md` and adjacent support notes | Prose-authored | Search/detail tools read notes on demand | Keep prose-authored and file-based. |
| Character relationships | `character_relationships`; `record_character_relationship_beat` writes relationship beats with scene evidence | SQLite-canonical | Public workflow hides table shape from callers | M4 adds outcome-level mutation surface and backup refresh. |
| Places | `places`; sheet files plus sidecars | SQLite-canonical for indexed name; sidecars are compatibility input/output and retained review notes | Place sidecars seed import/sync and are refreshed as compatibility output | M4 reorders canonical place-name updates SQLite-first; relationship fields remain review notes unless backed by scene evidence. |
| Place associated characters | Accepted/read from place sidecar; scene-backed authority is `scene_characters` + `scene_places` through `connect_character_place_evidence` | Sidecar-only review note unless connected through scene evidence | Place detail output and audit diagnostic | M5 documents retained sidecar values as compatibility/review notes; scene-backed authority uses `connect_character_place_evidence`, and schema migration remains future scope. |
| Place tags | Accepted/read from place sidecar; no SQLite table | Sidecar-only today | Compatibility/review note surfaced by `audit_relationship_metadata` | M4 classifies as non-authoritative compatibility/review notes; migrate/deprecate decision remains future scope. |
| Reference docs | `reference_docs`, `reference_doc_tags`, `reference_docs_fts` | SQLite-canonical index over file-authored docs | Reference file frontmatter seeds index | Keep SQLite-canonical index; source doc prose remains file-based. |
| Reference links | `reference_links` with `origin`; sidecar/frontmatter aliases `reference_ids`, `references`, `related_reference_ids`, `related_references`, `related_docs`, `related`, `reference_links`, `explicit_reference_links`, `related_reference_links` | SQLite-canonical target state; `link_reference_evidence` and apply workflows commit SQLite first | Legacy aliases and generated compatibility output | M4 makes explicit/apply workflows SQLite-first and treats sidecar/frontmatter refresh as compatibility output. |
| FTS indexes | `scenes_fts`, `reference_docs_fts` | Generated view | Rebuildable derived search surface | Keep generated/rebuildable, never authority. |
| Project backups | `project-backups/<project_id>/manifest.json`, `canonical.snapshot.json`, `operations.jsonl` | Recovery snapshot plus advisory operation history | Git-reviewable generated artifacts | Keep recovery snapshot; canonical mutations must refresh or document why not. |
| Structure exports | Structure snapshot/export artifacts | Generated view and explicit restore input when invoked | Review/recovery support | Keep generated; not daily-work authority. |
| Async jobs | `async_jobs` plus runtime job state | Runtime operational state | Not project metadata authority | Keep out of manuscript metadata ownership. |

## Current Write-Order Inventory

| Workflow/path | Current write order | Owner risk | Follow-up milestone |
| --- | --- | --- | --- |
| `syncAll` ordinary scene indexing | Reads sidecars/frontmatter/files, writes SQLite, then prunes unseen canonical rows | Filesystem absence can delete canonical state | M2. |
| `update_scene_metadata` | Reads raw source sidecar metadata for writes, writes only requested non-structural fields, reindexes SQLite with normalized metadata, refreshes backup | Sidecar compatibility write remains, but path-derived structure is not mirrored by generic updates | M3 accepted. |
| `update_character_sheet` | Validates request, commits SQLite character rows/traits, refreshes backup, then refreshes character sidecar compatibility output | Compatibility output failure is diagnostic after canonical commit | M4 implemented. |
| `update_place_sheet` | Place `name` commits SQLite-first and refreshes backup; `associated_characters`/`tags` refresh retained compatibility review metadata only | Relationship fields are explicitly non-canonical unless backed by scene evidence | M4 implemented, broad migration deferred. |
| `flag_scene` | Appends sidecar `flags`; no SQLite or backup refresh | Explicitly classified as non-canonical review metadata | M4 implemented; migration/deprecation deferred. |
| `track_thread_arc` / `upsert_thread_link` | Writes `threads` and `scene_threads` in SQLite, refreshes backup | Outcome name added; compatibility alias retained | M4 implemented. |
| `connect_character_place_evidence` | Writes `scene_characters` and `scene_places` in SQLite, refreshes backup, then refreshes scene sidecar compatibility output | Scene-backed character/place association is SQLite-first | M4 implemented. |
| `record_character_relationship_beat` | Writes `character_relationships` in SQLite, refreshes backup | Character relationship beats have no sidecar compatibility output | M4 implemented. |
| `audit_relationship_metadata` | Reads SQLite and sidecar metadata without mutation | Durable audit/repair guidance for stale indexes and retained compatibility notes | M4 implemented. |
| `link_reference_evidence` / `upsert_reference_link` | Validates compatibility target, commits `reference_links` in SQLite, refreshes backup, then refreshes sidecar/frontmatter compatibility output | Compatibility output failure is diagnostic after canonical commit | M4 implemented. |
| `suggest_scene_references` with apply | Uses SQLite/reference context, commits accepted links in SQLite transaction, refreshes backup, then refreshes compatibility output | Apply workflow is SQLite-first with compatibility diagnostics | M4 implemented. |
| `enrich_scene_characters_batch` apply | Prose inference writes retained scene sidecar character compatibility output, runs `syncAll` to refresh SQLite `scene_characters`, clears stale flags, refreshes backup | Retained prose-derived repair path is explicitly classified as compatibility output plus sync-index repair, not general relationship authority | M4 documented; full direct SQLite batch migration deferred. |
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

## Schema Gap Decisions And Migration Posture

- **Migrate-to-schema candidates:** scene workflow status, scene flags/review
  notes if retained, character tags, place tags, place associated characters,
  and possibly character group. M5 documents these as retained
  compatibility/review metadata unless a scene-backed relationship workflow
  writes SQLite evidence.
- **Generated/import-only candidates:** `external_source`, `external_id`,
  sidecar `threads`, legacy reference aliases, numeric chapter fields, and
  folder-derived structure.
- **Deprecated candidates:** sidecar `threads` as daily input, version strings
  as a separate scene field if ordinary tags are sufficient, and sidecar-only
  flags if replaced by review snapshots. M5 does not remove these paths; it
  names their compatibility role so removal or schema promotion can be planned
  separately.
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
