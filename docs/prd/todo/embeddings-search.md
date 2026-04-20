# Embedding-Based Search

**Status:** 📋 Deferred (Phase 4)

## Motivation

SQLite FTS5 works well for keyword-based metadata search and title/logline matches. However, it struggles with semantic queries like:
- "Find scenes with a confrontation near water"
- "Scenes where Elena feels cornered"
- "Show me tension escalation across the act"

These require understanding meaning, not just keyword presence.

## Design Questions

- Should embeddings index prose only, or also metadata (loglines, character notes)?
- Which embedding model? OpenAI (cost, API dependency), Ollama (local, slower), or Hugging Face (flexible)?
- Where do embeddings live? SQLite extension (vector), separate Postgres, or disk?
- How often do we re-embed? On every sync, on demand, or only for changed scenes?

## Implementation Path

1. Evaluate embedding performance against current FTS5 baseline
2. Choose embedding backend (likely Ollama for local deployment, cost control)
3. Add embedding indexing to `sync()` for changed scenes only
4. Implement `search_prose(query, semantic=true)` tool that uses embedding distance
5. Profile token cost for full-manuscript embedding at various model sizes

## Rollout

- Phase 4A: Implement embeddings for prose search
- Phase 4B: Extend to metadata and relationship reasoning

## Related

- [search-analysis.md](../done/search-analysis.md) — Current FTS5 search
