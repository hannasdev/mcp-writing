import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FILESYSTEM_ARTIFACT_CLASSES = Object.freeze({
  AUTHORED_PROSE: "authored_prose",
  METADATA_FILE: "metadata_file",
  SIDECAR: "sidecar",
  GENERATED_EXPORT: "generated_export",
  STYLEGUIDE_CONFIG: "styleguide_config",
  STYLEGUIDE_SKILL: "styleguide_skill",
  AI_BOOT_FILE: "ai_boot_file",
  IMPORT_SOURCE: "import_source",
  IMPORT_DESTINATION: "import_destination",
  SCRIVENER_RELOCATION: "scrivener_relocation",
  RUNTIME_TEMP: "runtime_temp",
  SUPPORT_SCRIPT: "support_script",
  SYNC_ROOT_PROBE: "sync_root_probe",
  WORLD_ENTITY: "world_entity",
});

const SYNC_ROOT_ARTIFACT_CLASSES = new Set([
  FILESYSTEM_ARTIFACT_CLASSES.AUTHORED_PROSE,
  FILESYSTEM_ARTIFACT_CLASSES.METADATA_FILE,
  FILESYSTEM_ARTIFACT_CLASSES.SIDECAR,
  FILESYSTEM_ARTIFACT_CLASSES.GENERATED_EXPORT,
  FILESYSTEM_ARTIFACT_CLASSES.STYLEGUIDE_CONFIG,
  FILESYSTEM_ARTIFACT_CLASSES.STYLEGUIDE_SKILL,
  FILESYSTEM_ARTIFACT_CLASSES.AI_BOOT_FILE,
  FILESYSTEM_ARTIFACT_CLASSES.IMPORT_DESTINATION,
  FILESYSTEM_ARTIFACT_CLASSES.SCRIVENER_RELOCATION,
  FILESYSTEM_ARTIFACT_CLASSES.SYNC_ROOT_PROBE,
  FILESYSTEM_ARTIFACT_CLASSES.WORLD_ENTITY,
]);

export function createCoreValidationError(code, message, details) {
  const error = new Error(message);
  error.name = "CoreValidationError";
  error.code = code;
  error.details = details;
  return error;
}

function isOutsideBoundary(boundaryRoot, candidatePath) {
  const relative = path.relative(boundaryRoot, candidatePath);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function normalizeBoundaryRoot(boundaryRoot, boundaryRootReal = boundaryRoot) {
  if (!boundaryRoot) {
    throw new TypeError("boundaryRoot is required.");
  }
  return {
    boundaryRootAbs: path.resolve(boundaryRoot),
    boundaryRootReal: path.resolve(boundaryRootReal),
  };
}

export function resolveBoundaryRootReal(boundaryRoot) {
  const boundaryRootAbs = path.resolve(boundaryRoot);
  try {
    return fs.realpathSync.native(boundaryRootAbs);
  } catch {
    let existingAncestor = boundaryRootAbs;
    while (!fs.existsSync(existingAncestor)) {
      const parentDir = path.dirname(existingAncestor);
      if (parentDir === existingAncestor) return boundaryRootAbs;
      existingAncestor = parentDir;
    }
    try {
      const realExistingAncestor = fs.realpathSync.native(existingAncestor);
      return path.resolve(realExistingAncestor, path.relative(existingAncestor, boundaryRootAbs));
    } catch {
      return boundaryRootAbs;
    }
  }
}

export function resolveCandidateInsideBoundary(candidatePath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  errorCode = "INVALID_PATH",
  errorMessage = "Path must be inside the configured boundary.",
  details = {},
} = {}) {
  const normalizedBoundary = normalizeBoundaryRoot(boundaryRoot, boundaryRootReal);

  const resolvedCandidate = path.resolve(candidatePath);
  let existingAncestor = resolvedCandidate;

  while (!fs.existsSync(existingAncestor)) {
    const parentDir = path.dirname(existingAncestor);
    if (parentDir === existingAncestor) {
      throw createCoreValidationError(errorCode, errorMessage, {
        ...details,
        path: resolvedCandidate,
        boundary_root: normalizedBoundary.boundaryRootAbs,
      });
    }
    existingAncestor = parentDir;
  }

  let realExistingAncestor;
  try {
    realExistingAncestor = fs.realpathSync.native(existingAncestor);
  } catch (err) {
    throw createCoreValidationError(
      errorCode,
      "Path ancestor could not be resolved: path may be inaccessible.",
      {
        ...details,
        path: candidatePath,
        existing_ancestor: existingAncestor,
        cause: err instanceof Error ? err.message : String(err),
      }
    );
  }

  const relativeFromAncestor = path.relative(existingAncestor, resolvedCandidate);
  const resolvedPath = path.resolve(realExistingAncestor, relativeFromAncestor);
  const relativeToBoundary = path.relative(normalizedBoundary.boundaryRootReal, resolvedPath);

  if (isOutsideBoundary(normalizedBoundary.boundaryRootReal, resolvedPath)) {
    throw createCoreValidationError(errorCode, errorMessage, {
      ...details,
      path: resolvedPath,
      boundary_root: normalizedBoundary.boundaryRootAbs,
    });
  }

  return { resolvedPath, relativeToBoundary };
}

