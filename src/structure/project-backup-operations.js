import fs from "node:fs";
import path from "node:path";
import {
  appendGeneratedOutputFile,
  assertRegularFileWriteTarget,
  ensureDirectoryInsideBoundary,
  resolveGeneratedOutputPath,
  writeGeneratedOutputFile,
} from "../core/filesystem-boundary.js";
import { CURRENT_SCHEMA_VERSION } from "../core/db.js";

export const PROJECT_BACKUP_OPERATION_SCHEMA_VERSION = 1;
export const PROJECT_BACKUP_OPERATION_LOG_FILE = "operations.jsonl";
const PROJECT_BACKUP_SCHEMA_VERSION = 1;

function stableStringify(value, indent = 0) {
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

export function buildProjectBackupOperationRecord({
  operation,
  projectId,
  affected = {},
  timestamp = new Date().toISOString(),
  actor = null,
  before = null,
  after = null,
  summary = null,
  applicationVersion = "0.0.0",
  metadata = {},
} = {}) {
  if (!operation || typeof operation !== "string") {
    throw new TypeError("operation is required.");
  }
  if (!projectId || typeof projectId !== "string") {
    throw new TypeError("projectId is required.");
  }

  return {
    artifact_kind: "project_backup_operation",
    schema_version: PROJECT_BACKUP_OPERATION_SCHEMA_VERSION,
    backup_schema_version: PROJECT_BACKUP_SCHEMA_VERSION,
    project_id: projectId,
    operation,
    timestamp,
    actor,
    affected,
    summary,
    before,
    after,
    metadata,
    advisory: true,
    restore_authority: false,
    compatibility: {
      application_version: applicationVersion,
      current_sqlite_schema_version: CURRENT_SCHEMA_VERSION,
    },
  };
}

export function renderProjectBackupOperationRecord(record) {
  return `${stableStringify(record, 0)}\n`;
}

export function ensureProjectBackupOperationLog({ outputDir }) {
  const normalizedOutputDir = path.resolve(outputDir);
  ensureDirectoryInsideBoundary(normalizedOutputDir, { label: "backup output_dir" });
  const operationLogPath = resolveGeneratedOutputPath(normalizedOutputDir, PROJECT_BACKUP_OPERATION_LOG_FILE);
  assertRegularFileWriteTarget(operationLogPath);

  if (fs.existsSync(operationLogPath)) {
    return {
      operationLogPath,
      written: false,
    };
  }

  writeGeneratedOutputFile(operationLogPath, "", { encoding: "utf8" });
  return {
    operationLogPath,
    written: true,
  };
}

export function appendProjectBackupOperationRecord(record, { outputDir }) {
  const { operationLogPath } = ensureProjectBackupOperationLog({ outputDir });
  appendGeneratedOutputFile(
    operationLogPath,
    renderProjectBackupOperationRecord(record),
    { encoding: "utf8" }
  );
  return {
    operationLogPath,
    appended: true,
  };
}
