import { z } from "zod";
import fs from "node:fs";
import matter from "gray-matter";
import { readMeta, writeMeta, indexSceneFile, normalizeSceneMetaForPath } from "../sync/sync.js";
import { validateProjectId, validateUniverseId } from "../sync/importer.js";
import { resolveValidatedChapterFilter } from "../core/chapter-resolution.js";
import {
  persistSceneReferenceLink,
  upsertExplicitReferenceLinkRow,
  upsertSerializedReferenceLinks,
} from "./reference-link-persistence.js";

function persistReferenceDocLink({ filePath, targetDocId, relation }) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const data = parsed.data ?? {};
  const existingExplicit = [
    ...(Array.isArray(data.reference_links) ? data.reference_links : data.reference_links ? [data.reference_links] : []),
    ...(Array.isArray(data.related_reference_links) ? data.related_reference_links : data.related_reference_links ? [data.related_reference_links] : []),
    ...(Array.isArray(data.explicit_reference_links) ? data.explicit_reference_links : data.explicit_reference_links ? [data.explicit_reference_links] : []),
  ];
  const nextReferenceLinks = upsertSerializedReferenceLinks(existingExplicit, targetDocId, relation, {
    defaultRelation: "related",
  });

  const nextData = {
    ...data,
    reference_links: nextReferenceLinks,
  };
  delete nextData.related_reference_links;
  delete nextData.explicit_reference_links;

  if (relation === "related") {
    const existingIds = Array.isArray(data.related_reference_ids)
      ? data.related_reference_ids
      : typeof data.related_reference_ids === "string"
        ? data.related_reference_ids.split(",")
        : [];
    nextData.related_reference_ids = [...new Set([...existingIds.map((value) => String(value).trim()).filter(Boolean), targetDocId])];
  }

  fs.writeFileSync(filePath, matter.stringify(parsed.content, nextData), "utf8");
}

function persistCharacterReferenceLink({ characterPath, syncDir, targetDocId, relation }) {
  const { meta } = readMeta(characterPath, syncDir, { writable: true });
  const existingExplicit = [
    ...(Array.isArray(meta.reference_links) ? meta.reference_links : meta.reference_links ? [meta.reference_links] : []),
    ...(Array.isArray(meta.explicit_reference_links) ? meta.explicit_reference_links : meta.explicit_reference_links ? [meta.explicit_reference_links] : []),
  ];
  const nextReferenceLinks = upsertSerializedReferenceLinks(existingExplicit, targetDocId, relation, {
    defaultRelation: "informs",
  });

  const nextMeta = {
    ...meta,
    reference_links: nextReferenceLinks,
  };
  delete nextMeta.explicit_reference_links;

  writeMeta(characterPath, nextMeta);
}

function persistPlaceReferenceLink({ placePath, syncDir, targetDocId, relation }) {
  const { meta } = readMeta(placePath, syncDir, { writable: true });
  const existingExplicit = [
    ...(Array.isArray(meta.reference_links) ? meta.reference_links : meta.reference_links ? [meta.reference_links] : []),
    ...(Array.isArray(meta.explicit_reference_links) ? meta.explicit_reference_links : meta.explicit_reference_links ? [meta.explicit_reference_links] : []),
  ];
  const nextReferenceLinks = upsertSerializedReferenceLinks(existingExplicit, targetDocId, relation, {
    defaultRelation: "informs",
  });

  const nextMeta = {
    ...meta,
    reference_links: nextReferenceLinks,
  };
  delete nextMeta.explicit_reference_links;

  writeMeta(placePath, nextMeta);
}

function resolveProjectScopedSource({
  db,
  errorResponse,
  sourceId,
  sourceProjectId,
  table,
  idColumn,
  label,
}) {
  if (sourceProjectId) {
    const scoped = db.prepare(`
      SELECT ${idColumn} AS source_id, project_id, file_path
      FROM ${table}
      WHERE ${idColumn} = ? AND project_id = ?
      LIMIT 1
    `).get(sourceId, sourceProjectId);
    if (!scoped) {
      return { error: errorResponse("NOT_FOUND", `${label} '${sourceId}' not found in project '${sourceProjectId}'.`) };
    }
    return {
      value: {
        resolvedSourceProjectId: scoped.project_id ?? "",
        sourceFilePath: scoped.file_path,
      },
    };
  }

  const matches = db.prepare(`
    SELECT ${idColumn} AS source_id, project_id, file_path
    FROM ${table}
    WHERE ${idColumn} = ?
    ORDER BY project_id
  `).all(sourceId);

  if (matches.length === 0) {
    return { error: errorResponse("NOT_FOUND", `${label} '${sourceId}' not found.`) };
  }
  if (matches.length > 1) {
    return {
      error: errorResponse(
        "CONFLICT",
        `${label} ID '${sourceId}' exists in multiple projects. Provide source_project_id to disambiguate.`,
        { source_id: sourceId, project_ids: matches.map((row) => row.project_id) }
      ),
    };
  }

  return {
    value: {
      resolvedSourceProjectId: matches[0].project_id ?? "",
      sourceFilePath: matches[0].file_path,
    },
  };
}

