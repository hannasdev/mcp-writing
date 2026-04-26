import { z } from "zod";
import fs from "node:fs";
import matter from "gray-matter";
import { readMeta, writeMeta, indexSceneFile, normalizeSceneMetaForPath } from "../sync.js";
import { validateProjectId, validateUniverseId } from "../importer.js";

export function registerMetadataTools(s, {
  db,
  SYNC_DIR,
  SYNC_DIR_WRITABLE,
  errorResponse,
  jsonResponse,
  createCanonicalWorldEntity,
}) {
  // ---- create_character_sheet ---------------------------------------------
  s.tool(
    "create_character_sheet",
    "Create or reuse a canonical character sheet folder with sheet.md and sheet.meta.yaml so the character can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.",
    {
      name: z.string().describe("Display name of the character (e.g. 'Mira Nystrom')."),
      project_id: z.string().optional().describe("Project scope for a book-local character (e.g. 'universe-1/book-1-the-lamb' or 'test-novel')."),
      universe_id: z.string().optional().describe("Universe scope for a cross-book shared character (e.g. 'universe-1')."),
      notes: z.string().optional().describe("Optional starter prose content for sheet.md."),
      fields: z.object({
        role: z.string().optional(),
        arc_summary: z.string().optional(),
        first_appearance: z.string().optional(),
        traits: z.array(z.string()).optional(),
      }).optional().describe("Optional starter metadata fields for the character sidecar."),
    },
    async ({ name, project_id, universe_id, notes, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot create character sheet: sync dir is read-only.");
      }
      const hasProjectId = project_id !== undefined;
      const hasUniverseId = universe_id !== undefined;
      if ((hasProjectId && hasUniverseId) || (!hasProjectId && !hasUniverseId)) {
        return errorResponse("VALIDATION_ERROR", "Provide exactly one of project_id or universe_id.");
      }
      if (hasProjectId) {
        const check = validateProjectId(project_id);
        if (!check.ok) return errorResponse("INVALID_PROJECT_ID", check.reason, { project_id });
      }
      if (hasUniverseId) {
        const check = validateUniverseId(universe_id);
        if (!check.ok) return errorResponse("INVALID_UNIVERSE_ID", check.reason, { universe_id });
      }

      try {
        const result = createCanonicalWorldEntity({
          kind: "character",
          name,
          notes,
          projectId: project_id,
          universeId: universe_id,
          meta: fields ?? {},
        });

        return jsonResponse({ ok: true, action: result.created ? "created" : "exists", kind: "character", ...result });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to create character sheet: ${err.message}`);
      }
    }
  );

  // ---- create_place_sheet -------------------------------------------------
  s.tool(
    "create_place_sheet",
    "Create or reuse a canonical place sheet folder with sheet.md and sheet.meta.yaml so the place can be indexed immediately. If the folder already exists, missing canonical files are backfilled and the existing sheet is preserved.",
    {
      name: z.string().describe("Display name of the place (e.g. 'University Hospital')."),
      project_id: z.string().optional().describe("Project scope for a book-local place (e.g. 'universe-1/book-1-the-lamb' or 'test-novel')."),
      universe_id: z.string().optional().describe("Universe scope for a cross-book shared place (e.g. 'universe-1')."),
      notes: z.string().optional().describe("Optional starter prose content for sheet.md."),
      fields: z.object({
        associated_characters: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      }).optional().describe("Optional starter metadata fields for the place sidecar."),
    },
    async ({ name, project_id, universe_id, notes, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot create place sheet: sync dir is read-only.");
      }
      const hasProjectId = project_id !== undefined;
      const hasUniverseId = universe_id !== undefined;
      if ((hasProjectId && hasUniverseId) || (!hasProjectId && !hasUniverseId)) {
        return errorResponse("VALIDATION_ERROR", "Provide exactly one of project_id or universe_id.");
      }
      if (hasProjectId) {
        const check = validateProjectId(project_id);
        if (!check.ok) return errorResponse("INVALID_PROJECT_ID", check.reason, { project_id });
      }
      if (hasUniverseId) {
        const check = validateUniverseId(universe_id);
        if (!check.ok) return errorResponse("INVALID_UNIVERSE_ID", check.reason, { universe_id });
      }

      try {
        const result = createCanonicalWorldEntity({
          kind: "place",
          name,
          notes,
          projectId: project_id,
          universeId: universe_id,
          meta: fields ?? {},
        });

        return jsonResponse({ ok: true, action: result.created ? "created" : "exists", kind: "place", ...result });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to create place sheet: ${err.message}`);
      }
    }
  );

  // ---- upsert_thread_link --------------------------------------------------
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
        status:            z.string().optional().describe("Workflow status (e.g. 'draft', 'revision', 'complete'). Free text — no fixed vocabulary."),
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
      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const updated = normalizeSceneMetaForPath(SYNC_DIR, scene.file_path, { ...meta, ...fields }).meta;
        writeMeta(scene.file_path, updated);

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        indexSceneFile(db, SYNC_DIR, scene.file_path, updated, prose);

        return { content: [{ type: "text", text: `Updated metadata for scene '${scene_id}'.` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write metadata for scene '${scene_id}': ${err.message}`);
      }
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
      try {
        const { meta } = readMeta(char.file_path, SYNC_DIR, { writable: true });
        const updated = { ...meta, ...fields };
        writeMeta(char.file_path, updated);

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
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Character file for '${character_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: char.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write character metadata for '${character_id}': ${err.message}`);
      }
    }
  );

  // ---- update_place_sheet --------------------------------------------------
  s.tool(
    "update_place_sheet",
    "Update structured metadata fields for a place (name, associated_characters, tags). Writes to the .meta.yaml sidecar — never modifies the prose notes file. Changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      place_id: z.string().describe("The place_id to update (e.g. 'place-harbor-district'). Use list_places to find valid IDs."),
      fields: z.object({
        name:                  z.string().optional(),
        associated_characters: z.array(z.string()).optional(),
        tags:                  z.array(z.string()).optional(),
      }).describe("Fields to update. Only supplied keys are changed."),
    },
    async ({ place_id, fields }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot update place: sync dir is read-only.");
      }
      const place = db.prepare(`SELECT file_path FROM places WHERE place_id = ?`).get(place_id);
      if (!place) {
        return errorResponse("NOT_FOUND", `Place '${place_id}' not found.`);
      }
      try {
        const { meta } = readMeta(place.file_path, SYNC_DIR, { writable: true });
        const updated = { ...meta, ...fields };
        writeMeta(place.file_path, updated);

        db.prepare(`UPDATE places SET name = ? WHERE place_id = ?`)
          .run(updated.name ?? meta.name ?? place_id, place_id);

        return { content: [{ type: "text", text: `Updated place sheet for '${place_id}'.` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Place file for '${place_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: place.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to write place metadata for '${place_id}': ${err.message}`);
      }
    }
  );

  // ---- flag_scene ----------------------------------------------------------
  s.tool(
    "flag_scene",
    "Attach a continuity or review note to a scene. Flags are appended to the sidecar file and accumulate over time — they are never overwritten. Use this to record continuity problems, revision notes, or questions you want to revisit.",
    {
      scene_id:   z.string().describe("The scene_id to flag (e.g. 'sc-012-open-to-anyone')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      note:       z.string().describe("The flag note (e.g. 'Victor knows Mira’s name here, but they haven’t been introduced yet — contradicts sc-006')."),
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
      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const flags = meta.flags ?? [];
        flags.push({ note, flagged_at: new Date().toISOString() });
        writeMeta(scene.file_path, { ...meta, flags });
        return { content: [{ type: "text", text: `Flagged scene '${scene_id}': ${note}` }] };
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to flag scene '${scene_id}': ${err.message}`);
      }
    }
  );
}
