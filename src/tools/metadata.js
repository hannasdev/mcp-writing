import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { readMeta, readSourceMeta, writeMeta, indexSceneFile, isManagedStructureProject, normalizeSceneMetaForPath, resolveSceneCharacterCompatibilityId } from "../sync/sync.js";
import { validateProjectId, validateUniverseId } from "../sync/importer.js";
import { resolveValidatedChapterFilter } from "../core/chapter-resolution.js";
import {
  FILESYSTEM_ARTIFACT_CLASSES,
  assertRegularFileReadTarget,
  resolveBoundaryRootReal,
  resolveArtifactPathInsideSyncRoot,
  writeTextInsideSyncRoot,
} from "../core/filesystem-boundary.js";
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
import {
  createToolActor,
  refreshProjectBackupAfterMutation,
} from "../structure/project-backup-refresh.js";

const STRUCTURAL_SCENE_METADATA_FIELDS = ["part", "chapter", "chapter_id", "chapter_title", "timeline_position"];
const RELATIONSHIP_SCENE_METADATA_FIELDS = ["characters", "places"];

function emptyBackupMutationResult() {
  return {
    operation_history: null,
    backup_refresh: null,
    backup_warnings: [],
  };
}

function refreshProjectScopedBackupAfterMutation(db, {
  syncDir,
  projectId,
  applicationVersion,
  operation,
  actor,
  affected,
  before,
  after,
  summary,
  metadata,
}) {
  if (!projectId) {
    return emptyBackupMutationResult();
  }
  return refreshProjectBackupAfterMutation(db, {
    syncDir,
    projectId,
    applicationVersion,
    operation,
    actor,
    affected,
    before,
    after,
    summary,
    metadata,
  });
}

