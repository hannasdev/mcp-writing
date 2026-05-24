import fs from "node:fs";
import path from "node:path";
import {
  buildProjectBackup,
  computeProjectBackupBundleChecksum,
  computeProjectBackupSnapshotChecksum,
  PROJECT_BACKUP_SCHEMA_VERSION,
} from "./project-backup.js";

const MANIFEST_FILE = "manifest.json";
const SNAPSHOT_FILE = "canonical.snapshot.json";

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function normalizeRelativePath(syncDir, filePath) {
  return path.relative(syncDir, filePath).split(path.sep).filter(Boolean).join("/");
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

function fileState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, readable: false, regular: false, symlink: false };
  }
  const stat = fs.lstatSync(filePath);
  return {
    exists: true,
    readable: true,
    regular: stat.isFile(),
    symlink: stat.isSymbolicLink(),
  };
}

function readJsonFile(filePath) {
  const state = fileState(filePath);
  if (!state.exists) {
    return { ok: false, state, error: "missing" };
  }
  if (state.symlink || !state.regular) {
    return { ok: false, state, error: state.symlink ? "symlink" : "not_regular" };
  }
  try {
    return {
      ok: true,
      state,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
    };
  } catch (error) {
    return {
      ok: false,
      state,
      error: "unreadable_json",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function statusFromDiagnostics(diagnostics) {
  if (diagnostics.some(diagnostic => diagnostic.type === "project_backup_stale")) return "stale";
  if (diagnostics.length) return "untrusted";
  return "current";
}

export function runProjectBackupDiagnostics(db, {
  syncDir,
  backupDir = null,
  projectId,
  applicationVersion = "0.0.0",
} = {}) {
  const diagnostics = [];
  const resolvedBackupDir = path.resolve(backupDir ?? path.join(syncDir, "project-backups", projectId));
  const relativeBackupDir = normalizeRelativePath(syncDir, resolvedBackupDir);
  const backupLocation = relativeBackupDir ? `${relativeBackupDir}/` : "./";
  const manifestPath = path.join(resolvedBackupDir, MANIFEST_FILE);
  const snapshotPath = path.join(resolvedBackupDir, SNAPSHOT_FILE);
  const manifestRead = readJsonFile(manifestPath);
  const snapshotRead = readJsonFile(snapshotPath);

  if (!manifestRead.state.exists && !snapshotRead.state.exists) {
    addDiagnostic(
      diagnostics,
      "project_backup_missing",
      `Project backup for "${projectId}" is missing.`,
      {
        project_id: projectId,
        backup_dir: resolvedBackupDir,
        relative_backup_dir: relativeBackupDir,
      },
      { nextStep: "Run export_project_backup for this project, then review or commit the generated backup bundle." }
    );
  } else if (!manifestRead.state.exists || !snapshotRead.state.exists) {
    addDiagnostic(
      diagnostics,
      "project_backup_partial",
      `Project backup for "${projectId}" is incomplete.`,
      {
        project_id: projectId,
        backup_dir: resolvedBackupDir,
        manifest_exists: manifestRead.state.exists,
        canonical_snapshot_exists: snapshotRead.state.exists,
      },
      { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
    );
  }

  for (const [label, readResult, filePath] of [
    ["manifest", manifestRead, manifestPath],
    ["canonical_snapshot", snapshotRead, snapshotPath],
  ]) {
    if (!readResult.state.exists) continue;
    if (!readResult.ok) {
      addDiagnostic(
        diagnostics,
        "project_backup_unreadable",
        `Project backup ${label} is not readable as trusted JSON.`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          file: filePath,
          reason: readResult.error,
          message: readResult.message ?? null,
        },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      );
    }
  }

  const built = buildProjectBackup(db, {
    projectId,
    syncDir,
    applicationVersion,
    backupLocation,
  });
  if (!built.ok) {
    addDiagnostic(
      diagnostics,
      "project_backup_current_snapshot_failed",
      built.error.message,
      built.error.details,
      { severity: "error", nextStep: "Confirm the project_id exists before diagnosing its backup bundle." }
    );
  }

  const manifest = manifestRead.ok ? manifestRead.value : null;
  const snapshot = snapshotRead.ok ? snapshotRead.value : null;

  if (manifest) {
    if (manifest.artifact_kind !== "project_backup") {
      addDiagnostic(
        diagnostics,
        "project_backup_wrong_artifact",
        `Backup manifest for "${projectId}" is not a project backup artifact.`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          artifact_kind: manifest.artifact_kind ?? null,
        },
        { nextStep: "Regenerate the backup with export_project_backup." }
      );
    }
    if (manifest.project_id !== projectId) {
      addDiagnostic(
        diagnostics,
        "project_backup_wrong_project",
        `Backup manifest belongs to project "${manifest.project_id ?? "unknown"}", not "${projectId}".`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          manifest_project_id: manifest.project_id ?? null,
        },
        { nextStep: "Choose the backup directory for the requested project or regenerate the backup." }
      );
    }
    if (manifest.schema_version !== PROJECT_BACKUP_SCHEMA_VERSION) {
      addDiagnostic(
        diagnostics,
        "project_backup_incompatible_schema",
        `Backup manifest schema version "${manifest.schema_version ?? "unknown"}" is not compatible with this server.`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          backup_schema_version: manifest.schema_version ?? null,
          expected_schema_version: PROJECT_BACKUP_SCHEMA_VERSION,
        },
        { nextStep: "Regenerate the backup with a compatible server version before using it for recovery." }
      );
    }
  }

  if (snapshot && snapshot.project?.project_id !== projectId) {
    addDiagnostic(
      diagnostics,
      "project_backup_wrong_project",
      `Backup snapshot belongs to project "${snapshot.project?.project_id ?? "unknown"}", not "${projectId}".`,
      {
        project_id: projectId,
        backup_dir: resolvedBackupDir,
        snapshot_project_id: snapshot.project?.project_id ?? null,
      },
      { nextStep: "Choose the backup directory for the requested project or regenerate the backup." }
    );
  }

  if (manifest && snapshot) {
    const exportedSnapshotChecksum = manifest.checksums?.canonical_snapshot_sha256 ?? null;
    const computedSnapshotChecksum = computeProjectBackupSnapshotChecksum(snapshot);
    if (!exportedSnapshotChecksum || exportedSnapshotChecksum !== computedSnapshotChecksum) {
      addDiagnostic(
        diagnostics,
        "project_backup_checksum_mismatch",
        `Project backup snapshot checksum does not match manifest for "${projectId}".`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          exported_checksum: exportedSnapshotChecksum,
          computed_checksum: computedSnapshotChecksum,
        },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      );
    }

    const exportedBundleChecksum = manifest.checksums?.bundle_sha256 ?? null;
    const computedBundleChecksum = computeProjectBackupBundleChecksum({ manifest, snapshot });
    if (!exportedBundleChecksum || exportedBundleChecksum !== computedBundleChecksum) {
      addDiagnostic(
        diagnostics,
        "project_backup_bundle_checksum_mismatch",
        `Project backup bundle checksum does not match manifest for "${projectId}".`,
        {
          project_id: projectId,
          backup_dir: resolvedBackupDir,
          exported_checksum: exportedBundleChecksum,
          computed_checksum: computedBundleChecksum,
        },
        { nextStep: "Regenerate the backup with export_project_backup before using it for recovery." }
      );
    }

    const canCheckFreshness = diagnostics.length === 0;
    if (canCheckFreshness && built.ok && exportedSnapshotChecksum === computedSnapshotChecksum) {
      const currentChecksum = built.manifest.checksums.canonical_snapshot_sha256;
      if (exportedSnapshotChecksum !== currentChecksum) {
        addDiagnostic(
          diagnostics,
          "project_backup_stale",
          `Project backup for "${projectId}" is stale relative to current SQLite canonical state.`,
          {
            project_id: projectId,
            backup_dir: resolvedBackupDir,
            exported_checksum: exportedSnapshotChecksum,
            current_checksum: currentChecksum,
          },
          { nextStep: "Regenerate the backup with export_project_backup, then review the Git diff." }
        );
      }
    }
  }

  diagnostics.sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare) return typeCompare;
    return a.message.localeCompare(b.message);
  });

  const status = statusFromDiagnostics(diagnostics);
  return {
    ok: diagnostics.length === 0,
    checked: {
      project_id: projectId,
      backup_dir: resolvedBackupDir,
      relative_backup_dir: relativeBackupDir,
      files: {
        manifest: manifestPath,
        canonical_snapshot: snapshotPath,
      },
      manifest_exists: manifestRead.state.exists,
      canonical_snapshot_exists: snapshotRead.state.exists,
    },
    trust: {
      trusted: diagnostics.length === 0,
      status,
      freshness: status === "current" ? "current" : status === "stale" ? "stale" : "unknown",
      schema_version: manifest?.schema_version ?? null,
      backup_location: manifest?.backup_location ?? null,
      checksums: manifest?.checksums ?? null,
    },
    summary: {
      total: diagnostics.length,
      by_type: countBy(diagnostics, "type"),
      by_severity: countBy(diagnostics, "severity"),
    },
    diagnostics,
    next_steps: diagnostics.length
      ? ["Follow diagnostic next_step guidance before treating this backup as recovery input."]
      : ["Project backup is trusted and current relative to SQLite canonical state."],
  };
}
