import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  computeStructureChecksum,
  defaultStructureExportFileName,
  STRUCTURE_EXPORT_SCHEMA_VERSION,
} from "./structure-export.js";

function createDiagnostic(type, message, details = {}, {
  severity = "error",
  nextStep = null,
} = {}) {
  return {
    type,
    severity,
    message,
    details,
    ...(nextStep ? { next_step: nextStep } : {}),
  };
}

function resolveExportPath(syncDir, {
  projectId,
  structureExportPath = null,
  structureExportDir = null,
} = {}) {
  const resolvedSyncDir = path.resolve(syncDir);
  const requestedPath = structureExportPath
    ? (path.isAbsolute(structureExportPath)
      ? path.resolve(structureExportPath)
      : path.resolve(resolvedSyncDir, structureExportPath))
    : path.resolve(
      structureExportDir
        ? (path.isAbsolute(structureExportDir) ? structureExportDir : path.resolve(resolvedSyncDir, structureExportDir))
        : path.resolve(resolvedSyncDir, "structure-exports"),
      defaultStructureExportFileName(projectId)
    );

  const relativePath = path.relative(resolvedSyncDir, requestedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "structure_export_invalid_location",
        "Structure export path must be inside the active sync root.",
        {
          project_id: projectId,
          export_path: requestedPath,
          sync_dir: resolvedSyncDir,
        },
        { nextStep: "Use a generated structure export under WRITING_SYNC_DIR." }
      ),
    };
  }

  return { ok: true, exportPath: requestedPath };
}

function resolveExportedPath(syncDir, exportedPath, {
  projectId,
  itemId,
  itemKind,
  diagnostics,
}) {
  if (!exportedPath) {
    diagnostics.push(createDiagnostic(
      "structure_export_missing_file_path",
      `${itemKind} "${itemId}" in project "${projectId}" is missing a file path in the structure export.`,
      {
        project_id: projectId,
        item_kind: itemKind,
        item_id: itemId,
      },
      { nextStep: "Regenerate the structure export before restoring from it." }
    ));
    return null;
  }

  const resolvedSyncDir = path.resolve(syncDir);
  const resolvedPath = path.resolve(resolvedSyncDir, exportedPath);
  const relativePath = path.relative(resolvedSyncDir, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    diagnostics.push(createDiagnostic(
      "structure_export_path_outside_sync_root",
      `${itemKind} "${itemId}" in project "${projectId}" points outside the active sync root.`,
      {
        project_id: projectId,
        item_kind: itemKind,
        item_id: itemId,
        exported_path: exportedPath,
      },
      { nextStep: "Regenerate the structure export from the current sync root." }
    ));
    return null;
  }

  if (!fs.existsSync(resolvedPath)) {
    diagnostics.push(createDiagnostic(
      "structure_export_file_missing",
      `${itemKind} "${itemId}" in project "${projectId}" points to a missing file.`,
      {
        project_id: projectId,
        item_kind: itemKind,
        item_id: itemId,
        exported_path: exportedPath,
        resolved_path: resolvedPath,
      },
      { nextStep: "Run sync after restoring the file, then retry restore_structure_from_export." }
    ));
    return null;
  }

  return resolvedPath;
}

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function addDuplicateDiagnostics({ diagnostics, projectId, rows, key, itemKind, type }) {
  const seen = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value == null || value === "") continue;
    const bucket = seen.get(value) ?? [];
    bucket.push(row);
    seen.set(value, bucket);
  }

  for (const [value, bucket] of seen.entries()) {
    if (bucket.length <= 1) continue;
    diagnostics.push(createDiagnostic(
      type,
      `Structure export for project "${projectId}" has duplicate ${itemKind} ${key} "${value}".`,
      {
        project_id: projectId,
        item_kind: itemKind,
        key,
        value,
        count: bucket.length,
      },
      { nextStep: "Regenerate or inspect the export before using it for repair." }
    ));
  }
}

