import path from "node:path";
import { validateProjectId } from "../sync/importer.js";
import { buildProjectBackup, writeProjectBackupFiles } from "./project-backup.js";
import {
  appendProjectBackupOperationRecord,
  buildProjectBackupOperationRecord,
} from "./project-backup-operations.js";

function relativePath(syncDirAbs, filePath) {
  return path.relative(syncDirAbs, filePath).split(path.sep).filter(Boolean).join("/");
}

function createBackupWarning(code, message, details = {}) {
  return {
    code,
    severity: "warning",
    message,
    details,
  };
}

export function createToolActor(id) {
  return {
    type: "tool",
    id,
  };
}

export function buildPostMutationBackupWarning({
  projectId,
  operation,
  phase,
  error,
  details = {},
}) {
  const message = error instanceof Error ? error.message : String(error);
  return createBackupWarning(
    phase === "operation_history"
      ? "OPERATION_LOG_APPEND_FAILED"
      : "PROJECT_BACKUP_REFRESH_FAILED",
    phase === "operation_history"
      ? `Canonical mutation '${operation}' succeeded, but the advisory backup operation log could not be updated: ${message}`
      : `Canonical mutation '${operation}' succeeded, but generated project backup artifacts could not be refreshed: ${message}`,
    {
      project_id: projectId,
      operation,
      phase,
      ...details,
    }
  );
}

export function refreshProjectBackupAfterMutation(db, {
  syncDir,
  projectId,
  applicationVersion = "0.0.0",
  operation,
  actor = null,
  affected = {},
  before = null,
  after = null,
  summary = null,
  metadata = {},
  timestamp,
  buildBackup = buildProjectBackup,
  writeBackup = writeProjectBackupFiles,
  appendOperation = appendProjectBackupOperationRecord,
} = {}) {
  if (!syncDir) throw new TypeError("syncDir is required.");
  if (!projectId) throw new TypeError("projectId is required.");
  if (!operation) throw new TypeError("operation is required.");
  const projectIdCheck = validateProjectId(projectId);
  if (!projectIdCheck.ok) {
    throw new TypeError(projectIdCheck.reason);
  }

  const syncDirAbs = path.resolve(syncDir);
  const outputDir = path.join(syncDirAbs, "project-backups", projectId);
  const relativeOutputDir = relativePath(syncDirAbs, outputDir);
  const backupLocation = relativeOutputDir ? `${relativeOutputDir}/` : "./";
  const warnings = [];

  let operationHistory = null;
  const operationRecord = buildProjectBackupOperationRecord({
    operation,
    projectId,
    timestamp,
    actor,
    affected,
    before,
    after,
    summary,
    applicationVersion,
    metadata,
  });

  try {
    const appended = appendOperation(operationRecord, { outputDir });
    operationHistory = {
      appended: appended.appended,
      path: appended.operationLogPath,
      relative_path: relativePath(syncDirAbs, appended.operationLogPath),
      advisory: true,
      restore_authority: false,
    };
  } catch (error) {
    warnings.push(buildPostMutationBackupWarning({
      projectId,
      operation,
      phase: "operation_history",
      error,
    }));
  }

  let backupRefresh = null;
  try {
    const built = buildBackup(db, {
      projectId,
      syncDir: syncDirAbs,
      applicationVersion,
      backupLocation,
    });
    if (!built.ok) {
      throw new Error(built.error?.message ?? "Project backup could not be built.");
    }
    const written = writeBackup(built, { outputDir });
    backupRefresh = {
      ok: true,
      output_dir: outputDir,
      relative_output_dir: relativeOutputDir,
      files: {
        manifest: written.manifestPath,
        canonical_snapshot: written.snapshotPath,
        operations: written.operationLogPath,
      },
      relative_files: {
        manifest: relativePath(syncDirAbs, written.manifestPath),
        canonical_snapshot: relativePath(syncDirAbs, written.snapshotPath),
        operations: relativePath(syncDirAbs, written.operationLogPath),
      },
      written: written.written,
      generated_transparency: true,
      restore_authority: "manifest_and_canonical_snapshot",
      git_commit_created: false,
    };
  } catch (error) {
    warnings.push(buildPostMutationBackupWarning({
      projectId,
      operation,
      phase: "backup_refresh",
      error,
    }));
  }

  return {
    operation_history: operationHistory,
    backup_refresh: backupRefresh,
    backup_warnings: warnings,
  };
}
