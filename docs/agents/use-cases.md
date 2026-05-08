# Use Cases

## Adding characters

Prompt:

We need to figure out who he is, his motivations, and then we need to figure out which parts of the book leave room for him structurally, so we don't kill the overall pacing.

Agent:

GPT-5.3-Codex

I’ll map structural insertion points first by pulling the full scene timeline metadata, then I’ll propose a minimal Bryce mini-arc (intro, humanization, fracture, exit) that fits your pacing without crowding Mira/Victor.

Ran `find_scenes` - mcp-writing (MCP Server)

Input:

```json
{
  "project_id": "universe-1/book-1-the-lamb",
  "page_size": 200
}
```

Output:

```json
{
  "results": [
    {
      "scene_id": "sc-000-prologue",
      "project_id": "universe-1/book-1-the-lamb",
      "title": "Prologue",
      "part": null,
      "chapter": null,
      "pov": null,
      "logline": null,
      "scene_change": null,
      "causality": null,
      "stakes": null,
      "scene_functions": null,
      "save_the_cat_beat": null,
      "timeline_position": 1,
      "story_time": null,
      "word_count": 614,
      "metadata_stale": 0
    },
    [...]
  ],
  "total_count": 104,
  "page": 1,
  "page_size": 200,
  "total_pages": 1,
  "has_next_page": false,
  "has_prev_page": false
}
```

I got the full metadata dump; next I’ll extract candidate timeline windows around your existing Bryce scenes and the collapse phase so we can place only a few high-impact additions.

_Execution complete: Extract Bryce insertion windows_

I need a cleaner timeline map than that parser output gave, so I’m now reading the actual scene filenames/ordering directly to anchor precise insertion points.

_Execution complete: Map scene order by filenames_

I’ll anchor this in your existing Bryce character data first, then give you a tight mini-arc and scene plan that adds depth without bloating pacing.

This is a strong direction, and your instinct is right: Bryce should be a thematic character, not a checkbox CEO.

You already have good raw material in:

- `sheet.md`
- `arc.md`

The gap is that his arc file is still empty and his scene presence is not yet shaped into a progression.

Recommended Bryce design

1. Core identity

- Not cynical, not evil.
- Mission-driven, socially fluent, good at belief.
- Vulnerability: equates optimism with leadership, avoids moral conflict until too late.

2. Thematic function

- He tests this question: Is good intention enough inside a corrupted system?
- Mira answers with truth + risk.
- Bryce initially answers with belief + messaging, then hits moral reality.

3. Mirror logic

- Bryce and Mira are both elevated young-ish faces of “new procedure.”
- Mira grows toward harder truth.
- Bryce collapses under it, then either breaks toward integrity or exits under pressure.

Important alignment choice

Your text says he should feel young and emotionally unequipped, but current sheet says age 47.
If you want that “young CEO ethos” to feel natural, consider reframing him to early-mid 30s, or keep 47 but characterize him as developmentally young in leadership (fast rise, low crisis mileage).

Low-disruption structure (best for pacing)

Use 3 short Bryce beats, not many full scenes:

1. Humanization beat (early, after momentum starts)

- Window: between A New Day Dawns and the mid-Aevi acceleration.
- Function: show him as a person, not brand machinery.
- Content: private call/home moment (family or someone he is responsible to), reveals genuine idealism and pressure from board expectations.

2. Fracture beat (mid, after Internal Testing scale risks)

- Window: around Internal Testing / before the late-finale run.
- Function: first moral crack.
- Content: board reporting scene where he is told to contain liability narrative; he complies outwardly, unsettled inwardly.

3. Exit beat (late collapse sequence)

- Window: between Exposed and On the Record.
- Function: make resignation/sidelining emotionally meaningful.
- Content: either he steps down under “health/transition” framing, or is pushed out; key is he recognizes too late that he was fronting harm.

Why this avoids Victor competition

Victor owns ideology and manipulation.
Bryce should own institutional pressure and public legitimacy.
That way they are complementary, not redundant:

- Victor: the engine of corruption.
- Bryce: the face that made corruption socially acceptable.

Practical guardrails so pacing stays clean

- Cap Bryce additions to 3 beats total.
- One Bryce beat per major phase (rise, fracture, collapse).
- Each beat must include a decision, not just mood.
- If a beat does not change pressure on Mira, cut it.
- If you want, I can draft Bryce arc.md fully next, with:

1. Need vs Want
2. 6 inflection points mapped to existing scene IDs
3. Thematic statement
4. Exact placement suggestions for the 3 new beats in your current timeline.
