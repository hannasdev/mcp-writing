import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { openDb } from "./db.js";
import { syncAll, isSyncDirWritable, writeMeta, readMeta, indexSceneFile } from "./sync.js";

const SYNC_DIR = process.env.WRITING_SYNC_DIR ?? "./sync";
const DB_PATH = process.env.DB_PATH ?? "./writing.db";
const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? "3000", 10);
const MAX_CHAPTER_SCENES = parseInt(process.env.MAX_CHAPTER_SCENES ?? "10", 10);
const DEFAULT_METADATA_PAGE_SIZE = parseInt(process.env.DEFAULT_METADATA_PAGE_SIZE ?? "20", 10);

function paginateRows(rows, { page, pageSize, forcePagination = false }) {
  const totalCount = rows.length;
  const shouldPaginate = forcePagination || page !== undefined || pageSize !== undefined;

  if (!shouldPaginate) {
    return {
      paginated: false,
      rows,
      meta: null,
    };
  }

  const safePageSize = Math.max(1, pageSize ?? DEFAULT_METADATA_PAGE_SIZE);
  const safePage = Math.max(1, page ?? 1);
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const normalizedPage = Math.min(safePage, totalPages);
  const offset = (normalizedPage - 1) * safePageSize;
  const pageRows = rows.slice(offset, offset + safePageSize);

  return {
    paginated: true,
    rows: pageRows,
    meta: {
      total_count: totalCount,
      page: normalizedPage,
      page_size: safePageSize,
      total_pages: totalPages,
      has_next_page: normalizedPage < totalPages,
      has_prev_page: normalizedPage > 1,
    },
  };
}

