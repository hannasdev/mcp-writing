import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { load as parseYaml } from "js-yaml";
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

function readStructureMetadata(syncDir, filePath) {
  const sidecar = sidecarPath(filePath);
  if (fs.existsSync(sidecar)) {
    const raw = fs.readFileSync(sidecar, "utf8");
    return parseYaml(raw) ?? {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw).data ?? {};
}

function readObservedStructure(syncDir, filePath) {
  const sourceMeta = readStructureMetadata(syncDir, filePath);
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

    let observed;
    try {
      observed = readObservedStructure(syncDir, epigraph.file_path);
    } catch {
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

export function runStructureDiagnostics(db, {
  syncDir,
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
