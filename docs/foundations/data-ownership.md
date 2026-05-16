# Data Ownership

**Status:** Design reference

This document applies the [Managed Structure Contract](./managed-structure-contract.md) to the repository's current file shapes and tool behaviors.
Use it when you need a concrete answer to "who is allowed to write this artifact, and through what path?"

## Purpose

The goal is not to bless file editing as the primary interface.
The goal is to clarify present-day ownership boundaries so humans, AI agents, import workflows, and maintenance workflows do not work against each other.

This document is intentionally operational:
- the Managed Structure Contract defines the high-level doctrine
- this document maps that doctrine onto today's prose files, sidecars, world docs, generated docs, and import flows

## Ownership Model

Ownership is determined first by artifact class, then by workflow.

| Artifact class | Examples | Primary writer | Normal write path |
| --- | --- | --- | --- |
| Authored prose | `scenes/**/*.md`, epigraph prose, world prose notes | Human author or sanctioned prose workflow | Direct prose editing where supported, or source-tool re-import |
| Canonical structure and metadata | Scene/chapter links, IDs, ordering, structured sidecar fields | MCP workflows | Named MCP operations with validation |
| Derived state | SQLite indexes, generated tool docs, reports, bundles | System tooling | Regeneration only |
| Migration inputs | Scrivener exports, `.scriv` bundles, legacy layouts | External source systems | Import/merge workflows only |

## Current Repository Boundaries

### `scenes/**/*.md`

These files are authored prose, but their writer depends on the workflow in use.

- In Scrivener-imported projects, the effective writer is Scrivener plus the import workflow.
- In direct prose-editing workflows, the effective writer may be a sanctioned MCP prose-edit path.
- These files should not be treated as safe structural mutation surfaces.

Current behavior:
- Scrivener re-import can overwrite scene prose.
- `sync` reads prose and updates indexes, but does not rewrite prose.
- Prose typography and Unicode punctuation are part of the authored manuscript, not normalization errors.

Rule:
- treat prose as authorial content
- do not encode structural decisions in prose files when a metadata or MCP path exists

### `scenes/**/*.meta.yaml`

These files currently mix several concerns:
- stable identifiers and import linkage
- structural metadata
- analytical/editorial metadata

They are not all equally writable.

**Importer-authoritative fields**
- `scene_id`
- `external_source`
- `external_id`
- `title`
- `timeline_position`
- `save_the_cat_beat` where sourced from import conventions

**MCP-managed fields**
- structured scene metadata such as `logline`, `status`, `tags`, `characters`, `places`, `pov`, `story_time`, `notes`, `flags`
- chapter and part linkage should be treated as canonical structural state, even where compatibility fields still exist today

Current behavior:
- import spreads existing sidecar data first, then rewrites the importer-owned fields
- edits to importer-owned fields can be reverted on re-import
- `sync` may read and index sidecars, but should not silently redefine canonical structure outside explicit workflows

Rule:
- use sanctioned MCP workflows for structured metadata changes
- do not rely on direct sidecar edits as the preferred mutation path for AI agents
- treat direct sidecar editing as an implementation detail or repair path, not the product contract

### `world/**`

`world/` is not import-managed by Scrivener, but that does **not** make it a free-for-all control plane.

There are two different kinds of content here:

**Authored prose/reference content**
- `world/characters/<slug>/sheet.md`
- `world/characters/<slug>/*.md`
- `world/places/<slug>/sheet.md`
- `world/reference/**/*.md`

This content is human-meaningful and may be edited as content.

**Structured metadata**
- `world/characters/<slug>/sheet.meta.yaml`
- `world/places/<slug>/sheet.meta.yaml`

This content should follow MCP ownership rules because it encodes structured state consumed by tools.

Rule:
- prose/reference files in `world/` are authored content
- metadata sidecars in `world/` are structured state and should prefer MCP mutation paths
- "not touched by Scrivener" does not mean "safe for arbitrary structural patching by AI"

### Generated and indexed artifacts

Examples:
- SQLite state
- generated docs such as `docs/agents/tools.md`
- review bundles
- reports, diagnostics, outlines, and indexes

These are derived artifacts.
They are valuable for transparency, but they should not become competing authorities.

Rule:
- regenerate them from canonical state
- do not hand-edit them as a normal workflow
- maintenance workflows may freely rebuild them

### Import sources

Examples:
- Scrivener External Folder Sync exports
- `.scriv` project bundles
- legacy folder layouts and naming conventions

These are migration inputs, not long-term control surfaces.

Rule:
- setup/import workflows may infer from them cautiously
- once imported, daily structural changes should move to sanctioned MCP operations

## Workflow View

### Setup and import

Allowed:
- read migration inputs
- create or reconcile prose and sidecars
- preserve or derive stable IDs
- warn on ambiguous mappings

Not allowed:
- silently bless ambiguous structure as canonical without an explicit import workflow result

### Daily work

Allowed:
- edit prose through supported authoring paths
- update structured metadata through MCP workflows
- inspect files and generated views

Not allowed:
- treat sidecar or folder edits as the preferred AI path for structural mutation when an MCP tool exists

### Maintenance and repair

Allowed:
- lint, diagnose, and regenerate derived state
- run explicit repair workflows

Not allowed:
- hide canonical drift by silently patching structural state as a side effect of inspection

## Practical Rules

1. If a change affects identity, ordering, membership, or structured relationships, prefer MCP workflows.
2. If a change affects authored prose, use the supported prose workflow for that project mode.
3. If a file is generated, regenerate it instead of editing it.
4. If an import owns a field, assume re-import may overwrite local edits to that field.
5. If no sanctioned structural workflow exists, surface that gap instead of improvising a direct AI file edit.

## Relationship to Existing Docs

- [Managed Structure Contract](./managed-structure-contract.md) is the governing doctrine.
- [Setup Guide](../setup.md) explains how these boundaries show up during first-time setup and Scrivener import.
- Metadata and import initiative docs record how the current behavior evolved, but this document defines the present ownership interpretation.

## Related

- [Managed Structure Contract](./managed-structure-contract.md)
- [Setup Guide](../setup.md)
- [Product Overview](../../PRODUCT.md)
- [Metadata Architecture & Ownership](../initiatives/done/metadata-architecture/prd.md)
- [Import & Sync Operations](../initiatives/done/import-sync/prd.md)
