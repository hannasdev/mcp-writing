# Divisions

## Status

Deferred backlog follow-up.

Chapter and epigraph structure is complete and tracked in [Chapter and Epigraph Structure](../../done/chapter-structure/prd.md).
This initiative captures the remaining larger-section work that was extracted from the completed chapter-structure initiative.

## Problem

Books may use Parts, Acts, or other major section conventions above chapters.
Today, chapters are canonical and ordered, but there is no first-class parent container for grouping chapters into larger narrative sections.

Without first-class divisions, future support for Parts or Acts would risk reusing folder names, numeric labels, or generated views as structural authority.

## User Value

- Authors can organize chapters into Parts, Acts, or other named sections without changing chapter identity.
- Review bundles and outlines can optionally group chapters by larger narrative structure.
- Future reordering can treat division order and chapter order as explicit, validated structure.
- AI agents can reason about larger manuscript sections without inferring them from folder paths.

## Scope

### In Scope

- Add project-scoped `divisions` as optional parent containers above chapters.
- Support division type/label values such as Part or Act.
- Allow chapters to reference a nullable `division_id`.
- Define deterministic ordering for divisions and chapters within divisions.
- Update read surfaces only where division grouping is explicitly useful.
- Keep chapters fully usable without divisions.

### Out of Scope

- Reopening chapter identity, epigraph placement, or numeric chapter compatibility policy.
- Making divisions required for existing chapter-only projects.
- Treating folder hierarchy as durable division authority during daily work.

## Architecture Alignment

Use [Managed Structure Contract](../../../foundations/managed-structure-contract.md) as the design arbiter.

- Division identity and order are canonical structure and must mutate through sanctioned MCP workflows.
- Folder or Scrivener section names may be import hints, not daily-work authority.
- Generated outlines and bundles may show division grouping, but editing those outputs must not change canonical structure.
- Numeric or human-readable labels are presentation/compatibility data, not durable identity.

## Acceptance Criteria

1. Divisions are represented as project-scoped canonical entities.
2. Chapters can optionally reference `division_id`.
3. Division order and chapter order compose deterministically.
4. Chapter listing and chapter-scoped workflows remain stable when no divisions exist.
5. Rendering and bundle workflows support division grouping only where intentionally requested or useful.
6. Diagnostics detect invalid chapter-to-division references and duplicate division ordering.
7. Import/setup behavior treats inferred divisions conservatively and reports ambiguity.

## Test Strategy

- Unit: division schema, project-scoped division identity, chapter-to-division references, duplicate ordering validation, and invalid references.
- Integration: chapter listing, diagnostics, rendering, and bundles with no divisions, with Parts, and with Acts.

## Related

- [Chapter and Epigraph Structure](../../done/chapter-structure/prd.md)
- [Managed Structure Contract](../../../foundations/managed-structure-contract.md)
- [Conceptual Target Architecture](../../../foundations/target-architecture.md)
