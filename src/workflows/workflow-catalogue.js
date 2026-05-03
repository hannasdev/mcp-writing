export const WORKFLOW_CATALOGUE = [
  {
    id: "question_driven_discovery",
    label: "Find scenes for a manuscript question",
    use_when: "Start here for most sessions: when the user has a manuscript question, you need to narrow scope, or you are not yet sure which scene matters.",
    steps: [
      { tool: "find_scenes", note: "Use structured metadata filters first when the question already suggests characters, beats, tags, parts, chapters, or POV." },
      { tool: "search_metadata", note: "Use this when the question is thematic, fuzzy, or keyword-driven rather than cleanly filterable." },
      { tool: "get_scene_prose", note: "Escalate to prose only after likely scenes have been identified and metadata is no longer enough." },
      { tool: "flag_scene", note: "Use only when the current task naturally leads to recording a follow-up note for later editorial attention." },
    ],
  },
  {
    id: "targeted_scene_reading",
    label: "Inspect prose for a likely scene",
    use_when: "Use this after metadata has narrowed the space and the user needs details, nuance, continuity, tone, pacing, or other evidence only prose can confirm.",
    steps: [
      { tool: "find_scenes", note: "Use metadata discovery first if the target scene is not already known." },
      { tool: "get_scene_prose", note: "Load the specific scene that matters once you have a likely target." },
      { tool: "get_chapter_prose", note: "Escalate only when the question cannot be answered scene-by-scene and chapter-wide prose context is truly required." },
      { tool: "list_scene_references", note: "Use when linked references are relevant to understanding the scene in context." },
    ],
  },
  {
    id: "safe_scene_revision",
    label: "Revise a scene safely",
    use_when: "Use when the next meaningful step is changing prose rather than continuing discovery or inspection.",
    steps: [
      { tool: "find_scenes", note: "Identify the target scene if the user has not already narrowed to a specific scene_id." },
      { tool: "get_scene_prose", note: "Read the current prose before proposing a revision." },
      { tool: "propose_edit", note: "Stage a revision and review the diff preview with the user before writing anything." },
      { tool: "commit_edit", note: "Apply the revision only after explicit user approval." },
      { tool: "discard_edit", note: "Use when the proposed change should not be applied." },
    ],
  },
  {
    id: "character_understanding",
    label: "Understand a character in context",
    use_when: "Use when the user wants to understand a character's path through the manuscript or needs the character's canonical profile in support of a story question.",
    steps: [
      { tool: "get_arc", note: "Use as the primary structural entry point when the question is about the character's progression across scenes." },
      { tool: "get_character_sheet", note: "Use when you need the canonical character profile, traits, notes, or supporting material." },
      { tool: "list_characters", note: "Use only as a helper to find or disambiguate character_id values." },
    ],
  },
  {
    id: "place_understanding",
    label: "Understand a place in context",
    use_when: "Use when the current scene involves a place that matters, or when the user is asking directly about a location's role in the manuscript.",
    steps: [
      { tool: "get_place_sheet", note: "Use when the place itself is part of the reasoning task and you need its canonical profile or notes." },
      { tool: "find_scenes", note: "Use to locate scenes where the place is likely to matter through tags, chapter context, or related story structure." },
      { tool: "list_places", note: "Use only as a helper to find or disambiguate place_id values." },
    ],
  },
  {
    id: "thread_understanding",
    label: "Understand a thread or arc in context",
    use_when: "Use when the question is about progression, continuity, subplot movement, or recurring storyline structure across scenes.",
    steps: [
      { tool: "get_thread_arc", note: "Use when the storyline or subplot is already identified and you need its ordered scene progression." },
      { tool: "list_threads", note: "Use only as a helper to find or disambiguate thread_id values." },
      { tool: "get_arc", note: "Use when the thread question is really a character-progression question and character context is the better structural entry point." },
    ],
  },
  {
    id: "parity_recovery",
    label: "Recover metadata parity",
    use_when: "Use when new material has been added, sync/import reveals metadata gaps, or normal work touches scenes or documents with weak, stale, or missing metadata support.",
    steps: [
      { tool: "sync", note: "Refresh the index and use the result as the main signal that material has changed or parity may need attention." },
      { tool: "enrich_scene", note: "Use for lightweight opportunistic recovery when the current task is already touching a specific low-parity scene." },
      { tool: "enrich_scene_characters_batch", note: "Use when recovery scope is broad enough to justify focused catch-up work; prefer dry_run first." },
      { tool: "suggest_scene_references", note: "Use when low parity is specifically about missing scene-to-reference relationships." },
    ],
  },
  {
    id: "review_preparation",
    label: "Prepare material for human review",
    use_when: "Use when the task has shifted from reasoning or revising into packaging material for editors, collaborators, or beta readers.",
    steps: [
      { tool: "preview_review_bundle", note: "Check scope, warnings, and planned outputs before generating anything." },
      { tool: "create_review_bundle", note: "Generate the review artifact once scope and warnings have been reviewed." },
    ],
  },
  {
    id: "first_time_setup",
    label: "Connect and verify a project",
    use_when: "Use when connecting to a project for the first time or when runtime configuration needs to be verified before normal workflows begin.",
    steps: [
      { tool: "get_runtime_config", note: "Verify sync dir, writability, and git availability." },
      { tool: "sync", note: "Index scenes from disk so the main manuscript workflows can operate." },
    ],
  },
  {
    id: "styleguide_setup_new",
    label: "Set up a prose styleguide",
    use_when: "Use only when styleguide configuration is intentionally part of the task and no suitable config exists yet.",
    steps: [
      { tool: "describe_workflows", note: "Check context.scene_count; use that value as max_scenes in the next call." },
      { tool: "bootstrap_prose_styleguide_config", note: "Detect dominant conventions. Confirm suggestions with the user before applying." },
      { tool: "setup_prose_styleguide_config", note: "Only if ALL context.styleguide_exists fields are false — a config at any scope is sufficient. Create at project_root scope (requires project_id and language e.g. 'english_us'), or sync_root if no project_id is known." },
      { tool: "update_prose_styleguide_config", note: "Apply the fields accepted from bootstrap suggestions." },
      { tool: "setup_prose_styleguide_skill", note: "Generate skills/prose-styleguide/SKILL.md. For sync-root setup this also publishes AI boot files (CLAUDE.md and .github/copilot-instructions.md); with project_id it skips boot files to avoid cross-project collisions." },
    ],
  },
  {
    id: "styleguide_drift_check",
    label: "Check styleguide drift",
    use_when: "Use only when styleguide conformance is intentionally the task and a styleguide config already exists.",
    steps: [
      { tool: "get_prose_styleguide_config", note: "Confirm the currently resolved config." },
      { tool: "check_prose_styleguide_drift", note: "Detect non-conforming scenes. Pass project_id from context.project_id and set max_scenes from context.scene_count." },
      { tool: "update_prose_styleguide_config", note: "If drift found and user approves, update config or note the outliers." },
    ],
  },
  {
    id: "async_job_tracking",
    label: "Async job tracking",
    use_when: "A tool returned a job_id instead of an immediate result (e.g. import_scrivener_sync_async).",
    steps: [
      { tool: "get_async_job_status", note: "Poll with the job_id until status is 'completed' or 'failed'." },
      { tool: "sync", note: "Call after a completed job that modified files on disk." },
    ],
  },
];
