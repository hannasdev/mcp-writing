# Reference Document Querying

**Status:** ✅ Phase 4A–4D complete; post-Phase-4D follow-up items tracked below

## Motivation

Projects contain world-building notes, research, continuity scratchpads, and style guides in `/world/reference/` and `/Notes/` folders. These are currently file-first (not indexed as entities). Users may want to:
- Search research notes for a specific historical detail
- Find all continuity notes mentioning a character
- Query world-building systems (magic rules, geography, etc.)
- Link scenes to the conceptual documents that inform them
- Follow related reference concepts without forcing everything into flat tags

Example:

- Scene: Sebastian goes through old inventions to manage his need for blood
- Direct reference: Sebastian's struggle for blood replacement
- Direct reference: Vampirism in this universe
- Related from loaded reference: History of vampirism in this universe
- Related from loaded reference: Groups of vampires

The key need is not just searching files by keyword. It is modeling a reference system where scenes can point to the documents that matter, and reference documents can point to related concepts.

## Design Decisions

### Conceptual Model

Reference documents should become first-class indexed entities, similar to scenes and world entities, but optimized for conceptual lookup rather than prose editing.

The model has two primary link types:

1. `scene -> reference`
- expresses that a scene is directly informed by a reference document
- should remain shallow and explicit

2. `reference -> reference`
- expresses conceptual relationships between reference documents
- supports deeper exploration once a relevant reference doc is loaded

This is intentionally different from a keyword-only system. Tags may still help discovery, but links carry the real semantic relationship.

### Why Not Keywords Alone?

Flat keywords are helpful but not reliable enough as the primary model.

Example:
- a document about Sebastian's struggle for blood replacement may be obviously relevant to vampirism
- but if no one remembers to tag it with `vampirism`, keyword search becomes incomplete

Keywords are still useful for:
- broad discovery
- quick filtering
- lightweight search ranking

But they are weak for:
- conceptual grouping
- explicit scene relevance
- long-term maintenance confidence

Decision:
- use explicit links as the source of truth for conceptual relevance
- keep keywords/tags as optional secondary metadata

### What Qualifies as a Reference Document?

Reference docs may include:
- world systems
- continuity notes
- research notes
- lore/history documents
- style/process notes
- conceptual notes tied to one project or shared across a universe

They remain file-backed markdown documents, but gain indexed metadata and relationship support.

### Schema Shape

Minimal initial schema:

```text
reference_docs(
  doc_id,
  project_id,
  universe_id,
  type,
  title,
  summary,
  tags,
  file_path
)

reference_links(
  source_kind,
  source_project_id,
  source_id,
  target_doc_id,
  relation,
  origin
)
```

Suggested `source_kind` values:
- `scene`
- `reference`

Suggested `relation` values:
- `informs`
- `related`
- `history_of`
- `depends_on`
- `see_also`

This should start small. We do not need an elaborate ontology before the feature becomes useful.

### Tool Design

If we add querying, it should be symmetric with prose search:

```text
search_reference(query, type?, tag?)
  - returns matching reference docs by title/summary/tags
  - does not load full content

list_scene_references(scene_id, project_id?)
  - returns direct scene -> reference links only
  - if `scene_id` is ambiguous across projects and `project_id` is omitted, returns a conflict with candidate project IDs

get_reference_doc(doc_id, include_related?)
  - returns reference metadata and optionally one hop of related references

upsert_reference_link(source_kind, source_id, source_project_id?, target_doc_id, relation)
  - creates or updates explicit links
  - requires `source_project_id` when a scene source is ambiguous across projects
```

### Integration with Scenes

When reasoning about a scene, should the AI automatically load related reference docs?

Options:
1. No — AI must explicitly ask for scene references or search references
2. Yes — include reference snippets in `find_scenes` results

Option 1 is safer; Option 2 requires careful token budgeting.

Decision:
- do not automatically include reference content in `find_scenes`
- allow explicit retrieval of direct scene references
- allow deeper reference exploration only when a reference document is loaded

### Graph Safety and Traversal Rules

Reference links may be cyclic.

That is acceptable because conceptual knowledge often forms a graph, not a tree. For example:
- `vampirism in this universe -> groups of vampires`
- `groups of vampires -> vampirism in this universe`

The system should avoid traversal loops, not forbid cyclic authoring.

Rules:
- allow cyclic links in stored data
- reject or warn on self-links only if they prove noisy in practice
- all traversal must track visited nodes
- all traversal must have bounded depth
- default tool responses should be shallow

