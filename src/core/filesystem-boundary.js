import fs from "node:fs";
import path from "node:path";

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

export function resolveCandidateInsideBoundary(candidatePath, {
  boundaryRoot,
  boundaryRootReal = boundaryRoot,
  errorCode = "INVALID_PATH",
  errorMessage = "Path must be inside the configured boundary.",
  details = {},
} = {}) {
  if (!boundaryRoot) {
    throw new TypeError("boundaryRoot is required.");
  }

  const resolvedCandidate = path.resolve(candidatePath);
  let existingAncestor = resolvedCandidate;

  while (!fs.existsSync(existingAncestor)) {
    const parentDir = path.dirname(existingAncestor);
    if (parentDir === existingAncestor) {
      throw createCoreValidationError(errorCode, errorMessage, {
        ...details,
        path: resolvedCandidate,
        boundary_root: boundaryRoot,
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
  const relativeToBoundary = path.relative(boundaryRootReal, resolvedPath);

  if (isOutsideBoundary(boundaryRootReal, resolvedPath)) {
    throw createCoreValidationError(errorCode, errorMessage, {
      ...details,
      path: resolvedPath,
      boundary_root: boundaryRoot,
    });
  }

  return { resolvedPath, relativeToBoundary };
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

export function ensureDirectoryInsideBoundary(dirPath, {
  errorCode = "INVALID_OUTPUT_DIR",
  label = "directory",
} = {}) {
  if (fs.existsSync(dirPath)) {
    const stat = fs.lstatSync(dirPath);
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
