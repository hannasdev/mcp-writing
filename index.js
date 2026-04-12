import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { openDb } from "./db.js";
import { syncAll } from "./sync.js";

const SYNC_DIR = process.env.WRITING_SYNC_DIR ?? "./sync";
const DB_PATH = process.env.DB_PATH ?? "./writing.db";
const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? "3000", 10);

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = openDb(DB_PATH);


// Run sync on startup
syncAll(db, SYNC_DIR);

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
function createMcpServer() {
  const s = new McpServer({ name: "mcp-writing", version: "0.1.0" });

  // ---- sync ----------------------------------------------------------------
  s.tool("sync", "Re-scan the sync folder and update the index from changed files.", {}, async () => {
    const result = syncAll(db, SYNC_DIR);
    return {
      content: [{
        type: "text",
        text: `Sync complete. ${result.indexed} scenes indexed. ${result.staleMarked} scenes marked stale (prose changed since last sync).`,
      }],
    };
  });

  // ---- find_scenes ---------------------------------------------------------
  s.tool(
    "find_scenes",
    "Find scenes by filtering on character, Save the Cat beat, tags, part, chapter, or POV. Returns metadata only — no prose. Warns if any matching scenes have stale metadata.",
    {
      project_id: z.string().optional().describe("Filter to a specific project."),
      character:  z.string().optional().describe("Character ID who appears in the scene."),
      beat:       z.string().optional().describe("Save the Cat beat name."),
      tag:        z.string().optional().describe("Tag to filter by."),
      part:       z.number().int().optional().describe("Part number."),
      chapter:    z.number().int().optional().describe("Chapter number."),
      pov:        z.string().optional().describe("POV character ID."),
    },
    async ({ project_id, character, beat, tag, part, chapter, pov }) => {
      let query = `
        SELECT DISTINCT s.scene_id, s.project_id, s.title, s.part, s.chapter, s.pov,
               s.logline, s.save_the_cat_beat, s.timeline_position, s.story_time,
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
        return { content: [{ type: "text", text: "No scenes match the given filters." }] };
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `\n\n⚠️ ${staleCount} scene(s) have stale metadata — prose has changed since last enrichment. Consider running enrich_scene() before relying on this data for analysis.`
        : "";

      return {
        content: [{
          type: "text",
          text: JSON.stringify(rows, null, 2) + warning,
        }],
      };
    }
  );

  // ---- get_scene_prose -----------------------------------------------------
  s.tool(
    "get_scene_prose",
    "Load the full prose text for a specific scene. Use targeted — prefer find_scenes for overview queries.",
    {
      scene_id: z.string().describe("The scene_id to retrieve prose for."),
    },
    async ({ scene_id }) => {
      const scene = db.prepare(`SELECT file_path, metadata_stale FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return { content: [{ type: "text", text: `Scene '${scene_id}' not found. Run sync() if you just added it.` }] };
      }
      try {
        const raw = fs.readFileSync(scene.file_path, "utf8");
        const { content: prose } = matter(raw);
        const warning = scene.metadata_stale
          ? `\n\n⚠️ Metadata for this scene may be stale — prose has changed since last enrichment.`
          : "";
        return { content: [{ type: "text", text: prose.trim() + warning }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed to read scene file: ${err.message}` }] };
      }
    }
  );

  // ---- get_chapter_prose ---------------------------------------------------
  s.tool(
    "get_chapter_prose",
    "Load prose for all scenes in a chapter, in order. Use sparingly — loads all scene files.",
    {
      project_id: z.string().describe("Project ID."),
      part:       z.number().int().describe("Part number."),
      chapter:    z.number().int().describe("Chapter number."),
    },
    async ({ project_id, part, chapter }) => {
      const scenes = db.prepare(`
        SELECT scene_id, title, file_path FROM scenes
        WHERE project_id = ? AND part = ? AND chapter = ?
        ORDER BY timeline_position
      `).all(project_id, part, chapter);

      if (scenes.length === 0) {
        return { content: [{ type: "text", text: `No scenes found for Part ${part}, Chapter ${chapter}.` }] };
      }

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

      return { content: [{ type: "text", text: parts.join("\n\n---\n\n") }] };
    }
  );

  // ---- get_arc -------------------------------------------------------------
  s.tool(
    "get_arc",
    "Get ordered scene metadata for all scenes involving a character. Returns metadata only — no prose.",
    {
      character_id: z.string().describe("The character ID to trace."),
      project_id:   z.string().optional().describe("Limit to a specific project."),
    },
    async ({ character_id, project_id }) => {
      let query = `
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.title, s.logline,
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
        return { content: [{ type: "text", text: `No scenes found for character '${character_id}'.` }] };
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0
        ? `\n\n⚠️ ${staleCount} scene(s) have stale metadata.`
        : "";

      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) + warning }] };
    }
  );

  // ---- list_characters -----------------------------------------------------
  s.tool(
    "list_characters",
    "List all characters, optionally filtered to a project or universe.",
    {
      project_id:  z.string().optional(),
      universe_id: z.string().optional(),
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
        return { content: [{ type: "text", text: "No characters found." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- get_character_sheet -------------------------------------------------
  s.tool(
    "get_character_sheet",
    "Get full character metadata including traits and extended notes from the character file.",
    {
      character_id: z.string().describe("The character ID to look up."),
    },
    async ({ character_id }) => {
      const character = db.prepare(`SELECT * FROM characters WHERE character_id = ?`).get(character_id);
      if (!character) {
        return { content: [{ type: "text", text: `Character '${character_id}' not found.` }] };
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
    "List all places, optionally filtered to a project or universe.",
    {
      project_id:  z.string().optional(),
      universe_id: z.string().optional(),
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
        return { content: [{ type: "text", text: "No places found." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- search_metadata -----------------------------------------------------
  s.tool(
    "search_metadata",
    "Full-text search across scene titles and loglines.",
    {
      query: z.string().describe("Search query."),
    },
    async ({ query }) => {
      const rows = db.prepare(`
        SELECT f.scene_id, s.project_id, s.title, s.logline, s.part, s.chapter, s.metadata_stale
        FROM scenes_fts f
        JOIN scenes s ON s.scene_id = f.scene_id
        WHERE scenes_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(query);

      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No scenes matched the search query." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- list_threads --------------------------------------------------------
  s.tool(
    "list_threads",
    "List all subplot/storyline threads for a project.",
    {
      project_id: z.string().describe("Project ID."),
    },
    async ({ project_id }) => {
      const rows = db.prepare(`SELECT * FROM threads WHERE project_id = ? ORDER BY name`).all(project_id);
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No threads found for project '${project_id}'.` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ---- get_thread_arc ------------------------------------------------------
  s.tool(
    "get_thread_arc",
    "Get ordered scene metadata for all scenes belonging to a thread, including the per-thread beat.",
    {
      thread_id: z.string().describe("Thread ID."),
    },
    async ({ thread_id }) => {
      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      if (!thread) {
        return { content: [{ type: "text", text: `Thread '${thread_id}' not found.` }] };
      }

      const rows = db.prepare(`
        SELECT s.scene_id, s.project_id, s.part, s.chapter, s.title, s.logline,
               st.beat AS thread_beat, s.timeline_position, s.story_time, s.metadata_stale
        FROM scenes s
        JOIN scene_threads st ON st.scene_id = s.scene_id AND st.thread_id = ?
        ORDER BY s.part, s.chapter, s.timeline_position
      `).all(thread_id);

      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No scenes assigned to thread '${thread_id}'.` }] };
      }

      const staleCount = rows.filter(r => r.metadata_stale).length;
      const warning = staleCount > 0 ? `\n\n⚠️ ${staleCount} scene(s) have stale metadata.` : "";

      return {
        content: [{
          type: "text",
          text: `Thread: ${thread.name} (${thread.status})\n\n` + JSON.stringify(rows, null, 2) + warning,
        }],
      };
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
