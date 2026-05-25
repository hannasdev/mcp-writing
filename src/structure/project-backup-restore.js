import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  buildProjectBackup,
  computeProjectBackupBundleChecksum,
  computeProjectBackupSnapshotChecksum,
  PROJECT_BACKUP_SCHEMA_VERSION,
} from "./project-backup.js";
import {
  resolveBoundaryRootReal,
  resolveCandidateInsideBoundary,
} from "../core/filesystem-boundary.js";

const MANIFEST_FILE = "manifest.json";
const SNAPSHOT_FILE = "canonical.snapshot.json";

const SNAPSHOT_ARRAY_DOMAINS = [
  ["chapters", ["project_id", "chapter_id"]],
  ["scenes", ["project_id", "scene_id"]],
  ["epigraphs", ["project_id", "epigraph_id"]],
  ["epigraph_characters", ["project_id", "epigraph_id", "character_id"]],
  ["epigraph_tags", ["project_id", "epigraph_id", "tag"]],
  ["scene_characters", ["project_id", "scene_id", "character_id"]],
  ["scene_places", ["project_id", "scene_id", "place_id"]],
  ["scene_tags", ["project_id", "scene_id", "tag"]],
  ["scene_threads", ["project_id", "scene_id", "thread_id"]],
  ["characters", ["character_id"]],
  ["character_traits", ["character_id", "trait"]],
  ["character_relationships", ["from_character", "to_character", "relationship_type", "scene_id", "note"]],
  ["places", ["place_id"]],
  ["threads", ["thread_id"]],
  ["reference_docs", ["doc_id"]],
  ["reference_doc_tags", ["doc_id", "tag"]],
  ["reference_links", ["source_kind", "source_project_id", "source_id", "target_doc_id", "relation"]],
];

const FILE_REFERENCE_FIELDS = [
  ["chapters", "source_path", "optional", "directory"],
  ["scenes", "file_path", "required", "file"],
  ["epigraphs", "file_path", "required", "file"],
  ["characters", "file_path", "optional", "file"],
  ["places", "file_path", "optional", "file"],
  ["reference_docs", "file_path", "required", "file"],
];

const SNAPSHOT_SINGLETON_DOMAINS = [
  ["project", "object"],
  ["universe", "nullable_object"],
  ["external_references", "object"],
  ["operation_history", "object"],
];

const NULLABLE_IDENTITY_FIELDS = new Map([
  ["character_relationships", new Set(["scene_id", "note"])],
]);

const EMPTY_STRING_IDENTITY_FIELDS = new Map([
  ["reference_links", new Set(["source_project_id"])],
]);

const PROJECT_SCOPE_FIELDS = new Map([
  ["characters", ["project_id"]],
  ["places", ["project_id"]],
  ["reference_docs", ["project_id"]],
  ["reference_links", ["source_project_id"]],
]);

const SNAPSHOT_DOMAIN_COLUMNS = new Map([
  ["project", ["project_id", "universe_id", "name"]],
  ["universe", ["universe_id", "name"]],
  ["external_references", ["character_ids", "place_ids", "reference_doc_ids"]],
  ["operation_history", ["supported", "authority", "advisory", "artifact"]],
  ["chapters", ["chapter_id", "project_id", "title", "sort_index", "logline", "source_path", "source_checksum", "metadata_stale", "updated_at"]],
  ["scenes", ["scene_id", "project_id", "chapter_id", "scene_role", "title", "part", "chapter", "chapter_title", "pov", "logline", "scene_change", "causality", "stakes", "scene_functions", "save_the_cat_beat", "timeline_position", "story_time", "word_count", "file_path", "prose_checksum", "metadata_stale", "updated_at"]],
  ["epigraphs", ["epigraph_id", "project_id", "chapter_id", "file_path", "prose_checksum", "metadata_stale", "updated_at"]],
  ["epigraph_characters", ["epigraph_id", "project_id", "character_id"]],
  ["epigraph_tags", ["epigraph_id", "project_id", "tag"]],
  ["scene_characters", ["scene_id", "project_id", "character_id"]],
  ["scene_places", ["scene_id", "project_id", "place_id"]],
  ["scene_tags", ["scene_id", "project_id", "tag"]],
  ["scene_threads", ["scene_id", "project_id", "thread_id", "beat"]],
  ["characters", ["character_id", "project_id", "universe_id", "name", "role", "arc_summary", "first_appearance", "file_path"]],
  ["character_traits", ["character_id", "trait"]],
  ["character_relationships", ["from_character", "to_character", "relationship_type", "strength", "scene_id", "note"]],
  ["places", ["place_id", "project_id", "universe_id", "name", "file_path"]],
  ["threads", ["thread_id", "project_id", "name", "status"]],
  ["reference_docs", ["doc_id", "project_id", "universe_id", "type", "title", "summary", "file_path"]],
  ["reference_doc_tags", ["doc_id", "tag"]],
  ["reference_links", ["source_kind", "source_project_id", "source_id", "target_doc_id", "relation", "origin"]],
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function sortedUnique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ""))].sort();
}

function fileReferenceBoundaryFailure(error, fallbackResolvedPath) {
  const errorDetails = isRecord(error?.details) ? error.details : {};
  const message = error instanceof Error ? error.message : String(error);
  const resolvedPath = typeof errorDetails.path === "string" ? errorDetails.path : fallbackResolvedPath;
  const ancestorResolutionFailed =
    Object.hasOwn(errorDetails, "existing_ancestor") ||
    Object.hasOwn(errorDetails, "cause") ||
    message === "Path ancestor could not be resolved: path may be inaccessible.";

  if (ancestorResolutionFailed) {
    return {
      message: "file reference could not be resolved inside WRITING_SYNC_DIR.",
      reason: "ancestor_resolution_failed",
      resolvedPath,
      nextStep: "Ensure the referenced path is accessible, then retry the dry run.",
      details: {
        existing_ancestor: errorDetails.existing_ancestor,
        cause: errorDetails.cause,
      },
      errorMessage: message,
    };
  }

  return {
    message: "file reference points outside WRITING_SYNC_DIR.",
    reason: "outside_sync_root",
    resolvedPath,
    nextStep: "Use only trusted backups generated for this sync root.",
    details: {},
    errorMessage: message,
  };
}

