# Metadata Architecture & Ownership

**Status:** ✅ Complete (Phase 1-2)

## Overview

Metadata is split into two tiers to balance adoption and flexibility:

1. **Tier 1 (structural, low-friction):** file path hierarchy, scene ordering, word count inferred directly from files. Optional Scrivener standard fields mapped when present (Synopsis → `logline`, Labels → `pov`, Keywords → `tags`).

2. **Tier 2 (editorial, explicit convention):** custom analysis metadata (`characters`, `save_the_cat_beat`, `scene_change`, `causality`, `stakes`, `scene_functions`, `threads`) stored in sidecars and maintained deliberately.

### Guiding Principle: Automate Structure, Preserve Authorship

The service automates what is deterministic and mechanical, and avoids automating what is editorial and interpretive.

- **Automate:** file/path-derived project scope, word counts, checksum/staleness detection, sync reconciliation warnings
- **Do not force:** scene meaning, thematic role, arc membership, causality, stakes, beat interpretation — these remain user-owned

## Design Decision: Sidecar Files (Phase 2)

### The Problem with Frontmatter

Initial implementation stored metadata in YAML headers inside `.md` files. This created two issues:

1. **Fragile co-ownership** — Scrivener owns prose, MCP owns metadata, but both live in the same file with nothing enforcing separation.
2. **Silent path/metadata mismatch** — `part` and `chapter` in metadata must be manually maintained; a file can be in `Part 2/Chapter 3/` while the header says `part: 1, chapter: 1`.

### The Solution: Sidecar Files

```bash
scenes/
  sc-001.md           ← Scrivener owns (prose only, no header)
  sc-001.meta.yaml    ← MCP service owns (metadata only)
```

Scrivener's External Folder Sync only touches `.md`/`.txt` files — it never reads/writes `.meta.yaml`. This gives clean, enforced ownership:
- Scrivener manages prose
- MCP service manages metadata
- Metadata changes are always intentional

### Migration Path (Phase 1 → Phase 2)

Phase 1 continues using frontmatter as a bootstrap source when present. On first Phase 2 sync:
- If no sidecar exists but the `.md` has frontmatter, auto-generate the sidecar from that data
- Frontmatter is never stripped and remains read-only legacy
- The sidecar always wins when both exist

Requirement: `scene_id` must be present in frontmatter or sidecar for a scene to be indexed. Files without `scene_id` are skipped and reported in sync summaries.

### Orphaned Sidecars

If a scene file is deleted in Scrivener, the sidecar is orphaned. On sync, the service detects `.meta.yaml` files with no corresponding `.md` and logs a warning. It does not auto-delete them — that is an explicit user action.

## File Formats

### Scene Format (Prose-First, Optional Legacy Frontmatter)

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

### Character Sheet Format

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

### Place Sheet Format

```markdown
---
place_id: harbor-district
name: The Harbor District
associated_characters: [marcus, elena]
tags: [urban, working-class, recurring]
---

Description, atmosphere, history...
```

## Prose & Metadata Consistency

### Stale Detection on Sync

When `sync()` runs, it compares current prose checksums against stored values. If they differ, it sets `metadata_stale = true` and updates the checksum. It does not auto-re-enrich — that is an explicit step.

### Staleness Enforcement in Tools

Tools that reason against metadata (`find_scenes`, `get_arc`, `get_relationship_arc`) warn the caller if any returned scenes have `metadata_stale = true`. Reasoning against stale metadata produces unreliable results.

### Re-enrichment on Demand

`enrich_scene(scene_id)` is an advisory tool — it re-runs lightweight prose analysis (logline extraction, character name matching) and clears the stale flag. Output is best-effort draft; the user reviews and applies what is useful.

**Design Principle:** Tier 1 metadata is inferred from files and optional source tool fields (for Scrivener: Synopsis/Labels/Keywords). Tier 2 metadata is an explicit MCP convention in sidecars. The service never auto-generates custom metadata for scenes that do not already have it.

### After an Editing Session

1. Call `sync()` to pick up changes written back
2. For substantially changed scenes, optionally call `enrich_scene(scene_id)` to refresh derived fields — review output before accepting
3. Update relationship state via `update_scene_metadata` if character dynamics shifted

## Metadata Write-Back

Tools that modify metadata:
- `update_scene_metadata` — Write Tier 2 fields to scene sidecar (logline, tags, beat, status, etc.)
- `update_character_sheet` — Write character metadata to sidecar
- `update_place_sheet` — Write place metadata to sidecar
- `flag_scene` — Attach continuity/review flag to scene

All metadata writes go to `.meta.yaml` sidecar files only. Scrivener-managed `.md` files are never touched except during prose edits (which use git commits, not sidecar writes).

## Related Sections

- [import-sync.md](../done/import-sync.md) — Syncing and indexing metadata
- [editing.md](../done/editing.md) — Prose changes and staleness
