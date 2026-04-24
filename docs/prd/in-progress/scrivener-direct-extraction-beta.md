# Scrivener Direct Extraction (Beta)

**Status:** 🚧 In Progress (Beta track)

## Goal

Introduce an official Scrivener-project extraction path that reads from `.scriv`/`.scrivx` internals to enrich scene metadata beyond what External Folder Sync text exports provide.

This is intentionally separate from the existing sync-folder importer. The sync-folder path remains the stable default.

## Why This Is Separate

Scrivener has two integration surfaces with different stability properties:

1. **External Folder Sync output (plain `.txt`/`.md`)**
   - Stable and version-resilient
   - Lower metadata fidelity

2. **Internal project structure (`.scriv` bundle, `.scrivx`, nested data files)**
   - Rich metadata fidelity
   - Potentially fragile across Scrivener version/schema changes

Because internal schema may change, direct extraction is an opt-in beta feature, not a replacement for the stable import path.

## Product Positioning

- Stable/default path: `import_scrivener_sync` from External Folder Sync text files
- Beta/opt-in path: Scrivener direct extraction
- Both paths coexist during beta, with clear user-facing stability labels

## Existing Functionality Baseline

### Stable Today

- `import_scrivener_sync` imports Draft sync files and reconciles by stable binder ID
- Sidecars preserve non-importer fields across re-imports
- Sync/index/search pipeline already supports keyword-bearing metadata (`tags`, `characters`, `places`, `versions`)

### Prototype/Hidden Today

- `scripts/merge-scrivx.js` and `scrivener-direct.js` parse `.scrivx` + project data to merge metadata into scene sidecars
- Official MCP beta tool exists: `merge_scrivener_project_beta` (async job-based)
- Documented as an opt-in beta ingestion mode with explicit stable fallback guidance
- Covered by focused unit and integration tests, including dry-run behavior, fallback messaging, `scenes_dir` precedence, async completion, warning surfaces, and rerun idempotency

## Beta Scope (Phase 1)

Provide a supported beta capability that can be called intentionally and safely.

### In Scope

1. Expose a dedicated beta tool/command for Scrivener direct extraction
2. Keep the existing stable sync-folder import unchanged
3. Parse and merge at least:
   - Scrivener keywords
   - Preserve keyword assignments as raw tags/keyword graph entries; do not infer semantic meaning (for example, auto-mapping keywords into `characters` or `versions`) in Phase 1
   - synopsis/card summary
   - selected custom metadata fields (initial allowlist)
4. Preserve identity/reconciliation behavior compatible with current scene IDs and external IDs
5. Add explicit beta warnings in tool descriptions and docs
6. Add `dry_run` behavior with clear change previews

### Out of Scope (Phase 1)

1. Replacing or deprecating `import_scrivener_sync`
2. Automatic background fallback between stable and beta importers
3. Full support promise across all historical/future Scrivener versions
4. Implicit writes outside scene sidecars

Note: Optional scene relocation into chapter-based folders may be exposed as an explicit opt-in (`organize_by_chapters`). It must remain off by default and never run implicitly.

## Feature Parity Requirements

Direct extraction must reach functional parity with the stable importer in safety and operational behavior before any graduation discussion.

1. **Identity Safety**
   - Re-imports must not create duplicate logical scenes when source ordering changes
   - Stable reconciliation by external source identity remains mandatory

2. **Write Safety**
   - Importer-authoritative vs agent-authoritative metadata ownership remains enforced
   - Non-authoritative sidecar fields must remain preserved

3. **Operational UX**
   - `dry_run` parity
   - Structured error messages with actionable fallback guidance
   - Optional auto-sync parity where appropriate

4. **Test Coverage**
   - Unit and integration tests covering success path, mismatch path, and schema drift handling

## Extra Data That Makes Beta Worthwhile

Direct extraction should unlock metadata quality improvements not available from text export alone.

1. Keyword graph from Scrivener keyword assignments
   - Maintain source fidelity: keyword values should be stored and exposed verbatim (subject to normalization like trimming/dedup), without interpretation-based remapping
2. Synopsis from Scrivener synopsis files
3. Binder hierarchy metadata for more reliable structural mapping
4. Custom metadata fields (via explicit mapping contract)
5. Optional provenance markers indicating which sidecar fields came from Scrivener internals

## Risk Register

1. **Schema drift risk**
   - Scrivener internal XML/data layout may change
   - Mitigation: parser version checks, strict error codes, stable fallback guidance

2. **Silent overwrite risk**
   - Direct extractor could overwrite fields users expect to be manual
   - Mitigation: explicit field ownership map + dry-run diffs + limited authoritative writes

3. **Project-specific custom field risk**
   - Custom metadata names are not standardized across projects
   - Mitigation: configurable allowlist/mapping, with conservative defaults

## User Experience Requirements (Beta Labeling)

1. Tool/CLI names and descriptions explicitly include beta status
2. Documentation contains a dedicated "Beta, may be version-fragile" warning
3. Errors include fallback guidance to stable sync-folder import
4. Runtime outputs identify parser assumptions when they fail

### Current Status

- Stable-vs-beta setup guidance is documented in `docs/setup.md`.
- Beta parser/schema mismatch troubleshooting and fallback guidance is documented in `docs/development.md`.
- Tool reference labels stable and beta tiers for Scrivener import/merge tools.
- Beta merge responses provide structured warning payloads and warning summaries for skipped or normalized inputs.

## Rollout Plan

1. **Phase A: Formalize current script core**
   - Refactor parsing/merging logic into reusable module(s)
2. **Phase B: Expose official beta entrypoint**
   - MCP tool + CLI path with explicit beta wording
3. **Phase C: Safety and parity hardening**
   - Ownership enforcement, conflict reporting, tests
4. **Phase D: Documentation and operator guidance**
   - Setup docs, troubleshooting, compatibility notes

## Implementation Tracker

- [scrivener-direct-extraction-beta-implementation.md](scrivener-direct-extraction-beta-implementation.md) — milestone checklist, acceptance criteria, and test matrix.

## Beta Graduation Criteria

This feature remains beta until all criteria are met:

1. Stable importer parity in identity and preservation behavior
2. Documented compatibility matrix for tested Scrivener versions
3. Zero unresolved high-severity data-loss bugs over a defined release window
4. Sufficient integration coverage for representative `.scriv` fixtures

If any criterion regresses, the feature stays beta.

## Current Gaps Before Graduation

1. Explicit importer-authoritative ownership policy enforcement remains incomplete.
2. Conflict reporting for ambiguous mappings still needs dedicated treatment.
3. Compatibility matrix expansion beyond the baseline fixture remains open.
4. Tested-version coverage documentation is still partial.

## Related

- [import-sync.md](../done/import-sync.md) — Current import architecture and identity model
- [metadata.md](../done/metadata.md) — Sidecar ownership and write rules
- [openclaw-integration.md](openclaw-integration.md) — Active integration planning context