function validateSnapshotShape(snapshot, { projectId, diagnostics }) {
  if (!snapshot || typeof snapshot !== "object") {
    diagnostics.push(createDiagnostic(
      "structure_export_invalid_json",
      "Structure export must be a JSON object.",
      { project_id: projectId },
      { nextStep: "Regenerate the export with export_structure_snapshot." }
    ));
    return;
  }

  const exportedProjectId = snapshot.project?.project_id ?? snapshot.export?.project_id ?? null;
  if (exportedProjectId !== projectId) {
    diagnostics.push(createDiagnostic(
      "structure_export_project_mismatch",
      `Structure export belongs to project "${exportedProjectId ?? "unknown"}", not "${projectId}".`,
      {
        project_id: projectId,
        exported_project_id: exportedProjectId,
      },
      { nextStep: "Use the export generated for the requested project." }
    ));
  }

  if (snapshot.export?.schema_version !== STRUCTURE_EXPORT_SCHEMA_VERSION) {
    diagnostics.push(createDiagnostic(
      "structure_export_incompatible_schema",
      `Structure export schema version "${snapshot.export?.schema_version ?? "unknown"}" is not compatible with this server.`,
      {
        project_id: projectId,
        exported_schema_version: snapshot.export?.schema_version ?? null,
        expected_schema_version: STRUCTURE_EXPORT_SCHEMA_VERSION,
      },
      { nextStep: "Regenerate the export with the current server before restoring." }
    ));
  }

  if (snapshot.export?.canonical_source !== "sqlite" || snapshot.export?.mutation_surface !== false) {
    diagnostics.push(createDiagnostic(
      "structure_export_untrusted_source",
      "Structure export is not marked as generated SQLite transparency.",
      {
        project_id: projectId,
        canonical_source: snapshot.export?.canonical_source ?? null,
        mutation_surface: snapshot.export?.mutation_surface ?? null,
      },
      { nextStep: "Use an export produced by export_structure_snapshot." }
    ));
  }

  const exportedChecksum = snapshot.export?.structure_checksum ?? null;
  const computedChecksum = computeStructureChecksum(snapshot);
  if (!exportedChecksum || exportedChecksum !== computedChecksum) {
    diagnostics.push(createDiagnostic(
      "structure_export_checksum_mismatch",
      "Structure export checksum does not match its contents.",
      {
        project_id: projectId,
        exported_checksum: exportedChecksum,
        computed_checksum: computedChecksum,
      },
      { nextStep: "Regenerate the export before using it as trusted repair input." }
    ));
  }

  for (const [key, label] of [
    ["chapters", "chapters"],
    ["scenes", "scenes"],
    ["epigraphs", "epigraphs"],
  ]) {
    if (!Array.isArray(snapshot[key])) {
      diagnostics.push(createDiagnostic(
        "structure_export_invalid_shape",
        `Structure export field "${key}" must be an array.`,
        {
          project_id: projectId,
          field: key,
          label,
        },
        { nextStep: "Regenerate the export before restoring." }
      ));
    }
  }
}

function readSnapshot(exportPath, { projectId, diagnostics }) {
  if (!fs.existsSync(exportPath)) {
    diagnostics.push(createDiagnostic(
      "structure_export_missing",
      `No structure export exists for project "${projectId}" at the requested path.`,
      {
        project_id: projectId,
        export_path: exportPath,
      },
      { nextStep: "Run export_structure_snapshot before restoring from an export." }
    ));
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(exportPath, "utf8"));
  } catch (error) {
    diagnostics.push(createDiagnostic(
      "structure_export_unreadable",
      `Could not read structure export for project "${projectId}" as JSON.`,
      {
        project_id: projectId,
        export_path: exportPath,
        error: error instanceof Error ? error.message : String(error),
      },
      { nextStep: "Regenerate the export before using it as repair input." }
    ));
    return null;
  }
}

