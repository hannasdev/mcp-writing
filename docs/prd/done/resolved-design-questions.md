# Resolved Design Questions

Questions that were raised during development and have been settled. Kept for reference.

---

## A. Enrichment Model

**Q:** Which model runs the enrichment pass?

**A:** `enrich_scene` uses deterministic heuristics only (first-sentence logline, character name matching). No model call. Advisory output; user reviews before accepting.

---

## B. Write-Back Safety for Metadata

**Q:** When the AI calls `update_scene_metadata`, it modifies the sync file. Scrivener will pick up that change on next sync. Is that acceptable, or should metadata writes go to a separate sidecar?

**A:** Sidecar files (`.meta.yaml`). The service writes only to sidecar files; Scrivener-managed `.md` files are never touched except during `commit_edit` prose writes.

---

## D. Database Inclusion Policy

**Q:** What should be entities vs file-first?

**A:** Entities require repeated cross-book queries or stable identifiers. Scenes, characters, places, threads are entities. Editorial guidance, feedback, and process notes remain file-first.

---

## Related

- [done/metadata.md](metadata.md)
- [done/import-sync.md](import-sync.md)
- [done/editing.md](editing.md)
