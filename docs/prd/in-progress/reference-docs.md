# Reference Document Querying

**Status:** 🚧 In progress (Phase 4A shipped; Phase 4B core shipped; durability follow-up remains)

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
- Phase 4D: Optional helper flows for authoring/suggesting links

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

Remaining (Phase 4C durability/policy follow-up):
- `upsert_reference_link` should write through to source metadata files so explicit links are not lost on DB reset/rebuild
- define merge rules between inferred links from files and explicit tool-authored links when both exist for the same source/target
- finalize ownership semantics for cross-project/shared-universe reference documents

## Next Implementation Slice (Phase 4C)

1. Persist explicit links to source metadata files.

- Scene sources: write explicit links to scene sidecar/frontmatter `reference_ids` (or canonical replacement field).
- Reference sources: write explicit links to reference frontmatter `related_reference_ids` (or canonical replacement field).

1. Define deterministic merge precedence during sync.

- Source of truth order: explicit tool-authored metadata > inferred metadata links from files.
- Preserve explicit relation labels where possible when source/target already exists.

1. Finalize shared ownership rules.

- Define who can write links for shared reference docs across projects in the same universe.
- Define conflict behavior when `source_project_id` does not match ownership policy.

Minimum acceptance criteria for Phase 4C:
- Explicit links survive full DB reset/rebuild from source files.
- Sync is idempotent when explicit and inferred links coexist.
- Conflicts are surfaced as structured tool errors (`CONFLICT`/`VALIDATION_ERROR`) with actionable details.
- Integration tests cover scene-source and reference-source write-through plus rebuild durability.

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

## Known Gaps

- No finalized authoring UX for creating links inside markdown/sidecars yet
- Explicit tool-authored links are not yet guaranteed to round-trip into source metadata files for DB rebuild durability
- The PRD schema example is intentionally minimal; the live implementation also tracks `source_project_id` and `origin` for scoping and inferred/explicit preservation
- No auto-suggestion flow for likely scene references yet
- No decision yet on whether summaries are handwritten only or can be inferred from content
- Cross-project/shared-universe reference ownership rules may need refinement once used on larger series projects

## Related

- [import-sync.md](../done/import-sync.md) — World folder structure
- [search-analysis.md](../done/search-analysis.md) — Current search capabilities