export function resolveExistingPathInsideBoundary(candidatePath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  errorCode = "INVALID_PATH",
  errorMessage = "Path must be inside the configured boundary.",
  details = {},
} = {}) {
  const normalizedBoundary = normalizeBoundaryRoot(boundaryRoot, boundaryRootReal);
  const resolvedCandidate = path.resolve(candidatePath);

  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync.native(resolvedCandidate);
  } catch (err) {
    throw createCoreValidationError(
      errorCode,
      "Path could not be resolved: path may not exist or may be inaccessible.",
      {
        ...details,
        path: resolvedCandidate,
        boundary_root: normalizedBoundary.boundaryRootAbs,
        cause: err instanceof Error ? err.message : String(err),
      }
    );
  }

  const relativeToBoundary = path.relative(normalizedBoundary.boundaryRootReal, resolvedPath);
  if (isOutsideBoundary(normalizedBoundary.boundaryRootReal, resolvedPath)) {
    throw createCoreValidationError(errorCode, errorMessage, {
      ...details,
      path: resolvedPath,
      boundary_root: normalizedBoundary.boundaryRootAbs,
    });
  }

  return { resolvedPath, relativeToBoundary };
}

export function resolveArtifactPathInsideSyncRoot(candidatePath, {
  syncDirAbs,
  syncDirReal = syncDirAbs,
  artifactClass,
  requireExisting = false,
  errorCode = "INVALID_SYNC_PATH",
  errorMessage = "Path must be inside WRITING_SYNC_DIR.",
  details = {},
} = {}) {
  if (!SYNC_ROOT_ARTIFACT_CLASSES.has(artifactClass)) {
    throw new TypeError(`Unsupported sync-root artifact class: ${artifactClass}`);
  }

  const resolver = requireExisting ? resolveExistingPathInsideBoundary : resolveCandidateInsideBoundary;
  return resolver(candidatePath, {
    boundaryRoot: syncDirAbs,
    boundaryRootReal: syncDirReal,
    errorCode,
    errorMessage,
    details: {
      ...details,
      artifact_class: artifactClass,
      sync_dir: syncDirAbs,
    },
  });
}

export function resolveGeneratedOutputDirWithinSync(outputDir, {
  syncDirAbs,
  syncDirReal,
} = {}) {
  const { resolvedPath, relativeToBoundary } = resolveCandidateInsideBoundary(outputDir, {
    boundaryRoot: syncDirAbs,
    boundaryRootReal: syncDirReal,
    errorCode: "INVALID_OUTPUT_DIR",
    errorMessage: "output_dir must be inside WRITING_SYNC_DIR.",
    details: { output_dir: path.resolve(outputDir), sync_dir: syncDirAbs },
  });

  return {
    resolvedOutputDir: resolvedPath,
    relativeToSyncDir: relativeToBoundary,
  };
}

