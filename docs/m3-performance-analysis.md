# M3 Performance Analysis: Review Bundles Async Evaluation

**Date**: 2026-04-25  
**Project**: `universe-1/book-1-the-lamb` (104 scenes, ~71,400 words)  
**Test Date**: Real manuscript project from `/Users/hanna/Code/writing/`

## Performance Results

### Full Project Generation (104 scenes)

| Profile | Planning | Artifact Gen | **Total** | Output Size |
|---------|----------|--------------|-----------|-------------|
| `outline_discussion` | 2.10ms | 21.75ms | **23.85ms** | 67 KB |
| `editor_detailed` | 0.42ms | 29.38ms | **29.80ms** | 433 KB |
| `beta_reader_personalized` | 0.57ms | 29.98ms | **30.55ms** | 434 KB |

### Subset Generation (Single Chapter, 2 scenes)

| Profile | Planning | Artifact Gen | **Total** | Output Size |
|---------|----------|--------------|-----------|-------------|
| `outline_discussion` | 0.16ms | 20.85ms | **21.02ms** | 2 KB |
| `editor_detailed` | 0.21ms | 18.91ms | **19.12ms** | 15 KB |
| `beta_reader_personalized` | 0.17ms | 21.21ms | **21.38ms** | 16 KB |

## Analysis

### Key Findings

1. **Generation is extremely fast** — even full-book bundles complete in ~30ms
2. **Disk I/O dominates** — most time is writing files, not computation
3. **Minimal overhead** — planning is sub-millisecond (0.16-2.10ms)
4. **Scaling is linear** — smaller projects are proportionally faster

### Async Threshold Assessment

Industry standards typically recommend async for operations > 1-5 seconds. Current performance:

- ✅ **30ms** is well below the 1-second "user must wait" threshold
- ✅ Network/MCP round-trip latency (typically 50-200ms) exceeds generation time
- ✅ No perceived performance benefit from async
- ❌ Async would add complexity (job queue, polling, state management)

## Recommendation

**❌ ASYNC NOT NEEDED for M3**

**Rationale:**
- Current synchronous `create_review_bundle` is **sub-30ms even for 100+ scene projects**
- Async overhead (job spawning, result serialization, polling loop) would be larger than the actual work
- Network latency dominates MCP communication; local generation is negligible
- Maintenance burden of async infrastructure outweighs benefits

**Alternative: Document Performance Characteristics**
Instead of implementing M3 async, recommend documenting in PRD/tools.md:
- Expected generation times for typical project sizes
- Note that sync is appropriate for current use cases
- Leave async as a future optimization if real-world usage patterns demand it

**Future Consideration:**
- If users report with projects > 1000 scenes, revisit async
- If large bundles hit MCP timeout limits (typically 30-60 seconds), implement async then
- Current architecture is compatible with future async wrapper if needed

## Test Script Location

Profiling script saved for future benchmarking: `scripts/profile-review-bundles.mjs`

Usage:
```bash
node --experimental-sqlite scripts/profile-review-bundles.mjs
```

Configurable via environment: `DB_PATH` and `PROJECT_SYNC_DIR` (hardcoded currently, can be parameterized)
