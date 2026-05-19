import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import yaml from "js-yaml";
import {
  buildStructureExport,
  defaultStructureExportFileName,
  STRUCTURE_EXPORT_SCHEMA_VERSION,
} from "./structure-export.js";
import {
  inferChapterStructureFromPath,
  normalizeSceneMetaForPath,
} from "./structure-inference.js";

function sidecarPath(filePath) {
  return filePath.replace(/\.(md|txt)$/, ".meta.yaml");
}

function normalizeRelativePath(syncDir, filePath) {
  return path.relative(syncDir, filePath).split(path.sep).join("/");
}

function isPathInsideSyncDir(syncDir, filePath) {
  const relativePath = path.relative(path.resolve(syncDir), path.resolve(filePath));
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function readStructureMetadata(filePath) {
  const sidecar = sidecarPath(filePath);
  if (fs.existsSync(sidecar)) {
    const raw = fs.readFileSync(sidecar, "utf8");
    return yaml.load(raw) ?? {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw).data ?? {};
}

function readObservedStructure(syncDir, filePath) {
  const sourceMeta = readStructureMetadata(filePath);
  const { meta } = normalizeSceneMetaForPath(syncDir, filePath, sourceMeta);
  return {
    meta,
    chapterStructure: inferChapterStructureFromPath(syncDir, filePath, meta),
  };
}

function createDiagnostic(type, message, details = {}, {
  severity = "warning",
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

function addDiagnostic(diagnostics, type, message, details = {}, options = {}) {
  diagnostics.push(createDiagnostic(type, message, details, options));
}

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function projectClause(projectId, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return projectId ? { sql: ` AND ${prefix}project_id = ?`, params: [projectId] } : { sql: "", params: [] };
}

function readIndexedSceneRows(db, projectId) {
  const scope = projectClause(projectId);
  return db.prepare(`
    SELECT scene_id, project_id, chapter_id, scene_role, chapter, chapter_title, file_path
    FROM scenes
    WHERE 1 = 1${scope.sql}
    ORDER BY project_id, scene_id
  `).all(...scope.params);
}

function readIndexedEpigraphRows(db, projectId) {
  const scope = projectClause(projectId);
  return db.prepare(`
    SELECT epigraph_id, project_id, chapter_id, file_path
    FROM epigraphs
    WHERE 1 = 1${scope.sql}
    ORDER BY project_id, epigraph_id
  `).all(...scope.params);
}

function readProjectRows(db, projectId) {
  const scope = projectClause(projectId);
  return db.prepare(`
    SELECT project_id
    FROM projects
    WHERE 1 = 1${scope.sql}
    ORDER BY project_id
  `).all(...scope.params);
}

function diagnoseUnknownChapterLinks(db, diagnostics, projectId) {
  const sceneScope = projectClause(projectId, "s");
  const scenes = db.prepare(`
    SELECT s.scene_id, s.project_id, s.chapter_id, s.file_path
    FROM scenes s
    LEFT JOIN chapters c ON c.project_id = s.project_id AND c.chapter_id = s.chapter_id
    WHERE s.chapter_id IS NOT NULL AND s.chapter_id != '' AND c.chapter_id IS NULL${sceneScope.sql}
    ORDER BY s.project_id, s.scene_id
  `).all(...sceneScope.params);

  for (const scene of scenes) {
    addDiagnostic(
      diagnostics,
      "scene_unknown_chapter",
      `Scene "${scene.scene_id}" in project "${scene.project_id}" references unknown chapter_id "${scene.chapter_id}".`,
      {
        project_id: scene.project_id,
        scene_id: scene.scene_id,
        chapter_id: scene.chapter_id,
        file_path: scene.file_path,
      },
      { nextStep: "Run sync to refresh canonical chapter indexes, then use an explicit structure workflow once available if the link is still invalid." }
    );
  }

  const epigraphScope = projectClause(projectId, "e");
  const epigraphs = db.prepare(`
    SELECT e.epigraph_id, e.project_id, e.chapter_id, e.file_path
    FROM epigraphs e
    LEFT JOIN chapters c ON c.project_id = e.project_id AND c.chapter_id = e.chapter_id
    WHERE c.chapter_id IS NULL${epigraphScope.sql}
    ORDER BY e.project_id, e.epigraph_id
  `).all(...epigraphScope.params);

  for (const epigraph of epigraphs) {
    addDiagnostic(
      diagnostics,
      "epigraph_unknown_chapter",
      `Epigraph "${epigraph.epigraph_id}" in project "${epigraph.project_id}" references unknown chapter_id "${epigraph.chapter_id}".`,
      {
        project_id: epigraph.project_id,
        epigraph_id: epigraph.epigraph_id,
        chapter_id: epigraph.chapter_id,
        file_path: epigraph.file_path,
      },
      { nextStep: "Check the epigraph file path and chapter sidecar fields before applying any repair." }
    );
  }
}

function diagnoseNumericCompatibility(db, diagnostics, projectId) {
  const scope = projectClause(projectId, "s");
  const rows = db.prepare(`
    SELECT s.scene_id, s.project_id, s.chapter_id, s.chapter, s.chapter_title,
           c.sort_index, c.title
    FROM scenes s
    JOIN chapters c ON c.project_id = s.project_id AND c.chapter_id = s.chapter_id
    WHERE (
      (s.chapter IS NOT NULL AND s.chapter != c.sort_index)
      OR (s.chapter_title IS NOT NULL AND s.chapter_title != c.title)
    )${scope.sql}
    ORDER BY s.project_id, s.scene_id
  `).all(...scope.params);

  for (const row of rows) {
    addDiagnostic(
      diagnostics,
      "numeric_chapter_identity_mismatch",
      `Scene "${row.scene_id}" compatibility chapter fields disagree with canonical chapter "${row.chapter_id}".`,
      {
        project_id: row.project_id,
        scene_id: row.scene_id,
        chapter_id: row.chapter_id,
        scene_chapter: row.chapter,
        canonical_chapter: row.sort_index,
        scene_chapter_title: row.chapter_title,
        canonical_chapter_title: row.title,
      },
      { nextStep: "Prefer canonical chapter_id in workflows; update compatibility fields only through sanctioned structure paths." }
    );
  }
}

function diagnoseObservedFiles(syncDir, diagnostics, { scenes, epigraphs }) {
  const observedChapterFolders = new Map();
  const roleFolders = new Map();

  for (const scene of scenes) {
    if (!scene.file_path || !fs.existsSync(scene.file_path)) continue;
    if (!isPathInsideSyncDir(syncDir, scene.file_path)) {
      addDiagnostic(
        diagnostics,
        "indexed_path_outside_sync_root",
        `Scene "${scene.scene_id}" has an indexed file path outside the active sync root.`,
        {
          project_id: scene.project_id,
          scene_id: scene.scene_id,
          file_path: scene.file_path,
          sync_dir: syncDir,
        },
        { nextStep: "Run sync with the current sync root before trusting file-derived structure diagnostics." }
      );
      continue;
    }

    let observed;
    try {
      observed = readObservedStructure(syncDir, scene.file_path);
    } catch (error) {
      addDiagnostic(
        diagnostics,
        "structure_file_read_failed",
        `Could not read structure metadata for scene "${scene.scene_id}": ${error.message}`,
        {
          project_id: scene.project_id,
          scene_id: scene.scene_id,
          file_path: scene.file_path,
        },
        { severity: "info", nextStep: "Run sync after confirming the file still exists and has readable metadata." }
      );
      continue;
    }

    const chapter = observed.chapterStructure.chapter;
    if (chapter) {
      const key = `${scene.project_id}::${chapter.sort_index}`;
      const existing = observedChapterFolders.get(key) ?? new Set();
      existing.add(chapter.folder_key);
      observedChapterFolders.set(key, existing);

      if (scene.chapter_id && scene.chapter_id !== chapter.chapter_id) {
        addDiagnostic(
          diagnostics,
          "folder_canonical_mismatch",
          `Scene "${scene.scene_id}" is indexed to chapter_id "${scene.chapter_id}" but its folder implies "${chapter.chapter_id}".`,
          {
            project_id: scene.project_id,
            scene_id: scene.scene_id,
            indexed_chapter_id: scene.chapter_id,
            observed_chapter_id: chapter.chapter_id,
            observed_chapter: chapter.sort_index,
            relative_path: normalizeRelativePath(syncDir, scene.file_path),
          },
          { nextStep: "Inspect the file location and sidecar before changing canonical chapter links." }
        );
      }
    }

    if (observed.chapterStructure.role && ["prologue", "epilogue"].includes(observed.chapterStructure.role)) {
      const key = `${scene.project_id}::${observed.chapterStructure.role}`;
      const existing = roleFolders.get(key) ?? new Set();
      existing.add(path.dirname(scene.file_path));
      roleFolders.set(key, existing);
    }
  }

  for (const [key, folders] of observedChapterFolders.entries()) {
    if (folders.size <= 1) continue;
    const [projectId, sortIndex] = key.split("::");
    addDiagnostic(
      diagnostics,
      "duplicate_chapter_sort_index",
      `Project "${projectId}" has multiple observed folders for chapter order ${sortIndex}.`,
      {
        project_id: projectId,
        chapter: Number(sortIndex),
        folders: [...folders].sort(),
      },
      { nextStep: "Resolve the duplicate folder-derived chapter order before relying on canonical structure diagnostics." }
    );
  }

  for (const [key, folders] of roleFolders.entries()) {
    if (folders.size <= 1) continue;
    const [projectId, role] = key.split("::");
    addDiagnostic(
      diagnostics,
      "multiple_scene_role",
      `Project "${projectId}" has multiple observed ${role} folders.`,
      {
        project_id: projectId,
        scene_role: role,
        folders: [...folders].sort().map(folder => normalizeRelativePath(syncDir, folder)),
      },
      { nextStep: `Decide which ${role} folder is canonical before running repair or mutation workflows.` }
    );
  }

  for (const epigraph of epigraphs) {
    if (!epigraph.file_path || !fs.existsSync(epigraph.file_path)) continue;
    if (!isPathInsideSyncDir(syncDir, epigraph.file_path)) {
      addDiagnostic(
        diagnostics,
        "indexed_path_outside_sync_root",
        `Epigraph "${epigraph.epigraph_id}" has an indexed file path outside the active sync root.`,
        {
          project_id: epigraph.project_id,
          epigraph_id: epigraph.epigraph_id,
          file_path: epigraph.file_path,
          sync_dir: syncDir,
        },
        { nextStep: "Run sync with the current sync root before trusting file-derived structure diagnostics." }
      );
      continue;
    }

    let observed;
    try {
      observed = readObservedStructure(syncDir, epigraph.file_path);
    } catch (error) {
      addDiagnostic(
        diagnostics,
        "structure_file_read_failed",
        `Could not read structure metadata for epigraph "${epigraph.epigraph_id}": ${error.message}`,
        {
          project_id: epigraph.project_id,
          epigraph_id: epigraph.epigraph_id,
          file_path: epigraph.file_path,
        },
        { severity: "info", nextStep: "Run sync after confirming the epigraph file still exists and has readable metadata." }
      );
      continue;
    }

    const observedChapterId = observed.chapterStructure.chapter?.chapter_id ?? observed.meta.chapter_id ?? null;
    if (observedChapterId && epigraph.chapter_id !== observedChapterId) {
      addDiagnostic(
        diagnostics,
        "epigraph_chapter_conflict",
        `Epigraph "${epigraph.epigraph_id}" is indexed to chapter_id "${epigraph.chapter_id}" but its file implies "${observedChapterId}".`,
        {
          project_id: epigraph.project_id,
          epigraph_id: epigraph.epigraph_id,
          indexed_chapter_id: epigraph.chapter_id,
          observed_chapter_id: observedChapterId,
          relative_path: normalizeRelativePath(syncDir, epigraph.file_path),
        },
        { nextStep: "Inspect the epigraph sidecar and folder before reassigning it." }
      );
    }
  }
}

function resolveStructureExportPath(syncDir, exportDir, projectId) {
  const resolvedSyncDir = path.resolve(syncDir);
  const resolvedExportDir = exportDir
    ? (path.isAbsolute(exportDir) ? path.resolve(exportDir) : path.resolve(resolvedSyncDir, exportDir))
    : path.resolve(resolvedSyncDir, "structure-exports");
  const relativeDir = path.relative(resolvedSyncDir, resolvedExportDir);
  if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
    throw new Error(`Structure export directory must be inside sync_dir: ${exportDir}`);
  }
  return path.join(resolvedExportDir, defaultStructureExportFileName(projectId));
}

function readStructureExportFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error("Could not read structure export."),
    };
  }
}