function identityFieldError(row, field, nullableFields, emptyStringFields) {
  const hasField = Object.hasOwn(row, field);
  const value = row[field];
  if (!hasField || value === undefined) return { reason: "missing_identity" };
  if (value === null) {
    return nullableFields.has(field) ? null : { reason: "missing_identity" };
  }
  if (typeof value !== "string") {
    return {
      reason: "non_string_identity",
      actual_type: jsonType(value),
    };
  }
  if (value === "" && !emptyStringFields.has(field)) {
    return { reason: "empty_identity" };
  }
  return null;
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

function fileState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, readable: false, regular: false, symlink: false };
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    return {
      exists: true,
      readable: false,
      regular: false,
      symlink: false,
      error: "lstat_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    exists: true,
    readable: true,
    regular: stat.isFile(),
    directory: stat.isDirectory(),
    symlink: stat.isSymbolicLink(),
  };
}

function readJsonFile(filePath, label) {
  const state = fileState(filePath);
  if (!state.exists) {
    return { ok: false, state, diagnostic: createDiagnostic(
      "project_restore_backup_partial",
      `Project backup ${label} is missing.`,
      { file: filePath, reason: "missing" },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    ) };
  }
  if (state.symlink || !state.regular) {
    return { ok: false, state, diagnostic: createDiagnostic(
      "project_restore_backup_unreadable",
      `Project backup ${label} is not readable as trusted JSON.`,
      { file: filePath, reason: state.error ?? (state.symlink ? "symlink" : "not_regular"), message: state.message ?? null },
      { nextStep: "Use a regular generated backup file from export_project_backup." }
    ) };
  }
  try {
    return {
      ok: true,
      state,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
    };
  } catch (error) {
    return { ok: false, state, diagnostic: createDiagnostic(
      "project_restore_backup_unreadable",
      `Project backup ${label} is not readable as trusted JSON.`,
      { file: filePath, reason: "unreadable_json", message: error instanceof Error ? error.message : String(error) },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    ) };
  }
}

function resolveBackupDir(backupPath) {
  const resolved = path.resolve(backupPath);
  const base = path.basename(resolved);
  if (base === MANIFEST_FILE || base === SNAPSHOT_FILE) return path.dirname(resolved);
  return resolved;
}

function backupLocation(syncDir, backupDir) {
  const relative = path.relative(syncDir, backupDir).split(path.sep).filter(Boolean).join("/");
  return relative ? `${relative}/` : "./";
}

function encodeIdentityValue(value) {
  if (value === null) return "null:";
  if (value === undefined) return "undefined:";
  return `${typeof value}:${String(value)}`;
}

function rowKey(row, keyFields) {
  return keyFields.map(field => encodeIdentityValue(row?.[field])).join("\u0000");
}

function rowIdentity(row, keyFields) {
  return Object.fromEntries(keyFields.map(field => [field, row?.[field] ?? null]));
}

function compareRows(currentRows = [], backupRows = [], keyFields) {
  const currentByKey = new Map(currentRows.map(row => [rowKey(row, keyFields), row]));
  const backupByKey = new Map(backupRows.map(row => [rowKey(row, keyFields), row]));
  const keys = [...new Set([...currentByKey.keys(), ...backupByKey.keys()])].sort();
  const changes = [];

  for (const key of keys) {
    const current = currentByKey.get(key) ?? null;
    const backup = backupByKey.get(key) ?? null;
    const identity = rowIdentity(backup ?? current, keyFields);
    if (!current) {
      changes.push({ action: "create", identity, backup });
    } else if (!backup) {
      changes.push({ action: "delete", identity, current, destructive: true });
    } else if (stableStringify(current) === stableStringify(backup)) {
      changes.push({ action: "unchanged", identity });
    } else {
      changes.push({ action: "update", identity, current, backup });
    }
  }

  return changes;
}

function rowIsCrossScope(domain, row, projectId) {
  if (!row) return false;
  if (domain === "universes") return true;
  if (["characters", "places", "reference_docs"].includes(domain)) {
    return row.project_id == null || row.project_id === "";
  }
  if (domain === "character_traits") {
    return false;
  }
  if (domain === "reference_links") {
    return row.source_project_id == null || row.source_project_id === "";
  }
  if (domain === "reference_doc_tags") {
    return false;
  }
  if (domain === "character_relationships") {
    return row.scene_id == null || row.scene_id === "";
  }
  return Object.hasOwn(row, "project_id") && row.project_id !== projectId;
}

function mergeScopedIds(map, rows, idField, projectId) {
  for (const row of rows ?? []) {
    const id = row?.[idField];
    if (!id) continue;
    const crossScope = row.project_id == null || row.project_id === "" || row.project_id !== projectId;
    map.set(id, (map.get(id) ?? false) || crossScope);
  }
}

function buildRestoreScopeContext(currentSnapshot, backupSnapshot, projectId) {
  const projectSceneIds = new Set();
  for (const snapshot of [currentSnapshot, backupSnapshot]) {
    for (const row of snapshot.scenes ?? []) {
      if (row.project_id === projectId) projectSceneIds.add(row.scene_id);
    }
  }

  const characterIds = new Map();
  mergeScopedIds(characterIds, currentSnapshot.characters, "character_id", projectId);
  mergeScopedIds(characterIds, backupSnapshot.characters, "character_id", projectId);

  const referenceDocIds = new Map();
  mergeScopedIds(referenceDocIds, currentSnapshot.reference_docs, "doc_id", projectId);
  mergeScopedIds(referenceDocIds, backupSnapshot.reference_docs, "doc_id", projectId);

  return { characterIds, projectSceneIds, referenceDocIds };
}