function validateCurrentDatabase(db, snapshot, {
  projectId,
  syncDir,
  diagnostics,
}) {
  const project = db.prepare(`
    SELECT project_id
    FROM projects
    WHERE project_id = ?
  `).get(projectId);
  if (!project) {
    diagnostics.push(createDiagnostic(
      "structure_restore_project_missing",
      `Project "${projectId}" is not indexed in SQLite.`,
      { project_id: projectId },
      { nextStep: "Run sync or import before restoring structure from an export." }
    ));
  }

  const chapters = Array.isArray(snapshot?.chapters) ? snapshot.chapters : [];
  const scenes = Array.isArray(snapshot?.scenes) ? snapshot.scenes : [];
  const epigraphs = Array.isArray(snapshot?.epigraphs) ? snapshot.epigraphs : [];
  const chapterIds = new Set(chapters.map(chapter => chapter.chapter_id).filter(Boolean));

  addDuplicateDiagnostics({ diagnostics, projectId, rows: chapters, key: "chapter_id", itemKind: "chapter", type: "structure_export_duplicate_chapter_id" });
  addDuplicateDiagnostics({ diagnostics, projectId, rows: chapters, key: "sort_index", itemKind: "chapter", type: "structure_export_duplicate_chapter_sort" });
  addDuplicateDiagnostics({ diagnostics, projectId, rows: scenes, key: "scene_id", itemKind: "scene", type: "structure_export_duplicate_scene_id" });
  addDuplicateDiagnostics({ diagnostics, projectId, rows: epigraphs, key: "epigraph_id", itemKind: "epigraph", type: "structure_export_duplicate_epigraph_id" });
  addDuplicateDiagnostics({ diagnostics, projectId, rows: epigraphs, key: "chapter_id", itemKind: "epigraph", type: "structure_export_duplicate_epigraph_chapter" });

  for (const chapter of chapters) {
    if (!chapter.chapter_id || chapter.sort_index == null || !chapter.title) {
      diagnostics.push(createDiagnostic(
        "structure_export_invalid_chapter",
        "Structure export contains a chapter without chapter_id, title, or sort_index.",
        {
          project_id: projectId,
          chapter_id: chapter.chapter_id ?? null,
          sort_index: chapter.sort_index ?? null,
          title: chapter.title ?? null,
        },
        { nextStep: "Regenerate or inspect the export before restoring." }
      ));
    }
  }

  for (const scene of scenes) {
    if (scene.chapter_id && !chapterIds.has(scene.chapter_id)) {
      diagnostics.push(createDiagnostic(
        "structure_export_unknown_scene_chapter",
        `Scene "${scene.scene_id}" references chapter "${scene.chapter_id}" that is not in the export.`,
        {
          project_id: projectId,
          scene_id: scene.scene_id,
          chapter_id: scene.chapter_id,
        },
        { nextStep: "Regenerate or inspect the export before restoring." }
      ));
    }
    const filePath = resolveExportedPath(syncDir, scene.file_path, {
      projectId,
      itemId: scene.scene_id,
      itemKind: "scene",
      diagnostics,
    });
    const indexedScene = db.prepare(`
      SELECT scene_id
      FROM scenes
      WHERE scene_id = ? AND project_id = ?
    `).get(scene.scene_id, projectId);
    if (!indexedScene) {
      diagnostics.push(createDiagnostic(
        "structure_restore_scene_not_indexed",
        `Scene "${scene.scene_id}" from the structure export is not indexed in SQLite.`,
        {
          project_id: projectId,
          scene_id: scene.scene_id,
          file_path: filePath,
        },
        { nextStep: "Run sync before restoring scene chapter links from the export." }
      ));
    }
  }

  for (const epigraph of epigraphs) {
    if (!chapterIds.has(epigraph.chapter_id)) {
      diagnostics.push(createDiagnostic(
        "structure_export_unknown_epigraph_chapter",
        `Epigraph "${epigraph.epigraph_id}" references chapter "${epigraph.chapter_id}" that is not in the export.`,
        {
          project_id: projectId,
          epigraph_id: epigraph.epigraph_id,
          chapter_id: epigraph.chapter_id,
        },
        { nextStep: "Regenerate or inspect the export before restoring." }
      ));
    }
    resolveExportedPath(syncDir, epigraph.file_path, {
      projectId,
      itemId: epigraph.epigraph_id,
      itemKind: "epigraph",
      diagnostics,
    });

    const existingById = db.prepare(`
      SELECT epigraph_id, chapter_id
      FROM epigraphs
      WHERE epigraph_id = ? AND project_id = ?
    `).get(epigraph.epigraph_id, projectId);
    if (existingById && existingById.chapter_id !== epigraph.chapter_id) {
      diagnostics.push(createDiagnostic(
        "structure_restore_epigraph_conflict",
        `Epigraph "${epigraph.epigraph_id}" is already indexed to chapter "${existingById.chapter_id}".`,
        {
          project_id: projectId,
          epigraph_id: epigraph.epigraph_id,
          indexed_chapter_id: existingById.chapter_id,
          exported_chapter_id: epigraph.chapter_id,
        },
        { nextStep: "Resolve the current epigraph conflict before restoring from export." }
      ));
    }

    const existingByChapter = db.prepare(`
      SELECT epigraph_id, chapter_id
      FROM epigraphs
      WHERE chapter_id = ? AND project_id = ?
    `).get(epigraph.chapter_id, projectId);
    if (existingByChapter && existingByChapter.epigraph_id !== epigraph.epigraph_id) {
      diagnostics.push(createDiagnostic(
        "structure_restore_epigraph_conflict",
        `Chapter "${epigraph.chapter_id}" already has epigraph "${existingByChapter.epigraph_id}".`,
        {
          project_id: projectId,
          indexed_epigraph_id: existingByChapter.epigraph_id,
          exported_epigraph_id: epigraph.epigraph_id,
          chapter_id: epigraph.chapter_id,
        },
        { nextStep: "Resolve the current epigraph conflict before restoring from export." }
      ));
    }
  }

  const exportedChapterIds = [...chapterIds];
  const extraChapters = db.prepare(`
    SELECT chapter_id
    FROM chapters
    WHERE project_id = ?
    ORDER BY chapter_id
  `).all(projectId).filter(chapter => !chapterIds.has(chapter.chapter_id));
  for (const chapter of extraChapters) {
    diagnostics.push(createDiagnostic(
      "structure_restore_extra_chapter_conflict",
      `Current SQLite chapter "${chapter.chapter_id}" is not present in the structure export.`,
      {
        project_id: projectId,
        chapter_id: chapter.chapter_id,
        exported_chapter_ids: exportedChapterIds,
      },
      { nextStep: "Use explicit structure tools to resolve extra canonical chapters before restoring from export." }
    ));
  }
}