Default behavior:
- `list_scene_references(scene_id, project_id?)` returns only direct scene links
- `get_reference_doc(doc_id, include_related=true)` returns the doc plus one hop of related references
- no tool should recursively walk the full graph by default

## Implementation Path

1. Define `reference_docs` as indexed entities with lightweight metadata
2. Define `reference_links` for scene-to-reference and reference-to-reference relations
3. Add folder-based type inference (`/world/reference/` -> type 'world', `/Notes/continuity/` -> type 'continuity')
4. Implement lightweight FTS indexing on title, summary, and tags
5. Implement `search_reference(query, type?, tag?)`
6. Implement `list_scene_references(scene_id, project_id?)`
7. Implement `get_reference_doc(doc_id, include_related?)`
8. Add `sync()` support for detecting and indexing reference docs and their links
9. Optionally add authoring helpers for writing/updating links later
10. Persist explicit tool-authored links back to source metadata files (scene sidecars/frontmatter and reference frontmatter) so links survive DB reset/rebuild

Link extraction can start simple:
- frontmatter fields in reference docs for `tags`, `summary`, and related reference IDs
- sidecar metadata or scene metadata field for direct scene reference IDs

Do not require semantic auto-linking in the first version.

## Rollout

- Phase 4A: Reference docs become indexed entities with lightweight search
- Phase 4B: Add explicit scene-to-reference and reference-to-reference links plus query/read tools
- Phase 4C: Durable write-through to source metadata files and final ownership/merge rules
- Phase 4D: Optional helper flows for authoring/suggesting links (implemented)

## Current Implementation Status

Completed (Phase 4A):
- `reference_docs` metadata indexing is implemented
- folder-based type inference is implemented (`/world/reference/`, `/Notes/*`)
- FTS indexing on title/summary/tags is implemented
- `search_reference(query, type?, tag?)` is implemented

Completed (Phase 4B core):
- explicit `reference_links` schema is implemented
- `sync()` now indexes direct scene-to-reference (`informs`) and reference-to-reference (`related`) links from metadata
- `list_scene_references(scene_id, project_id?)` is implemented with project-aware disambiguation
- `get_reference_doc(doc_id, include_related?)` is implemented with one-hop related expansion
- `upsert_reference_link(source_kind, source_id, source_project_id?, target_doc_id, relation)` is implemented for explicit scene/reference link authoring with relation normalization and conflict-safe source resolution
- explicit tool-authored links are preserved across `sync()` via `origin` tracking (`explicit` vs `inferred`)

Completed (Phase 4C durability & merge rules):
- `upsert_reference_link` writes through to source metadata files (scene sidecars + reference frontmatter) so explicit links survive DB reset/rebuild
- deterministic merge precedence implemented: explicit links indexed before inferred links to prevent relation overwrite
- idempotent sync: overlapping source/target pairs preserve explicit relation in single pass
- legacy field canonicalization: all supported explicit-link field variants merged and legacy fields deleted to prevent relation resurrection
- ownership semantics finalized: per-source-kind context (informs for scenes, related for references)
- full test coverage for write-through, rebuild durability, and merge scenarios (v2.17.0)

Completed (Phase 4D suggestion/apply helpers):
- `upsert_reference_link` supports `character` and `place` as `source_kind` values with sidecar write-through for canonical character/place files
- `sync()` indexes character/place explicit reference links with existing explicit-vs-inferred precedence rules
- `suggest_scene_references(scene_id, project_id?, mode?, selected_doc_ids?, max_apply?, min_score?)` is implemented with preview/apply modes
- project isolation hardening is implemented for scene suggestions:
  - successful metadata reads are authoritative (including empty entity lists)
  - join-table fallback is used only when metadata cannot be read/no indexed file path
- suggestion safety hardening is implemented:
  - candidates whose target docs are missing from `reference_docs` are filtered out
  - apply mode deduplicates by `doc_id` with deterministic ordering (one applied relation per doc per call)
  - explicit scene-link index upsert is atomic (transaction/savepoint-safe)

## Phase 4D Design (Implemented)

Authoring and auto-suggestion helpers through entity-based reference linking.

### Phase 4D Design

**New source kinds:** `character` and `place` for reference links

- Extend `upsert_reference_link` tool to support `character` and `place` as `source_kind` values
- Links are persisted to character/place `.meta.yaml` sidecars parallel to scene sidecars
- Write-through helpers: `persistCharacterReferenceLink()`, `persistPlaceReferenceLink()`

**Suggestion mechanism:** `suggest_scene_references(scene_id, project_id?, mode?, selected_doc_ids?, max_apply?, min_score?)`