export function assertImportSourcePath(importSourcePath, {
  errorCode = "INVALID_IMPORT_SOURCE",
  details = {},
} = {}) {
  const resolvedPath = path.resolve(importSourcePath);
  let realPath;
  let stat;
  try {
    realPath = fs.realpathSync.native(resolvedPath);
    stat = fs.statSync(realPath);
  } catch (err) {
    throw createCoreValidationError(
      errorCode,
      "Import source path could not be resolved.",
      {
        ...details,
        path: resolvedPath,
        artifact_class: FILESYSTEM_ARTIFACT_CLASSES.IMPORT_SOURCE,
        cause: err instanceof Error ? err.message : String(err),
      }
    );
  }

  if (!stat.isFile() && !stat.isDirectory()) {
    throw createCoreValidationError(
      errorCode,
      `Import source path must be a file or directory: ${resolvedPath}`,
      {
        ...details,
        path: resolvedPath,
        artifact_class: FILESYSTEM_ARTIFACT_CLASSES.IMPORT_SOURCE,
      }
    );
  }

  return { resolvedPath: realPath };
}

export function ensureDirectoryInsideBoundary(dirPath, {
  errorCode = "INVALID_OUTPUT_DIR",
  label = "directory",
} = {}) {
  if (fs.existsSync(dirPath)) {
    const stat = fs.lstatSync(dirPath);
    if (stat.isSymbolicLink()) {
      throw createCoreValidationError(
        errorCode,
        `${label} exists but is a symlink: ${dirPath}`,
        { path: dirPath }
      );
    }
    if (!stat.isDirectory()) {
      throw createCoreValidationError(
        errorCode,
        `${label} exists but is not a directory: ${dirPath}`,
        { path: dirPath }
      );
    }
  } else {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
  } catch {
    throw createCoreValidationError(
      errorCode,
      `${label} is not writable: ${dirPath}`,
      { path: dirPath }
    );
  }
}

export function ensureDirectoryForBoundaryPath(filePath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  errorCode = "INVALID_PATH",
  label = "directory",
} = {}) {
  const dirPath = path.dirname(filePath);
  resolveCandidateInsideBoundary(dirPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    errorMessage: `${label} must be inside the configured boundary.`,
  });
  ensureDirectoryInsideBoundary(dirPath, { errorCode, label });
  return dirPath;
}

export function ensureDirectoryInsideSyncRoot(dirPath, {
  syncDirAbs,
  syncDirReal = syncDirAbs,
  artifactClass,
  errorCode = "INVALID_SYNC_PATH",
} = {}) {
  if (!SYNC_ROOT_ARTIFACT_CLASSES.has(artifactClass)) {
    throw new TypeError(`Unsupported sync-root artifact class: ${artifactClass}`);
  }

  const { resolvedPath } = resolveArtifactPathInsideSyncRoot(dirPath, {
    syncDirAbs,
    syncDirReal,
    artifactClass,
    errorCode,
  });
  ensureDirectoryInsideBoundary(resolvedPath, {
    errorCode,
    label: "target directory",
  });
  return resolvedPath;
}

export function resolveGeneratedOutputPath(outputDir, fileName, {
  errorCode = "INVALID_OUTPUT_PATH",
} = {}) {
  const normalizedOutputDir = path.resolve(outputDir);
  const targetPath = path.resolve(normalizedOutputDir, fileName);

  if (isOutsideBoundary(normalizedOutputDir, targetPath)) {
    throw createCoreValidationError(
      errorCode,
      `Output file '${fileName}' resolves outside output_dir.`,
      { output_dir: normalizedOutputDir, file_name: fileName }
    );
  }

  return targetPath;
}

export function assertRegularFileReadTarget(filePath, {
  errorCode = "INVALID_PATH",
} = {}) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to read: target path is a symlink: ${filePath}`,
        { path: filePath }
      );
    }
    if (!stat.isFile()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to read: target path exists but is not a regular file: ${filePath}`,
        { path: filePath }
      );
    }
  } catch (error) {
    if (error?.name === "CoreValidationError") throw error;
    throw error;
  }
}

