export const WORKFLOW_CATALOGUE = [
  {
    id: "first_time_setup",
    label: "First-time setup",
    use_when: "Connecting to a project for the first time or verifying the runtime is correctly configured.",
    steps: [
      { tool: "get_runtime_config", note: "Verify sync dir, writability, and git availability." },
      { tool: "sync", note: "Index scenes from disk." },
    ],
  },
  {
    id: "styleguide_setup_new",
    label: "Styleguide setup (new project)",
    use_when: "No prose styleguide config exists and you want to create one based on the manuscript's existing conventions.",
    steps: [
      { tool: "describe_workflows", note: "Check context.scene_count; use that value as max_scenes in the next call." },
      { tool: "bootstrap_prose_styleguide_config", note: "Detect dominant conventions. Confirm suggestions with the user before applying." },
      { tool: "setup_prose_styleguide_config", note: "Only if ALL context.styleguide_exists fields are false — a config at any scope is sufficient. Create at project_root scope (requires project_id and language e.g. 'english_us'), or sync_root if no project_id is known." },
      { tool: "update_prose_styleguide_config", note: "Apply the fields accepted from bootstrap suggestions." },
    ],
  },
  {
    id: "styleguide_drift_check",
    label: "Styleguide drift check",
    use_when: "A styleguide config exists and you want to check whether recent scenes conform to it.",
    steps: [
      { tool: "get_prose_styleguide_config", note: "Confirm the currently resolved config." },
      { tool: "check_prose_styleguide_drift", note: "Detect non-conforming scenes. Pass project_id from context.project_id and set max_scenes from context.scene_count." },
      { tool: "update_prose_styleguide_config", note: "If drift found and user approves, update config or note the outliers." },
    ],
  },
  {
    id: "manuscript_exploration",
    label: "Manuscript exploration",
    use_when: "Answering questions about the manuscript, finding scenes, or getting an overview.",
    steps: [
      { tool: "find_scenes", note: "Filter by character, beat, tag, part, chapter, or POV. No filters returns all scenes." },
      { tool: "get_scene_prose", note: "Load prose for specific scenes identified by find_scenes." },
      { tool: "get_chapter_prose", note: "Load all prose for a chapter. Use sparingly — large chapters can overflow context." },
      { tool: "search_metadata", note: "Full-text search across scene metadata fields." },
    ],
  },
  {
    id: "prose_editing",
    label: "Prose editing",
    use_when: "Revising scene prose. All edits require explicit user confirmation before writing.",
    steps: [
      { tool: "find_scenes", note: "Identify the target scene." },
      { tool: "get_scene_prose", note: "Load the current prose." },
      { tool: "propose_edit", note: "Stage a revision; returns a diff preview and a proposal_id." },
      { tool: "commit_edit", note: "Write the revision after the user confirms. Runs preflight checks before writing." },
      { tool: "discard_edit", note: "Reject the revision if the user does not approve." },
    ],
  },
  {
    id: "character_management",
    label: "Character management",
    use_when: "Finding characters, reading their sheets, or updating character details.",
    steps: [
      { tool: "list_characters", note: "Find character_id values." },
      { tool: "get_character_sheet", note: "Read full character details." },
      { tool: "create_character_sheet", note: "Create a new character. Requires exactly one of project_id or universe_id." },
      { tool: "update_character_sheet", note: "Edit character metadata." },
    ],
  },
  {
    id: "place_management",
    label: "Place management",
    use_when: "Finding locations, reading place sheets, or updating place details.",
    steps: [
      { tool: "list_places", note: "Find place_id values." },
      { tool: "get_place_sheet", note: "Read full place details." },
      { tool: "create_place_sheet", note: "Create a new place. Requires exactly one of project_id or universe_id." },
      { tool: "update_place_sheet", note: "Edit place metadata." },
    ],
  },
  {
    id: "review_bundle",
    label: "Review bundle",
    use_when: "Preparing a formatted bundle for human review (outline, editorial, or beta read profile).",
    steps: [
      { tool: "preview_review_bundle", note: "Check which scenes would be included and the estimated size. Requires project_id and profile." },
      { tool: "create_review_bundle", note: "Generate the bundle. Requires project_id." },
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