- Query: Find all characters and places in the scene
- Query: For each character/place, retrieve linked references
- Score references by link count:
  - +1 for each character in the scene with a link to that reference
  - +1 for each place in the scene with a link to that reference
  - Deduplicate on (doc_id, relation) pair; sum scores
- Return candidates sorted by score descending
- Exclude any already-explicit scene → reference links
- Include source attribution (e.g., "linked via character X" or "linked via place Y" or "linked via both")

**Simplified UX modes:**

- `mode: "preview"` (default) returns weighted candidates only
- `mode: "apply"` persists selected/top suggestions as explicit `scene -> reference` links in one call
- `selected_doc_ids` optionally limits which suggested doc IDs are applied
- `max_apply` optionally caps the number of suggestions applied in a single call
- `min_score` optionally filters low-confidence candidates from preview/apply

**Manual linking:** Users can always call `upsert_reference_link` directly

- `upsert_reference_link('scene', scene_id, project_id, target_doc_id, relation)` creates explicit scene links
- Explicit scene links take precedence over any suggestion (not overridden by suggestions)

**Order of operations guidance:**

- Common flow can now be single-step with `suggest_scene_references(..., mode="apply")`
- For manual review/approval, use `suggest_scene_references(..., mode="preview")` then `upsert_reference_link`
- After external file edits (outside tools), run `sync()` before preview/apply to refresh index state

**Sync indexing:** Extend `sync()` to index character/place → reference links

- Index links alongside scene/reference links during sync
- Preserve `origin` tracking (explicit vs inferred from metadata)
- Parallel to existing scene/reference indexing

### Example Scoring

Scene "Sebastian's experiment" contains:
- Character: Sebastian (linked to reference "Vampirism in this universe")
- Character: Mira (linked to reference "Vampirism in this universe")
- Place: Laboratory (linked to reference "Alchemy in Sebastian's world")
- Place: Laboratory (linked to reference "Vampirism in this universe")

Suggestion scores:
- "Vampirism in this universe": score 3 (Sebastian, Mira, Laboratory all link to it)
- "Alchemy in Sebastian's world": score 1 (Laboratory links to it)

Phase 4C Completion Notes (v2.17.0):
✅ Explicit links survive full DB reset/rebuild from source files via write-through.
✅ Sync is idempotent: deterministic explicit-first ordering prevents relation overwrite.
✅ Conflicts surfaced as structured errors with actionable details.
✅ Full test coverage: write-through, rebuild durability, legacy field canonicalization, precedence ordering.

## Validation and Test Strategy

Unit tests:
- reference doc parsing and type inference
- link validation and relation normalization
- cycle-safe traversal with visited-node tracking
- bounded expansion depth

Integration tests:
- `sync()` indexes reference docs and links correctly
- `search_reference()` returns lightweight results without loading full content
- `list_scene_references(scene_id, project_id?)` returns only direct scene links
- `get_reference_doc(doc_id, include_related=true)` returns one-hop related references without looping
- explicit links authored via tools remain present after `sync()`
- project-aware disambiguation is covered for duplicated `scene_id` values across projects

Behavioral guardrails:
- no automatic deep expansion in scene query tools
- missing target docs should produce warnings, not crashes
- cyclic links must not cause repeated or recursive output

## Follow-up Backlog (Post-Phase-4D candidates)

- Authoring UX beyond preview/apply remains open (for example, structured approval and batch-confirmation flows)
- No secondary suggestion model based on keyword overlap or mention heuristics (entity-link aggregation is implemented)
- Deferred feature: reference-document "logline-like" summaries as explicit metadata fields
- Open design for deferred feature: summaries may be handwritten by users or generated/suggested and then user-edited
- Bulk link editing workflows (especially cross-project scenarios) not yet scoped
- Cross-project/shared-universe ownership enforcement may need refinement once used on larger series projects

## Issue Tracking

- No dedicated follow-up issue exists yet for most post-Phase-4D backlog bullets.
- Potentially related (partial overlap): https://github.com/hannasdev/mcp-writing/issues/155
- Recommendation: open one issue per backlog bullet when the item is pulled into active planning.

## Resolved Items

✅ Explicit links round-trip into source metadata files for DB rebuild durability (Phase 4C, v2.17.0)
✅ Schema tracking `source_project_id` and `origin` for scoping and inferred/explicit preservation (implemented in Phase 4B+4C)

## Related

- [import-sync.md](../done/import-sync.md) — World folder structure
- [search-analysis.md](../done/search-analysis.md) — Current search capabilities