function rowIsContextCrossScope(domain, row, projectId, scopeContext) {
  if (domain === "character_traits") {
    return scopeContext.characterIds.get(row?.character_id) === true;
  }
  if (domain === "reference_doc_tags") {
    return scopeContext.referenceDocIds.get(row?.doc_id) === true;
  }
  if (domain === "character_relationships") {
    if (!row || row.scene_id == null || row.scene_id === "") return true;
    return !scopeContext.projectSceneIds.has(row.scene_id);
  }
  return rowIsCrossScope(domain, row, projectId);
}

function markChangeScope(change, projectId, scopeContext) {
  const row = change.backup ?? change.current ?? null;
  const crossScope = rowIsContextCrossScope(change.domain, row, projectId, scopeContext);
  return crossScope ? { ...change, cross_scope: true } : change;
}

function compareSingleton(domain, current, backup, keyFields) {
  return compareRows(
    current ? [current] : [],
    backup ? [backup] : [],
    keyFields
  ).map(change => ({ domain, ...change }));
}

function countActions(changes) {
  const counts = { create: 0, update: 0, delete: 0, unchanged: 0, refused: 0, conflict: 0 };
  for (const change of changes) {
    counts[change.action] = (counts[change.action] ?? 0) + 1;
  }
  return counts;
}

function buildEmptyCurrentSnapshot(db, backupSnapshot) {
  const universeId = backupSnapshot.universe?.universe_id ?? null;
  const universe = universeId
    ? db.prepare(`
      SELECT universe_id, name
      FROM universes
      WHERE universe_id = ?
    `).get(universeId) ?? null
    : null;

  return {
    project: null,
    universe,
    chapters: [],
    scenes: [],
    epigraphs: [],
    epigraph_characters: [],
    epigraph_tags: [],
    scene_characters: [],
    scene_places: [],
    scene_tags: [],
    scene_threads: [],
    characters: [],
    character_traits: [],
    character_relationships: [],
    places: [],
    threads: [],
    reference_docs: [],
    reference_doc_tags: [],
    reference_links: [],
    external_references: { character_ids: [], place_ids: [], reference_doc_ids: [] },
    operation_history: backupSnapshot.operation_history ?? null,
  };
}

function collectCurrentSnapshot(db, {
  projectId,
  syncDir,
  applicationVersion,
  backupLocationValue,
  backupSnapshot,
}) {
  const built = buildProjectBackup(db, {
    projectId,
    syncDir,
    applicationVersion,
    backupLocation: backupLocationValue,
  });
  if (built.ok) return { ok: true, snapshot: built.snapshot, checksum: built.manifest.checksums.canonical_snapshot_sha256 };
  if (built.error?.code === "NOT_FOUND") {
    const snapshot = buildEmptyCurrentSnapshot(db, backupSnapshot);
    return { ok: true, snapshot, checksum: null };
  }
  return built;
}

function validateFileReferences(snapshot, { syncDir }) {
  const diagnostics = [];
  const syncRoot = path.resolve(syncDir);
  const syncRootReal = resolveBoundaryRootReal(syncRoot);
  for (const [domain, field, requirement, expectedKind] of FILE_REFERENCE_FIELDS) {
    for (const row of snapshot[domain] ?? []) {
      const value = row[field];
      const hasValue = value !== null && value !== undefined && value !== "";
      if (!hasValue) {
        if (requirement === "required") {
          diagnostics.push(createDiagnostic(
            "project_restore_file_reference_invalid",
            `Backup ${domain} record is missing required ${field}.`,
            { domain, field, identity: row },
            { nextStep: "Regenerate the backup before using it for recovery." }
          ));
        }
        continue;
      }

      if (typeof value !== "string") {
        diagnostics.push(createDiagnostic(
          "project_restore_file_reference_invalid",
          `Backup ${domain} record has non-string ${field}.`,
          {
            domain,
            field,
            actual_type: jsonType(value),
            reason: "non_string_file_reference",
          },
          { nextStep: "Regenerate the backup before using it for recovery." }
        ));
        continue;
      }

      const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(syncRoot, value);
      let boundaryResolvedPath;
      try {
        boundaryResolvedPath = resolveCandidateInsideBoundary(resolved, {
          boundaryRoot: syncRoot,
          boundaryRootReal: syncRootReal,
          errorCode: "project_restore_file_reference_invalid",
          errorMessage: "Backup file reference must stay inside WRITING_SYNC_DIR.",
          details: { domain, field, path: value },
        }).resolvedPath;
      } catch (error) {
        const boundaryFailure = fileReferenceBoundaryFailure(error, resolved);
        diagnostics.push(createDiagnostic(
          "project_restore_file_reference_invalid",
          `Backup ${domain} record ${boundaryFailure.message}`,
          {
            domain,
            field,
            path: value,
            resolved_path: boundaryFailure.resolvedPath,
            reason: boundaryFailure.reason,
            message: boundaryFailure.errorMessage,
            ...boundaryFailure.details,
          },
          { nextStep: boundaryFailure.nextStep }
        ));
        continue;
      }

      const state = fileState(resolved);
      if (state.symlink) {
        diagnostics.push(createDiagnostic(
          "project_restore_file_reference_invalid",
          `Backup ${domain} record points to a symlink, which is not trusted restore input.`,
          { domain, field, path: value, resolved_path: resolved, reason: "symlink" },
          { nextStep: "Restore the referenced prose file as a regular file, then retry the dry run." }
        ));
      } else if (!state.exists) {
        diagnostics.push(createDiagnostic(
          "project_restore_file_reference_missing",
          `Backup ${domain} record points to a missing ${expectedKind}.`,
          { domain, field, path: value, resolved_path: boundaryResolvedPath },
          { nextStep: "Restore the referenced path, then retry the dry run." }
        ));
      } else if (
        (expectedKind === "file" && !state.regular) ||
        (expectedKind === "directory" && !state.directory)
      ) {
        diagnostics.push(createDiagnostic(
          "project_restore_file_reference_invalid",
          `Backup ${domain} record does not point to a ${expectedKind}.`,
          { domain, field, path: value, resolved_path: boundaryResolvedPath, expected_kind: expectedKind, reason: state.error ?? `not_${expectedKind}` },
          { nextStep: "Restore the referenced path with the expected kind, then retry the dry run." }
        ));
      }
    }
  }
  return diagnostics;
}

