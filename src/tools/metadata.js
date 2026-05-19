import { z } from "zod";
import fs from "node:fs";
import matter from "gray-matter";
import { readMeta, writeMeta, indexSceneFile, applySceneStructurePatch } from "../sync/sync.js";
import { validateProjectId, validateUniverseId } from "../sync/importer.js";
import { resolveValidatedChapterFilter } from "../core/chapter-resolution.js";
import { buildMoveScenePlan, buildSceneChapterAssignmentPlan } from "../structure/scene-chapter-assignment.js";
import {
  buildCreateChapterPlan,
  buildRenameChapterPlan,
  buildReorderChapterPlan,
  buildAttachEpigraphPlan,
  insertCanonicalChapter,
  renameCanonicalChapter,
  reorderCanonicalChapter,
  attachCanonicalEpigraph,
} from "../structure/chapter-commands.js";
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

function writeStructureSidecarUpdates(updates, { failureCode }) {
  const failures = [];
  let updatedCount = 0;

  for (const update of updates) {
    try {
      writeMeta(update.filePath, update.meta);
      updatedCount += 1;
    } catch (err) {
      failures.push({
        file_path: update.filePath,
        message: err.message,
      });
    }
  }

  return {
    updatedCount,
    diagnostics: failures.length
      ? [
        {
          code: failureCode,
          severity: "warning",
          message: "Canonical structure was updated, but one or more explicit sidecar compatibility updates failed.",
          next_step: "Inspect the failed sidecar paths, then run sync and diagnose_structure before making more structure changes.",
          details: {
            failed_sidecar_count: failures.length,
            failures,
          },
        },
      ]
      : [],
  };
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

  // ---- create_chapter ------------------------------------------------------
  s.tool(
    "create_chapter",
    "Create a canonical chapter record through the explicit structure workflow. Writes canonical chapter state only; it does not create scene files, sidecars, or Scrivener-compatible folders. Use assign_scene_to_chapter afterward to place unchaptered scenes in the new chapter.",
    {
      project_id: z.string().describe("Project the chapter belongs to (e.g. 'the-lamb')."),
      title: z.string().describe("Human-readable chapter title."),
      sort_index: z.number().int().min(1).describe("Canonical chapter order within the project. Must be unused."),
      chapter_id: z.string().optional().describe("Optional canonical chapter identifier. If omitted, one is derived from sort_index and title."),
      logline: z.string().optional().describe("Optional chapter-level logline."),
    },
    async ({ project_id, title, sort_index, chapter_id, logline }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot create chapter: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const plan = buildCreateChapterPlan(db, {
        projectId: project_id,
        title,
        sortIndex: sort_index,
        chapterId: chapter_id,
        logline,
      });
      if (!plan.ok) {
        return errorResponse(plan.error.code, plan.error.message, {
          project_id,
          title,
          sort_index,
          chapter_id: chapter_id ?? null,
          ...(plan.error.details ?? {}),
        });
      }

      try {
        db.exec("BEGIN");
        insertCanonicalChapter(db, plan.chapter);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        return errorResponse("IO_ERROR", `Failed to create chapter '${plan.chapter.chapter_id}': ${err.message}`);
      }

      return jsonResponse({
        ok: true,
        action: "created",
        chapter: {
          chapter_id: plan.chapter.chapter_id,
          project_id: plan.chapter.project_id,
          title: plan.chapter.title,
          sort_index: plan.chapter.sort_index,
          logline: plan.chapter.logline,
          metadata_stale: plan.chapter.metadata_stale,
        },
        diagnostics: plan.diagnostics,
        next_steps: [
          "Use assign_scene_to_chapter to place unchaptered scenes in this chapter.",
          "Run diagnose_structure if existing folders or sidecars may imply conflicting structure.",
        ],
      });
    }
  );

  // ---- rename_chapter ------------------------------------------------------
  s.tool(
    "rename_chapter",
    "Rename a canonical chapter through the explicit structure workflow. Updates canonical chapter state and explicit scene chapter_title compatibility fields; it does not rename scene files, sidecars by path-derived structure, or Scrivener-compatible folders.",
    {
      project_id: z.string().describe("Project the chapter belongs to (e.g. 'the-lamb')."),
      chapter_id: z.string().describe("Canonical chapter identifier. Use list_chapters to find valid values."),
      title: z.string().describe("New human-readable chapter title."),
    },
    async ({ project_id, chapter_id, title }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot rename chapter: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const plan = buildRenameChapterPlan(db, {
        projectId: project_id,
        chapterId: chapter_id,
        title,
      });
      if (!plan.ok) {
        return errorResponse(plan.error.code, plan.error.message, {
          project_id,
          chapter_id,
          title,
          ...(plan.error.details ?? {}),
        });
      }

      const linkedScenes = db.prepare(`
        SELECT scene_id, project_id, file_path
        FROM scenes
        WHERE project_id = ? AND chapter_id = ?
        ORDER BY scene_id
      `).all(project_id, chapter_id);

      const sidecarUpdates = [];
      try {
        for (const scene of linkedScenes) {
          const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
          if (meta.chapter_id === chapter_id) {
            sidecarUpdates.push({
              scene,
              filePath: scene.file_path,
              meta: {
                ...meta,
                chapter_title: plan.chapter.title,
              },
            });
          }
        }

        db.exec("BEGIN");
        renameCanonicalChapter(db, plan.chapter);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Cannot rename chapter '${chapter_id}': an indexed scene file is missing. Run sync() to refresh.`, {
            project_id,
            chapter_id,
          });
        }
        return errorResponse("IO_ERROR", `Failed to rename chapter '${chapter_id}': ${err.message}`);
      }

      const sidecarWriteResult = writeStructureSidecarUpdates(sidecarUpdates, {
        failureCode: "SCENE_SIDECAR_UPDATE_FAILED",
      });

      return jsonResponse({
        ok: true,
        action: "renamed",
        chapter: {
          chapter_id: plan.chapter.chapter_id,
          project_id: plan.chapter.project_id,
          title: plan.chapter.title,
          sort_index: plan.chapter.sort_index,
          logline: plan.chapter.logline,
          metadata_stale: plan.chapter.metadata_stale,
        },
        previous_title: plan.previousChapter.title,
        updated_scene_count: linkedScenes.length,
        updated_sidecar_count: sidecarWriteResult.updatedCount,
        diagnostics: [
          ...plan.diagnostics,
          ...sidecarWriteResult.diagnostics,
        ],
        next_steps: [
          "Use list_chapters to confirm the canonical title.",
          "Run diagnose_structure if folder-derived structure may still use the previous chapter title.",
        ],
      });
    }
  );

  // ---- reorder_chapter -----------------------------------------------------
  s.tool(
    "reorder_chapter",
    "Reorder a canonical chapter through the explicit structure workflow. Updates canonical chapter order and explicit scene chapter/chapter_title compatibility fields; it does not rename, move, or resequence scene files, sidecars by path-derived structure, or Scrivener-compatible folders.",
    {
      project_id: z.string().describe("Project the chapter belongs to (e.g. 'the-lamb')."),
      chapter_id: z.string().describe("Canonical chapter identifier. Use list_chapters to find valid values."),
      sort_index: z.number().int().min(1).describe("New canonical chapter order within the project. Must be unused."),
    },
    async ({ project_id, chapter_id, sort_index }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot reorder chapter: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const plan = buildReorderChapterPlan(db, {
        projectId: project_id,
        chapterId: chapter_id,
        sortIndex: sort_index,
      });
      if (!plan.ok) {
        return errorResponse(plan.error.code, plan.error.message, {
          project_id,
          chapter_id,
          sort_index,
          ...(plan.error.details ?? {}),
        });
      }

      const linkedScenes = db.prepare(`
        SELECT scene_id, project_id, file_path
        FROM scenes
        WHERE project_id = ? AND chapter_id = ?
        ORDER BY scene_id
      `).all(project_id, chapter_id);

      const sidecarUpdates = [];
      try {
        for (const scene of linkedScenes) {
          const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
          if (meta.chapter_id === chapter_id) {
            sidecarUpdates.push({
              scene,
              filePath: scene.file_path,
              meta: {
                ...meta,
                chapter: plan.chapter.sort_index,
                chapter_title: plan.chapter.title,
              },
            });
          }
        }

        db.exec("BEGIN");
        reorderCanonicalChapter(db, plan.chapter);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Cannot reorder chapter '${chapter_id}': an indexed scene file is missing. Run sync() to refresh.`, {
            project_id,
            chapter_id,
          });
        }
        return errorResponse("IO_ERROR", `Failed to reorder chapter '${chapter_id}': ${err.message}`);
      }

      const sidecarWriteResult = writeStructureSidecarUpdates(sidecarUpdates, {
        failureCode: "SCENE_SIDECAR_UPDATE_FAILED",
      });

      return jsonResponse({
        ok: true,
        action: "reordered",
        chapter: {
          chapter_id: plan.chapter.chapter_id,
          project_id: plan.chapter.project_id,
          title: plan.chapter.title,
          sort_index: plan.chapter.sort_index,
          logline: plan.chapter.logline,
          metadata_stale: plan.chapter.metadata_stale,
        },
        previous_sort_index: plan.previousChapter.sort_index,
        updated_scene_count: linkedScenes.length,
        updated_sidecar_count: sidecarWriteResult.updatedCount,
        diagnostics: [
          ...plan.diagnostics,
          ...sidecarWriteResult.diagnostics,
        ],
        next_steps: [
          "Use list_chapters to confirm canonical order.",
          "Run diagnose_structure if folder-derived structure may still use the previous order.",
        ],
      });
    }
  );

  // ---- attach_epigraph -----------------------------------------------------
  s.tool(
    "attach_epigraph",
    "Attach an existing canonical epigraph to a canonical chapter through the explicit structure workflow. Updates canonical epigraph linkage and explicit epigraph sidecar fields; it does not move, rename, or create epigraph source files or Scrivener-compatible folders.",
    {
      project_id: z.string().describe("Project the epigraph belongs to (e.g. 'the-lamb')."),
      epigraph_id: z.string().describe("Canonical epigraph identifier. Use find_epigraphs to find valid values."),
      chapter_id: z.string().describe("Canonical chapter identifier. Use list_chapters to find valid values."),
    },
    async ({ project_id, epigraph_id, chapter_id }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot attach epigraph: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const plan = buildAttachEpigraphPlan(db, {
        projectId: project_id,
        epigraphId: epigraph_id,
        chapterId: chapter_id,
      });
      if (!plan.ok) {
        return errorResponse(plan.error.code, plan.error.message, {
          project_id,
          epigraph_id,
          chapter_id,
          ...(plan.error.details ?? {}),
        });
      }

      try {
        const { meta } = readMeta(plan.epigraph.file_path, SYNC_DIR, { writable: true });
        const sidecarUpdate = {
          filePath: plan.epigraph.file_path,
          meta: {
          ...meta,
          kind: meta.kind ?? "epigraph",
          epigraph_id: plan.epigraph.epigraph_id,
          chapter_id: plan.chapter.chapter_id,
          chapter: plan.chapter.sort_index,
          chapter_title: plan.chapter.title,
          },
        };

        db.exec("BEGIN");
        attachCanonicalEpigraph(db, plan.epigraph);
        db.exec("COMMIT");

        const sidecarWriteResult = writeStructureSidecarUpdates([sidecarUpdate], {
          failureCode: "EPIGRAPH_SIDECAR_UPDATE_FAILED",
        });

        return jsonResponse({
          ok: true,
          action: "attached",
          epigraph: {
            epigraph_id: plan.epigraph.epigraph_id,
            project_id: plan.epigraph.project_id,
            chapter_id: plan.epigraph.chapter_id,
            metadata_stale: plan.epigraph.metadata_stale,
          },
          chapter: {
            chapter_id: plan.chapter.chapter_id,
            title: plan.chapter.title,
            sort_index: plan.chapter.sort_index,
          },
          previous_chapter: plan.previousChapter
            ? {
              chapter_id: plan.previousChapter.chapter_id,
              title: plan.previousChapter.title,
              sort_index: plan.previousChapter.sort_index,
            }
            : null,
          updated_sidecar_count: sidecarWriteResult.updatedCount,
          diagnostics: [
            ...plan.diagnostics,
            ...sidecarWriteResult.diagnostics,
          ],
          next_steps: [
            "Use find_epigraphs to confirm the canonical epigraph attachment.",
            "Run diagnose_structure if folder-derived structure may still imply the previous chapter.",
          ],
        });
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Cannot attach epigraph '${epigraph_id}': the indexed epigraph file is missing. Run sync() to refresh.`, {
            project_id,
            epigraph_id,
            chapter_id,
          });
        }
        return errorResponse("IO_ERROR", `Failed to attach epigraph '${epigraph_id}': ${err.message}`);
      }
    }
  );

  // ---- move_scene ----------------------------------------------------------
  s.tool(
    "move_scene",
    "Move a scene through the explicit structure workflow. Updates canonical chapter linkage and/or timeline_position in the scene sidecar and index; it does not move, rename, or resequence scene files or Scrivener-compatible folders.",
    {
      scene_id: z.string().describe("The scene_id to move (e.g. 'sc-011-sebastian')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      chapter_id: z.string().optional().describe("Optional canonical chapter identifier. Use list_chapters to find valid values. Omit to keep the current chapter."),
      timeline_position: z.number().int().min(1).optional().describe("Optional new position within the target chapter. Must be unused."),
    },
    async ({ scene_id, project_id, chapter_id, timeline_position }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot move scene: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      if (chapter_id === undefined && timeline_position === undefined) {
        return errorResponse("VALIDATION_ERROR", "Provide chapter_id and/or timeline_position for move_scene.", {
          project_id,
          scene_id,
        });
      }

      const scene = db.prepare(`
        SELECT scene_id, project_id, chapter_id, chapter, chapter_title, timeline_position, file_path
        FROM scenes
        WHERE scene_id = ? AND project_id = ?
      `).get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      let chapter = undefined;
      if (chapter_id !== undefined) {
        const resolvedChapterFilter = resolveValidatedChapterFilter(db, {
          projectId: project_id,
          chapterId: chapter_id,
        });

        if (resolvedChapterFilter.error) {
          return errorResponse(
            resolvedChapterFilter.error.code,
            resolvedChapterFilter.error.message,
            { project_id, chapter_id }
          );
        }

        chapter = resolvedChapterFilter.chapter;
        if (!chapter) {
          return errorResponse("NOT_FOUND", "Chapter not found for the provided project and identifier.", {
            project_id,
            chapter_id,
          });
        }
      }

      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const plan = buildMoveScenePlan(SYNC_DIR, scene.file_path, meta, {
          currentScene: scene,
          chapter,
          timelinePosition: timeline_position,
        });
        if (!plan.ok) {
          return errorResponse(plan.error.code, plan.error.message, {
            project_id,
            scene_id,
            chapter_id: chapter_id ?? null,
            timeline_position: timeline_position ?? null,
            ...(plan.error.details ?? {}),
          });
        }

        const targetChapterId = plan.meta.chapter_id ?? null;
        const effectiveTimelinePosition = plan.timelinePosition;
        const targetChapterChanged = chapter_id !== undefined
          && (plan.previousChapterId ?? null) !== targetChapterId;
        if (effectiveTimelinePosition != null && (timeline_position !== undefined || targetChapterChanged)) {
          const positionConflict = targetChapterId === null
            ? db.prepare(`
              SELECT scene_id
              FROM scenes
              WHERE project_id = ? AND chapter_id IS NULL AND timeline_position = ? AND scene_id != ?
              ORDER BY scene_id
              LIMIT 1
            `).get(project_id, effectiveTimelinePosition, scene_id)
            : db.prepare(`
              SELECT scene_id
              FROM scenes
              WHERE project_id = ? AND chapter_id = ? AND timeline_position = ? AND scene_id != ?
              ORDER BY scene_id
              LIMIT 1
            `).get(project_id, targetChapterId, effectiveTimelinePosition, scene_id);

          if (positionConflict) {
            return errorResponse("VALIDATION_ERROR", `timeline_position ${effectiveTimelinePosition} is already used in the target chapter.`, {
              project_id,
              scene_id,
              chapter_id: targetChapterId,
              timeline_position: effectiveTimelinePosition,
              existing_scene_id: positionConflict.scene_id,
              next_step: "Choose an unused timeline_position. Automatic resequencing is not part of this command yet.",
            });
          }
        }

        writeMeta(scene.file_path, plan.meta);

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        indexSceneFile(db, SYNC_DIR, scene.file_path, plan.meta, prose);

        return jsonResponse({
          ok: true,
          action: "moved",
          scene_id,
          project_id,
          previous_chapter_id: plan.previousChapterId,
          previous_timeline_position: plan.previousTimelinePosition,
          chapter: plan.assignedChapter,
          timeline_position: plan.timelinePosition,
          diagnostics: [
            {
              code: "REPRESENTATION_NOT_MOVED",
              severity: "warning",
              message: "Moved canonical scene structure fields only; the existing scene source file was not moved or renamed.",
              next_step: "Run diagnose_structure if folder-derived structure may still imply the previous placement.",
              details: {
                file_path: scene.file_path,
              },
            },
          ],
          next_steps: [
            "Use find_scenes to confirm the scene's canonical chapter and timeline_position.",
            "Run diagnose_structure if folder-derived structure may still imply the previous placement.",
          ],
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path. Run sync() to refresh.`, {
            indexed_path: scene.file_path,
          });
        }
        return errorResponse("IO_ERROR", `Failed to move scene '${scene_id}': ${err.message}`);
      }
    }
  );

  // ---- assign_scene_to_chapter --------------------------------------------
  s.tool(
    "assign_scene_to_chapter",
    "Assign a scene to a canonical chapter through the explicit structure workflow. Writes chapter_id plus compatibility chapter/chapter_title fields to the scene sidecar and refreshes the index. Pass chapter_id=null to clear an explicit chapter link on an unchaptered scene. Use list_chapters first to choose a valid canonical chapter_id.",
    {
      scene_id: z.string().describe("The scene_id to assign (e.g. 'sc-011-sebastian')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      chapter_id: z.string().nullable().describe("Canonical chapter identifier. Use list_chapters to find valid values. Pass null to clear an explicit chapter link on an unchaptered scene."),
    },
    async ({ scene_id, project_id, chapter_id }) => {
      if (!SYNC_DIR_WRITABLE) {
        return errorResponse("READ_ONLY", "Cannot assign scene to chapter: sync dir is read-only.");
      }

      const projectIdCheck = validateProjectId(project_id);
      if (!projectIdCheck.ok) {
        return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
      }

      const scene = db.prepare(`
        SELECT scene_id, project_id, chapter_id, file_path
        FROM scenes
        WHERE scene_id = ? AND project_id = ?
      `).get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      let chapter = null;
      if (chapter_id !== null) {
        const resolvedChapterFilter = resolveValidatedChapterFilter(db, {
          projectId: project_id,
          chapterId: chapter_id,
        });

        if (resolvedChapterFilter.error) {
          return errorResponse(
            resolvedChapterFilter.error.code,
            resolvedChapterFilter.error.message,
            { project_id, chapter_id }
          );
        }

        chapter = resolvedChapterFilter.chapter;
        if (!chapter) {
          return errorResponse("NOT_FOUND", "Chapter not found for the provided project and identifier.", {
            project_id,
            chapter_id,
          });
        }
      }

      try {
        const { meta } = readMeta(scene.file_path, SYNC_DIR, { writable: true });
        const plan = buildSceneChapterAssignmentPlan(SYNC_DIR, scene.file_path, meta, { chapter });
        if (!plan.ok) {
          return errorResponse(plan.error.code, plan.error.message, {
            project_id,
            scene_id,
            chapter_id,
            ...(plan.error.details ?? {}),
          });
        }

        writeMeta(scene.file_path, plan.meta);

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        indexSceneFile(db, SYNC_DIR, scene.file_path, plan.meta, prose);

        return jsonResponse({
          ok: true,
          action: chapter === null ? "cleared" : "assigned",
          scene_id,
          project_id,
          previous_chapter_id: plan.previousChapterId ?? scene.chapter_id ?? null,
          chapter: plan.assignedChapter,
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to assign scene '${scene_id}' to chapter: ${err.message}`);
      }
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
        let chapter = undefined;

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
          const structurePlan = applySceneStructurePatch(SYNC_DIR, scene.file_path, meta);
          if (structurePlan.derived.chapter !== null || structurePlan.chapterStructure.chapter?.chapter_id) {
            return errorResponse(
              "VALIDATION_ERROR",
              "chapter_id cannot be cleared for a scene whose file path implies a chapter.",
              {
                project_id,
                scene_id,
                chapter_id: null,
                path_chapter: structurePlan.chapterStructure.chapter?.chapter_id ?? structurePlan.derived.chapter,
              }
            );
          }
          chapter = null;
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

          chapter = resolvedChapter;
        }

        const updated = applySceneStructurePatch(SYNC_DIR, scene.file_path, { ...meta, ...nextFields }, { chapter }).meta;
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