export function assertRegularFileWriteTarget(filePath, {
  errorCode = "INVALID_OUTPUT_PATH",
} = {}) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to write: target path is a symlink: ${filePath}`,
        { path: filePath }
      );
    }
    if (!stat.isFile()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to write: target path exists but is not a regular file: ${filePath}`,
        { path: filePath }
      );
    }
  } catch (error) {
    if (error?.name === "CoreValidationError") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

export function writeFileInsideBoundary(filePath, data, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  artifactClass = FILESYSTEM_ARTIFACT_CLASSES.GENERATED_EXPORT,
  encoding,
  errorCode = "INVALID_PATH",
} = {}) {
  const { resolvedPath } = resolveCandidateInsideBoundary(filePath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    errorMessage: "Write target must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });
  ensureDirectoryForBoundaryPath(resolvedPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    label: "target parent directory",
  });
  assertRegularFileWriteTarget(path.resolve(filePath), { errorCode });
  assertRegularFileWriteTarget(resolvedPath, { errorCode });
  if (encoding) {
    fs.writeFileSync(resolvedPath, data, encoding);
  } else {
    fs.writeFileSync(resolvedPath, data);
  }
}

export function writeTextInsideSyncRoot(filePath, data, {
  syncDirAbs,
  syncDirReal = syncDirAbs,
  artifactClass,
  encoding = "utf8",
  errorCode = "INVALID_SYNC_PATH",
} = {}) {
  if (!SYNC_ROOT_ARTIFACT_CLASSES.has(artifactClass)) {
    throw new TypeError(`Unsupported sync-root artifact class: ${artifactClass}`);
  }
  writeFileInsideBoundary(filePath, data, {
    boundaryRoot: syncDirAbs,
    boundaryRootReal: syncDirReal,
    artifactClass,
    encoding,
    errorCode,
  });
}

export function writeGeneratedOutputFile(filePath, data, {
  encoding,
  errorCode = "INVALID_OUTPUT_PATH",
} = {}) {
  assertRegularFileWriteTarget(filePath, { errorCode });
  if (encoding) {
    fs.writeFileSync(filePath, data, encoding);
  } else {
    fs.writeFileSync(filePath, data);
  }
}