function validateBundle({ manifest, snapshot, projectId, backupDir }) {
  const diagnostics = [];
  if (manifest.artifact_kind !== "project_backup") {
    diagnostics.push(createDiagnostic(
      "project_restore_wrong_artifact",
      "Backup manifest is not a project backup artifact.",
      { backup_dir: backupDir, artifact_kind: manifest.artifact_kind ?? null },
      { nextStep: "Choose a generated project backup bundle." }
    ));
  }
  if (manifest.project_id !== projectId || snapshot.project?.project_id !== projectId) {
    diagnostics.push(createDiagnostic(
      "project_restore_wrong_project",
      `Backup bundle does not belong to project "${projectId}".`,
      {
        backup_dir: backupDir,
        manifest_project_id: manifest.project_id ?? null,
        snapshot_project_id: snapshot.project?.project_id ?? null,
      },
      { nextStep: "Choose the backup directory for the requested project." }
    ));
  }
  if (manifest.schema_version !== PROJECT_BACKUP_SCHEMA_VERSION) {
    diagnostics.push(createDiagnostic(
      "project_restore_incompatible_schema",
      `Backup schema version "${manifest.schema_version ?? "unknown"}" is not compatible with this server.`,
      {
        backup_dir: backupDir,
        backup_schema_version: manifest.schema_version ?? null,
        expected_schema_version: PROJECT_BACKUP_SCHEMA_VERSION,
      },
      { nextStep: "Regenerate the backup with a compatible server version before restoring." }
    ));
  }

  const exportedSnapshotChecksum = manifest.checksums?.canonical_snapshot_sha256 ?? null;
  const computedSnapshotChecksum = computeProjectBackupSnapshotChecksum(snapshot);
  if (!exportedSnapshotChecksum || exportedSnapshotChecksum !== computedSnapshotChecksum) {
    diagnostics.push(createDiagnostic(
      "project_restore_checksum_mismatch",
      "Backup snapshot checksum does not match manifest.",
      { backup_dir: backupDir, exported_checksum: exportedSnapshotChecksum, computed_checksum: computedSnapshotChecksum },
      { nextStep: "Regenerate the backup before using it for recovery." }
    ));
  }

  const exportedBundleChecksum = manifest.checksums?.bundle_sha256 ?? null;
  const computedBundleChecksum = computeProjectBackupBundleChecksum({ manifest, snapshot });
  if (!exportedBundleChecksum || exportedBundleChecksum !== computedBundleChecksum) {
    diagnostics.push(createDiagnostic(
      "project_restore_bundle_checksum_mismatch",
      "Backup bundle checksum does not match manifest.",
      { backup_dir: backupDir, exported_checksum: exportedBundleChecksum, computed_checksum: computedBundleChecksum },
      { nextStep: "Regenerate the backup before using it for recovery." }
    ));
  }
  return diagnostics;
}