function buildSummary(db, snapshot, { projectId, syncDir }) {
  const chapters = Array.isArray(snapshot?.chapters) ? snapshot.chapters : [];
  const scenes = Array.isArray(snapshot?.scenes) ? snapshot.scenes : [];
  const epigraphs = Array.isArray(snapshot?.epigraphs) ? snapshot.epigraphs : [];

  let chaptersCreated = 0;
  let chaptersUpdated = 0;
  for (const chapter of chapters) {
    const existing = db.prepare(`
      SELECT chapter_id, title, sort_index, logline, source_path, source_checksum, metadata_stale
      FROM chapters
      WHERE chapter_id = ? AND project_id = ?
    `).get(chapter.chapter_id, projectId);
    if (!existing) {
      chaptersCreated += 1;
      continue;
    }
    if (
      existing.title !== chapter.title
      || existing.sort_index !== chapter.sort_index
      || (existing.logline ?? null) !== (chapter.logline ?? null)
      || (existing.source_path ?? null) !== (chapter.source_path ?? null)
      || (existing.source_checksum ?? null) !== (chapter.source_checksum ?? null)
      || existing.metadata_stale !== chapter.metadata_stale
    ) {
      chaptersUpdated += 1;
    }
  }

  let scenesUpdated = 0;
  for (const scene of scenes) {
    const existing = db.prepare(`
      SELECT chapter_id, scene_role, chapter, chapter_title, timeline_position
      FROM scenes
      WHERE scene_id = ? AND project_id = ?
    `).get(scene.scene_id, projectId);
    if (
      existing
      && (
        (existing.chapter_id ?? null) !== (scene.chapter_id ?? null)
        || (existing.scene_role ?? null) !== (scene.scene_role ?? null)
        || (existing.chapter ?? null) !== (scene.compatibility_chapter ?? null)
        || (existing.chapter_title ?? null) !== (scene.compatibility_chapter_title ?? null)
        || (existing.timeline_position ?? null) !== (scene.timeline_position ?? null)
      )
    ) {
      scenesUpdated += 1;
    }
  }

  let epigraphsCreated = 0;
  let epigraphsUpdated = 0;
  for (const epigraph of epigraphs) {
    const existing = db.prepare(`
      SELECT epigraph_id, chapter_id, file_path, prose_checksum, metadata_stale
      FROM epigraphs
      WHERE epigraph_id = ? AND project_id = ?
    `).get(epigraph.epigraph_id, projectId);
    if (!existing) {
      epigraphsCreated += 1;
      continue;
    }
    if (
      existing.chapter_id !== epigraph.chapter_id
      || existing.file_path !== path.resolve(syncDir, epigraph.file_path)
      || (existing.prose_checksum ?? null) !== (epigraph.prose_checksum ?? null)
      || existing.metadata_stale !== epigraph.metadata_stale
    ) {
      epigraphsUpdated += 1;
    }
  }

  return {
    chapters_created: chaptersCreated,
    chapters_updated: chaptersUpdated,
    scenes_updated: scenesUpdated,
    epigraphs_created: epigraphsCreated,
    epigraphs_updated: epigraphsUpdated,
  };
}

