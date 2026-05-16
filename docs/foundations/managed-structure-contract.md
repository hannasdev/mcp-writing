# Managed Structure Contract

**Status:** Design reference

This document defines boundaries for structural manuscript state.
Use it as an arbiter when deciding whether a workflow should mutate files directly, call MCP tools, generate read-only projections, or run as an import/repair path.

## Core Boundary

The manuscript is a structured domain model with prose attachments, not a folder tree with metadata attached.

Folders, files, generated reports, Scrivener sync output, and review bundles are representations of the manuscript.
They may be useful, inspectable, portable, and Git-friendly, but they should not silently become the domain model.

## Principles

1. **One trusted mutation path**
   Structural state must be changed through sanctioned MCP workflows.
   This includes chapters, divisions, epigraphs, scene membership, ordering, identities, and metadata relationships.
   The rule applies to both human users and AI agents.

2. **Prose is different from structure**
   Prose is authored text and may remain directly inspectable and editable where the workflow supports it.
   Structure encodes invariants and relationships, so it needs validation, commands, and guardrails.

3. **The filesystem is a representation, not the control plane**
   The sync tree is useful for storage, portability, Git history, and inspection.
   It should not be treated as the primary UI or API for structural changes.

4. **Generated transparency, not generated authority**
   Outlines, chapter indexes, diagnostics, reports, and exports are valuable read models.
   They can explain the project, but they must not become competing sources of truth.

5. **Import is a special mode**
   Setup and import may infer structure from Scrivener folders, legacy metadata, or file layout because they are translating from an existing reality.
   That inference must be conservative, diagnosable, and explicitly committed into canonical state.

6. **Daily work should be explicit**
   Once a project is under MCP management, structural changes should happen through named operations such as rename chapter, move scene, add epigraph, reorder chapter, or assign division.

7. **Maintenance observes broadly and repairs deliberately**
   Lint, sync, and diagnostics may inspect everything and regenerate derived state.
   They should not silently mutate canonical structure unless running an explicit repair workflow.

8. **Do not promote a view into the model**
   Human-readable folder names, numeric chapter labels, and Scrivener ordering can be useful views or migration hints.
   They should not be long-term identity, ordering, or relationship authority once the domain model has first-class concepts.

## Artifact Classes

| Class | Examples | Write Rule |
| --- | --- | --- |
| Authored prose | Scene text, epigraph text | Editable through supported prose workflows |
| Canonical structure | IDs, order, chapter links, division links | MCP-only mutation |
| Derived views | Outline, chapter index, reports, bundles, search index | Regenerated from canonical state |
| Migration inputs | Legacy folders, Scrivener markers, numeric chapters | Interpreted during setup/import only |

## Workflow Zones

### Setup and Import

Setup and import workflows may interpret existing material because the system is translating from a less controlled source into canonical state.

Allowed:
- infer cautiously from explicit folders, source-tool structure, and legacy metadata
- produce diagnostics for ambiguous or refused mappings
- generate stable canonical identities
- present a reviewable summary before committing structure

Boundaries:
- ambiguous mappings should warn, leave links null, or fail strict mode
- inferred structure should become canonical only through an explicit import workflow
- import conventions should not become permanent daily-work mutation paths by accident

### Working on the Project

Daily project work should make structure changes through explicit MCP operations.
The human user expresses intent, the AI resolves targets when needed, and the MCP validates and writes canonical state.

Allowed:
- read canonical state, prose, and generated views
- edit prose through supported prose workflows
- mutate structure through named operations
- generate review bundles, outlines, diagnostics, and reports

Boundaries:
- AI agents should not directly patch structural files when an MCP workflow exists
- if no sanctioned operation exists, surface the missing workflow instead of improvising a structural file edit
- generated views may aid review, but editing them must not change canonical structure

### Ongoing Maintenance

Maintenance workflows keep the project understandable and coherent over time.
They may inspect broadly, but canonical repair should remain deliberate.

Allowed:
- lint structure and metadata
- detect stale or inconsistent derived state
- regenerate derived views and indexes
- propose or run explicit repair workflows

Boundaries:
- lint should report canonical drift instead of hiding it through silent mutation
- auto-repair should be limited to derived/cache/index state unless explicitly invoked as a canonical repair operation
- maintenance tools should distinguish observation, regeneration, and mutation in their output

## Decision Test

When adding or changing a workflow, ask:

1. What artifact class is this touching?
2. Is this setup/import, daily work, or maintenance?
3. Is the operation reading, generating, or mutating?
4. If it mutates structure, what sanctioned MCP command owns it?
5. If no command exists, is that a product gap rather than something an AI agent should patch directly?

## Relationship to Current Design

This contract refines existing ownership principles:

- Scrivener-managed prose and MCP-managed metadata remain separate ownership domains.
- Stable identities remain more important than visible file names or ordering prefixes.
- Folder structure may still be useful for source import, migration, inspection, and generated views.
- Future chapter, epigraph, and division work should avoid coupling durable identity to human-readable filesystem presentation.

## Related

- [Product Overview](../../PRODUCT.md)
- [Data Ownership](./data-ownership.md)
- [Chapter Structure Follow-up](../initiatives/backlog/chapter-structure/prd.md)
- [Metadata Architecture & Ownership](../initiatives/done/metadata-architecture/prd.md)
- [Import & Sync Operations](../initiatives/done/import-sync/prd.md)