function diagnoseStructureExports(db, diagnostics, {
  syncDir,
  exportDir,
  projectId,
}) {
  if (!syncDir) return [];

  const exportChecks = [];
  const projects = readProjectRows(db, projectId);
  for (const project of projects) {
    const expectedProjectId = project.project_id;
    let exportPath;
    try {
      exportPath = resolveStructureExportPath(syncDir, exportDir, expectedProjectId);
    } catch {
      addDiagnostic(
        diagnostics,
        "structure_export_invalid_location",
        `Structure export location for project "${expectedProjectId}" is outside the active sync root.`,
        {
          project_id: expectedProjectId,
          export_dir: exportDir,
          sync_dir: syncDir,
        },
        {
          nextStep: "Use an export directory inside WRITING_SYNC_DIR before trusting generated structure exports.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: null,
        trusted: false,
        status: "invalid_location",
      });
      continue;
    }

    if (!fs.existsSync(exportPath)) {
      addDiagnostic(
        diagnostics,
        "structure_export_missing",
        `Project "${expectedProjectId}" does not have a generated structure export.`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
        },
        {
          severity: "info",
          nextStep: "Run export_structure_snapshot before relying on export-based recovery.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "missing",
      });
      continue;
    }

    const parsed = readStructureExportFile(exportPath);
    if (parsed.error) {
      addDiagnostic(
        diagnostics,
        "structure_export_unreadable",
        `Structure export for project "${expectedProjectId}" could not be read as JSON.`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
          error: parsed.error.message,
        },
        {
          nextStep: "Regenerate the export with export_structure_snapshot before using it for recovery.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "unreadable",
      });
      continue;
    }

    const exportedProjectId = parsed.project?.project_id ?? parsed.export?.project_id ?? null;
    if (exportedProjectId !== expectedProjectId) {
      addDiagnostic(
        diagnostics,
        "structure_export_project_mismatch",
        `Structure export for project "${expectedProjectId}" belongs to project "${exportedProjectId ?? "unknown"}".`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
          exported_project_id: exportedProjectId,
        },
        {
          nextStep: "Regenerate the export for this project before using it for recovery.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "wrong_project",
      });
      continue;
    }

    const exportedSchemaVersion = parsed.export?.schema_version ?? null;
    if (exportedSchemaVersion !== STRUCTURE_EXPORT_SCHEMA_VERSION) {
      addDiagnostic(
        diagnostics,
        "structure_export_incompatible_schema",
        `Structure export for project "${expectedProjectId}" has schema version "${exportedSchemaVersion ?? "unknown"}"; expected "${STRUCTURE_EXPORT_SCHEMA_VERSION}".`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
          exported_schema_version: exportedSchemaVersion,
          expected_schema_version: STRUCTURE_EXPORT_SCHEMA_VERSION,
        },
        {
          nextStep: "Regenerate the export with the current server before using it for recovery.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "incompatible_schema",
      });
      continue;
    }

    const built = buildStructureExport(db, {
      projectId: expectedProjectId,
      syncDir,
    });
    if (!built.ok) {
      addDiagnostic(
        diagnostics,
        "structure_export_current_snapshot_failed",
        `Could not build current structure snapshot for project "${expectedProjectId}".`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
          error_code: built.error.code,
          error_message: built.error.message,
        },
        {
          nextStep: "Repair the canonical project record before trusting structure exports.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "current_snapshot_failed",
      });
      continue;
    }

    const exportedChecksum = parsed.export?.structure_checksum ?? null;
    const currentChecksum = built.snapshot.export.structure_checksum;
    if (exportedChecksum !== currentChecksum) {
      addDiagnostic(
        diagnostics,
        "structure_export_stale",
        `Structure export for project "${expectedProjectId}" is stale relative to current SQLite canonical state.`,
        {
          project_id: expectedProjectId,
          export_path: exportPath,
          exported_checksum: exportedChecksum,
          current_checksum: currentChecksum,
        },
        {
          nextStep: "Regenerate the export with export_structure_snapshot, then review the Git diff.",
        }
      );
      exportChecks.push({
        project_id: expectedProjectId,
        export_path: exportPath,
        trusted: false,
        status: "stale",
      });
      continue;
    }

    exportChecks.push({
      project_id: expectedProjectId,
      export_path: exportPath,
      trusted: true,
      status: "current",
      schema_version: exportedSchemaVersion,
      structure_checksum: currentChecksum,
    });
  }

  return exportChecks;
}