function resolveReferenceLinkSource({
  db,
  errorResponse,
  sourceKind,
  sourceId,
  sourceProjectId,
  targetDocId,
}) {
  if (sourceKind === "reference") {
    const sourceDoc = db.prepare(`
      SELECT doc_id, project_id, file_path
      FROM reference_docs
      WHERE doc_id = ?
      LIMIT 1
    `).get(sourceId);
    if (!sourceDoc) {
      return { error: errorResponse("NOT_FOUND", `Source reference doc '${sourceId}' not found.`) };
    }
    if (sourceId === targetDocId) {
      return { error: errorResponse("VALIDATION_ERROR", "Self-links are not allowed for reference sources.") };
    }
    const resolvedSourceProjectId = sourceDoc.project_id ?? "";
    if ((sourceProjectId ?? "") !== "" && sourceProjectId !== resolvedSourceProjectId) {
      const resolvedSourceProjectLabel = resolvedSourceProjectId === ""
        ? "unscoped/no project"
        : `project '${resolvedSourceProjectId}'`;
      const requestedSourceProjectLabel = sourceProjectId === ""
        ? "unscoped/no project"
        : `project '${sourceProjectId}'`;
      return {
        error: errorResponse(
          "CONFLICT",
          `Source reference doc '${sourceId}' belongs to ${resolvedSourceProjectLabel}, not ${requestedSourceProjectLabel}.`,
          {
            source_id: sourceId,
            source_project_id: sourceProjectId,
            resolved_source_project_id: resolvedSourceProjectId,
          }
        ),
      };
    }
    return {
      value: {
        resolvedSourceProjectId,
        sourceFilePath: sourceDoc.file_path,
      },
    };
  }

  const sourceConfigByKind = {
    scene: { table: "scenes", idColumn: "scene_id", label: "Scene" },
    character: { table: "characters", idColumn: "character_id", label: "Character" },
    place: { table: "places", idColumn: "place_id", label: "Place" },
  };
  const config = sourceConfigByKind[sourceKind];
  return resolveProjectScopedSource({
    db,
    errorResponse,
    sourceId,
    sourceProjectId,
    table: config.table,
    idColumn: config.idColumn,
    label: config.label,
  });
}

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
        INSERT INTO scene_threads (scene_id, project_id, thread_id, beat)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (scene_id, project_id, thread_id) DO UPDATE SET
          beat = excluded.beat
      `).run(scene_id, project_id, thread_id, beat ?? null);

      const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
      const link = db.prepare(`SELECT scene_id, project_id, thread_id, beat FROM scene_threads WHERE scene_id = ? AND project_id = ? AND thread_id = ?`)
        .get(scene_id, project_id, thread_id);

      return jsonResponse({
        ok: true,
        action: "upserted",
        thread,
        link,
      });
    }
  );

  // ---- upsert_reference_link -----------------------------------------------
  s.tool(
    "upsert_reference_link",
    "Create or update an explicit reference link from a scene, character, place, or reference doc to a target reference doc. If a link already exists between the same source and target, this updates the relation. Only available when the sync dir is writable.",
    {
      source_kind: z.enum(["scene", "character", "place", "reference"]).describe("Link source kind."),
      source_id: z.string().describe("Source scene_id, character_id, place_id, or reference doc_id."),
      source_project_id: z.string().optional().describe("Optional project scope for the source. For scene/character/place sources, use this to disambiguate an ambiguous source_id across projects. For reference sources, when provided, it is treated as an ownership check and must match the source reference doc's project."),
      target_doc_id: z.string().describe("Target reference doc_id."),
      relation: z.string().describe("Relationship label (for example: 'informs', 'related', 'history_of'). The value is trimmed and lowercased before validation."),
    },
    async ({ source_kind, source_id, source_project_id, target_doc_id, relation }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot write reference links: sync dir is read-only.");
      }

      const normalizedRelation = relation.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(normalizedRelation)) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Relation is normalized to lowercase and must match [a-z][a-z0-9_-]* after normalization (for example: 'informs' or 'history_of').",
          { relation }
        );
      }

      const targetDoc = db.prepare(`
        SELECT doc_id
        FROM reference_docs
        WHERE doc_id = ?
      `).get(target_doc_id);
      if (!targetDoc) {
        return errorResponse("NOT_FOUND", `Target reference doc '${target_doc_id}' not found.`);
      }

      const sourceResolution = resolveReferenceLinkSource({
        db,
        errorResponse,
        sourceKind: source_kind,
        sourceId: source_id,
        sourceProjectId: source_project_id,
        targetDocId: target_doc_id,
      });
      if (sourceResolution.error) {
        return sourceResolution.error;
      }
      const { resolvedSourceProjectId, sourceFilePath } = sourceResolution.value;

      try {
        if (source_kind === "scene") {
          if (!sourceFilePath) {
            return errorResponse("STALE_PATH", `Scene '${source_id}' has no indexed file path. Run sync() to refresh.`, {
              source_id,
              source_project_id: resolvedSourceProjectId,
            });
          }
          persistSceneReferenceLink({
            scenePath: sourceFilePath,
            syncDir: SYNC_DIR,
            targetDocId: target_doc_id,
            relation: normalizedRelation,
          });
        } else if (source_kind === "character") {
          if (!sourceFilePath) {
            return errorResponse("STALE_PATH", `Character '${source_id}' has no indexed file path. Run sync() to refresh.`, {
              source_id,
              source_project_id: resolvedSourceProjectId,
            });
          }
          persistCharacterReferenceLink({
            characterPath: sourceFilePath,
            syncDir: SYNC_DIR,
            targetDocId: target_doc_id,
            relation: normalizedRelation,
          });
        } else if (source_kind === "place") {
          if (!sourceFilePath) {
            return errorResponse("STALE_PATH", `Place '${source_id}' has no indexed file path. Run sync() to refresh.`, {
              source_id,
              source_project_id: resolvedSourceProjectId,
            });
          }
          persistPlaceReferenceLink({
            placePath: sourceFilePath,
            syncDir: SYNC_DIR,
            targetDocId: target_doc_id,
            relation: normalizedRelation,
          });
        } else {
          if (!sourceFilePath) {
            return errorResponse("STALE_PATH", `Reference doc '${source_id}' has no indexed file path. Run sync() to refresh.`, {
              source_id,
            });
          }
          persistReferenceDocLink({
            filePath: sourceFilePath,
            targetDocId: target_doc_id,
            relation: normalizedRelation,
          });
        }
      } catch (err) {
        if (err?.code === "ENOENT") {
          return errorResponse(
            "STALE_PATH",
            `Source file for ${source_kind} '${source_id}' not found at indexed path — run sync() to refresh.`,
            { indexed_path: sourceFilePath }
          );
        }
        return errorResponse("IO_ERROR", `Failed to persist link metadata: ${err.message}`);
      }

      try {
        db.exec("BEGIN");
        upsertExplicitReferenceLinkRow(db, {
          sourceKind: source_kind,
          sourceProjectId: resolvedSourceProjectId,
          sourceId: source_id,
          targetDocId: target_doc_id,
          relation: normalizedRelation,
        });
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        throw err;
      }

      const link = db.prepare(`
        SELECT source_kind, source_project_id, source_id, target_doc_id, relation, origin
        FROM reference_links
        WHERE source_kind = ? AND source_project_id = ? AND source_id = ? AND target_doc_id = ? AND relation = ?
      `).get(source_kind, resolvedSourceProjectId, source_id, target_doc_id, normalizedRelation);

      return jsonResponse({
        ok: true,
        action: "upserted",
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
        chapter:           z.number().int().optional().describe("Compatibility chapter number. When it resolves to a canonical chapter, update_scene_metadata also persists the matching chapter_id."),
        chapter_id:        z.string().nullable().optional().describe("Canonical chapter identifier. Use list_chapters to find valid values. Pass null to clear an explicit chapter link on an unchaptered scene."),
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
        const nextFields = { ...fields };

        if (fields.chapter_id === null && fields.chapter !== undefined) {
          return errorResponse(
            "VALIDATION_ERROR",
            "chapter_id cannot be null when chapter is also provided.",
            {
              project_id,
              chapter_id: null,
              chapter: fields.chapter,
            }
          );
        }

        if (fields.chapter_id === null) {
          nextFields.chapter = null;
          nextFields.chapter_title = null;
        } else if (fields.chapter_id !== undefined || fields.chapter !== undefined) {
          const resolvedChapterFilter = resolveValidatedChapterFilter(db, {
            projectId: project_id,
            chapterNumber: fields.chapter,
            chapterId: fields.chapter_id,
          });

          if (resolvedChapterFilter.error) {
            return errorResponse(
              resolvedChapterFilter.error.code,
              resolvedChapterFilter.error.message,
              {
                project_id,
                chapter_id: fields.chapter_id ?? null,
                chapter: fields.chapter ?? null,
              }
            );
          }

          const resolvedChapter = resolvedChapterFilter.chapter;

          if (!resolvedChapter) {
            return errorResponse(
              "NOT_FOUND",
              "Chapter not found for the provided project and identifier.",
              {
                project_id,
                chapter_id: fields.chapter_id ?? null,
                chapter: fields.chapter ?? null,
              }
            );
          }

          nextFields.chapter_id = resolvedChapter.chapter_id;
          nextFields.chapter = resolvedChapter.sort_index;
          nextFields.chapter_title = resolvedChapter.title ?? null;
        }

        const updated = normalizeSceneMetaForPath(SYNC_DIR, scene.file_path, { ...meta, ...nextFields }).meta;
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