export function copyFileInsideBoundary(sourcePath, targetPath, {
  sourceBoundaryRoot,
  sourceBoundaryRootReal = sourceBoundaryRoot,
  targetBoundaryRoot = sourceBoundaryRoot,
  targetBoundaryRootReal,
  artifactClass = FILESYSTEM_ARTIFACT_CLASSES.GENERATED_EXPORT,
  errorCode = "INVALID_PATH",
} = {}) {
  const effectiveTargetBoundaryRootReal = targetBoundaryRootReal ?? (
    targetBoundaryRoot === sourceBoundaryRoot ? sourceBoundaryRootReal : targetBoundaryRoot
  );

  assertRegularFileReadTarget(path.resolve(sourcePath), { errorCode });
  const source = resolveExistingPathInsideBoundary(sourcePath, {
    boundaryRoot: sourceBoundaryRoot,
    boundaryRootReal: sourceBoundaryRootReal,
    errorCode,
    errorMessage: "Copy source must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });
  assertRegularFileReadTarget(source.resolvedPath, { errorCode });

  const target = resolveCandidateInsideBoundary(targetPath, {
    boundaryRoot: targetBoundaryRoot,
    boundaryRootReal: effectiveTargetBoundaryRootReal,
    errorCode,
    errorMessage: "Copy target must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });
  ensureDirectoryForBoundaryPath(target.resolvedPath, {
    boundaryRoot: targetBoundaryRoot,
    boundaryRootReal: effectiveTargetBoundaryRootReal,
    errorCode,
    label: "copy target parent directory",
  });
  assertRegularFileWriteTarget(path.resolve(targetPath), { errorCode });
  assertRegularFileWriteTarget(target.resolvedPath, { errorCode });

  fs.copyFileSync(source.resolvedPath, target.resolvedPath);
  return { sourcePath: source.resolvedPath, targetPath: target.resolvedPath };
}

export function copyImportSourceFileToSyncRoot(sourcePath, targetPath, {
  syncDirAbs,
  syncDirReal = syncDirAbs,
  artifactClass = FILESYSTEM_ARTIFACT_CLASSES.IMPORT_DESTINATION,
  errorCode = "INVALID_IMPORT_DESTINATION",
} = {}) {
  const source = assertImportSourcePath(sourcePath, {
    errorCode,
    details: { import_source: path.resolve(sourcePath) },
  });
  assertRegularFileReadTarget(source.resolvedPath, { errorCode });

  const target = resolveArtifactPathInsideSyncRoot(targetPath, {
    syncDirAbs,
    syncDirReal,
    artifactClass,
    errorCode,
    errorMessage: "Import destination must be inside WRITING_SYNC_DIR.",
  });
  ensureDirectoryForBoundaryPath(target.resolvedPath, {
    boundaryRoot: syncDirAbs,
    boundaryRootReal: syncDirReal,
    errorCode,
    label: "import destination parent directory",
  });
  assertRegularFileWriteTarget(path.resolve(targetPath), { errorCode });
  assertRegularFileWriteTarget(target.resolvedPath, { errorCode });

  fs.copyFileSync(source.resolvedPath, target.resolvedPath);
  return { sourcePath: source.resolvedPath, targetPath: target.resolvedPath };
}

export function deleteInsideBoundary(targetPath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  artifactClass = FILESYSTEM_ARTIFACT_CLASSES.GENERATED_EXPORT,
  force = false,
  recursive = false,
  errorCode = "INVALID_PATH",
} = {}) {
  try {
    const stat = fs.lstatSync(path.resolve(targetPath));
    if (stat.isSymbolicLink()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to delete: target path is a symlink: ${targetPath}`,
        { path: path.resolve(targetPath), artifact_class: artifactClass }
      );
    }
  } catch (error) {
    if (error?.name === "CoreValidationError") throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  const candidate = resolveCandidateInsideBoundary(targetPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    errorMessage: "Delete target must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });

  if (!fs.existsSync(candidate.resolvedPath)) {
    if (force) {
      return { deleted: false, missing: true, targetPath: candidate.resolvedPath };
    }
    throw createCoreValidationError(
      errorCode,
      `Delete target does not exist: ${targetPath}`,
      { path: candidate.resolvedPath, artifact_class: artifactClass }
    );
  }

  fs.rmSync(candidate.resolvedPath, { force, recursive });
  return { deleted: true, targetPath: candidate.resolvedPath };
}

export function moveInsideBoundary(fromPath, toPath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  artifactClass = FILESYSTEM_ARTIFACT_CLASSES.GENERATED_EXPORT,
  allowCrossDeviceCopyFallback = true,
  errorCode = "INVALID_PATH",
  operations = fs,
} = {}) {
  const existsSync = operations.existsSync ?? fs.existsSync;
  assertRegularFileReadTarget(path.resolve(fromPath), { errorCode });
  const source = resolveExistingPathInsideBoundary(fromPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    errorMessage: "Move source must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });
  assertRegularFileReadTarget(source.resolvedPath, { errorCode });

  const target = resolveCandidateInsideBoundary(toPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    errorMessage: "Move target must be inside the configured boundary.",
    details: { artifact_class: artifactClass },
  });
  ensureDirectoryForBoundaryPath(target.resolvedPath, {
    boundaryRoot,
    boundaryRootReal,
    errorCode,
    label: "move target parent directory",
  });
  assertRegularFileWriteTarget(path.resolve(toPath), { errorCode });
  assertRegularFileWriteTarget(target.resolvedPath, { errorCode });

  try {
    operations.renameSync(source.resolvedPath, target.resolvedPath);
    return { moved: true, method: "rename", sourcePath: source.resolvedPath, targetPath: target.resolvedPath };
  } catch (error) {
    if (!allowCrossDeviceCopyFallback || error?.code !== "EXDEV") {
      throw error;
    }
  }

  try {
    operations.copyFileSync(source.resolvedPath, target.resolvedPath);
  } catch (copyError) {
    try {
      if (existsSync(target.resolvedPath)) operations.unlinkSync(target.resolvedPath);
    } catch {
      // Best effort cleanup; report the original copy failure.
    }
    return {
      moved: false,
      method: "copy_unlink",
      warning: {
        code: "move_cross_device_copy_failed",
        message: "Failed to copy file to destination; source file preserved and destination cleanup was attempted.",
        from_path: source.resolvedPath,
        to_path: target.resolvedPath,
        cause: copyError instanceof Error ? copyError.message : String(copyError),
      },
    };
  }
  if (!existsSync(target.resolvedPath)) {
    return {
      moved: false,
      method: "copy_unlink",
      warning: {
        code: "move_copy_verification_failed",
        message: "Failed to verify file copy to destination; source file preserved.",
        from_path: source.resolvedPath,
        to_path: target.resolvedPath,
      },
    };
  }

  try {
    operations.unlinkSync(source.resolvedPath);
  } catch (unlinkError) {
    try {
      if (existsSync(target.resolvedPath)) operations.unlinkSync(target.resolvedPath);
    } catch {
      // Best effort cleanup; report the original unlink failure.
    }
    return {
      moved: false,
      method: "copy_unlink",
      warning: {
        code: "move_cross_device_unlink_failed",
        message: "Copied destination but failed to remove source; destination cleanup was attempted.",
        from_path: source.resolvedPath,
        to_path: target.resolvedPath,
        cause: unlinkError instanceof Error ? unlinkError.message : String(unlinkError),
      },
    };
  }

  return { moved: true, method: "copy_unlink", sourcePath: source.resolvedPath, targetPath: target.resolvedPath };
}

export function createRuntimeTempBoundary({
  prefix = "mcp-writing-job-",
  tmpRoot = os.tmpdir(),
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, prefix));
  return {
    tmpDir,
    tmpDirReal: fs.realpathSync.native(tmpDir),
  };
}

export function resolveRuntimeTempPath(tempDir, candidatePath, {
  tempDirReal = tempDir,
  errorCode = "INVALID_RUNTIME_TEMP_PATH",
} = {}) {
  return resolveCandidateInsideBoundary(candidatePath, {
    boundaryRoot: tempDir,
    boundaryRootReal: tempDirReal,
    errorCode,
    errorMessage: "Runtime temp path must stay inside the job temp directory.",
    details: { artifact_class: FILESYSTEM_ARTIFACT_CLASSES.RUNTIME_TEMP },
  });
}

export function writeRuntimeTempFile(tempDir, filePath, data, {
  tempDirReal = tempDir,
  encoding = "utf8",
  errorCode = "INVALID_RUNTIME_TEMP_PATH",
} = {}) {
  const { resolvedPath } = resolveRuntimeTempPath(tempDir, filePath, { tempDirReal, errorCode });
  assertRegularFileWriteTarget(path.resolve(filePath), { errorCode });
  assertRegularFileWriteTarget(resolvedPath, { errorCode });
  if (encoding) {
    fs.writeFileSync(resolvedPath, data, encoding);
  } else {
    fs.writeFileSync(resolvedPath, data);
  }
  return resolvedPath;
}

export function cleanupRuntimeTempPath(tempDir, candidatePath, {
  tempDirReal = tempDir,
  recursive = false,
  force = true,
  errorCode = "INVALID_RUNTIME_TEMP_PATH",
} = {}) {
  try {
    const stat = fs.lstatSync(path.resolve(candidatePath));
    if (stat.isSymbolicLink()) {
      throw createCoreValidationError(
        errorCode,
        `Refusing to cleanup runtime temp path: target path is a symlink: ${candidatePath}`,
        { path: path.resolve(candidatePath), artifact_class: FILESYSTEM_ARTIFACT_CLASSES.RUNTIME_TEMP }
      );
    }
  } catch (error) {
    if (error?.name === "CoreValidationError") throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  const { resolvedPath } = resolveRuntimeTempPath(tempDir, candidatePath, { tempDirReal, errorCode });
  fs.rmSync(resolvedPath, { recursive, force });
  return { deleted: true, targetPath: resolvedPath };
}

export function probeSyncRootWritable(syncDir, {
  probeFileName = ".mcp-write-check",
  errorCode = "INVALID_SYNC_ROOT_PROBE",
} = {}) {
  const syncDirAbs = path.resolve(syncDir);
  const syncDirReal = fs.realpathSync.native(syncDirAbs);
  const probePath = path.join(syncDirAbs, probeFileName);

  writeTextInsideSyncRoot(probePath, "", {
    syncDirAbs,
    syncDirReal,
    artifactClass: FILESYSTEM_ARTIFACT_CLASSES.SYNC_ROOT_PROBE,
    errorCode,
  });
  deleteInsideBoundary(probePath, {
    boundaryRoot: syncDirAbs,
    boundaryRootReal: syncDirReal,
    artifactClass: FILESYSTEM_ARTIFACT_CLASSES.SYNC_ROOT_PROBE,
    errorCode,
  });

  return true;
}
