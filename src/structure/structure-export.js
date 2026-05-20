import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const STRUCTURE_EXPORT_SCHEMA_VERSION = 1;

function normalizePathForExport(syncDir, filePath) {
  if (!filePath) return null;
  const syncRoot = path.resolve(syncDir);
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(syncRoot, filePath);
  const normalized = path.relative(syncRoot, resolvedPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Cannot export path outside sync_dir: ${filePath}`);
  }
  return normalized.split(path.sep).join("/");
}

function stableStringify(value, indent = 2) {
  const seen = new WeakSet();
  function normalize(input) {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) {
      throw new TypeError("Cannot stable-stringify circular structure.");
    }
    seen.add(input);
    if (Array.isArray(input)) {
      const array = input.map(normalize);
      seen.delete(input);
      return array;
    }
    const object = {};
    for (const key of Object.keys(input).sort()) {
      object[key] = normalize(input[key]);
    }
    seen.delete(input);
    return object;
  }

  return JSON.stringify(normalize(value), null, indent);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function computeStructureChecksum(snapshot) {
  const {
    export: exportMetadata = {},
    ...rest
  } = snapshot ?? {};
  const {
    structure_checksum: _structureChecksum,
    ...checksumExportMetadata
  } = exportMetadata;

  return sha256(stableStringify({
    export: checksumExportMetadata,
    ...rest,
  }, 0));
}

export function defaultStructureExportFileName(projectId) {
  const slug = String(projectId ?? "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
  return `${slug}.structure.json`;
}

export function buildStructureExport(db, { projectId, syncDir }) {
  const project = db.prepare(`
    SELECT project_id, universe_id, name
    FROM projects
    WHERE project_id = ?
  `).get(projectId);
  if (!project) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Project '${projectId}' not found.`,
        details: { project_id: projectId },
      },
    };
  }

  const chapters = db.prepare(`
    SELECT chapter_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    FROM chapters
    WHERE project_id = ?
    ORDER BY sort_index, chapter_id
  `).all(projectId).map(row => ({
    chapter_id: row.chapter_id,
    title: row.title,
    sort_index: row.sort_index,
    logline: row.logline ?? null,
    source_path: normalizePathForExport(syncDir, row.source_path),
    source_checksum: row.source_checksum ?? null,
    metadata_stale: row.metadata_stale,
    updated_at: row.updated_at,
  }));

  const scenes = db.prepare(`
    SELECT
      s.scene_id,
      s.title,
      s.chapter_id,
      s.scene_role,
      s.part,
      s.chapter,
      s.chapter_title,
      s.timeline_position,
      s.file_path,
      s.prose_checksum,
      s.metadata_stale,
      s.updated_at
    FROM scenes s
    LEFT JOIN chapters c
      ON c.project_id = s.project_id
     AND c.chapter_id = s.chapter_id
    WHERE s.project_id = ?
    ORDER BY
      CASE WHEN c.sort_index IS NULL THEN 2147483647 ELSE c.sort_index END,
      CASE WHEN s.timeline_position IS NULL THEN 1 ELSE 0 END,
      s.timeline_position,
      s.scene_id
  `).all(projectId).map(row => ({
    scene_id: row.scene_id,
    title: row.title ?? null,
    chapter_id: row.chapter_id ?? null,
    scene_role: row.scene_role ?? null,
    part: row.part ?? null,
    compatibility_chapter: row.chapter ?? null,
    compatibility_chapter_title: row.chapter_title ?? null,
    timeline_position: row.timeline_position ?? null,
    file_path: normalizePathForExport(syncDir, row.file_path),
    prose_checksum: row.prose_checksum ?? null,
    metadata_stale: row.metadata_stale,
    updated_at: row.updated_at,
  }));

  const epigraphs = db.prepare(`
    SELECT
      e.epigraph_id,
      e.chapter_id,
      e.file_path,
      e.prose_checksum,
      e.metadata_stale,
      e.updated_at
    FROM epigraphs e
    LEFT JOIN chapters c
      ON c.project_id = e.project_id
     AND c.chapter_id = e.chapter_id
    WHERE e.project_id = ?
    ORDER BY
      CASE WHEN c.sort_index IS NULL THEN 2147483647 ELSE c.sort_index END,
      e.epigraph_id
  `).all(projectId).map(row => ({
    epigraph_id: row.epigraph_id,
    chapter_id: row.chapter_id,
    file_path: normalizePathForExport(syncDir, row.file_path),
    prose_checksum: row.prose_checksum ?? null,
    metadata_stale: row.metadata_stale,
    updated_at: row.updated_at,
  }));

  const baseSnapshot = {
    export: {
      schema_version: STRUCTURE_EXPORT_SCHEMA_VERSION,
      canonical_source: "sqlite",
      project_id: project.project_id,
      generated_transparency: true,
      mutation_surface: false,
    },
    project: {
      project_id: project.project_id,
      universe_id: project.universe_id ?? null,
      name: project.name,
    },
    summary: {
      chapter_count: chapters.length,
      scene_count: scenes.length,
      epigraph_count: epigraphs.length,
    },
    chapters,
    scenes,
    epigraphs,
  };

  const structureChecksum = computeStructureChecksum(baseSnapshot);
  return {
    ok: true,
    snapshot: {
      ...baseSnapshot,
      export: {
        ...baseSnapshot.export,
        structure_checksum: structureChecksum,
      },
    },
  };
}

export function renderStructureExport(snapshot) {
  return `${stableStringify(snapshot, 2)}\n`;
}

export function writeStructureExportFile(snapshot, { outputDir, fileName }) {
  const normalizedOutputDir = path.resolve(outputDir);
  const targetPath = path.resolve(normalizedOutputDir, fileName);
  const relative = path.relative(normalizedOutputDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Output file '${fileName}' resolves outside output_dir.`);
  }

  if (!fs.existsSync(normalizedOutputDir)) {
    fs.mkdirSync(normalizedOutputDir, { recursive: true });
  } else {
    const outputDirStat = fs.lstatSync(normalizedOutputDir);
    if (!outputDirStat.isDirectory()) {
      throw new Error(`output_dir exists but is not a directory: ${normalizedOutputDir}`);
    }
  }
  fs.accessSync(normalizedOutputDir, fs.constants.W_OK);

  const stat = (() => {
    try {
      return fs.lstatSync(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  })();
  if (stat?.isSymbolicLink()) {
    throw new Error(`Refusing to write: target path is a symlink: ${targetPath}`);
  }
  if (stat && !stat.isFile()) {
    throw new Error(`Refusing to write: target path exists but is not a regular file: ${targetPath}`);
  }

  fs.writeFileSync(targetPath, renderStructureExport(snapshot), "utf8");
  return targetPath;
}