function backupMutationFields(backupResult) {
  return {
    operation_history: backupResult.operation_history,
    backup_refresh: backupResult.backup_refresh,
    backup_warnings: backupResult.backup_warnings,
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
}

function buildCompatibilityOutput({ refreshed, diagnostics = [], role = "generated_transparency" } = {}) {
  return {
    role,
    generated_transparency: true,
    mutation_surface: false,
    refreshed: Boolean(refreshed),
    diagnostics,
  };
}

function getProvidedStructuralSceneMetadataFields(fields) {
  return STRUCTURAL_SCENE_METADATA_FIELDS.filter((field) => Object.hasOwn(fields, field));
}

function getProvidedRelationshipSceneMetadataFields(fields) {
  return RELATIONSHIP_SCENE_METADATA_FIELDS.filter((field) => Object.hasOwn(fields, field));
}

function buildRelationshipMetadataBoundaryDetails({ projectId, sceneId, blockedFields }) {
  return {
    project_id: projectId,
    scene_id: sceneId,
    blocked_fields: blockedFields,
    boundary: "scene_relationship_metadata",
    relationship_tools: [
      "connect_character_place_evidence",
      "connect_scene_character_evidence",
      "connect_scene_place_evidence",
      "audit_relationship_metadata",
    ],
    discovery_workflows: ["describe_workflows", "find_scenes", "list_characters", "list_places"],
    next_step: "Use find_scenes, list_characters, and list_places to identify stable IDs. Use connect_character_place_evidence when the scene proves paired sheet-backed character/place evidence, connect_scene_character_evidence for character-only evidence, connect_scene_place_evidence for place-only evidence, and audit_relationship_metadata to review legacy sidecar/frontmatter relationship fields.",
  };
}

function persistReferenceDocLink({ filePath, syncDir, targetDocId, relation }) {
  const syncDirAbs = path.resolve(syncDir);
  const syncDirReal = resolveBoundaryRootReal(syncDirAbs);
  resolveArtifactPathInsideSyncRoot(filePath, {
    syncDirAbs,
    syncDirReal,
    artifactClass: FILESYSTEM_ARTIFACT_CLASSES.METADATA_FILE,
    requireExisting: true,
    errorCode: "INVALID_METADATA_PATH",
    errorMessage: "Reference metadata path must be inside WRITING_SYNC_DIR.",
  });
  assertRegularFileReadTarget(path.resolve(filePath), { errorCode: "INVALID_METADATA_PATH" });

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

  writeTextInsideSyncRoot(filePath, matter.stringify(parsed.content, nextData), {
    syncDirAbs,
    syncDirReal,
    artifactClass: FILESYSTEM_ARTIFACT_CLASSES.METADATA_FILE,
    errorCode: "INVALID_METADATA_PATH",
  });
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

  writeMeta(characterPath, nextMeta, { syncDir });
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

  writeMeta(placePath, nextMeta, { syncDir });
}

function writeStructureSidecarUpdates(updates, { failureCode, syncDir }) {
  const failures = [];
  let updatedCount = 0;

  for (const update of updates) {
    try {
      writeMeta(update.filePath, update.meta, { syncDir });
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

function persistSceneStructureCanonical(db, {
  projectId,
  sceneId,
  assignedChapter,
  timelinePosition,
  updateTimelinePosition = false,
}) {
  const chapterId = assignedChapter?.chapter_id ?? null;
  const chapter = assignedChapter?.sort_index ?? null;
  const chapterTitle = assignedChapter?.title ?? null;
  const updatedAt = new Date().toISOString();

  if (updateTimelinePosition) {
    db.prepare(`
      UPDATE scenes
      SET chapter_id = ?,
          chapter = ?,
          chapter_title = ?,
          timeline_position = ?,
          updated_at = ?
      WHERE scene_id = ? AND project_id = ?
    `).run(chapterId, chapter, chapterTitle, timelinePosition ?? null, updatedAt, sceneId, projectId);
    return;
  }

  db.prepare(`
    UPDATE scenes
    SET chapter_id = ?,
        chapter = ?,
        chapter_title = ?,
        updated_at = ?
    WHERE scene_id = ? AND project_id = ?
  `).run(chapterId, chapter, chapterTitle, updatedAt, sceneId, projectId);
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

function getProjectUniverseId(db, projectId) {
  return db.prepare(`SELECT universe_id FROM projects WHERE project_id = ?`).get(projectId)?.universe_id ?? null;
}

function resolveCharacterForProject(db, { characterId, projectId }) {
  const universeId = getProjectUniverseId(db, projectId);
  return db.prepare(`
    SELECT character_id, project_id, universe_id, name
    FROM characters
    WHERE character_id = ?
      AND (
        project_id = ?
        OR (universe_id IS NOT NULL AND universe_id = ?)
        OR (project_id IS NULL AND universe_id IS NULL)
      )
    LIMIT 1
  `).get(characterId, projectId, universeId);
}

function resolvePlaceForProject(db, { placeId, projectId }) {
  const universeId = getProjectUniverseId(db, projectId);
  return db.prepare(`
    SELECT place_id, project_id, universe_id, name
    FROM places
    WHERE place_id = ?
      AND (
        project_id = ?
        OR (universe_id IS NOT NULL AND universe_id = ?)
        OR (project_id IS NULL AND universe_id IS NULL)
      )
    LIMIT 1
  `).get(placeId, projectId, universeId);
}

function querySceneRelationshipSnapshot(db, { sceneId, projectId }) {
  return {
    characters: db.prepare(`
      SELECT character_id
      FROM scene_characters
      WHERE scene_id = ? AND project_id = ?
      ORDER BY character_id
    `).all(sceneId, projectId).map(row => row.character_id),
    places: db.prepare(`
      SELECT place_id
      FROM scene_places
      WHERE scene_id = ? AND project_id = ?
      ORDER BY place_id
    `).all(sceneId, projectId).map(row => row.place_id),
  };
}

function sameStringSet(a, b) {
  const left = [...new Set(a.map(String))].sort();
  const right = [...new Set(b.map(String))].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeSceneRelationshipCompatibilityFields(db, sourceMeta) {
  const hasCharactersField = Object.hasOwn(sourceMeta, "characters");
  const hasPlacesField = Object.hasOwn(sourceMeta, "places");
  return {
    has_relationship_fields: hasCharactersField || hasPlacesField,
    has_characters_field: hasCharactersField,
    has_places_field: hasPlacesField,
    characters: normalizeStringList(sourceMeta.characters)
      .filter((value) => !isVersionContinuityMarker(value))
      .map((value) => resolveSceneCharacterCompatibilityId(db, value)),
    places: normalizeStringList(sourceMeta.places),
  };
}

function sceneRelationshipCompatibilityHasDrift(canonicalRelationships, compatibilityRelationships) {
  return (
    compatibilityRelationships.has_characters_field &&
    !sameStringSet(canonicalRelationships.characters, compatibilityRelationships.characters)
  ) || (
    compatibilityRelationships.has_places_field &&
    !sameStringSet(canonicalRelationships.places, compatibilityRelationships.places)
  );
}

function restoreSceneRelationshipSnapshot(db, { sceneId, projectId, snapshot }) {
  db.prepare(`DELETE FROM scene_characters WHERE scene_id = ? AND project_id = ?`).run(sceneId, projectId);
  db.prepare(`DELETE FROM scene_places WHERE scene_id = ? AND project_id = ?`).run(sceneId, projectId);

  const insertCharacter = db.prepare(`
    INSERT OR IGNORE INTO scene_characters (scene_id, project_id, character_id)
    VALUES (?, ?, ?)
  `);
  for (const characterId of snapshot.characters) {
    insertCharacter.run(sceneId, projectId, characterId);
  }

  const insertPlace = db.prepare(`
    INSERT OR IGNORE INTO scene_places (scene_id, project_id, place_id)
    VALUES (?, ?, ?)
  `);
  for (const placeId of snapshot.places) {
    insertPlace.run(sceneId, projectId, placeId);
  }
}

function isVersionContinuityMarker(value) {
  return /^v\d[\d.a-z]*$/i.test(String(value).trim());
}

function buildSceneMetadataSearchKeywords(meta, relationshipSnapshot) {
  const compatibilityVersionMarkers = normalizeStringList(meta.characters).filter(isVersionContinuityMarker);
  return [
    ...normalizeStringList(meta.tags),
    ...compatibilityVersionMarkers,
    ...relationshipSnapshot.characters,
    ...relationshipSnapshot.places,
    ...normalizeStringList(meta.versions),
  ]
    .filter(Boolean)
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

function restoreSceneRelationshipSearchKeywords(db, { sceneId, projectId, meta, snapshot }) {
  db.prepare(`DELETE FROM scenes_fts WHERE scene_id = ? AND project_id = ?`).run(sceneId, projectId);
  db.prepare(`
    INSERT INTO scenes_fts (scene_id, project_id, logline, title, keywords)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    meta.logline ?? meta.synopsis ?? "",
    meta.title ?? "",
    buildSceneMetadataSearchKeywords(meta, snapshot),
  );
}

function writeSceneRelationshipCompatibilityOutput({ db, sceneId, projectId, scenePath, syncDir, snapshot }) {
  const { sourceMeta } = readSourceMeta(scenePath, syncDir, { writable: true });
  const nextMeta = {
    ...sourceMeta,
    characters: uniqueSorted(snapshot.characters),
    places: uniqueSorted(snapshot.places),
  };
  writeMeta(scenePath, nextMeta, { syncDir });
  restoreSceneRelationshipSearchKeywords(db, {
    sceneId,
    projectId,
    meta: nextMeta,
    snapshot,
  });
}

export function registerMetadataTools(s, {
  db,
  SYNC_DIR,
  SYNC_DIR_WRITABLE,
  MCP_SERVER_VERSION = "0.0.0",
  errorResponse,
  jsonResponse,
  createCanonicalWorldEntity,
}) {
  async function trackThreadArcLink({ project_id, thread_id, thread_name, scene_id, beat, status }, { operation }) {
    if (!SYNC_DIR_WRITABLE) {
      return errorResponse("READ_ONLY", "Cannot write thread links: sync dir is read-only.");
    }
    const projectIdCheck = validateProjectId(project_id);
    if (!projectIdCheck.ok) {
      return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
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

    try {
      db.exec("BEGIN");
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
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        void rollbackErr;
      }
      return errorResponse("IO_ERROR", `Failed to track thread arc '${thread_id}' for scene '${scene_id}': ${err.message}`);
    }

    const thread = db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(thread_id);
    const link = db.prepare(`SELECT scene_id, project_id, thread_id, beat FROM scene_threads WHERE scene_id = ? AND project_id = ? AND thread_id = ?`)
      .get(scene_id, project_id, thread_id);
    const backupResult = refreshProjectScopedBackupAfterMutation(db, {
      syncDir: SYNC_DIR,
      projectId: project_id,
      applicationVersion: MCP_SERVER_VERSION,
      operation,
      actor: createToolActor(operation),
      affected: {
        threads: [thread_id],
        scenes: [scene_id],
      },
      summary: `Tracked thread "${thread_id}" for scene "${scene_id}".`,
      before: null,
      after: {
        thread,
        link,
      },
    });

    return jsonResponse({
      ok: true,
      action: operation === "upsert_thread_link" ? "upserted" : "tracked",
      thread,
      link,
      mutation_order: ["validated_request", "sqlite_commit", "project_backup_refresh"],
      ...backupMutationFields(backupResult),
    });
  }

  function writeReferenceLinkCompatibilityOutput({ sourceKind, sourceFilePath, targetDocId, relation }) {
    if (sourceKind === "scene") {
      persistSceneReferenceLink({
        scenePath: sourceFilePath,
        syncDir: SYNC_DIR,
        targetDocId,
        relation,
      });
    } else if (sourceKind === "character") {
      persistCharacterReferenceLink({
        characterPath: sourceFilePath,
        syncDir: SYNC_DIR,
        targetDocId,
        relation,
      });
    } else if (sourceKind === "place") {
      persistPlaceReferenceLink({
        placePath: sourceFilePath,
        syncDir: SYNC_DIR,
        targetDocId,
        relation,
      });
    } else {
      persistReferenceDocLink({
        filePath: sourceFilePath,
        syncDir: SYNC_DIR,
        targetDocId,
        relation,
      });
    }
  }

  async function linkReferenceEvidence({
    source_kind,
    source_id,
    source_project_id,
    target_doc_id,
    relation,
  }, { operation }) {
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
      SELECT doc_id, project_id
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
      return errorResponse("IO_ERROR", `Failed to link reference evidence in SQLite: ${err.message}`);
    }

    const link = db.prepare(`
      SELECT source_kind, source_project_id, source_id, target_doc_id, relation, origin
      FROM reference_links
      WHERE source_kind = ? AND source_project_id = ? AND source_id = ? AND target_doc_id = ? AND relation = ?
    `).get(source_kind, resolvedSourceProjectId, source_id, target_doc_id, normalizedRelation);
    const backupProjectId = resolvedSourceProjectId || targetDoc.project_id || null;
    const backupResult = refreshProjectScopedBackupAfterMutation(db, {
      syncDir: SYNC_DIR,
      projectId: backupProjectId,
      applicationVersion: MCP_SERVER_VERSION,
      operation,
      actor: createToolActor(operation),
      affected: {
        reference_docs: [target_doc_id],
        sources: [`${source_kind}:${source_id}`],
      },
      summary: `Linked ${source_kind} evidence from "${source_id}" to "${target_doc_id}".`,
      before: null,
      after: {
        link,
      },
    });

    const compatibilityDiagnostics = [];
    if (!sourceFilePath) {
      compatibilityDiagnostics.push({
        code: "STALE_PATH",
        severity: "warning",
        message: `Canonical reference link was committed, but ${source_kind} '${source_id}' has no indexed file path for generated compatibility output.`,
        next_step: "Treat SQLite and project backup artifacts as current. Run sync, inspect the indexed source path, then retry link_reference_evidence if compatibility output is still needed.",
        details: {
          source_kind,
          source_id,
          source_project_id: resolvedSourceProjectId,
          target_doc_id,
          indexed_path: null,
        },
      });
    } else {
      try {
        writeReferenceLinkCompatibilityOutput({
          sourceKind: source_kind,
          sourceFilePath,
          targetDocId: target_doc_id,
          relation: normalizedRelation,
        });
      } catch (err) {
        compatibilityDiagnostics.push({
          code: err?.code ?? "COMPATIBILITY_OUTPUT_FAILED",
          severity: "warning",
          message: `Canonical reference link was committed, but generated compatibility metadata for ${source_kind} '${source_id}' could not be refreshed: ${err.message}`,
          next_step: "Treat SQLite and project backup artifacts as current. Run sync, inspect the indexed source path, then retry link_reference_evidence if compatibility output is still needed.",
          details: {
            source_kind,
            source_id,
            source_project_id: resolvedSourceProjectId,
            target_doc_id,
            indexed_path: sourceFilePath,
          },
        });
      }
    }

    return jsonResponse({
      ok: true,
      action: operation === "upsert_reference_link" ? "upserted" : "linked",
      link,
      mutation_order: [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ],
      compatibility_output: {
        generated_transparency: true,
        mutation_surface: false,
        refreshed: compatibilityDiagnostics.length === 0,
      },
      compatibility_diagnostics: compatibilityDiagnostics,
      ...backupMutationFields(backupResult),
    });
  }

  async function connectCharacterPlaceEvidence({
    project_id,
    scene_id,
    character_id,
    place_id,
    note,
  }) {
    if (!SYNC_DIR_WRITABLE) {
      return errorResponse("READ_ONLY", "Cannot connect character/place evidence: sync dir is read-only.");
    }
    const projectIdCheck = validateProjectId(project_id);
    if (!projectIdCheck.ok) {
      return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
    }

    const scene = db.prepare(`
      SELECT scene_id, project_id, file_path
      FROM scenes
      WHERE scene_id = ? AND project_id = ?
    `).get(scene_id, project_id);
    if (!scene) {
      return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
    }

    const character = resolveCharacterForProject(db, { characterId: character_id, projectId: project_id });
    if (!character) {
      return errorResponse("NOT_FOUND", `Character '${character_id}' is not indexed for project '${project_id}' or its universe.`);
    }
    const place = resolvePlaceForProject(db, { placeId: place_id, projectId: project_id });
    if (!place) {
      return errorResponse("NOT_FOUND", `Place '${place_id}' is not indexed for project '${project_id}' or its universe.`);
    }

    const before = querySceneRelationshipSnapshot(db, { sceneId: scene_id, projectId: project_id });
    try {
      db.exec("BEGIN");
      db.prepare(`
        INSERT OR IGNORE INTO scene_characters (scene_id, project_id, character_id)
        VALUES (?, ?, ?)
      `).run(scene_id, project_id, character_id);
      db.prepare(`
        INSERT OR IGNORE INTO scene_places (scene_id, project_id, place_id)
        VALUES (?, ?, ?)
      `).run(scene_id, project_id, place_id);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        void rollbackErr;
      }
      return errorResponse("IO_ERROR", `Failed to connect character/place evidence for scene '${scene_id}': ${err.message}`);
    }

    const after = querySceneRelationshipSnapshot(db, { sceneId: scene_id, projectId: project_id });
    const backupResult = refreshProjectScopedBackupAfterMutation(db, {
      syncDir: SYNC_DIR,
      projectId: project_id,
      applicationVersion: MCP_SERVER_VERSION,
      operation: "connect_character_place_evidence",
      actor: createToolActor("connect_character_place_evidence"),
      affected: {
        scenes: [scene_id],
        characters: [character_id],
        places: [place_id],
      },
      summary: `Connected character "${character_id}" and place "${place_id}" as evidence in scene "${scene_id}".`,
      before: {
        scene_relationships: before,
      },
      after: {
        scene_relationships: after,
      },
      metadata: {
        note: note ?? null,
      },
    });

    const compatibilityDiagnostics = [];
    if (!scene.file_path) {
      compatibilityDiagnostics.push({
        code: "STALE_PATH",
        severity: "warning",
        message: `Canonical scene relationship evidence was committed, but scene '${scene_id}' has no indexed file path for generated compatibility output.`,
        next_step: "Treat SQLite and project backup artifacts as current. Run sync and inspect the indexed scene path before retrying compatibility output.",
        details: {
          scene_id,
          project_id,
          indexed_path: null,
        },
      });
    } else {
      try {
        writeSceneRelationshipCompatibilityOutput({
          db,
          sceneId: scene_id,
          projectId: project_id,
          scenePath: scene.file_path,
          syncDir: SYNC_DIR,
          snapshot: after,
        });
      } catch (err) {
        compatibilityDiagnostics.push({
          code: err?.code ?? "COMPATIBILITY_OUTPUT_FAILED",
          severity: "warning",
          message: `Canonical scene relationship evidence was committed, but generated scene metadata compatibility output could not be refreshed: ${err.message}`,
          next_step: "Treat SQLite and project backup artifacts as current. Run sync and inspect the indexed scene path before retrying compatibility output.",
          details: {
            scene_id,
            project_id,
            indexed_path: scene.file_path,
          },
        });
      }
    }

    return jsonResponse({
      ok: true,
      action: "connected",
      scene_id,
      project_id,
      character_id,
      place_id,
      note: note ?? null,
      mutation_order: [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ],
      compatibility_output: buildCompatibilityOutput({
        refreshed: compatibilityDiagnostics.length === 0,
        diagnostics: compatibilityDiagnostics,
      }),
      ...backupMutationFields(backupResult),
    });
  }

  async function connectOneSidedSceneEvidence({
    project_id,
    scene_id,
    entity_id,
    note,
  }, {
    operation,
    entityKind,
    idField,
    tableName,
    resolveEntity,
  }) {
    if (!SYNC_DIR_WRITABLE) {
      return errorResponse("READ_ONLY", `Cannot connect scene ${entityKind} evidence: sync dir is read-only.`);
    }
    const projectIdCheck = validateProjectId(project_id);
    if (!projectIdCheck.ok) {
      return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
    }

    const scene = db.prepare(`
      SELECT scene_id, project_id, file_path
      FROM scenes
      WHERE scene_id = ? AND project_id = ?
    `).get(scene_id, project_id);
    if (!scene) {
      return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
    }

    const entity = resolveEntity(entity_id);
    if (!entity) {
      const label = entityKind[0].toUpperCase() + entityKind.slice(1);
      return errorResponse("NOT_FOUND", `${label} '${entity_id}' is not indexed for project '${project_id}' or its universe.`);
    }

    const before = querySceneRelationshipSnapshot(db, { sceneId: scene_id, projectId: project_id });
    const alreadyLinked = before[entityKind === "character" ? "characters" : "places"].includes(entity_id);
    try {
      db.exec("BEGIN");
      db.prepare(`
        INSERT OR IGNORE INTO ${tableName} (scene_id, project_id, ${idField})
        VALUES (?, ?, ?)
      `).run(scene_id, project_id, entity_id);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        void rollbackErr;
      }
      return errorResponse("IO_ERROR", `Failed to connect scene ${entityKind} evidence for scene '${scene_id}': ${err.message}`);
    }

    const after = querySceneRelationshipSnapshot(db, { sceneId: scene_id, projectId: project_id });
    const backupResult = refreshProjectScopedBackupAfterMutation(db, {
      syncDir: SYNC_DIR,
      projectId: project_id,
      applicationVersion: MCP_SERVER_VERSION,
      operation,
      actor: createToolActor(operation),
      affected: {
        scenes: [scene_id],
        [`${entityKind}s`]: [entity_id],
      },
      summary: `Connected ${entityKind} "${entity_id}" as evidence in scene "${scene_id}".`,
      before: {
        scene_relationships: before,
      },
      after: {
        scene_relationships: after,
      },
      metadata: {
        note: note ?? null,
      },
    });

    const compatibilityDiagnostics = [];
    if (!scene.file_path) {
      compatibilityDiagnostics.push({
        code: "STALE_PATH",
        severity: "warning",
        message: `Canonical scene ${entityKind} evidence was committed, but scene '${scene_id}' has no indexed file path for generated compatibility output.`,
        next_step: "Treat SQLite and project backup artifacts as current. Run sync and inspect the indexed scene path before retrying compatibility output.",
        details: {
          scene_id,
          project_id,
          indexed_path: null,
        },
      });
    } else {
      try {
        writeSceneRelationshipCompatibilityOutput({
          db,
          sceneId: scene_id,
          projectId: project_id,
          scenePath: scene.file_path,
          syncDir: SYNC_DIR,
          snapshot: after,
        });
      } catch (err) {
        compatibilityDiagnostics.push({
          code: err?.code ?? "COMPATIBILITY_OUTPUT_FAILED",
          severity: "warning",
          message: `Canonical scene ${entityKind} evidence was committed, but generated scene metadata compatibility output could not be refreshed: ${err.message}`,
          next_step: "Treat SQLite and project backup artifacts as current. Run sync and inspect the indexed scene path before retrying compatibility output.",
          details: {
            scene_id,
            project_id,
            indexed_path: scene.file_path,
          },
        });
      }
    }

    return jsonResponse({
      ok: true,
      action: "connected",
      already_linked: alreadyLinked,
      scene_id,
      project_id,
      [idField]: entity_id,
      note: note ?? null,
      scene_relationships: after,
      mutation_order: [
        "validated_request",
        "sqlite_commit",
        "project_backup_refresh",
        "compatibility_output_refresh",
      ],
      compatibility_output: buildCompatibilityOutput({
        refreshed: compatibilityDiagnostics.length === 0,
        diagnostics: compatibilityDiagnostics,
      }),
      ...backupMutationFields(backupResult),
    });
  }

  async function connectSceneCharacterEvidence(args) {
    return connectOneSidedSceneEvidence({
      project_id: args.project_id,
      scene_id: args.scene_id,
      entity_id: args.character_id,
      note: args.note,
    }, {
      operation: "connect_scene_character_evidence",
      entityKind: "character",
      idField: "character_id",
      tableName: "scene_characters",
      resolveEntity: (characterId) => resolveCharacterForProject(db, { characterId, projectId: args.project_id }),
    });
  }

  async function connectScenePlaceEvidence(args) {
    return connectOneSidedSceneEvidence({
      project_id: args.project_id,
      scene_id: args.scene_id,
      entity_id: args.place_id,
      note: args.note,
    }, {
      operation: "connect_scene_place_evidence",
      entityKind: "place",
      idField: "place_id",
      tableName: "scene_places",
      resolveEntity: (placeId) => resolvePlaceForProject(db, { placeId, projectId: args.project_id }),
    });
  }

  async function recordCharacterRelationshipBeat({
    project_id,
    from_character,
    to_character,
    relationship_type,
    strength,
    scene_id,
    note,
  }) {
    if (!SYNC_DIR_WRITABLE) {
      return errorResponse("READ_ONLY", "Cannot record character relationship beats: sync dir is read-only.");
    }
    const projectIdCheck = validateProjectId(project_id);
    if (!projectIdCheck.ok) {
      return errorResponse("INVALID_PROJECT_ID", projectIdCheck.reason, { project_id });
    }
    if (from_character === to_character) {
      return errorResponse("VALIDATION_ERROR", "from_character and to_character must be different characters.");
    }

    const fromCharacter = resolveCharacterForProject(db, { characterId: from_character, projectId: project_id });
    if (!fromCharacter) {
      return errorResponse("NOT_FOUND", `Character '${from_character}' is not indexed for project '${project_id}' or its universe.`);
    }
    const toCharacter = resolveCharacterForProject(db, { characterId: to_character, projectId: project_id });
    if (!toCharacter) {
      return errorResponse("NOT_FOUND", `Character '${to_character}' is not indexed for project '${project_id}' or its universe.`);
    }
    const scene = db.prepare(`
      SELECT scene_id, project_id
      FROM scenes
      WHERE scene_id = ? AND project_id = ?
    `).get(scene_id, project_id);
    if (!scene) {
      return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
    }

    const normalizedRelationshipType = relationship_type.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(normalizedRelationshipType)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "relationship_type is normalized to lowercase and must match [a-z][a-z0-9_-]* after normalization.",
        { relationship_type }
      );
    }
    const normalizedNote = note?.trim() || null;
    const before = db.prepare(`
      SELECT from_character, to_character, relationship_type, strength, scene_id, note
      FROM character_relationships
      WHERE from_character = ? AND to_character = ? AND relationship_type = ? AND scene_id = ? AND COALESCE(note, '') = COALESCE(?, '')
    `).all(from_character, to_character, normalizedRelationshipType, scene_id, normalizedNote);

    try {
      db.exec("BEGIN");
      db.prepare(`
        DELETE FROM character_relationships
        WHERE from_character = ? AND to_character = ? AND relationship_type = ? AND scene_id = ? AND COALESCE(note, '') = COALESCE(?, '')
      `).run(from_character, to_character, normalizedRelationshipType, scene_id, normalizedNote);
      db.prepare(`
        INSERT INTO character_relationships (from_character, to_character, relationship_type, strength, scene_id, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(from_character, to_character, normalizedRelationshipType, strength ?? null, scene_id, normalizedNote);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        void rollbackErr;
      }
      return errorResponse("IO_ERROR", `Failed to record relationship beat for '${from_character}' and '${to_character}': ${err.message}`);
    }

    const relationship = db.prepare(`
      SELECT from_character, to_character, relationship_type, strength, scene_id, note
      FROM character_relationships
      WHERE from_character = ? AND to_character = ? AND relationship_type = ? AND scene_id = ? AND COALESCE(note, '') = COALESCE(?, '')
    `).get(from_character, to_character, normalizedRelationshipType, scene_id, normalizedNote);
    const backupResult = refreshProjectScopedBackupAfterMutation(db, {
      syncDir: SYNC_DIR,
      projectId: project_id,
      applicationVersion: MCP_SERVER_VERSION,
      operation: "record_character_relationship_beat",
      actor: createToolActor("record_character_relationship_beat"),
      affected: {
        scenes: [scene_id],
        characters: [from_character, to_character],
      },
      summary: `Recorded "${normalizedRelationshipType}" beat for "${from_character}" and "${to_character}" in scene "${scene_id}".`,
      before: {
        relationships: before,
      },
      after: {
        relationship,
      },
    });

    return jsonResponse({
      ok: true,
      action: "recorded",
      relationship,
      mutation_order: ["validated_request", "sqlite_commit", "project_backup_refresh"],
      compatibility_output: {
        role: "none",
        reason: "Character relationship beats are canonical SQLite state and have no sidecar compatibility output in M4.",
      },
      ...backupMutationFields(backupResult),
    });
  }

  async function auditRelationshipMetadata({ project_id }) {
    const projectFilter = project_id ? `WHERE project_id = ?` : "";
    const projectParams = project_id ? [project_id] : [];
    const projectScope = project_id
      ? db.prepare(`SELECT universe_id FROM projects WHERE project_id = ?`).get(project_id)
      : null;
    const entityFilter = project_id
      ? projectScope
        ? `WHERE project_id = ?
          OR (universe_id IS NOT NULL AND universe_id = ?)
          OR (project_id IS NULL AND universe_id IS NULL)`
        : "WHERE 0"
      : "";
    const entityParams = project_id && projectScope
      ? [project_id, projectScope.universe_id]
      : [];
    const scenes = db.prepare(`
      SELECT scene_id, project_id, file_path, metadata_stale
      FROM scenes
      ${projectFilter}
      ORDER BY project_id, scene_id
    `).all(...projectParams);
    const characters = db.prepare(`
      SELECT character_id, project_id, universe_id, file_path
      FROM characters
      ${entityFilter}
      ORDER BY character_id
    `).all(...entityParams);
    const places = db.prepare(`
      SELECT place_id, project_id, universe_id, file_path
      FROM places
      ${entityFilter}
      ORDER BY place_id
    `).all(...entityParams);

    const diagnostics = [];
    for (const scene of scenes) {
      if (scene.metadata_stale) {
        diagnostics.push({
          type: "stale_scene_relationship_index",
          severity: "warning",
          message: `Scene '${scene.scene_id}' has stale metadata; relationship indexes may lag prose.`,
          scene_id: scene.scene_id,
          project_id: scene.project_id,
          next_step: "Use enrich_scene or enrich_scene_characters_batch dry_run to review prose-derived repairs before applying.",
        });
      }
      try {
        const { sourceMeta } = readSourceMeta(scene.file_path, SYNC_DIR, { writable: false });
        const compatibilityRelationships = normalizeSceneRelationshipCompatibilityFields(db, sourceMeta);
        if (compatibilityRelationships.has_relationship_fields) {
          const canonicalRelationships = querySceneRelationshipSnapshot(db, {
            sceneId: scene.scene_id,
            projectId: scene.project_id,
          });
          diagnostics.push({
            type: "scene_relationship_compatibility_input",
            severity: "info",
            message: `Scene '${scene.scene_id}' retains sidecar/frontmatter character/place relationship fields as compatibility input; SQLite scene relationship rows remain canonical.`,
            scene_id: scene.scene_id,
            project_id: scene.project_id,
            compatibility: compatibilityRelationships,
            canonical: canonicalRelationships,
            authority: {
              canonical_owner: "SQLite scene_characters/scene_places",
              compatibility_mutation_surface: false,
            },
            next_step: "Use this as migration or review evidence only. Use outcome-level relationship tools for current repairs.",
          });
          if (sceneRelationshipCompatibilityHasDrift(canonicalRelationships, compatibilityRelationships)) {
            diagnostics.push({
              type: "scene_relationship_compatibility_drift",
              severity: "warning",
              message: `Scene '${scene.scene_id}' sidecar/frontmatter relationship fields disagree with canonical SQLite relationship rows.`,
              scene_id: scene.scene_id,
              project_id: scene.project_id,
              compatibility: compatibilityRelationships,
              canonical: canonicalRelationships,
              next_step: "Treat SQLite relationship rows as canonical. Use find_scenes, list_characters, and list_places to inspect stable IDs; use connect_character_place_evidence when evidence is paired, connect_scene_character_evidence for character-only evidence, and connect_scene_place_evidence for place-only evidence.",
            });
          }
        }
        if (sourceMeta.threads) {
          diagnostics.push({
            type: "sidecar_threads_compatibility_input",
            severity: "info",
            message: `Scene '${scene.scene_id}' still has sidecar thread metadata; use track_thread_arc for current thread authority.`,
            scene_id: scene.scene_id,
            project_id: scene.project_id,
          });
        }
      } catch (err) {
        diagnostics.push({
          type: "scene_relationship_metadata_unreadable",
          severity: "warning",
          message: `Could not read scene metadata for '${scene.scene_id}': ${err.message}`,
          scene_id: scene.scene_id,
          project_id: scene.project_id,
        });
      }
    }

    for (const character of characters) {
      if (!character.file_path) continue;
      try {
        const { sourceMeta } = readSourceMeta(character.file_path, SYNC_DIR, { writable: false });
        if (normalizeStringList(sourceMeta.tags).length > 0) {
          diagnostics.push({
            type: "character_tags_review_note",
            severity: "info",
            message: `Character '${character.character_id}' has sidecar tags; M4 treats these as compatibility/review notes, not relationship authority.`,
            character_id: character.character_id,
          });
        }
      } catch {
        // Character prose/metadata files are compatibility output for this audit.
      }
    }

    for (const place of places) {
      if (!place.file_path) continue;
      try {
        const { sourceMeta } = readSourceMeta(place.file_path, SYNC_DIR, { writable: false });
        if (normalizeStringList(sourceMeta.associated_characters).length > 0) {
          diagnostics.push({
            type: "place_associated_characters_review_note",
            severity: "info",
            message: `Place '${place.place_id}' has associated_characters sidecar metadata; use connect_character_place_evidence for current scene-backed authority.`,
            place_id: place.place_id,
          });
        }
        if (normalizeStringList(sourceMeta.tags).length > 0) {
          diagnostics.push({
            type: "place_tags_review_note",
            severity: "info",
            message: `Place '${place.place_id}' has sidecar tags; M4 treats these as compatibility/review notes, not relationship authority.`,
            place_id: place.place_id,
          });
        }
      } catch {
        // Place prose/metadata files are compatibility output for this audit.
      }
    }

    return jsonResponse({
      ok: true,
      project_id: project_id ?? null,
      audit_authority: {
        canonical_relationship_sources: [
          "scene_characters",
          "scene_places",
          "threads",
          "scene_threads",
          "character_relationships",
          "reference_links",
        ],
        compatibility_sources: [
          "scene sidecar characters/places/tags/threads",
          "character sidecar tags",
          "place sidecar associated_characters/tags",
        ],
        compatibility_mutation_surface: false,
      },
      diagnostics,
      summary: {
        diagnostics_count: diagnostics.length,
        stale_scene_count: diagnostics.filter(diagnostic => diagnostic.type === "stale_scene_relationship_index").length,
        compatibility_drift_count: diagnostics.filter(diagnostic => diagnostic.type === "scene_relationship_compatibility_drift").length,
        compatibility_note_count: diagnostics.filter(diagnostic => diagnostic.severity === "info").length,
      },
      next_steps: [
        "Use connect_character_place_evidence when scene-backed character/place evidence is paired; use connect_scene_character_evidence or connect_scene_place_evidence for one-sided scene evidence.",
        "Use record_character_relationship_beat for relationship arcs between characters.",
        "Use link_reference_evidence for explicit reference evidence.",
        "Use export_project_backup when a fresh recovery snapshot is needed.",
      ],
    });
  }

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
        const backupResult = refreshProjectScopedBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "create_character_sheet",
          actor: createToolActor("create_character_sheet"),
          affected: {
            characters: [result.id],
          },
          summary: `${result.created ? "Created" : "Reused"} character sheet "${result.id}".`,
          before: null,
          after: {
            character: {
              character_id: result.id,
              project_id: result.project_id,
              universe_id: result.universe_id,
              name,
            },
          },
        });

        return jsonResponse({
          ok: true,
          action: result.created ? "created" : "exists",
          kind: "character",
          ...result,
          ...backupMutationFields(backupResult),
        });
      } catch (err) {
        if (err?.name === "CoreValidationError") {
          return errorResponse(err.code, err.message, err.details);
        }
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
        const backupResult = refreshProjectScopedBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "create_place_sheet",
          actor: createToolActor("create_place_sheet"),
          affected: {
            places: [result.id],
          },
          summary: `${result.created ? "Created" : "Reused"} place sheet "${result.id}".`,
          before: null,
          after: {
            place: {
              place_id: result.id,
              project_id: result.project_id,
              universe_id: result.universe_id,
              name,
            },
          },
        });

        return jsonResponse({
          ok: true,
          action: result.created ? "created" : "exists",
          kind: "place",
          ...result,
          ...backupMutationFields(backupResult),
        });
      } catch (err) {
        if (err?.name === "CoreValidationError") {
          return errorResponse(err.code, err.message, err.details);
        }
        return errorResponse("IO_ERROR", `Failed to create place sheet: ${err.message}`);
      }
    }
  );

  // ---- track_thread_arc ----------------------------------------------------
  s.tool(
    "track_thread_arc",
    "Track a storyline, subplot, or recurring arc through a scene by recording the scene's thread beat. This is the outcome-level workflow for thread relationship changes: callers provide story intent, while SQLite thread tables, backup refresh, and rollback stay implementation details.",
    {
      project_id: z.string().describe("Project the thread belongs to (e.g. 'the-lamb')."),
      thread_id: z.string().describe("Stable thread ID for the arc being tracked (e.g. 'thread-reconciliation')."),
      thread_name: z.string().describe("Human-readable thread or arc name."),
      scene_id: z.string().describe("Scene that carries this thread beat (e.g. 'sc-011-sebastian')."),
      beat: z.string().optional().describe("Optional story beat for this scene in the thread, such as setup, escalation, reveal, reversal, or payoff."),
      status: z.string().optional().describe("Thread status (e.g. 'active', 'resolved'). Defaults to 'active'."),
    },
    async (args) => trackThreadArcLink(args, { operation: "track_thread_arc" })
  );

  // ---- upsert_thread_link --------------------------------------------------
  s.tool(
    "upsert_thread_link",
    "Compatibility name for track_thread_arc. Prefer track_thread_arc when recording story intent; this retained alias still validates, writes SQLite first, refreshes project backups, and rolls back failed canonical writes.",
    {
      project_id: z.string().describe("Project the thread belongs to (e.g. 'the-lamb')."),
      thread_id: z.string().describe("Stable thread ID for the arc being tracked (e.g. 'thread-reconciliation')."),
      thread_name: z.string().describe("Human-readable thread or arc name."),
      scene_id: z.string().describe("Scene that carries this thread beat (e.g. 'sc-011-sebastian')."),
      beat: z.string().optional().describe("Optional story beat for this scene in the thread, such as setup, escalation, reveal, reversal, or payoff."),
      status: z.string().optional().describe("Thread status (e.g. 'active', 'resolved'). Defaults to 'active'."),
    },
    async (args) => trackThreadArcLink(args, { operation: "upsert_thread_link" })
  );

  // ---- link_reference_evidence --------------------------------------------
  s.tool(
    "link_reference_evidence",
    "Link scene, character, place, or reference evidence to a reference document. This is the outcome-level workflow for evidence relationships: SQLite commits first, project backup artifacts refresh after commit, and sidecar/frontmatter compatibility output is refreshed only as generated transparency.",
    {
      source_kind: z.enum(["scene", "character", "place", "reference"]).describe("Evidence source kind."),
      source_id: z.string().describe("Source scene_id, character_id, place_id, or reference doc_id."),
      source_project_id: z.string().optional().describe("Optional project scope for the source. For scene/character/place sources, use this to disambiguate an ambiguous source_id across projects. For reference sources, when provided, it is treated as an ownership check and must match the source reference doc's project."),
      target_doc_id: z.string().describe("Target reference doc_id."),
      relation: z.string().describe("Evidence relationship label (for example: 'informs', 'related', 'history_of'). The value is trimmed and lowercased before validation."),
    },
    async (args) => linkReferenceEvidence(args, { operation: "link_reference_evidence" })
  );

  // ---- upsert_reference_link -----------------------------------------------
  s.tool(
    "upsert_reference_link",
    "Compatibility name for link_reference_evidence. Prefer link_reference_evidence when recording story evidence; this retained alias still validates, commits SQLite first, refreshes project backups, and treats sidecar/frontmatter output as generated compatibility.",
    {
      source_kind: z.enum(["scene", "character", "place", "reference"]).describe("Evidence source kind."),
      source_id: z.string().describe("Source scene_id, character_id, place_id, or reference doc_id."),
      source_project_id: z.string().optional().describe("Optional project scope for the source. For scene/character/place sources, use this to disambiguate an ambiguous source_id across projects. For reference sources, when provided, it is treated as an ownership check and must match the source reference doc's project."),
      target_doc_id: z.string().describe("Target reference doc_id."),
      relation: z.string().describe("Evidence relationship label (for example: 'informs', 'related', 'history_of'). The value is trimmed and lowercased before validation."),
    },
    async (args) => linkReferenceEvidence(args, { operation: "upsert_reference_link" })
  );

  // ---- connect_character_place_evidence ------------------------------------
  s.tool(
    "connect_character_place_evidence",
    "Connect a character and place as paired scene-backed story evidence. This outcome-level workflow covers sheet-backed character/place associations: SQLite scene relationship indexes commit first, project backups refresh after commit, and scene sidecar characters/places are regenerated only as generated compatibility output from canonical indexes. Use connect_scene_character_evidence or connect_scene_place_evidence for one-sided scene evidence.",
    {
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      scene_id: z.string().describe("Scene that provides the evidence for this character/place association."),
      character_id: z.string().describe("Character present in the scene. Use list_characters to find valid IDs."),
      place_id: z.string().describe("Place present in the scene. Use list_places to find valid IDs."),
      note: z.string().optional().describe("Optional review note explaining the evidence. Stored in operation history, not in compatibility sidecars."),
    },
    async (args) => connectCharacterPlaceEvidence(args)
  );

  // ---- connect_scene_character_evidence -----------------------------------
  s.tool(
    "connect_scene_character_evidence",
    "Connect a sheet-backed character to a scene without requiring paired place evidence. This outcome-level workflow records character-only scene evidence in SQLite first, refreshes project backups after commit, and regenerates scene sidecar characters/places only as generated compatibility output from canonical indexes.",
    {
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      scene_id: z.string().describe("Scene that provides the evidence for this character."),
      character_id: z.string().describe("Sheet-backed character_id present in the scene. Use list_characters to find valid IDs; freeform names are rejected."),
      note: z.string().optional().describe("Optional review note explaining the evidence. Stored in operation history, not in compatibility sidecars."),
    },
    async (args) => connectSceneCharacterEvidence(args)
  );

  // ---- connect_scene_place_evidence ---------------------------------------
  s.tool(
    "connect_scene_place_evidence",
    "Connect a sheet-backed place to a scene without requiring paired character evidence. This outcome-level workflow records place-only scene evidence in SQLite first, refreshes project backups after commit, and regenerates scene sidecar characters/places only as generated compatibility output from canonical indexes.",
    {
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      scene_id: z.string().describe("Scene that provides the evidence for this place."),
      place_id: z.string().describe("Sheet-backed place_id present in the scene. Use list_places to find valid IDs; freeform names are rejected."),
      note: z.string().optional().describe("Optional review note explaining the evidence. Stored in operation history, not in compatibility sidecars."),
    },
    async (args) => connectScenePlaceEvidence(args)
  );

  // ---- record_character_relationship_beat ----------------------------------
  s.tool(
    "record_character_relationship_beat",
    "Record how two characters relate in a specific scene. This outcome-level workflow writes character relationship beats directly to SQLite, validates scene evidence, refreshes project backups after commit, and does not require callers to know the character_relationships table.",
    {
      project_id: z.string().describe("Project the scene evidence belongs to (e.g. 'the-lamb')."),
      from_character: z.string().describe("First character_id in the relationship beat."),
      to_character: z.string().describe("Second character_id in the relationship beat."),
      relationship_type: z.string().describe("Relationship label such as trusts, protects, fears, betrays, or reconciles. Trimmed and lowercased before validation."),
      strength: z.string().optional().describe("Optional qualitative strength or direction for this scene beat."),
      scene_id: z.string().describe("Scene that provides the evidence for this relationship beat."),
      note: z.string().optional().describe("Optional short evidence note for this beat."),
    },
    async (args) => recordCharacterRelationshipBeat(args)
  );

  // ---- audit_relationship_metadata -----------------------------------------
  s.tool(
    "audit_relationship_metadata",
    "Review relationship metadata authority, stale indexes, retained compatibility notes, and scene character/place sidecar drift without mutating SQLite or files. Use this before repair work when character/place associations, sidecar tags, scene threads, or recovery readiness look stale or ambiguous.",
    {
      project_id: z.string().optional().describe("Optional project scope for the audit."),
    },
    async (args) => auditRelationshipMetadata(args)
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

      const backupResult = refreshProjectBackupAfterMutation(db, {
        syncDir: SYNC_DIR,
        projectId: project_id,
        applicationVersion: MCP_SERVER_VERSION,
        operation: "create_chapter",
        actor: createToolActor("create_chapter"),
        affected: {
          chapters: [plan.chapter.chapter_id],
        },
        summary: `Created chapter "${plan.chapter.title}" at sort_index ${plan.chapter.sort_index}.`,
        before: null,
        after: {
          chapter: {
            chapter_id: plan.chapter.chapter_id,
            project_id: plan.chapter.project_id,
            title: plan.chapter.title,
            sort_index: plan.chapter.sort_index,
            logline: plan.chapter.logline,
            metadata_stale: plan.chapter.metadata_stale,
          },
        },
      });

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
        operation_history: backupResult.operation_history,
        backup_refresh: backupResult.backup_refresh,
        backup_warnings: backupResult.backup_warnings,
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
        syncDir: SYNC_DIR,
      });
      const backupResult = refreshProjectBackupAfterMutation(db, {
        syncDir: SYNC_DIR,
        projectId: project_id,
        applicationVersion: MCP_SERVER_VERSION,
        operation: "rename_chapter",
        actor: createToolActor("rename_chapter"),
        affected: {
          chapters: [plan.chapter.chapter_id],
          scenes: linkedScenes.map(scene => scene.scene_id),
        },
        summary: `Renamed chapter "${plan.previousChapter.title}" to "${plan.chapter.title}".`,
        before: {
          chapter: {
            chapter_id: plan.previousChapter.chapter_id,
            title: plan.previousChapter.title,
            sort_index: plan.previousChapter.sort_index,
          },
        },
        after: {
          chapter: {
            chapter_id: plan.chapter.chapter_id,
            project_id: plan.chapter.project_id,
            title: plan.chapter.title,
            sort_index: plan.chapter.sort_index,
            logline: plan.chapter.logline,
            metadata_stale: plan.chapter.metadata_stale,
          },
        },
        metadata: {
          updated_scene_count: linkedScenes.length,
          updated_sidecar_count: sidecarWriteResult.updatedCount,
        },
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
        operation_history: backupResult.operation_history,
        backup_refresh: backupResult.backup_refresh,
        backup_warnings: backupResult.backup_warnings,
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
        syncDir: SYNC_DIR,
      });
      const backupResult = refreshProjectBackupAfterMutation(db, {
        syncDir: SYNC_DIR,
        projectId: project_id,
        applicationVersion: MCP_SERVER_VERSION,
        operation: "reorder_chapter",
        actor: createToolActor("reorder_chapter"),
        affected: {
          chapters: [plan.chapter.chapter_id],
          scenes: linkedScenes.map(scene => scene.scene_id),
        },
        summary: `Reordered chapter "${plan.chapter.title}" from ${plan.previousChapter.sort_index} to ${plan.chapter.sort_index}.`,
        before: {
          chapter: {
            chapter_id: plan.previousChapter.chapter_id,
            title: plan.previousChapter.title,
            sort_index: plan.previousChapter.sort_index,
          },
        },
        after: {
          chapter: {
            chapter_id: plan.chapter.chapter_id,
            project_id: plan.chapter.project_id,
            title: plan.chapter.title,
            sort_index: plan.chapter.sort_index,
            logline: plan.chapter.logline,
            metadata_stale: plan.chapter.metadata_stale,
          },
        },
        metadata: {
          updated_scene_count: linkedScenes.length,
          updated_sidecar_count: sidecarWriteResult.updatedCount,
        },
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
        operation_history: backupResult.operation_history,
        backup_refresh: backupResult.backup_refresh,
        backup_warnings: backupResult.backup_warnings,
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
          syncDir: SYNC_DIR,
        });
        const backupResult = refreshProjectBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "attach_epigraph",
          actor: createToolActor("attach_epigraph"),
          affected: {
            epigraphs: [plan.epigraph.epigraph_id],
            chapters: [plan.chapter.chapter_id],
          },
          summary: `Attached epigraph "${plan.epigraph.epigraph_id}" to chapter "${plan.chapter.title}".`,
          before: {
            epigraph: {
              epigraph_id: plan.epigraph.epigraph_id,
              chapter_id: plan.previousChapter?.chapter_id ?? null,
            },
          },
          after: {
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
          },
          metadata: {
            updated_sidecar_count: sidecarWriteResult.updatedCount,
          },
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
          operation_history: backupResult.operation_history,
          backup_refresh: backupResult.backup_refresh,
          backup_warnings: backupResult.backup_warnings,
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
    "Move a scene through the explicit structure workflow. Writes canonical SQLite chapter linkage and/or timeline_position first, then mirrors compatibility fields to the scene sidecar and index; it does not move, rename, or resequence scene files or Scrivener-compatible folders.",
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

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        persistSceneStructureCanonical(db, {
          projectId: project_id,
          sceneId: scene_id,
          assignedChapter: plan.assignedChapter,
          timelinePosition: plan.timelinePosition,
          updateTimelinePosition: true,
        });
        const sidecarMirror = writeStructureSidecarUpdates(
          [{ filePath: scene.file_path, meta: plan.meta }],
          { failureCode: "SCENE_STRUCTURE_SIDECAR_MIRROR_FAILED", syncDir: SYNC_DIR }
        );
        if (sidecarMirror.updatedCount > 0) {
          indexSceneFile(db, SYNC_DIR, scene.file_path, plan.meta, prose, {
            managedStructure: isManagedStructureProject(db, project_id),
          });
        }
        const backupResult = refreshProjectBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "move_scene",
          actor: createToolActor("move_scene"),
          affected: {
            scenes: [scene_id],
            chapters: [
              plan.previousChapterId ?? null,
              plan.assignedChapter?.chapter_id ?? null,
            ].filter(Boolean),
          },
          summary: `Moved scene "${scene_id}" to ${plan.assignedChapter?.chapter_id ?? "no chapter"} at timeline_position ${plan.timelinePosition ?? "unchanged"}.`,
          before: {
            scene: {
              scene_id,
              project_id,
              chapter_id: plan.previousChapterId ?? null,
              timeline_position: plan.previousTimelinePosition ?? null,
            },
          },
          after: {
            scene: {
              scene_id,
              project_id,
              chapter_id: plan.assignedChapter?.chapter_id ?? null,
              timeline_position: plan.timelinePosition ?? null,
            },
          },
          metadata: {
            updated_sidecar_count: sidecarMirror.updatedCount,
          },
        });

        return jsonResponse({
          ok: true,
          action: "moved",
          scene_id,
          project_id,
          previous_chapter_id: plan.previousChapterId,
          previous_timeline_position: plan.previousTimelinePosition,
          chapter: plan.assignedChapter,
          timeline_position: plan.timelinePosition,
          updated_sidecar_count: sidecarMirror.updatedCount,
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
            ...sidecarMirror.diagnostics,
          ],
          operation_history: backupResult.operation_history,
          backup_refresh: backupResult.backup_refresh,
          backup_warnings: backupResult.backup_warnings,
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
    "Assign a scene to a canonical chapter through the explicit structure workflow. Writes canonical SQLite chapter linkage first, then mirrors chapter_id plus compatibility chapter/chapter_title fields to the scene sidecar and index. Pass chapter_id=null to clear an explicit chapter link on an unchaptered scene. Use list_chapters first to choose a valid canonical chapter_id.",
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

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        persistSceneStructureCanonical(db, {
          projectId: project_id,
          sceneId: scene_id,
          assignedChapter: plan.assignedChapter,
        });
        const sidecarMirror = writeStructureSidecarUpdates(
          [{ filePath: scene.file_path, meta: plan.meta }],
          { failureCode: "SCENE_STRUCTURE_SIDECAR_MIRROR_FAILED", syncDir: SYNC_DIR }
        );
        if (sidecarMirror.updatedCount > 0) {
          indexSceneFile(db, SYNC_DIR, scene.file_path, plan.meta, prose, {
            managedStructure: isManagedStructureProject(db, project_id),
          });
        }
        const backupResult = refreshProjectBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "assign_scene_to_chapter",
          actor: createToolActor("assign_scene_to_chapter"),
          affected: {
            scenes: [scene_id],
            chapters: [
              plan.previousChapterId ?? scene.chapter_id ?? null,
              plan.assignedChapter?.chapter_id ?? null,
            ].filter(Boolean),
          },
          summary: chapter === null
            ? `Cleared chapter assignment for scene "${scene_id}".`
            : `Assigned scene "${scene_id}" to chapter "${plan.assignedChapter.chapter_id}".`,
          before: {
            scene: {
              scene_id,
              project_id,
              chapter_id: plan.previousChapterId ?? scene.chapter_id ?? null,
            },
          },
          after: {
            scene: {
              scene_id,
              project_id,
              chapter_id: plan.assignedChapter?.chapter_id ?? null,
            },
          },
          metadata: {
            updated_sidecar_count: sidecarMirror.updatedCount,
          },
        });

        return jsonResponse({
          ok: true,
          action: chapter === null ? "cleared" : "assigned",
          scene_id,
          project_id,
          previous_chapter_id: plan.previousChapterId ?? scene.chapter_id ?? null,
          chapter: plan.assignedChapter,
          updated_sidecar_count: sidecarMirror.updatedCount,
          diagnostics: sidecarMirror.diagnostics,
          operation_history: backupResult.operation_history,
          backup_refresh: backupResult.backup_refresh,
          backup_warnings: backupResult.backup_warnings,
        });
      } catch (err) {
        if (err?.name === "CoreValidationError") {
          return errorResponse(err.code, err.message, err.details);
        }
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
    "Update one or more non-structural, non-relationship metadata fields for a scene. Writes only supplied allowed fields to the .meta.yaml sidecar and preserves existing structural compatibility fields; it never modifies prose, mirrors path-derived structure, or changes scene character/place relationship authority. Structural fields (part, chapter, chapter_id, chapter_title, timeline_position) are rejected here; use list_chapters plus assign_scene_to_chapter, move_scene, rename_chapter, or reorder_chapter for structure changes. Relationship fields (characters, places) are rejected here; use discovery workflows plus connect_character_place_evidence when evidence is paired, connect_scene_character_evidence for character-only evidence, connect_scene_place_evidence for place-only evidence, and audit_relationship_metadata for legacy sidecar/frontmatter relationship review. Allowed changes are immediately reflected in the index. Only available when the sync dir is writable.",
    {
      scene_id:   z.string().describe("The scene_id to update (e.g. 'sc-011-sebastian')."),
      project_id: z.string().describe("Project the scene belongs to (e.g. 'the-lamb')."),
      fields: z.object({
        title:             z.string().optional(),
        logline:           z.string().optional(),
        status:            z.string().optional().describe("Workflow status (e.g. 'draft', 'revision', 'complete'). Free text — no fixed vocabulary."),
        save_the_cat_beat: z.string().optional(),
        pov:               z.string().optional(),
        part:              z.number().int().optional().describe("Rejected by update_scene_metadata. Structural placement must use explicit structure workflows."),
        chapter:           z.number().int().optional().describe("Rejected by update_scene_metadata. Use assign_scene_to_chapter or move_scene with canonical chapter_id."),
        chapter_id:        z.string().nullable().optional().describe("Rejected by update_scene_metadata. Use list_chapters, then assign_scene_to_chapter or move_scene."),
        chapter_title:     z.string().nullable().optional().describe("Rejected by update_scene_metadata. Use rename_chapter for canonical chapter title changes."),
        timeline_position: z.number().int().optional().describe("Rejected by update_scene_metadata. Use move_scene for ordering changes."),
        story_time:        z.string().optional(),
        tags:              z.array(z.string()).optional(),
        characters:        z.array(z.string()).optional().describe("Rejected by update_scene_metadata. Use find_scenes, list_characters, list_places, connect_character_place_evidence when evidence is paired, connect_scene_character_evidence for character-only evidence, and audit_relationship_metadata for compatibility review."),
        places:            z.array(z.string()).optional().describe("Rejected by update_scene_metadata. Use find_scenes, list_characters, list_places, connect_character_place_evidence when evidence is paired, connect_scene_place_evidence for place-only evidence, and audit_relationship_metadata for compatibility review."),
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
      const relationshipFields = getProvidedRelationshipSceneMetadataFields(fields);
      if (relationshipFields.length > 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "update_scene_metadata cannot change relationship-boundary fields characters or places. Scene relationship metadata is sheet-backed and must use outcome-level relationship workflows, not generic sidecar metadata writes.",
          buildRelationshipMetadataBoundaryDetails({
            projectId: project_id,
            sceneId: scene_id,
            blockedFields: relationshipFields,
          })
        );
      }
      const structuralFields = getProvidedStructuralSceneMetadataFields(fields);
      if (structuralFields.length > 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "update_scene_metadata cannot change structural fields. Use list_chapters plus assign_scene_to_chapter, move_scene, rename_chapter, or reorder_chapter for structural changes.",
          {
            project_id,
            scene_id,
            blocked_fields: structuralFields,
            allowed_structure_tools: ["list_chapters", "assign_scene_to_chapter", "move_scene", "rename_chapter", "reorder_chapter"],
          }
        );
      }
      try {
        const relationshipSnapshot = querySceneRelationshipSnapshot(db, { sceneId: scene_id, projectId: project_id });
        const { sourceMeta } = readSourceMeta(scene.file_path, SYNC_DIR, { writable: true });
        const updated = { ...sourceMeta, ...fields };
        writeMeta(scene.file_path, updated, { syncDir: SYNC_DIR });
        const normalizedUpdated = normalizeSceneMetaForPath(SYNC_DIR, scene.file_path, updated).meta;

        const { content: prose } = matter(fs.readFileSync(scene.file_path, "utf8"));
        indexSceneFile(db, SYNC_DIR, scene.file_path, normalizedUpdated, prose, {
          managedStructure: isManagedStructureProject(db, project_id),
        });
        restoreSceneRelationshipSnapshot(db, {
          sceneId: scene_id,
          projectId: project_id,
          snapshot: relationshipSnapshot,
        });
        restoreSceneRelationshipSearchKeywords(db, {
          sceneId: scene_id,
          projectId: project_id,
          meta: normalizedUpdated,
          snapshot: relationshipSnapshot,
        });
        const backupResult = refreshProjectScopedBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "update_scene_metadata",
          actor: createToolActor("update_scene_metadata"),
          affected: {
            scenes: [scene_id],
          },
          summary: `Updated metadata for scene "${scene_id}".`,
          before: {
            scene: {
              scene_id,
              project_id,
              fields: Object.keys(fields).sort().reduce((acc, key) => {
                acc[key] = sourceMeta[key] ?? null;
                return acc;
              }, {}),
            },
          },
          after: {
            scene: {
              scene_id,
              project_id,
              fields: Object.keys(fields).sort().reduce((acc, key) => {
                acc[key] = normalizedUpdated[key] ?? null;
                return acc;
              }, {}),
            },
          },
        });

        return jsonResponse({
          ok: true,
          action: "updated",
          message: `Updated metadata for scene '${scene_id}'.`,
          scene_id,
          project_id,
          ...backupMutationFields(backupResult),
        });
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
    "Update canonical character profile fields such as name, role, arc_summary, first_appearance, and traits. SQLite commits first, project backups refresh after commit, and the .meta.yaml file is refreshed only as generated compatibility output; prose notes are never modified.",
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
      const char = db.prepare(`SELECT character_id, project_id, universe_id, file_path, name, role, arc_summary, first_appearance FROM characters WHERE character_id = ?`).get(character_id);
      if (!char) {
        return errorResponse("NOT_FOUND", `Character '${character_id}' not found.`);
      }
      const beforeTraits = db.prepare(`SELECT trait FROM character_traits WHERE character_id = ? ORDER BY trait`)
        .all(character_id).map(row => row.trait);
      const nextCharacter = {
        name: fields.name ?? char.name,
        role: Object.hasOwn(fields, "role") ? fields.role ?? null : char.role,
        arc_summary: Object.hasOwn(fields, "arc_summary") ? fields.arc_summary ?? null : char.arc_summary,
        first_appearance: Object.hasOwn(fields, "first_appearance") ? fields.first_appearance ?? null : char.first_appearance,
      };
      const nextTraits = fields.traits ? uniqueSorted(fields.traits) : beforeTraits;
      try {
        db.exec("BEGIN");
        db.prepare(`
          UPDATE characters SET name = ?, role = ?, arc_summary = ?, first_appearance = ?
          WHERE character_id = ?
        `).run(
          nextCharacter.name, nextCharacter.role,
          nextCharacter.arc_summary, nextCharacter.first_appearance,
          character_id
        );
        if (fields.traits) {
          db.prepare(`DELETE FROM character_traits WHERE character_id = ?`).run(character_id);
          for (const t of nextTraits) {
            db.prepare(`INSERT OR IGNORE INTO character_traits (character_id, trait) VALUES (?, ?)`).run(character_id, t);
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch (rollbackErr) {
          void rollbackErr;
        }
        return errorResponse("IO_ERROR", `Failed to update canonical character metadata for '${character_id}': ${err.message}`);
      }

      const backupResult = refreshProjectScopedBackupAfterMutation(db, {
        syncDir: SYNC_DIR,
        projectId: char.project_id,
        applicationVersion: MCP_SERVER_VERSION,
        operation: "update_character_sheet",
        actor: createToolActor("update_character_sheet"),
        affected: {
          characters: [character_id],
        },
        summary: `Updated character sheet "${character_id}".`,
        before: {
          character: {
            character_id,
            project_id: char.project_id,
            universe_id: char.universe_id,
            name: char.name,
            role: char.role,
            arc_summary: char.arc_summary,
            first_appearance: char.first_appearance,
            traits: beforeTraits,
          },
        },
        after: {
          character: {
            character_id,
            project_id: char.project_id,
            universe_id: char.universe_id,
            ...nextCharacter,
            traits: nextTraits,
          },
        },
      });

      const compatibilityDiagnostics = [];
      try {
        if (!char.file_path) {
          throw Object.assign(new Error("character has no indexed file path"), { code: "STALE_PATH" });
        }
        const { meta } = readMeta(char.file_path, SYNC_DIR, { writable: true });
        writeMeta(char.file_path, {
          ...meta,
          ...nextCharacter,
          traits: nextTraits,
        }, { syncDir: SYNC_DIR });
      } catch (err) {
        compatibilityDiagnostics.push({
          code: err?.code ?? "COMPATIBILITY_OUTPUT_FAILED",
          severity: "warning",
          message: `Canonical character metadata was committed, but generated compatibility output for '${character_id}' could not be refreshed: ${err.message}`,
          next_step: "Treat SQLite and project backup artifacts as current. Run sync and inspect the indexed character path before retrying compatibility output.",
          details: {
            character_id,
            indexed_path: char.file_path,
          },
        });
      }

      return jsonResponse({
        ok: true,
        action: "updated",
        message: `Updated character sheet for '${character_id}'.`,
        character_id,
        mutation_order: [
          "validated_request",
          "sqlite_commit",
          "project_backup_refresh",
          "compatibility_output_refresh",
        ],
        compatibility_output: buildCompatibilityOutput({
          refreshed: compatibilityDiagnostics.length === 0,
          diagnostics: compatibilityDiagnostics,
        }),
        ...backupMutationFields(backupResult),
      });
    }
  );

  // ---- update_place_sheet --------------------------------------------------
  s.tool(
    "update_place_sheet",
    "Update canonical place profile fields and retained compatibility notes. The place name commits to SQLite first and refreshes project backups; associated_characters and tags are compatibility/review metadata only. Use connect_character_place_evidence when scene-backed character/place evidence is paired, or connect_scene_place_evidence when scene evidence is place-only.",
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
      const place = db.prepare(`SELECT place_id, project_id, universe_id, file_path, name FROM places WHERE place_id = ?`).get(place_id);
      if (!place) {
        return errorResponse("NOT_FOUND", `Place '${place_id}' not found.`);
      }
      const hasCanonicalNameUpdate = Object.hasOwn(fields, "name");
      const nextName = fields.name ?? place.name;
      let backupResult = emptyBackupMutationResult();

      if (hasCanonicalNameUpdate) {
        try {
          db.exec("BEGIN");
          db.prepare(`UPDATE places SET name = ? WHERE place_id = ?`)
            .run(nextName, place_id);
          db.exec("COMMIT");
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch (rollbackErr) {
            void rollbackErr;
          }
          return errorResponse("IO_ERROR", `Failed to update canonical place metadata for '${place_id}': ${err.message}`);
        }
        backupResult = refreshProjectScopedBackupAfterMutation(db, {
          syncDir: SYNC_DIR,
          projectId: place.project_id,
          applicationVersion: MCP_SERVER_VERSION,
          operation: "update_place_sheet",
          actor: createToolActor("update_place_sheet"),
          affected: {
            places: [place_id],
          },
          summary: `Updated place sheet "${place_id}".`,
          before: {
            place: {
              place_id,
              project_id: place.project_id,
              universe_id: place.universe_id,
              name: place.name,
            },
          },
          after: {
            place: {
              place_id,
              project_id: place.project_id,
              universe_id: place.universe_id,
              name: nextName,
            },
          },
        });
      }

      const compatibilityDiagnostics = [];
      try {
        if (!place.file_path) {
          throw Object.assign(new Error("place has no indexed file path"), { code: "STALE_PATH" });
        }
        const { meta } = readMeta(place.file_path, SYNC_DIR, { writable: true });
        const updated = { ...meta, ...fields, name: nextName };
        writeMeta(place.file_path, updated, { syncDir: SYNC_DIR });
      } catch (err) {
        compatibilityDiagnostics.push({
          code: err?.code ?? "COMPATIBILITY_OUTPUT_FAILED",
          severity: "warning",
          message: `Place metadata was updated, but generated compatibility output for '${place_id}' could not be refreshed: ${err.message}`,
          next_step: "Treat SQLite and project backup artifacts as current for canonical place fields. Use connect_character_place_evidence for relationship authority.",
          details: {
            place_id,
            indexed_path: place.file_path,
          },
        });
      }

      return jsonResponse({
        ok: true,
        action: "updated",
        message: `Updated place sheet for '${place_id}'.`,
        place_id,
        canonical_mutation: hasCanonicalNameUpdate,
        mutation_order: hasCanonicalNameUpdate
          ? [
              "validated_request",
              "sqlite_commit",
              "project_backup_refresh",
              "compatibility_output_refresh",
            ]
          : [
              "validated_request",
              "compatibility_review_note_refresh",
            ],
        compatibility_output: buildCompatibilityOutput({
          refreshed: compatibilityDiagnostics.length === 0,
          diagnostics: compatibilityDiagnostics,
          role: hasCanonicalNameUpdate ? "generated_transparency" : "review_note",
        }),
        non_canonical_fields: ["associated_characters", "tags"].filter(field => Object.hasOwn(fields, field)),
        next_step: Object.hasOwn(fields, "associated_characters")
          ? "Use connect_character_place_evidence when paired scene-backed character/place evidence should become authoritative; use connect_scene_character_evidence or connect_scene_place_evidence for one-sided scene evidence."
          : undefined,
        ...backupMutationFields(backupResult),
      });
    }
  );

  // ---- flag_scene ----------------------------------------------------------
  s.tool(
    "flag_scene",
    "Attach a continuity or review note to a scene as compatibility review metadata. Flags are not canonical relationship authority and do not mutate SQLite; use audit_relationship_metadata, connect_character_place_evidence, record_character_relationship_beat, or link_reference_evidence when the note identifies relationship repair work.",
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
        const { sourceMeta } = readSourceMeta(scene.file_path, SYNC_DIR, { writable: true });
        const flags = sourceMeta.flags ?? [];
        flags.push({ note, flagged_at: new Date().toISOString() });
        writeMeta(scene.file_path, { ...sourceMeta, flags }, { syncDir: SYNC_DIR });
        return jsonResponse({
          ok: true,
          action: "flagged",
          message: `Flagged scene '${scene_id}': ${note}`,
          scene_id,
          project_id,
          compatibility_output: {
            role: "review_note",
            generated_transparency: false,
            mutation_surface: false,
            canonical_mutation: false,
            refreshed: true,
          },
          next_step: "If this flag identifies relationship drift, use audit_relationship_metadata before applying an outcome-level repair.",
        });
      } catch (err) {
        if (err?.name === "CoreValidationError") {
          return errorResponse(err.code, err.message, err.details);
        }
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path — the file may have moved. Run sync() to refresh.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to flag scene '${scene_id}': ${err.message}`);
      }
    }
  );
}