export function runStructureDiagnostics(db, {
  syncDir,
  structureExportDir = null,
  projectId = null,
} = {}) {
  const diagnostics = [];
  const scenes = readIndexedSceneRows(db, projectId);
  const epigraphs = readIndexedEpigraphRows(db, projectId);

  diagnoseUnknownChapterLinks(db, diagnostics, projectId);
  diagnoseNumericCompatibility(db, diagnostics, projectId);

  if (syncDir) {
    diagnoseObservedFiles(syncDir, diagnostics, { scenes, epigraphs });
  }

  const structureExports = diagnoseStructureExports(db, diagnostics, {
    syncDir,
    exportDir: structureExportDir,
    projectId,
  });

  diagnostics.sort((a, b) => {
    const projectCompare = String(a.details.project_id ?? "").localeCompare(String(b.details.project_id ?? ""));
    if (projectCompare) return projectCompare;
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare) return typeCompare;
    return a.message.localeCompare(b.message);
  });

  return {
    ok: diagnostics.length === 0,
    checked: {
      project_id: projectId,
      scenes: scenes.length,
      epigraphs: epigraphs.length,
      structure_exports: structureExports,
    },
    summary: {
      total: diagnostics.length,
      by_type: countBy(diagnostics, "type"),
      by_severity: countBy(diagnostics, "severity"),
    },
    diagnostics,
    next_steps: diagnostics.length
      ? [
        "Review diagnostics before applying any structure repair.",
        "Run sync after external file moves, then re-run diagnose_structure to confirm remaining drift.",
      ]
      : ["No structure drift detected in the current index."],
  };
}