function validateBundleShape({ manifest, snapshot, backupDir, projectId }) {
  const diagnostics = [];
  if (!isRecord(manifest)) {
    diagnostics.push(createDiagnostic(
      "project_restore_invalid_manifest",
      "Backup manifest must be a JSON object.",
      { backup_dir: backupDir, actual_type: jsonType(manifest) },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    ));
  } else if (!isRecord(manifest.checksums)) {
    diagnostics.push(createDiagnostic(
      "project_restore_invalid_manifest",
      "Backup manifest is missing its checksum object.",
      { backup_dir: backupDir, field: "checksums" },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    ));
  }

  if (!isRecord(snapshot)) {
    diagnostics.push(createDiagnostic(
      "project_restore_invalid_snapshot",
      "Backup canonical snapshot must be a JSON object.",
      { backup_dir: backupDir, actual_type: jsonType(snapshot) },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    ));
    return diagnostics;
  }

  for (const [domain, expected] of SNAPSHOT_SINGLETON_DOMAINS) {
    const value = snapshot[domain];
    const valid = expected === "nullable_object"
      ? value === null || isRecord(value)
      : isRecord(value);
    if (!valid) {
      diagnostics.push(createDiagnostic(
        "project_restore_invalid_snapshot",
        `Backup canonical snapshot field "${domain}" has an invalid shape.`,
        {
          backup_dir: backupDir,
          domain,
          expected,
          actual_type: jsonType(value),
        },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      ));
    } else if (value !== null) {
      const allowedColumns = SNAPSHOT_DOMAIN_COLUMNS.get(domain) ?? [];
      const unexpectedColumns = Object.keys(value).filter(column => !allowedColumns.includes(column));
      if (unexpectedColumns.length) {
        diagnostics.push(createDiagnostic(
          "project_restore_invalid_snapshot",
          `Backup canonical snapshot field "${domain}" contains unsupported columns.`,
          {
            backup_dir: backupDir,
            domain,
            unsupported_columns: unexpectedColumns,
          },
          { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
        ));
      }
    }
  }

  for (const [domain, keyFields] of SNAPSHOT_ARRAY_DOMAINS) {
    const nullableFields = NULLABLE_IDENTITY_FIELDS.get(domain) ?? new Set();
    const emptyStringFields = EMPTY_STRING_IDENTITY_FIELDS.get(domain) ?? new Set();
    const projectScopeFields = PROJECT_SCOPE_FIELDS.get(domain) ?? [];
    if (!(domain in snapshot)) {
      diagnostics.push(createDiagnostic(
        "project_restore_incomplete_snapshot",
        `Backup canonical snapshot is missing required domain "${domain}".`,
        { backup_dir: backupDir, domain },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      ));
    } else if (!Array.isArray(snapshot[domain])) {
      diagnostics.push(createDiagnostic(
        "project_restore_invalid_snapshot",
        `Backup canonical snapshot domain "${domain}" must be an array.`,
        {
          backup_dir: backupDir,
          domain,
          actual_type: jsonType(snapshot[domain]),
        },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      ));
    } else {
      const seenKeys = new Set();
      snapshot[domain].forEach((row, index) => {
        if (!isRecord(row)) {
          diagnostics.push(createDiagnostic(
            "project_restore_invalid_snapshot",
            `Backup canonical snapshot row ${index} in domain "${domain}" must be an object.`,
            {
              backup_dir: backupDir,
              domain,
              index,
              actual_type: jsonType(row),
            },
            { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
          ));
          return;
        }

        const allowedColumns = SNAPSHOT_DOMAIN_COLUMNS.get(domain) ?? [];
        const unexpectedColumns = Object.keys(row).filter(column => !allowedColumns.includes(column));
        if (unexpectedColumns.length) {
          diagnostics.push(createDiagnostic(
            "project_restore_invalid_snapshot",
            `Backup canonical snapshot row ${index} in domain "${domain}" contains unsupported columns.`,
            {
              backup_dir: backupDir,
              domain,
              index,
              unsupported_columns: unexpectedColumns,
            },
            { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
          ));
        }

        let hasValidIdentity = true;
        for (const field of keyFields) {
          const identityError = identityFieldError(row, field, nullableFields, emptyStringFields);
          if (identityError) {
            hasValidIdentity = false;
            diagnostics.push(createDiagnostic(
              "project_restore_invalid_snapshot",
              `Backup canonical snapshot row ${index} in domain "${domain}" has invalid identity field "${field}".`,
              {
                backup_dir: backupDir,
                domain,
                index,
                field,
                ...identityError,
              },
              { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
            ));
          }
        }

        if (hasValidIdentity) {
          const key = rowKey(row, keyFields);
          if (seenKeys.has(key)) {
            diagnostics.push(createDiagnostic(
              "project_restore_duplicate_identity",
              `Backup canonical snapshot domain "${domain}" contains duplicate identity values.`,
              {
                backup_dir: backupDir,
                domain,
                index,
                identity: Object.fromEntries(keyFields.map(field => [field, row[field] ?? null])),
              },
              { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
            ));
          } else {
            seenKeys.add(key);
          }
        }

        if (
          keyFields.includes("project_id") &&
          Object.hasOwn(row, "project_id") &&
          row.project_id !== null &&
          row.project_id !== undefined &&
          row.project_id !== "" &&
          row.project_id !== projectId
        ) {
          diagnostics.push(createDiagnostic(
            "project_restore_wrong_project",
            `Backup canonical snapshot row ${index} in domain "${domain}" belongs to project "${row.project_id}", not "${projectId}".`,
            {
              backup_dir: backupDir,
              domain,
              index,
              row_project_id: row.project_id,
              expected_project_id: projectId,
            },
            { nextStep: "Choose the backup directory for the requested project or regenerate the backup." }
          ));
        }

        for (const field of projectScopeFields) {
          if (!Object.hasOwn(row, field)) {
            diagnostics.push(createDiagnostic(
              "project_restore_invalid_snapshot",
              `Backup canonical snapshot row ${index} in domain "${domain}" is missing required project scope field "${field}".`,
              {
                backup_dir: backupDir,
                domain,
                index,
                field,
                reason: "missing_project_scope",
              },
              { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
            ));
            continue;
          }
          const value = row[field];
          const emptyStringFields = EMPTY_STRING_IDENTITY_FIELDS.get(domain) ?? new Set();
          if (value === "" && !emptyStringFields.has(field)) {
            diagnostics.push(createDiagnostic(
              "project_restore_invalid_snapshot",
              `Backup canonical snapshot row ${index} in domain "${domain}" has empty project scope field "${field}".`,
              {
                backup_dir: backupDir,
                domain,
                index,
                field,
                reason: "empty_project_scope",
              },
              { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
            ));
          } else if (value !== null && value !== undefined && value !== "" && value !== projectId) {
            diagnostics.push(createDiagnostic(
              "project_restore_wrong_project",
              `Backup canonical snapshot row ${index} in domain "${domain}" has ${field} "${value}", not "${projectId}".`,
              {
                backup_dir: backupDir,
                domain,
                index,
                field,
                row_project_id: value,
                expected_project_id: projectId,
              },
              { nextStep: "Choose the backup directory for the requested project or regenerate the backup." }
            ));
          }
        }
      });
    }
  }

  return diagnostics;
}

function validateCurrentSnapshotForPlanning(snapshot, { backupDir }) {
  const diagnostics = [];
  for (const [domain, keyFields] of SNAPSHOT_ARRAY_DOMAINS) {
    const seenKeys = new Set();
    for (const [index, row] of (snapshot[domain] ?? []).entries()) {
      const key = rowKey(row, keyFields);
      if (seenKeys.has(key)) {
        diagnostics.push(createDiagnostic(
          "project_restore_current_duplicate_identity",
          `Current SQLite canonical snapshot domain "${domain}" contains duplicate identity values.`,
          {
            backup_dir: backupDir,
            domain,
            index,
            identity: rowIdentity(row, keyFields),
          },
          {
            severity: "error",
            nextStep: "Fix duplicate current SQLite identity rows before retrying restore planning.",
          }
        ));
      } else {
        seenKeys.add(key);
      }
    }
  }
  return diagnostics;
}

function buildRestorePlan(currentSnapshot, backupSnapshot, { projectId }) {
  const changes = [
    ...compareSingleton("projects", currentSnapshot.project, backupSnapshot.project, ["project_id"]),
    ...compareSingleton("universes", currentSnapshot.universe, backupSnapshot.universe, ["universe_id"]),
  ];

  for (const [domain, keyFields] of SNAPSHOT_ARRAY_DOMAINS) {
    for (const change of compareRows(currentSnapshot[domain] ?? [], backupSnapshot[domain] ?? [], keyFields)) {
      changes.push({ domain, ...change });
    }
  }

  const scopeContext = buildRestoreScopeContext(currentSnapshot, backupSnapshot, projectId);
  const scopedChanges = changes.map(change => markChangeScope(change, projectId, scopeContext));

  const byDomain = {};
  for (const change of scopedChanges) {
    byDomain[change.domain] ??= { create: 0, update: 0, delete: 0, unchanged: 0, refused: 0, conflict: 0 };
    byDomain[change.domain][change.action] = (byDomain[change.domain][change.action] ?? 0) + 1;
  }

  return {
    totals: countActions(scopedChanges),
    by_domain: byDomain,
    destructive_change_count: scopedChanges.filter(change => change.action === "delete").length,
    cross_scope_change_count: scopedChanges.filter(change => change.cross_scope && change.action !== "unchanged").length,
    changes: scopedChanges,
  };
}

function placeholders(values) {
  return values.map(() => "?").join(",") || "NULL";
}

function allSnapshotIds(snapshot, domain, field) {
  return sortedUnique((snapshot[domain] ?? []).map(row => row[field]));
}

function deleteCharacterRelationship(db, row) {
  db.prepare(`
    DELETE FROM character_relationships
    WHERE from_character = ?
      AND to_character = ?
      AND relationship_type = ?
      AND (strength IS ? OR strength = ?)
      AND (scene_id IS ? OR scene_id = ?)
      AND (note IS ? OR note = ?)
  `).run(
    row.from_character,
    row.to_character,
    row.relationship_type,
    row.strength ?? null,
    row.strength ?? null,
    row.scene_id ?? null,
    row.scene_id ?? null,
    row.note ?? null,
    row.note ?? null
  );
}

function upsertRow(db, table, row, conflictColumns) {
  const columns = Object.keys(row);
  if (!conflictColumns.length) {
    db.prepare(`
      INSERT INTO ${table} (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
    `).run(...columns.map(column => row[column]));
    return;
  }
  const updateColumns = columns.filter(column => !conflictColumns.includes(column));
  const conflictSql = conflictColumns.join(", ");
  const updateSql = updateColumns.length
    ? `DO UPDATE SET ${updateColumns.map(column => `${column} = excluded.${column}`).join(", ")}`
    : "DO NOTHING";
  db.prepare(`
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT (${conflictSql}) ${updateSql}
  `).run(...columns.map(column => row[column]));
}

function insertRows(db, table, rows, conflictColumns) {
  for (const row of rows) {
    upsertRow(db, table, row, conflictColumns);
  }
}

function restoreEpigraphRows(db, snapshot, { syncDir }) {
  for (const row of snapshot.epigraphs) {
    const filePath = path.isAbsolute(row.file_path)
      ? path.resolve(row.file_path)
      : path.resolve(syncDir, row.file_path);
    const body = matter(fs.readFileSync(filePath, "utf8")).content;
    upsertRow(db, "epigraphs", {
      ...row,
      body,
      file_path: row.file_path,
    }, ["epigraph_id", "project_id"]);
  }
}

function clearDerivedRestoreRows(db, { projectId, currentSnapshot, backupSnapshot }) {
  db.prepare(`DELETE FROM scenes_fts WHERE project_id = ?`).run(projectId);

  const referenceDocIds = sortedUnique([
    ...allSnapshotIds(currentSnapshot, "reference_docs", "doc_id"),
    ...allSnapshotIds(backupSnapshot, "reference_docs", "doc_id"),
  ]);
  if (referenceDocIds.length) {
    db.prepare(`
      DELETE FROM reference_docs_fts
      WHERE doc_id IN (${placeholders(referenceDocIds)})
    `).run(...referenceDocIds);
  }
}

function applyProjectRestore(db, {
  projectId,
  syncDir,
  currentSnapshot,
  backupSnapshot,
}) {
  const currentCharacterIds = allSnapshotIds(currentSnapshot, "characters", "character_id");
  const currentPlaceIds = allSnapshotIds(currentSnapshot, "places", "place_id");
  const currentReferenceDocIds = allSnapshotIds(currentSnapshot, "reference_docs", "doc_id");

  clearDerivedRestoreRows(db, { projectId, currentSnapshot, backupSnapshot });

  for (const domain of [
    "epigraph_characters",
    "epigraph_tags",
    "scene_characters",
    "scene_places",
    "scene_tags",
    "scene_threads",
  ]) {
    db.prepare(`DELETE FROM ${domain} WHERE project_id = ?`).run(projectId);
  }

  db.prepare(`DELETE FROM chapters WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM epigraphs WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM scenes WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM threads WHERE project_id = ?`).run(projectId);

  if (currentCharacterIds.length) {
    db.prepare(`DELETE FROM character_traits WHERE character_id IN (${placeholders(currentCharacterIds)})`).run(...currentCharacterIds);
  }
  for (const row of currentSnapshot.character_relationships ?? []) {
    deleteCharacterRelationship(db, row);
  }
  if (currentCharacterIds.length) {
    db.prepare(`DELETE FROM characters WHERE character_id IN (${placeholders(currentCharacterIds)})`).run(...currentCharacterIds);
  }

  if (currentPlaceIds.length) {
    db.prepare(`DELETE FROM places WHERE place_id IN (${placeholders(currentPlaceIds)})`).run(...currentPlaceIds);
  }

  if (currentReferenceDocIds.length) {
    db.prepare(`DELETE FROM reference_doc_tags WHERE doc_id IN (${placeholders(currentReferenceDocIds)})`).run(...currentReferenceDocIds);
    db.prepare(`DELETE FROM reference_docs WHERE doc_id IN (${placeholders(currentReferenceDocIds)})`).run(...currentReferenceDocIds);
  }
  for (const row of currentSnapshot.reference_links ?? []) {
    db.prepare(`
      DELETE FROM reference_links
      WHERE source_kind = ?
        AND source_project_id = ?
        AND source_id = ?
        AND target_doc_id = ?
        AND relation = ?
    `).run(row.source_kind, row.source_project_id, row.source_id, row.target_doc_id, row.relation);
  }

  if (currentSnapshot.universe && !backupSnapshot.universe) {
    db.prepare(`DELETE FROM universes WHERE universe_id = ?`).run(currentSnapshot.universe.universe_id);
  }

  if (backupSnapshot.universe) {
    upsertRow(db, "universes", backupSnapshot.universe, ["universe_id"]);
  }
  if (backupSnapshot.project) {
    upsertRow(db, "projects", backupSnapshot.project, ["project_id"]);
  }

  insertRows(db, "chapters", backupSnapshot.chapters, ["chapter_id", "project_id"]);
  insertRows(db, "scenes", backupSnapshot.scenes, ["scene_id", "project_id"]);
  restoreEpigraphRows(db, backupSnapshot, { syncDir });
  insertRows(db, "characters", backupSnapshot.characters, ["character_id"]);
  insertRows(db, "character_traits", backupSnapshot.character_traits, ["character_id", "trait"]);
  insertRows(db, "character_relationships", backupSnapshot.character_relationships, []);
  insertRows(db, "places", backupSnapshot.places, ["place_id"]);
  insertRows(db, "threads", backupSnapshot.threads, ["thread_id"]);
  insertRows(db, "reference_docs", backupSnapshot.reference_docs, ["doc_id"]);
  insertRows(db, "reference_doc_tags", backupSnapshot.reference_doc_tags, ["doc_id", "tag"]);
  insertRows(db, "reference_links", backupSnapshot.reference_links, ["source_kind", "source_project_id", "source_id", "target_doc_id", "relation"]);

  for (const domain of [
    ["epigraph_characters", ["epigraph_id", "project_id", "character_id"]],
    ["epigraph_tags", ["epigraph_id", "project_id", "tag"]],
    ["scene_characters", ["scene_id", "project_id", "character_id"]],
    ["scene_places", ["scene_id", "project_id", "place_id"]],
    ["scene_tags", ["scene_id", "project_id", "tag"]],
    ["scene_threads", ["scene_id", "project_id", "thread_id"]],
  ]) {
    insertRows(db, domain[0], backupSnapshot[domain[0]], domain[1]);
  }
}

export function restoreProjectFromBackup(db, {
  syncDir,
  projectId,
  backupPath = null,
  dryRun = true,
  confirmDestructive = false,
  confirmCrossScope = false,
  expectedCurrentSnapshotChecksum = null,
  applicationVersion = "0.0.0",
} = {}) {
  const resolvedBackupDir = resolveBackupDir(backupPath ?? path.join(syncDir, "project-backups", projectId));
  const manifestPath = path.join(resolvedBackupDir, MANIFEST_FILE);
  const snapshotPath = path.join(resolvedBackupDir, SNAPSHOT_FILE);
  const manifestRead = readJsonFile(manifestPath, "manifest");
  const snapshotRead = readJsonFile(snapshotPath, "canonical snapshot");
  const diagnostics = [manifestRead.diagnostic, snapshotRead.diagnostic].filter(Boolean);

  const manifest = manifestRead.ok ? manifestRead.value : null;
  const snapshot = snapshotRead.ok ? snapshotRead.value : null;
  if (manifestRead.ok && snapshotRead.ok) {
    const shapeDiagnostics = validateBundleShape({
      manifest,
      snapshot,
      backupDir: resolvedBackupDir,
      projectId,
    });
    diagnostics.push(...shapeDiagnostics);
    if (shapeDiagnostics.length === 0) {
      diagnostics.push(...validateBundle({ manifest, snapshot, projectId, backupDir: resolvedBackupDir }));
      diagnostics.push(...validateFileReferences(snapshot, { syncDir }));
    }
  }

  diagnostics.sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare) return typeCompare;
    return a.message.localeCompare(b.message);
  });

  if (diagnostics.length || !manifest || !snapshot) {
    return {
      ok: false,
      action: "restore_refused",
      dry_run: Boolean(dryRun),
      project_id: projectId,
      backup_dir: resolvedBackupDir,
      diagnostics,
      plan: null,
      next_step: "Resolve restore diagnostics before using this backup as recovery input.",
    };
  }

  const current = collectCurrentSnapshot(db, {
    projectId,
    syncDir,
    applicationVersion,
    backupLocationValue: backupLocation(syncDir, resolvedBackupDir),
    backupSnapshot: snapshot,
  });
  if (!current.ok) {
    return {
      ok: false,
      action: "restore_refused",
      dry_run: Boolean(dryRun),
      project_id: projectId,
      backup_dir: resolvedBackupDir,
      diagnostics: [createDiagnostic(
        "project_restore_current_snapshot_failed",
        current.error?.message ?? "Current SQLite canonical state could not be inspected.",
        current.error?.details ?? { project_id: projectId },
        { severity: "error", nextStep: "Fix the current project database state before retrying restore planning." }
      )],
      plan: null,
      next_step: "Resolve restore diagnostics before using this backup as recovery input.",
    };
  }

  const currentShapeDiagnostics = validateCurrentSnapshotForPlanning(current.snapshot, {
    backupDir: resolvedBackupDir,
  });
  if (currentShapeDiagnostics.length) {
    currentShapeDiagnostics.sort((a, b) => {
      const typeCompare = a.type.localeCompare(b.type);
      if (typeCompare) return typeCompare;
      return a.message.localeCompare(b.message);
    });
    return {
      ok: false,
      action: "restore_refused",
      dry_run: Boolean(dryRun),
      project_id: projectId,
      backup_dir: resolvedBackupDir,
      diagnostics: currentShapeDiagnostics,
      plan: null,
      next_step: "Fix duplicate current SQLite identity rows before retrying restore planning.",
    };
  }

  const plan = buildRestorePlan(current.snapshot, snapshot, { projectId });
  const applyDiagnostics = [];
  if (dryRun === false) {
    if (typeof expectedCurrentSnapshotChecksum !== "string" || expectedCurrentSnapshotChecksum === "") {
      applyDiagnostics.push(createDiagnostic(
        "project_restore_current_snapshot_confirmation_required",
        "Project backup restore requires the current_snapshot_checksum from the reviewed dry-run plan.",
        {
          project_id: projectId,
          current_snapshot_checksum: current.checksum,
        },
        {
          severity: "error",
          nextStep: "Run a dry-run restore, review the plan, then retry with expected_current_snapshot_checksum set to that dry-run current_snapshot_checksum.",
        }
      ));
    } else if (expectedCurrentSnapshotChecksum !== current.checksum) {
      applyDiagnostics.push(createDiagnostic(
        "project_restore_current_snapshot_changed",
        "Current SQLite canonical state changed after the reviewed dry-run plan.",
        {
          project_id: projectId,
          expected_current_snapshot_checksum: expectedCurrentSnapshotChecksum,
          current_snapshot_checksum: current.checksum,
        },
        {
          severity: "error",
          nextStep: "Run a new dry-run restore, review the updated plan, then retry with the new current_snapshot_checksum.",
        }
      ));
    }
  }
  if (dryRun === false && plan.destructive_change_count > 0 && confirmDestructive !== true) {
    applyDiagnostics.push(createDiagnostic(
      "project_restore_destructive_confirmation_required",
      "Project backup restore would delete canonical SQLite records and requires explicit confirmation.",
      {
        project_id: projectId,
        destructive_change_count: plan.destructive_change_count,
      },
      {
        severity: "error",
        nextStep: "Review the dry-run delete candidates, then retry with confirm_destructive=true if those deletes are intended.",
      }
    ));
  }
  if (dryRun === false && plan.cross_scope_change_count > 0 && confirmCrossScope !== true) {
    applyDiagnostics.push(createDiagnostic(
      "project_restore_cross_scope_confirmation_required",
      "Project backup restore would create, update, or delete universe-scoped records and requires explicit confirmation.",
      {
        project_id: projectId,
        cross_scope_change_count: plan.cross_scope_change_count,
      },
      {
        severity: "error",
        nextStep: "Review the dry-run cross_scope changes, then retry with confirm_cross_scope=true if those changes are intended.",
      }
    ));
  }

  if (applyDiagnostics.length) {
    applyDiagnostics.sort((a, b) => {
      const typeCompare = a.type.localeCompare(b.type);
      if (typeCompare) return typeCompare;
      return a.message.localeCompare(b.message);
    });
    return {
      ok: false,
      action: "restore_refused",
      dry_run: Boolean(dryRun),
      project_id: projectId,
      backup_dir: resolvedBackupDir,
      diagnostics: applyDiagnostics,
      plan,
      next_step: "Resolve confirmation requirements before applying this trusted backup.",
    };
  }

  if (dryRun === false) {
    try {
      db.exec("BEGIN");
      applyProjectRestore(db, {
        projectId,
        syncDir,
        currentSnapshot: current.snapshot,
        backupSnapshot: snapshot,
      });
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        void rollbackError;
      }
      return {
        ok: false,
        action: "restore_refused",
        dry_run: false,
        project_id: projectId,
        backup_dir: resolvedBackupDir,
        diagnostics: [createDiagnostic(
          "project_restore_write_failed",
          "Failed to apply project backup restore transaction.",
          {
            project_id: projectId,
            error: error instanceof Error ? error.message : String(error),
          },
          { severity: "error", nextStep: "Review the database error and retry after resolving conflicts." }
        )],
        plan,
        next_step: "Resolve restore write diagnostics before retrying.",
      };
    }
  }

  return {
    ok: true,
    action: dryRun ? "planned" : "restored",
    dry_run: Boolean(dryRun),
    project_id: projectId,
    backup_dir: resolvedBackupDir,
    backup: {
      manifest: manifestPath,
      canonical_snapshot: snapshotPath,
      schema_version: manifest.schema_version,
      checksums: manifest.checksums,
    },
    current_snapshot_checksum: current.checksum,
    backup_snapshot_checksum: manifest.checksums.canonical_snapshot_sha256,
    plan,
    applied: dryRun ? null : {
      restored: true,
      destructive_confirmed: Boolean(confirmDestructive),
      cross_scope_confirmed: Boolean(confirmCrossScope),
      derived_indexes: {
        scenes_fts: "cleared_for_restored_project",
        reference_docs_fts: "cleared_for_restored_reference_docs",
      },
    },
    diagnostics: [],
    next_step: dryRun
      ? (plan.destructive_change_count > 0 || plan.cross_scope_change_count > 0
          ? "Review destructive delete and cross_scope candidates carefully before applying with explicit confirmation."
          : "Review the dry-run plan, then rerun with dry_run=false to apply the restore transactionally.")
      : "Run sync, diagnose_project_backups, and export_project_backup to rebuild derived indexes and refresh generated backup transparency.",
  };
}
