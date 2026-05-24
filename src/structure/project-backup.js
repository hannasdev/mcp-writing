import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertRegularFileWriteTarget,
  ensureDirectoryInsideBoundary,
  resolveGeneratedOutputPath,
  writeGeneratedOutputFile,
} from "../core/filesystem-boundary.js";
import { CURRENT_SCHEMA_VERSION } from "../core/db.js";
import {
  ensureProjectBackupOperationLog,
  PROJECT_BACKUP_OPERATION_LOG_FILE,
} from "./project-backup-operations.js";

export const PROJECT_BACKUP_SCHEMA_VERSION = 1;

const INCLUDED_TABLES = [
  "projects",
  "universes",
  "scenes",
  "chapters",
  "epigraphs",
  "epigraph_characters",
  "epigraph_tags",
  "scene_characters",
  "scene_places",
  "scene_tags",
  "scene_threads",
  "characters",
  "character_traits",
  "character_relationships",
  "places",
  "threads",
  "reference_docs",
  "reference_doc_tags",
  "reference_links",
];

const EXCLUDED_TABLES = [
  "scenes_fts",
  "reference_docs_fts",
  "async_jobs",
  "schema_version",
];

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

function normalizePathForBackup(syncDir, filePath) {
  if (!filePath) return null;
  if (!syncDir) return filePath;
  const syncRoot = path.resolve(syncDir);
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(syncRoot, filePath);
  const normalized = path.relative(syncRoot, resolvedPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Cannot back up path outside sync_dir: ${filePath}`);
  }
  return normalized.split(path.sep).join("/");
}

function querySchemaVersion(db) {
  return db.prepare(`SELECT version FROM schema_version WHERE id = 1`).get()?.version ?? null;
}

function sortedUnique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ""))].sort();
}

function mapPath(row, key, syncDir) {
  return {
    ...row,
    [key]: normalizePathForBackup(syncDir, row[key]),
  };
}

function collectProjectScopedRows(db, table, projectId, orderBy) {
  return db.prepare(`
    SELECT *
    FROM ${table}
    WHERE project_id = ?
    ORDER BY ${orderBy}
  `).all(projectId);
}

function collectScopedWorldRows(db, table, {
  projectId,
  universeId,
  idColumn,
  orderBy,
}) {
  const rows = db.prepare(`
    SELECT *
    FROM ${table}
    WHERE project_id = ?
       OR (? IS NOT NULL AND project_id IS NULL AND universe_id = ?)
    ORDER BY ${orderBy}
  `).all(projectId, universeId, universeId);
  return {
    rows,
    ids: new Set(rows.map(row => row[idColumn])),
  };
}

function collectProjectBackupSnapshot(db, { project, syncDir }) {
  const projectId = project.project_id;
  const universe = project.universe_id
    ? db.prepare(`
      SELECT universe_id, name
      FROM universes
      WHERE universe_id = ?
    `).get(project.universe_id) ?? null
    : null;

  const chapters = collectProjectScopedRows(db, "chapters", projectId, "sort_index, chapter_id")
    .map(row => mapPath(row, "source_path", syncDir));
  const scenes = collectProjectScopedRows(db, "scenes", projectId, "part, chapter, timeline_position, scene_id")
    .map(row => mapPath(row, "file_path", syncDir));
  const epigraphs = db.prepare(`
    SELECT epigraph_id, project_id, chapter_id, file_path, prose_checksum, metadata_stale, updated_at
    FROM epigraphs
    WHERE project_id = ?
    ORDER BY chapter_id, epigraph_id
  `).all(projectId).map(row => mapPath(row, "file_path", syncDir));

  const epigraphCharacters = collectProjectScopedRows(db, "epigraph_characters", projectId, "epigraph_id, character_id");
  const epigraphTags = collectProjectScopedRows(db, "epigraph_tags", projectId, "epigraph_id, tag");
  const sceneCharacters = collectProjectScopedRows(db, "scene_characters", projectId, "scene_id, character_id");
  const scenePlaces = collectProjectScopedRows(db, "scene_places", projectId, "scene_id, place_id");
  const sceneTags = collectProjectScopedRows(db, "scene_tags", projectId, "scene_id, tag");
  const sceneThreads = collectProjectScopedRows(db, "scene_threads", projectId, "scene_id, thread_id");
  const threads = collectProjectScopedRows(db, "threads", projectId, "thread_id");

  const characters = collectScopedWorldRows(db, "characters", {
    projectId,
    universeId: project.universe_id,
    idColumn: "character_id",
    orderBy: "project_id IS NULL, character_id",
  });
  const characterTraits = characters.ids.size
    ? db.prepare(`
      SELECT *
      FROM character_traits
      WHERE character_id IN (${[...characters.ids].map(() => "?").join(",")})
      ORDER BY character_id, trait
    `).all(...characters.ids)
    : [];

  const characterRelationships = db.prepare(`
    SELECT *
    FROM character_relationships
    WHERE from_character IN (${[...characters.ids].map(() => "?").join(",") || "NULL"})
       OR to_character IN (${[...characters.ids].map(() => "?").join(",") || "NULL"})
       OR scene_id IN (${scenes.map(() => "?").join(",") || "NULL"})
    ORDER BY from_character, to_character, relationship_type, scene_id, note
  `).all(...characters.ids, ...characters.ids, ...scenes.map(row => row.scene_id));

  const places = collectScopedWorldRows(db, "places", {
    projectId,
    universeId: project.universe_id,
    idColumn: "place_id",
    orderBy: "project_id IS NULL, place_id",
  });

  const referenceDocs = collectScopedWorldRows(db, "reference_docs", {
    projectId,
    universeId: project.universe_id,
    idColumn: "doc_id",
    orderBy: "project_id IS NULL, doc_id",
  });
  const referenceDocTags = referenceDocs.ids.size
    ? db.prepare(`
      SELECT *
      FROM reference_doc_tags
      WHERE doc_id IN (${[...referenceDocs.ids].map(() => "?").join(",")})
      ORDER BY doc_id, tag
    `).all(...referenceDocs.ids)
    : [];
  const referenceLinks = db.prepare(`
    SELECT *
    FROM reference_links
    WHERE source_project_id = ?
       OR (
         source_project_id = ''
         AND source_kind = 'reference'
         AND source_id IN (${[...referenceDocs.ids].map(() => "?").join(",") || "NULL"})
       )
    ORDER BY source_kind, source_project_id, source_id, target_doc_id, relation
  `).all(projectId, ...referenceDocs.ids);

  const includedCharacterIds = characters.ids;
  const includedPlaceIds = places.ids;
  const includedReferenceDocIds = referenceDocs.ids;
  const externalReferences = {
    character_ids: sortedUnique([
      ...sceneCharacters.map(row => row.character_id),
      ...epigraphCharacters.map(row => row.character_id),
      ...characterRelationships.flatMap(row => [row.from_character, row.to_character]),
    ].filter(id => !includedCharacterIds.has(id))),
    place_ids: sortedUnique(scenePlaces.map(row => row.place_id).filter(id => !includedPlaceIds.has(id))),
    reference_doc_ids: sortedUnique(referenceLinks.map(row => row.target_doc_id).filter(id => !includedReferenceDocIds.has(id))),
  };

  return {
    project: {
      project_id: project.project_id,
      universe_id: project.universe_id ?? null,
      name: project.name,
    },
    universe: universe
      ? {
          universe_id: universe.universe_id,
          name: universe.name,
        }
      : null,
    chapters,
    scenes,
    epigraphs,
    epigraph_characters: epigraphCharacters,
    epigraph_tags: epigraphTags,
    scene_characters: sceneCharacters,
    scene_places: scenePlaces,
    scene_tags: sceneTags,
    scene_threads: sceneThreads,
    characters: characters.rows.map(row => mapPath(row, "file_path", syncDir)),
    character_traits: characterTraits,
    character_relationships: characterRelationships,
    places: places.rows.map(row => mapPath(row, "file_path", syncDir)),
    threads,
    reference_docs: referenceDocs.rows.map(row => mapPath(row, "file_path", syncDir)),
    reference_doc_tags: referenceDocTags,
    reference_links: referenceLinks,
    external_references: externalReferences,
    operation_history: {
      supported: true,
      authority: false,
      advisory: true,
      artifact: PROJECT_BACKUP_OPERATION_LOG_FILE,
    },
  };
}

export function computeProjectBackupSnapshotChecksum(snapshot) {
  return sha256(stableStringify(snapshot, 0));
}

export function computeProjectBackupBundleChecksum(bundle) {
  const { manifest = {}, snapshot = {} } = bundle ?? {};
  const { checksums: _checksums, ...manifestWithoutChecksums } = manifest;
  return sha256(stableStringify({
    manifest: manifestWithoutChecksums,
    snapshot,
  }, 0));
}

export function renderProjectBackupArtifact(value) {
  return `${stableStringify(value, 2)}\n`;
}

function writeGeneratedOutputFileIfChanged(filePath, rendered) {
  assertRegularFileWriteTarget(filePath);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === rendered) {
    return false;
  }
  writeGeneratedOutputFile(filePath, rendered, { encoding: "utf8" });
  return true;
}

export function writeProjectBackupFiles(bundle, { outputDir }) {
  const normalizedOutputDir = path.resolve(outputDir);
  ensureDirectoryInsideBoundary(normalizedOutputDir, { label: "backup output_dir" });

  const manifestPath = resolveGeneratedOutputPath(normalizedOutputDir, "manifest.json");
  const snapshotPath = resolveGeneratedOutputPath(normalizedOutputDir, "canonical.snapshot.json");
  const renderedManifest = renderProjectBackupArtifact(bundle.manifest);
  const renderedSnapshot = renderProjectBackupArtifact(bundle.snapshot);

  const manifestWritten = writeGeneratedOutputFileIfChanged(manifestPath, renderedManifest);
  const snapshotWritten = writeGeneratedOutputFileIfChanged(snapshotPath, renderedSnapshot);
  const operationLog = ensureProjectBackupOperationLog({ outputDir: normalizedOutputDir });

  return {
    manifestPath,
    snapshotPath,
    operationLogPath: operationLog.operationLogPath,
    written: {
      manifest: manifestWritten,
      canonical_snapshot: snapshotWritten,
      operations: operationLog.written,
    },
  };
}

export function buildProjectBackup(db, {
  projectId,
  syncDir = null,
  applicationVersion = "0.0.0",
  backupLocation = null,
} = {}) {
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

  const snapshot = collectProjectBackupSnapshot(db, { project, syncDir });
  const snapshotChecksum = computeProjectBackupSnapshotChecksum(snapshot);
  const manifestBase = {
    artifact_kind: "project_backup",
    schema_version: PROJECT_BACKUP_SCHEMA_VERSION,
    canonical_source: "sqlite",
    generated_transparency: true,
    mutation_surface: false,
    project_id: project.project_id,
    backup_location: backupLocation ?? `project-backups/${project.project_id}/`,
    compatibility: {
      application_version: applicationVersion,
      sqlite_schema_version: querySchemaVersion(db),
      current_sqlite_schema_version: CURRENT_SCHEMA_VERSION,
    },
    restore_policy: {
      authority: "full_snapshot",
      custom_delta_chains: false,
      event_replay_required: false,
      operation_history_authority: false,
    },
    operation_history: {
      supported: true,
      advisory: true,
      artifact: PROJECT_BACKUP_OPERATION_LOG_FILE,
      authority: false,
      purpose: "future audit, provenance, progress analytics, and tool accountability",
    },
    privacy: {
      git_trackable: true,
      manuscript_sensitive: true,
      includes_authored_prose_bodies: false,
      note: "Backup artifacts may include titles, summaries, tags, relationship notes, and structural metadata.",
    },
    coverage: {
      included_tables: INCLUDED_TABLES,
      excluded_tables: EXCLUDED_TABLES,
      split_snapshot_supported: false,
      counts: {
        chapters: snapshot.chapters.length,
        scenes: snapshot.scenes.length,
        epigraphs: snapshot.epigraphs.length,
        characters: snapshot.characters.length,
        places: snapshot.places.length,
        threads: snapshot.threads.length,
        reference_docs: snapshot.reference_docs.length,
        external_character_references: snapshot.external_references.character_ids.length,
        external_place_references: snapshot.external_references.place_ids.length,
        external_reference_doc_references: snapshot.external_references.reference_doc_ids.length,
      },
    },
  };
  const manifest = {
    ...manifestBase,
    checksums: {
      canonical_snapshot_sha256: snapshotChecksum,
      bundle_sha256: computeProjectBackupBundleChecksum({ manifest: manifestBase, snapshot }),
    },
  };

  return {
    ok: true,
    manifest,
    snapshot,
  };
}
