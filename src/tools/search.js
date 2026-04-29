import { z } from "zod";
import fs from "node:fs";
import matter from "gray-matter";

export function registerSearchTools(s, {
  db,
  SYNC_DIR,
  GIT_ENABLED,
  errorResponse,
  paginateRows,
  DEFAULT_METADATA_PAGE_SIZE,
  MAX_CHAPTER_SCENES,
  getSceneProseAtCommit,
  readSupportingNotesForEntity,
  readEntityMetadata,
}) {
  // ---- find_scenes ---------------------------------------------------------
  s.tool(
    "find_scenes",
    "Find scenes by filtering on character, Save the Cat beat, tags, part, chapter, or POV. Returns ordered scene metadata only — no prose. All filters are optional and combinable. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Warns if any matching scenes have stale metadata.",
    {
      project_id: z.string().optional().describe("Project ID (e.g. 'the-lamb'). Use to scope results to one project."),
      character:  z.string().optional().describe("A character_id (e.g. 'char-mira-nystrom'). Returns only scenes that character appears in. Use list_characters first to find valid IDs."),
      beat:       z.string().optional().describe("Save the Cat beat name (e.g. 'Opening Image'). Exact match."),
      tag:        z.string().optional().describe("Scene tag to filter by. Exact match."),
      part:       z.number().int().optional().describe("Part number (integer, e.g. 1). Chapters are numbered globally across the whole project."),
      chapter:    z.number().int().optional().describe("Chapter number (integer, e.g. 3). Chapters are numbered globally across the whole project — do not reset per part."),
      pov:        z.string().optional().describe("POV character_id. Use list_characters first to find valid IDs."),
      page:       z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size:  z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ project_id, character, beat, tag, part, chapter, pov, page, page_size }) => {
      let query = `
        SELECT DISTINCT s.scene_id, s.project_id, s.title, s.part, s.chapter, s.chapter_title, s.pov,
               s.logline, s.scene_change, s.causality, s.stakes, s.scene_functions,
               s.save_the_cat_beat, s.timeline_position, s.story_time,
               s.word_count, s.metadata_stale
        FROM scenes s
      `;
      const joins = [];
      const conditions = [];
      const params = [];

      if (character) {
        joins.push(`JOIN scene_characters sc ON sc.scene_id = s.scene_id AND sc.character_id = ?`);
        params.push(character);
      }
      if (tag) {
        joins.push(`JOIN scene_tags st ON st.scene_id = s.scene_id AND st.tag = ?`);
        params.push(tag);
      }
      if (project_id)  { conditions.push(`s.project_id = ?`);        params.push(project_id); }
      if (beat)        { conditions.push(`s.save_the_cat_beat = ?`);  params.push(beat); }
      if (part)        { conditions.push(`s.part = ?`);               params.push(part); }
      if (chapter)     { conditions.push(`s.chapter = ?`);            params.push(chapter); }
      if (pov)         { conditions.push(`s.pov = ?`);                params.push(pov); }

      if (joins.length)      query += " " + joins.join(" ");
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY s.part, s.chapter, s.timeline_position";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No scenes match the given filters. Hint: broaden filters or call search_metadata with a keyword first.");
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `${staleCount} scene(s) have stale metadata — prose has changed since last enrichment. Consider running enrich_scene() before relying on this data for analysis.`
        : undefined;

      const paged = paginateRows(rows, {
        page,
        pageSize: page_size,
        forcePagination: rows.length > DEFAULT_METADATA_PAGE_SIZE,
      });

      const payload = paged.paginated
        ? {
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : rows;

      return {
        content: [{
          type: "text",
          text: JSON.stringify(payload, null, 2),
        }],
      };
    }
  );

  // ---- get_scene_prose -----------------------------------------------------
  s.tool(
    "get_scene_prose",
    "Load the full prose text of a single scene. Use this for close reading, continuity checks, or when you need the actual writing. For overview or filtering, use find_scenes instead — it is much cheaper. Optionally retrieve a past version from git history.",
    {
      scene_id: z.string().describe("The scene_id to retrieve (e.g. 'sc-001-prologue'). Get this from find_scenes or get_arc."),
      commit: z.string().optional().describe("Optional git commit hash to retrieve a past version. Use list_snapshots to find valid hashes. If omitted, returns the current prose."),
    },
    async ({ scene_id, commit }) => {
      const scene = db.prepare(`SELECT file_path, metadata_stale FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found. Run sync() if you just added it.`);
      }
      try {
        let rawContent;
        if (commit && GIT_ENABLED) {
          rawContent = getSceneProseAtCommit(SYNC_DIR, scene.file_path, commit);
        } else if (commit && !GIT_ENABLED) {
          return errorResponse("GIT_UNAVAILABLE", "Git is not available — cannot retrieve historical versions.");
        } else {
          rawContent = fs.readFileSync(scene.file_path, "utf8");
        }

        const { content: prose } = matter(rawContent);
        const versionNote = commit ? `\n\n(Retrieved from commit: ${commit})` : "";
        const warning = scene.metadata_stale && !commit
          ? `\n\n⚠️ Metadata for this scene may be stale — prose has changed since last enrichment.`
          : "";
        return { content: [{ type: "text", text: prose.trim() + versionNote + warning }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse(
            "STALE_PATH",
            `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved since the last sync. Run sync() to refresh the index.`,
            { indexed_path: scene.file_path }
          );
        }
        return errorResponse("IO_ERROR", `Failed to read scene file: ${err.message}`);
      }
    }
  );

  // ---- get_chapter_prose ---------------------------------------------------
  s.tool(
    "get_chapter_prose",
    `Load the full prose for every scene in a chapter, concatenated in order. Expensive — only use when you need to read an entire chapter. Capped at ${MAX_CHAPTER_SCENES} scenes. Use find_scenes first to confirm the chapter exists.`,
    {
      project_id: z.string().describe("Project ID (e.g. 'the-lamb')."),
      part:       z.number().int().describe("Part number (integer)."),
      chapter:    z.number().int().describe("Chapter number (integer, globally numbered across the whole project)."),
    },
    async ({ project_id, part, chapter }) => {
      const allScenes = db.prepare(`
        SELECT scene_id, title, file_path FROM scenes
        WHERE project_id = ? AND part = ? AND chapter = ?
        ORDER BY timeline_position
      `).all(project_id, part, chapter);

      if (allScenes.length === 0) {
        return errorResponse("NO_RESULTS", `No scenes found for Part ${part}, Chapter ${chapter}.`);
      }

      const truncated = allScenes.length > MAX_CHAPTER_SCENES;
      const scenes = truncated ? allScenes.slice(0, MAX_CHAPTER_SCENES) : allScenes;

      const parts = [];
      for (const scene of scenes) {
        try {
          const raw = fs.readFileSync(scene.file_path, "utf8");
          const { content: prose } = matter(raw);
          parts.push(`## ${scene.title ?? scene.scene_id}\n\n${prose.trim()}`);
        } catch (err) {
          parts.push(`## ${scene.scene_id}\n\n[Error reading file: ${err.message}]`);
        }
      }

      const warning = truncated
        ? `\n\n⚠️ Chapter has ${allScenes.length} scenes — only the first ${MAX_CHAPTER_SCENES} were loaded. Set MAX_CHAPTER_SCENES to increase this limit.`
        : "";
      return { content: [{ type: "text", text: parts.join("\n\n---\n\n") + warning }] };
    }
  );

  // ---- get_arc -------------------------------------------------------------
  s.tool(
    "get_arc",
    "Get every scene a character appears in, ordered by part/chapter/position. Returns scene metadata only — no prose. Use this to trace a character's arc through the story. Supports pagination via page/page_size and auto-paginates large result sets with total_count. Call list_characters first to get the character_id.",
    {
      character_id: z.string().describe("The character_id to trace (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs."),
      project_id:   z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      page:         z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size:    z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ character_id, project_id, page, page_size }) => {
      let query = `
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.chapter_title, s.title, s.logline,
               s.scene_change, s.causality, s.stakes, s.scene_functions,
               s.save_the_cat_beat, s.timeline_position, s.story_time, s.pov, s.metadata_stale
        FROM scenes s
        JOIN scene_characters sc ON sc.scene_id = s.scene_id
        WHERE sc.character_id = ?
      `;
      const params = [character_id];
      if (project_id) { query += ` AND s.project_id = ?`; params.push(project_id); }
      query += ` ORDER BY s.part, s.chapter, s.timeline_position`;

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", `No scenes found for character '${character_id}'.`);
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `${staleCount} scene(s) have stale metadata.`
        : undefined;

      const paged = paginateRows(rows, {
        page,
        pageSize: page_size,
        forcePagination: rows.length > DEFAULT_METADATA_PAGE_SIZE,
      });

      const payload = paged.paginated
        ? {
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : rows;

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- list_characters -----------------------------------------------------
  s.tool(
    "list_characters",
    "List all indexed characters with their character_id, name, role, and arc_summary. Call this first whenever you need to filter scenes by character or look up a character sheet — it gives you the character_id values required by other tools.",
    {
      project_id:  z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      universe_id: z.string().optional().describe("Limit to a specific universe (if using cross-project world-building)."),
    },
    async ({ project_id, universe_id }) => {
      let query = `SELECT character_id, name, role, arc_summary, project_id, universe_id FROM characters`;
      const conditions = [];
      const params = [];
      if (project_id)  { conditions.push(`project_id = ?`);  params.push(project_id); }
      if (universe_id) { conditions.push(`universe_id = ?`); params.push(universe_id); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY name";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No characters found.");
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- get_character_sheet -------------------------------------------------
  s.tool(
    "get_character_sheet",
    "Get full character details: role, arc_summary, traits, the canonical sheet content, and any adjacent support notes when the character uses a folder-based layout. Use list_characters first to get the character_id.",
    {
      character_id: z.string().describe("The character_id to look up (e.g. 'char-sebastian'). Use list_characters to find valid IDs."),
    },
    async ({ character_id }) => {
      const character = db.prepare(`SELECT * FROM characters WHERE character_id = ?`).get(character_id);
      if (!character) {
        return errorResponse("NOT_FOUND", `Character '${character_id}' not found.`);
      }

      const traits = db.prepare(`SELECT trait FROM character_traits WHERE character_id = ?`)
        .all(character_id).map(r => r.trait);

      let notes = "";
      let supportingNotes = [];
      if (character.file_path) {
        try {
          const raw = fs.readFileSync(character.file_path, "utf8");
          const { content } = matter(raw);
          notes = content.trim();
          supportingNotes = readSupportingNotesForEntity(character.file_path);
        } catch { /* empty */ }
      }

      const result = {
        ...character,
        traits,
        notes: notes || undefined,
        supporting_notes: supportingNotes.length ? supportingNotes : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---- list_places ---------------------------------------------------------
  s.tool(
    "list_places",
    "List all indexed places with their place_id and name. Use this to find place_id values for scene filtering or to get an overview of the story's locations.",
    {
      project_id:  z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
      universe_id: z.string().optional().describe("Limit to a specific universe."),
    },
    async ({ project_id, universe_id }) => {
      let query = `SELECT place_id, name, project_id, universe_id FROM places`;
      const conditions = [];
      const params = [];
      if (project_id)  { conditions.push(`project_id = ?`);  params.push(project_id); }
      if (universe_id) { conditions.push(`universe_id = ?`); params.push(universe_id); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY name";

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", "No places found.");
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- get_place_sheet -----------------------------------------------------
  s.tool(
    "get_place_sheet",
    "Get full place details: associated_characters, tags, the canonical sheet content, and any adjacent support notes when the place uses a folder-based layout. Use list_places first to get the place_id.",
    {
      place_id: z.string().describe("The place_id to look up (e.g. 'place-harbor-district'). Use list_places to find valid IDs."),
    },
    async ({ place_id }) => {
      const place = db.prepare(`SELECT * FROM places WHERE place_id = ?`).get(place_id);
      if (!place) {
        return errorResponse("NOT_FOUND", `Place '${place_id}' not found.`);
      }

      let notes = "";
      let supportingNotes = [];
      let associatedCharacters = [];
      let tags = [];

      if (place.file_path) {
        try {
          const raw = fs.readFileSync(place.file_path, "utf8");
          const { content } = matter(raw);
          notes = content.trim();
          supportingNotes = readSupportingNotesForEntity(place.file_path);

          const meta = readEntityMetadata(place.file_path);
          associatedCharacters = Array.isArray(meta.associated_characters) ? meta.associated_characters : [];
          tags = Array.isArray(meta.tags) ? meta.tags : [];
        } catch { /* empty */ }
      }

      const result = {
        ...place,
        associated_characters: associatedCharacters.length ? associatedCharacters : undefined,
        tags: tags.length ? tags : undefined,
        notes: notes || undefined,
        supporting_notes: supportingNotes.length ? supportingNotes : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ---- search_metadata -----------------------------------------------------
  s.tool(
    "search_metadata",
    "Full-text search across scene titles, loglines (synopsis/logline text fields), and metadata keywords (tags/characters/places/versions). Use this when you don't know the exact scene_id or chapter but want to find scenes by topic, theme, or metadata keyword. Not a prose search — use get_scene_prose to read actual text. Supports pagination via page/page_size and auto-paginates large result sets with total_count.",
    {
      query: z.string().describe("Search terms (e.g. 'hospital' or 'Sebastian feeding'). FTS5 syntax supported."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ query, page, page_size }) => {
      let totalCount;
      try {
        totalCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM scenes_fts f
          JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
          WHERE scenes_fts MATCH ?
        `).get(query)?.count ?? 0;
      } catch (err) {
        return errorResponse("INVALID_QUERY", "Invalid search query syntax. Use plain keywords or quoted phrases.", { detail: err.message });
      }

      if (totalCount === 0) {
        return errorResponse("NO_RESULTS", "No scenes matched the search query.");
      }

      const shouldPaginate = totalCount > DEFAULT_METADATA_PAGE_SIZE || page !== undefined || page_size !== undefined;

      if (!shouldPaginate) {
        const rows = db.prepare(`
          SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.chapter_title, s.metadata_stale
          FROM scenes_fts f
          JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
          WHERE scenes_fts MATCH ?
          ORDER BY rank
        `).all(query);

        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      }

      const safePageSize = Math.max(1, page_size ?? DEFAULT_METADATA_PAGE_SIZE);
      const safePage = Math.max(1, page ?? 1);
      const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
      const normalizedPage = Math.min(safePage, totalPages);
      const offset = (normalizedPage - 1) * safePageSize;

      const rows = db.prepare(`
        SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.chapter_title, s.metadata_stale
        FROM scenes_fts f
        JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
        WHERE scenes_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(query, safePageSize, offset);

      const payload = {
        results: rows,
        total_count: totalCount,
        page: normalizedPage,
        page_size: safePageSize,
        total_pages: totalPages,
        has_next_page: normalizedPage < totalPages,
        has_prev_page: normalizedPage > 1,
      };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- list_threads --------------------------------------------------------
  s.tool(
    "list_threads",
    "List all subplot/storyline threads for a project. Returns a structured JSON envelope with results and total_count. Use this to discover valid thread_id values before calling get_thread_arc or upsert_thread_link. Supports pagination via page/page_size.",
    {
      project_id: z.string().describe("Project ID."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ project_id, page, page_size }) => {
      const rows = db.prepare(`SELECT * FROM threads WHERE project_id = ? ORDER BY name`).all(project_id);
      const paged = paginateRows(rows, { page, pageSize: page_size, forcePagination: false });
      const payload = paged.paginated
        ? {
            project_id,
            results: paged.rows,
            ...paged.meta,
          }
        : {
            project_id,
            results: rows,
            total_count: rows.length,
          };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- get_thread_arc ------------------------------------------------------
  s.tool(
    "get_thread_arc",
    "Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat. Returns a structured JSON envelope with thread metadata, results, and total_count. Use list_threads first to find a valid thread_id, then call get_scene_prose for close reading of specific scenes. Supports pagination via page/page_size.",
    {
      thread_id: z.string().describe("Thread ID."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ thread_id, page, page_size }) => {
      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      if (!thread) {
        return errorResponse("NOT_FOUND", `Thread '${thread_id}' not found. Hint: call list_threads with project_id to get valid thread IDs.`);
      }

      const rows = db.prepare(`
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.chapter_title, s.title, s.logline,
               st.beat AS thread_beat, s.timeline_position, s.story_time, s.metadata_stale
        FROM scenes s
        JOIN scene_threads st ON st.scene_id = s.scene_id AND st.thread_id = ?
        ORDER BY s.part, s.chapter, s.timeline_position
      `).all(thread_id);
      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0 ? `${staleCount} scene(s) have stale metadata.` : undefined;
      const paged = paginateRows(rows, { page, pageSize: page_size, forcePagination: false });

      const payload = paged.paginated
        ? {
            thread,
            results: paged.rows,
            ...paged.meta,
            warning,
          }
        : {
            thread,
            results: rows,
            total_count: rows.length,
            warning,
          };

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // ---- get_relationship_arc ------------------------------------------------
  s.tool(
    "get_relationship_arc",
    "Show how the relationship between two characters evolves across scenes, in order. Uses explicitly recorded relationship entries — returns nothing if no entries exist yet. Use list_characters to get character_id values.",
    {
      from_character: z.string().describe("character_id of the first character (e.g. 'char-sebastian')."),
      to_character:   z.string().describe("character_id of the second character (e.g. 'char-mira-nystrom')."),
      project_id:     z.string().optional().describe("Limit to a specific project (e.g. 'the-lamb')."),
    },
    async ({ from_character, to_character, project_id }) => {
      let query = `
        SELECT r.from_character, r.to_character, r.relationship_type, r.strength,
               r.scene_id, r.note,
               s.part, s.chapter, s.chapter_title, s.timeline_position, s.title AS scene_title
        FROM character_relationships r
        LEFT JOIN scenes s ON s.scene_id = r.scene_id
        WHERE r.from_character = ? AND r.to_character = ?
      `;
      const params = [from_character, to_character];
      if (project_id) { query += ` AND (s.project_id = ? OR r.scene_id IS NULL)`; params.push(project_id); }
      query += ` ORDER BY s.part, s.chapter, s.timeline_position`;

      const rows = db.prepare(query).all(...params);
      if (rows.length === 0) {
        return errorResponse("NO_RESULTS", `No relationship data found between '${from_character}' and '${to_character}'.`);
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );
}
