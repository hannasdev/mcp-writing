# Data Ownership Model

Two separate rulesets apply depending on whether a file lives under `scenes/` (import-managed) or `world/` (human/agent-managed). Mixing writers outside these rules risks silent data loss.

## scenes/ — import-managed files

The importer is the authoritative writer for Scrivener-imported prose; any edits to `scenes/**/*.md` (manual or via tools) will be overwritten on re-import. Sidecars are shared but with clearly partitioned fields.

| File | Writer | Fields written | Behavior on re-import |
|---|---|---|---|
| `scenes/**/*.md` | **Scrivener / importer** | Full prose content | **Unconditionally overwritten.** Never edit `.md` files directly — changes will be lost on the next import. |
| `scenes/**/*.meta.yaml` | **Importer** (Scrivener fields) + **AI agent** (enrichment fields) | Importer writes: `scene_id`, `external_source`, `external_id` (always); `title`, `timeline_position`, `save_the_cat_beat` (from Scrivener metadata, also writable by agents via `update_scene_metadata`) | Importer spreads existing sidecar first, then overlays only its fields. All other fields (logline, status, tags, characters, notes, flags, …) are preserved across re-imports. |

**Rule:** write AI-side fields via the appropriate tool — never touch the Scrivener-controlled fields manually or the importer will overwrite them.
- `update_scene_metadata` supports: `logline`, `status`, `tags`, `characters`, `places`, `pov`, `part`, `chapter`, `timeline_position`, `story_time`, `save_the_cat_beat`, `title`.
- `flag_scene` appends accumulating continuity/review notes (free-text `flags` list).
- `enrich_scene` re-derives lightweight metadata from the current prose and clears staleness.
- `metadata_stale` is a SQLite-only flag set automatically by sync when prose changes — it is not a sidecar field and cannot be written by tools.

## sync — read-only with respect to files

`sync` reads files and writes only to SQLite. It never touches `.md` prose. The one exception is auto-migration: if a `.md` file has YAML frontmatter but no sidecar yet, sync will create the `.meta.yaml` from the frontmatter (one-time, non-destructive). After that, the sidecar is the source of truth and frontmatter is ignored.

| Operation | Reads | Writes |
|---|---|---|
| Indexing pass | `scenes/**/*.md`, `scenes/**/*.meta.yaml`, `world/**/*.md`, `world/**/*.meta.yaml` | SQLite only |
| Frontmatter auto-migration | Any `.md`/`.txt` file (frontmatter block) | Corresponding `.meta.yaml` (created once if missing, for any file type including `world/**`) |

`sync` never overwrites an existing sidecar and never touches a `.md` prose file.

## world/ — human/agent-managed files

The importer never reads or writes anything under `world/`. These files are fully owned by humans and the AI agent and are safe to edit at any time without import risk.

| File | Writer | Description |
|---|---|---|
| `world/characters/<slug>/sheet.md` | **Human** (after creation) | Canonical character sheet prose. `create_character_sheet` writes this file once on first setup; after that it is human-owned and no tool modifies it. |
| `world/characters/<slug>/*.md` | **Human or AI agent** | Arc notes, relationship docs, history. Add and edit freely. |
| `world/characters/<slug>/sheet.meta.yaml` | **AI agent** | Character metadata (`name`, `role`, `arc_summary`, `first_appearance`, `traits`). Written by `create_character_sheet`, `update_character_sheet`. |
| `world/places/<slug>/sheet.md` | **Human** (after creation) | Canonical place sheet prose. `create_place_sheet` writes this file once on first setup; after that it is human-owned and no tool modifies it. |
| `world/places/<slug>/sheet.meta.yaml` | **AI agent** | Place metadata (`name`, `associated_characters`, `tags`). Written by `create_place_sheet`, `update_place_sheet`. |
| `world/reference/**/*.md` | **Human** | Free-form reference notes (world rules, timelines, etc.). Never indexed as entities. |

**Rule:** all character and place changes that should survive forever — backstory, relationships, traits, arc notes — belong in `world/`. This content is never at risk from a Scrivener re-import.

## Summary

| What you want to change | Where to make the change |
|---|---|
| Prose wording | Scrivener → re-import |
| Scene logline, status, tags, beat analysis | `scenes/*.meta.yaml` via AI tools |
| Character traits, backstory, relationships | `world/characters/<slug>/` files |
| Place descriptions and lore | `world/places/<slug>/` files |
| Shared world rules, timelines, reference | `world/reference/` files |