function applyRestore(db, snapshot, { projectId, syncDir }) {
  const now = new Date().toISOString();

  snapshot.chapters.forEach((chapter, index) => {
    db.prepare(`
      UPDATE chapters
      SET sort_index = ?
      WHERE chapter_id = ? AND project_id = ?
    `).run(-1000000 - index, chapter.chapter_id, projectId);
  });

  for (const chapter of snapshot.chapters) {
    db.prepare(`
      INSERT INTO chapters (
        chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (chapter_id, project_id) DO UPDATE SET
        title = excluded.title,
        sort_index = excluded.sort_index,
        logline = excluded.logline,
        source_path = excluded.source_path,
        source_checksum = excluded.source_checksum,
        metadata_stale = excluded.metadata_stale,
        updated_at = excluded.updated_at
    `).run(
      chapter.chapter_id,
      projectId,
      chapter.title,
      chapter.sort_index,
      chapter.logline ?? null,
      chapter.source_path ?? null,
      chapter.source_checksum ?? null,
      chapter.metadata_stale ?? 0,
      chapter.updated_at ?? now
    );
  }

  for (const scene of snapshot.scenes) {
    db.prepare(`
      UPDATE scenes
      SET chapter_id = ?,
          scene_role = ?,
          chapter = ?,
          chapter_title = ?,
          timeline_position = ?,
          updated_at = ?
      WHERE scene_id = ? AND project_id = ?
    `).run(
      scene.chapter_id ?? null,
      scene.scene_role ?? null,
      scene.compatibility_chapter ?? null,
      scene.compatibility_chapter_title ?? null,
      scene.timeline_position ?? null,
      scene.updated_at ?? now,
      scene.scene_id,
      projectId
    );
  }

  for (const epigraph of snapshot.epigraphs) {
    const filePath = path.resolve(syncDir, epigraph.file_path);
    const prose = matter(fs.readFileSync(filePath, "utf8")).content;
    db.prepare(`
      INSERT INTO epigraphs (
        epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (epigraph_id, project_id) DO UPDATE SET
        chapter_id = excluded.chapter_id,
        body = excluded.body,
        file_path = excluded.file_path,
        prose_checksum = excluded.prose_checksum,
        metadata_stale = excluded.metadata_stale,
        updated_at = excluded.updated_at
    `).run(
      epigraph.epigraph_id,
      projectId,
      epigraph.chapter_id,
      prose,
      filePath,
      epigraph.prose_checksum ?? null,
      epigraph.metadata_stale ?? 0,
      epigraph.updated_at ?? now
    );
  }
}

export function restoreStructureFromExport(db, {
  syncDir,
  projectId,
  structureExportPath = null,
  structureExportDir = null,
  dryRun = true,
} = {}) {
  const diagnostics = [];
  const resolved = resolveExportPath(syncDir, {
    projectId,
    structureExportPath,
    structureExportDir,
  });
  if (!resolved.ok) {
    diagnostics.push(resolved.diagnostic);
    return {
      ok: false,
      action: "restore_refused",
      project_id: projectId,
      dry_run: dryRun,
      diagnostics,
      summary: { total: diagnostics.length, by_type: countBy(diagnostics, "type") },
    };
  }

  const snapshot = readSnapshot(resolved.exportPath, { projectId, diagnostics });
  validateSnapshotShape(snapshot, { projectId, diagnostics });
  if (diagnostics.length === 0) {
    validateCurrentDatabase(db, snapshot, {
      projectId,
      syncDir,
      diagnostics,
    });
  }

  const blocked = diagnostics.length > 0;
  const planned = !blocked ? buildSummary(db, snapshot, { projectId, syncDir }) : null;
  if (!blocked && !dryRun) {
    try {
      db.exec("BEGIN");
      applyRestore(db, snapshot, { projectId, syncDir });
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        void rollbackError;
      }
      diagnostics.push(createDiagnostic(
        "structure_restore_write_failed",
        `Failed to restore structure for project "${projectId}".`,
        {
          project_id: projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        { nextStep: "Review the database error and retry after resolving conflicts." }
      ));
    }
  }

  return {
    ok: diagnostics.length === 0,
    action: diagnostics.length
      ? "restore_refused"
      : dryRun ? "planned" : "restored",
    project_id: projectId,
    dry_run: dryRun,
    export_path: resolved.exportPath,
    export: snapshot?.export ?? null,
    planned_changes: planned,
    summary: {
      total: diagnostics.length,
      by_type: countBy(diagnostics, "type"),
      by_severity: countBy(diagnostics, "severity"),
    },
    diagnostics,
    next_step: diagnostics.length
      ? "Resolve diagnostics before restoring canonical structure from this export."
      : dryRun
        ? "Re-run restore_structure_from_export with dry_run=false to apply these canonical SQLite repairs transactionally."
        : "Run diagnose_structure and export_structure_snapshot to verify and refresh generated transparency.",
  };
}