function jsonResponse(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResponse(code, message, details) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
  return jsonResponse(payload);
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = openDb(DB_PATH);

// Check sync dir writability once at startup (needed for Phase 2 sidecar writes)
const SYNC_DIR_WRITABLE = isSyncDirWritable(SYNC_DIR);
if (!SYNC_DIR_WRITABLE) {
  process.stderr.write(`[mcp-writing] WARNING: sync dir is not writable — sidecar auto-migration and metadata write-back will be unavailable\n`);
}

// Run sync on startup
syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
function createMcpServer() {
  const s = new McpServer({ name: "mcp-writing", version: "0.1.0" });

  // ---- sync ----------------------------------------------------------------
  s.tool("sync", "Re-scan the sync folder and update the scene/character/place index from disk. Call this after making edits in Scrivener or updating sidecar files outside the MCP.", {}, async () => {
    const result = syncAll(db, SYNC_DIR, { writable: SYNC_DIR_WRITABLE });
    const parts = [`Sync complete. ${result.indexed} scenes indexed. ${result.staleMarked} scenes marked stale.`];
    if (result.sidecarsMigrated) parts.push(`${result.sidecarsMigrated} sidecar(s) auto-generated from frontmatter.`);
    if (result.skipped) parts.push(`${result.skipped} file(s) skipped (no scene_id).`);
    if (result.warnings.length) parts.push(`\n⚠️ Warnings:\n` + result.warnings.map(w => `- ${w}`).join("\n"));
    return { content: [{ type: "text", text: parts.join(" ") }] };
  });

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
        SELECT DISTINCT s.scene_id, s.project_id, s.title, s.part, s.chapter, s.pov,
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
        return errorResponse("NO_RESULTS", "No scenes match the given filters.");
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
    "Load the full prose text of a single scene. Use this for close reading, continuity checks, or when you need the actual writing. For overview or filtering, use find_scenes instead — it is much cheaper.",
    {
      scene_id: z.string().describe("The scene_id to retrieve (e.g. 'sc-001-prologue'). Get this from find_scenes or get_arc."),
    },
    async ({ scene_id }) => {
      const scene = db.prepare(`SELECT file_path, metadata_stale FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found. Run sync() if you just added it.`);
      }
      try {
        const raw = fs.readFileSync(scene.file_path, "utf8");
        const { content: prose } = matter(raw);
        const warning = scene.metadata_stale
          ? `\n\n⚠️ Metadata for this scene may be stale — prose has changed since last enrichment.`
          : "";
        return { content: [{ type: "text", text: prose.trim() + warning }] };
      } catch (err) {
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
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.title, s.logline,
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
    "Get full character details: role, arc_summary, traits, and the full content of the character notes file. Use list_characters first to get the character_id.",
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
      if (character.file_path) {
        try {
          const raw = fs.readFileSync(character.file_path, "utf8");
          const { content } = matter(raw);
          notes = content.trim();
        } catch {}
      }

      const result = { ...character, traits, notes: notes || undefined };
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

  // ---- search_metadata -----------------------------------------------------
  s.tool(
    "search_metadata",
    "Full-text search across scene titles and loglines (synopsis/logline text fields). Use this when you don't know the exact scene_id or chapter but want to find scenes by topic, theme, or keywords in the description. Not a prose search — use get_scene_prose to read actual text. Supports pagination via page/page_size and auto-paginates large result sets with total_count.",
    {
      query: z.string().describe("Search terms (e.g. 'hospital' or 'Sebastian feeding'). FTS5 syntax supported."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ query, page, page_size }) => {
      const totalCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM scenes_fts f
        JOIN scenes s ON s.scene_id = f.scene_id AND s.project_id = f.project_id
        WHERE scenes_fts MATCH ?
      `).get(query)?.count ?? 0;

      if (totalCount === 0) {
        return errorResponse("NO_RESULTS", "No scenes matched the search query.");
      }

      const shouldPaginate = totalCount > DEFAULT_METADATA_PAGE_SIZE || page !== undefined || page_size !== undefined;

      if (!shouldPaginate) {
        const rows = db.prepare(`
          SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.metadata_stale
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
        SELECT f.scene_id, f.project_id, s.title, s.logline, s.part, s.chapter, s.metadata_stale
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
    "List all subplot/storyline threads for a project. Returns a structured JSON envelope with results and total_count. Supports pagination via page/page_size.",
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
    "Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat. Returns a structured JSON envelope with thread metadata, results, and total_count. Supports pagination via page/page_size.",
    {
      thread_id: z.string().describe("Thread ID."),
      page: z.number().int().min(1).optional().describe("Optional page number for paginated responses (1-based)."),
      page_size: z.number().int().min(1).max(200).optional().describe("Optional page size for paginated responses (default: 20, max: 200)."),
    },
    async ({ thread_id, page, page_size }) => {
      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      if (!thread) {
        return errorResponse("NOT_FOUND", `Thread '${thread_id}' not found.`);
      }

      const rows = db.prepare(`
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.title, s.logline,
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

  // ---- upsert_thread_link ---------------------------------------------------
  s.tool(
    "upsert_thread_link",
    "Create or update a thread and link it to a scene. Idempotent: if the link already exists, updates its beat. Only available when the sync dir is writable.",
    {
      project_id: z.string().describe("Project the thread belongs to (e.g. 'the-lamb')."),
      thread_id: z.string().describe("Thread ID (e.g. 'thread-reconciliation')."),
      thread_name: z.string().describe("Thread display name."),
      scene_id: z.string().describe("Scene to link to the thread (e.g. 'sc-011-sebastian')."),
      beat: z.string().optional().describe("Optional thread-specific beat label for this scene."),
      status: z.string().optional().describe("Thread status (e.g. 'active', 'resolved'). Defaults to 'active'."),
    },
    async ({ project_id, thread_id, thread_name, scene_id, beat, status }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot write thread links: sync dir is read-only.");
      }

      const existingThread = db.prepare(`SELECT thread_id, project_id FROM threads WHERE thread_id = ?`).get(thread_id);
      if (existingThread && existingThread.project_id !== project_id) {
        return errorResponse(
          "CONFLICT",
          `Thread '${thread_id}' already exists in project '${existingThread.project_id}', cannot reuse it for project '${project_id}'.`
        );
      }

      const scene = db.prepare(`SELECT scene_id FROM scenes WHERE scene_id = ? AND project_id = ?`).get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      db.prepare(`
        INSERT INTO threads (thread_id, project_id, name, status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (thread_id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status
      `).run(thread_id, project_id, thread_name, status ?? "active");

      db.prepare(`
        INSERT INTO scene_threads (scene_id, thread_id, beat)
        VALUES (?, ?, ?)
        ON CONFLICT (scene_id, thread_id) DO UPDATE SET
          beat = excluded.beat
      `).run(scene_id, thread_id, beat ?? null);

      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      const link = db.prepare(`SELECT scene_id, thread_id, beat FROM scene_threads WHERE scene_id = ? AND thread_id = ?`)
        .get(scene_id, thread_id);

      return jsonResponse({
        ok: true,
        action: "upserted",
        thread,
        link,
      });
    }
  );

  // ---- update_scene_metadata -----------------------------------------------
  s.tool(
    "update_scene_metadata",
    "Update one or more metadata fields for a scene. Writes to the .meta.yaml sidecar — never modifies prose. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      scene_id:   z.string().describe("The scene_id to update (e.g. 'sc-011-sebastian')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      fields: z.object({
        title:             z.string().optional(),
        logline:           z.string().optional(),
        save_the_cat_beat: z.string().optional(),
        pov:               z.string().optional(),
        part:              z.number().int().optional(),
        chapter:           z.number().int().optional(),
        timeline_position: z.number().int().optional(),
        story_time:        z.string().optional(),
        tags:              z.array(z.string()).optional(),
        characters:        z.array(z.string()).optional(),
        places:            z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ scene_id, project_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update metadata: sync dir is read-only.");
      }
      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }
      const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
      const updated = { ...meta, ...fields };
      writeMeta(scene.file_path, updated);

      // Re-index the scene immediately so the DB reflects the new metadata
      const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
      indexSceneFile(db, SYNC_DIR, scene.file_path, updated, prose);

      return { content: [{ type: "text", text: `Updated metadata for scene '${scene_id}'.` }] };
    }
  );

  // ---- update_character_sheet ----------------------------------------------
  s.tool(
    "update_character_sheet",
    "Update structured metadata fields for a character (role, arc_summary, traits, etc). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      character_id: z.string().describe("The character_id to update (e.g. 'char-mira-nystrom'). Use list_characters to find valid IDs."),
      fields: z.object({
        name:             z.string().optional(),
        role:             z.string().optional(),
        arc_summary:      z.string().optional(),
        first_appearance: z.string().optional(),
        traits:           z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ character_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update character: sync dir is read-only.");
      }
      const char = db.prepare(`SELECT file_path FROM characters WHERE character_id = ?`).get(character_id);
      if (!char) {
        return errorResponse("NOT_FOUND", `Character '${character_id}' not found.`);
      }
      const { meta } = readMeta(char.file_path, SYNC_DIR, { writable: true });
      const updated = { ...meta, ...fields };
      writeMeta(char.file_path, updated);

      // Update DB directly
      db.prepare(`
        UPDATE characters SET name = ?, role = ?, arc_summary = ?, first_appearance = ?
        WHERE character_id = ?
      `).run(
        updated.name ?? meta.name, updated.role ?? null,
        updated.arc_summary ?? null, updated.first_appearance ?? null,
        character_id
      );
      if (fields.traits) {
        db.prepare(`DELETE FROM character_traits WHERE character_id = ?`).run(character_id);
        for (const t of fields.traits) {
          db.prepare(`INSERT OR IGNORE INTO character_traits (character_id, trait) VALUES (?, ?)`).run(character_id, t);
        }
      }

      return { content: [{ type: "text", text: `Updated character sheet for '${character_id}'.` }] };
    }
  );

  // ---- flag_scene ----------------------------------------------------------
  s.tool(
    "flag_scene",
    "Attach a continuity or review note to a scene. Flags are appended to the sidecar file and accumulate over time — they are never overwritten. Use this to record continuity problems, revision notes, or questions you want to revisit.",
    {
      scene_id:   z.string().describe("The scene_id to flag (e.g. 'sc-012-open-to-anyone')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      note:       z.string().describe("The flag note (e.g. 'Victor knows Mira\'s name here, but they haven\'t been introduced yet — contradicts sc-006')."),
    },
    async ({ scene_id, project_id, note }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot flag scene: sync dir is read-only.");
      }
      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }
      const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
      const flags = meta.flags ?? [];
      flags.push({ note, flagged_at: new Date().toISOString() });
      writeMeta(scene.file_path, { ...meta, flags });
      return { content: [{ type: "text", text: `Flagged scene '${scene_id}': ${note}` }] };
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
               s.part, s.chapter, s.timeline_position, s.title AS scene_title
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

  return s;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const activeSessions = new Map();

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/sse") {
    const transport = new SSEServerTransport("/message", res);
    const sessionId = transport.sessionId;

    const existing = activeSessions.get(sessionId);
    if (existing) {
      try { await existing.transport.close(); } catch {}
      try { await existing.server.close(); } catch {}
      activeSessions.delete(sessionId);
    }

    const sessionServer = createMcpServer();
    activeSessions.set(sessionId, { transport, server: sessionServer });
    res.on("close", () => activeSessions.delete(sessionId));

    await sessionServer.connect(transport);
    process.stderr.write(`[mcp-writing] SSE client connected (session=${sessionId})\n`);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/message")) {
    const url = new URL(req.url, `http://localhost`);
    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId ? activeSessions.get(sessionId) : null;
    if (!session) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Session not found");
      return;
    }
    await session.transport.handlePostMessage(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  process.stderr.write(`[mcp-writing] Listening on port ${HTTP_PORT}\n`);
});
