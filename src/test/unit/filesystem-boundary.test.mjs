import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupRuntimeTempPath,
  copyFileInsideBoundary,
  createRuntimeTempBoundary,
  deleteInsideBoundary,
  ensureDirectoryInsideBoundary,
  FILESYSTEM_ARTIFACT_CLASSES,
  moveInsideBoundary,
  resolveArtifactPathInsideSyncRoot,
  resolveGeneratedOutputDirWithinSync,
  resolveGeneratedOutputPath,
  resolveRuntimeTempPath,
  writeGeneratedOutputFile,
  writeRuntimeTempFile,
  writeTextInsideSyncRoot,
} from "../../core/filesystem-boundary.js";

function withTempDir(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("filesystem boundary helpers", () => {
  test("resolves a missing generated output directory inside the sync root", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const outputDir = path.join(syncDir, "exports", "structure");

      const result = resolveGeneratedOutputDirWithinSync(outputDir, {
        syncDirAbs: syncDir,
        syncDirReal,
      });

      assert.equal(result.resolvedOutputDir, path.join(syncDirReal, "exports", "structure"));
      assert.equal(result.relativeToSyncDir.split(path.sep).join("/"), "exports/structure");
    });
  });

  test("rejects a generated output directory that escapes through a symlink ancestor", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      withTempDir("fs-boundary-outside-", (outsideDir) => {
        const syncDirReal = fs.realpathSync.native(syncDir);
        const linkPath = path.join(syncDir, "exports-link");
        fs.symlinkSync(outsideDir, linkPath, "dir");

        assert.throws(
          () => resolveGeneratedOutputDirWithinSync(path.join(linkPath, "nested"), {
            syncDirAbs: syncDir,
            syncDirReal,
          }),
          (error) => error.name === "CoreValidationError"
            && error.code === "INVALID_OUTPUT_DIR"
            && /inside WRITING_SYNC_DIR/.test(error.message)
        );
      });
    });
  });

  test("rejects generated filenames that traverse outside the output directory", () => {
    withTempDir("fs-boundary-output-", (outputDir) => {
      assert.throws(
        () => resolveGeneratedOutputPath(outputDir, "../escape.md"),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_OUTPUT_PATH"
          && /resolves outside output_dir/.test(error.message)
      );
    });
  });

  test("creates guarded output directories and writes regular files", () => {
    withTempDir("fs-boundary-output-", (root) => {
      const outputDir = path.join(root, "exports");
      const filePath = path.join(outputDir, "bundle.md");

      ensureDirectoryInsideBoundary(outputDir, { label: "output_dir" });
      writeGeneratedOutputFile(filePath, "hello\n", { encoding: "utf8" });

      assert.equal(fs.readFileSync(filePath, "utf8"), "hello\n");
    });
  });

  test("rejects writes to symlink targets", () => {
    withTempDir("fs-boundary-output-", (root) => {
      const outsideTarget = path.join(root, "outside.md");
      const linkPath = path.join(root, "link.md");
      fs.writeFileSync(outsideTarget, "outside", "utf8");
      fs.symlinkSync(outsideTarget, linkPath);

      assert.throws(
        () => writeGeneratedOutputFile(linkPath, "replacement", { encoding: "utf8" }),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_OUTPUT_PATH"
          && /target path is a symlink/.test(error.message)
      );
      assert.equal(fs.readFileSync(outsideTarget, "utf8"), "outside");
    });
  });

  test("resolves artifact-aware sync-root paths for missing targets", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const targetPath = path.join(syncDir, "projects", "novel", "scenes", "sc-001.md");

      const result = resolveArtifactPathInsideSyncRoot(targetPath, {
        syncDirAbs: syncDir,
        syncDirReal,
        artifactClass: FILESYSTEM_ARTIFACT_CLASSES.AUTHORED_PROSE,
      });

      assert.equal(result.resolvedPath, path.join(syncDirReal, "projects", "novel", "scenes", "sc-001.md"));
      assert.equal(result.relativeToBoundary.split(path.sep).join("/"), "projects/novel/scenes/sc-001.md");
    });
  });

  test("rejects unsupported sync-root artifact classes", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      assert.throws(
        () => resolveArtifactPathInsideSyncRoot(path.join(syncDir, "source.txt"), {
          syncDirAbs: syncDir,
          syncDirReal: fs.realpathSync.native(syncDir),
          artifactClass: FILESYSTEM_ARTIFACT_CLASSES.IMPORT_SOURCE,
        }),
        /Unsupported sync-root artifact class/
      );
    });
  });

  test("writes artifact-aware sync-root text and rejects symlink targets", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const prosePath = path.join(syncDir, "scenes", "sc-001.md");
      writeTextInsideSyncRoot(prosePath, "Scene prose.\n", {
        syncDirAbs: syncDir,
        syncDirReal,
        artifactClass: FILESYSTEM_ARTIFACT_CLASSES.AUTHORED_PROSE,
      });
      assert.equal(fs.readFileSync(prosePath, "utf8"), "Scene prose.\n");

      const target = path.join(syncDir, "real.md");
      const link = path.join(syncDir, "link.md");
      fs.writeFileSync(target, "real", "utf8");
      fs.symlinkSync(target, link);

      assert.throws(
        () => writeTextInsideSyncRoot(link, "replacement\n", {
          syncDirAbs: syncDir,
          syncDirReal,
          artifactClass: FILESYSTEM_ARTIFACT_CLASSES.AUTHORED_PROSE,
        }),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_SYNC_PATH"
          && /target path is a symlink/.test(error.message)
      );
      assert.equal(fs.readFileSync(target, "utf8"), "real");
    });
  });

  test("copies files only when source and target stay inside their boundaries", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      withTempDir("fs-boundary-outside-", (outsideDir) => {
        const syncDirReal = fs.realpathSync.native(syncDir);
        const source = path.join(syncDir, "source.md");
        const target = path.join(syncDir, "nested", "target.md");
        fs.writeFileSync(source, "copy me", "utf8");

        const result = copyFileInsideBoundary(source, target, {
          sourceBoundaryRoot: syncDir,
          sourceBoundaryRootReal: syncDirReal,
          artifactClass: FILESYSTEM_ARTIFACT_CLASSES.SIDECAR,
          errorCode: "INVALID_SYNC_PATH",
        });

        assert.equal(result.targetPath, path.join(syncDirReal, "nested", "target.md"));
        assert.equal(fs.readFileSync(target, "utf8"), "copy me");

        assert.throws(
          () => copyFileInsideBoundary(source, path.join(outsideDir, "escape.md"), {
            sourceBoundaryRoot: syncDir,
            sourceBoundaryRootReal: syncDirReal,
            artifactClass: FILESYSTEM_ARTIFACT_CLASSES.SIDECAR,
            errorCode: "INVALID_SYNC_PATH",
          }),
          (error) => error.name === "CoreValidationError"
            && error.code === "INVALID_SYNC_PATH"
            && /Copy target/.test(error.message)
        );
      });
    });
  });

  test("rejects copy and move targets that are non-regular files", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const source = path.join(syncDir, "source.md");
      const targetDir = path.join(syncDir, "target.md");
      fs.writeFileSync(source, "content", "utf8");
      fs.mkdirSync(targetDir);

      assert.throws(
        () => copyFileInsideBoundary(source, targetDir, {
          sourceBoundaryRoot: syncDir,
          sourceBoundaryRootReal: syncDirReal,
          errorCode: "INVALID_SYNC_PATH",
        }),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_SYNC_PATH"
          && /not a regular file/.test(error.message)
      );

      assert.throws(
        () => moveInsideBoundary(source, targetDir, {
          boundaryRoot: syncDir,
          boundaryRootReal: syncDirReal,
          errorCode: "INVALID_SYNC_PATH",
        }),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_SYNC_PATH"
          && /not a regular file/.test(error.message)
      );
    });
  });

  test("moves files by rename inside the boundary", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const source = path.join(syncDir, "source.md");
      const target = path.join(syncDir, "moved", "target.md");
      fs.writeFileSync(source, "move me", "utf8");

      const result = moveInsideBoundary(source, target, {
        boundaryRoot: syncDir,
        boundaryRootReal: syncDirReal,
        artifactClass: FILESYSTEM_ARTIFACT_CLASSES.AUTHORED_PROSE,
        errorCode: "INVALID_SYNC_PATH",
      });

      assert.deepEqual(
        { moved: result.moved, method: result.method },
        { moved: true, method: "rename" }
      );
      assert.equal(fs.existsSync(source), false);
      assert.equal(fs.readFileSync(target, "utf8"), "move me");
    });
  });

  test("uses explicit copy-unlink fallback for cross-device moves", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const source = path.join(syncDir, "source.md");
      const target = path.join(syncDir, "target.md");
      fs.writeFileSync(source, "move me", "utf8");

      const operations = {
        renameSync() {
          const error = new Error("cross-device move");
          error.code = "EXDEV";
          throw error;
        },
        copyFileSync: fs.copyFileSync,
        unlinkSync: fs.unlinkSync,
      };

      const result = moveInsideBoundary(source, target, {
        boundaryRoot: syncDir,
        boundaryRootReal: syncDirReal,
        operations,
      });

      assert.deepEqual(
        { moved: result.moved, method: result.method },
        { moved: true, method: "copy_unlink" }
      );
      assert.equal(fs.existsSync(source), false);
      assert.equal(fs.readFileSync(target, "utf8"), "move me");
    });
  });

  test("reports and cleans up partial cross-device moves when source unlink fails", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const source = path.join(syncDir, "source.md");
      const target = path.join(syncDir, "target.md");
      fs.writeFileSync(source, "move me", "utf8");
      const sourceReal = fs.realpathSync.native(source);

      const operations = {
        renameSync() {
          const error = new Error("cross-device move");
          error.code = "EXDEV";
          throw error;
        },
        copyFileSync: fs.copyFileSync,
        unlinkSync(filePath) {
          if (filePath === sourceReal) {
            throw new Error("source is locked");
          }
          fs.unlinkSync(filePath);
        },
      };

      const result = moveInsideBoundary(source, target, {
        boundaryRoot: syncDir,
        boundaryRootReal: syncDirReal,
        operations,
      });

      assert.equal(result.moved, false);
      assert.equal(result.warning.code, "move_cross_device_unlink_failed");
      assert.equal(fs.existsSync(source), true);
      assert.equal(fs.existsSync(target), false);
    });
  });

  test("delete helper refuses symlink targets and does not remove the symlink destination", () => {
    withTempDir("fs-boundary-sync-", (syncDir) => {
      const syncDirReal = fs.realpathSync.native(syncDir);
      const target = path.join(syncDir, "target.md");
      const link = path.join(syncDir, "link.md");
      fs.writeFileSync(target, "preserve", "utf8");
      fs.symlinkSync(target, link);

      assert.throws(
        () => deleteInsideBoundary(link, {
          boundaryRoot: syncDir,
          boundaryRootReal: syncDirReal,
          errorCode: "INVALID_SYNC_PATH",
        }),
        (error) => error.name === "CoreValidationError"
          && error.code === "INVALID_SYNC_PATH"
          && /target path is a symlink/.test(error.message)
      );
      assert.equal(fs.readFileSync(target, "utf8"), "preserve");
    });
  });

  test("runtime temp helpers constrain writes and cleanup to the job temp dir", () => {
    withTempDir("fs-boundary-outside-", (outsideDir) => {
      const { tmpDir, tmpDirReal } = createRuntimeTempBoundary({ prefix: "fs-boundary-job-" });
      try {
        const requestPath = path.join(tmpDir, "job.request.json");
        const resolvedRequest = writeRuntimeTempFile(tmpDir, requestPath, "{\"ok\":true}\n", {
          tempDirReal: tmpDirReal,
        });
        assert.equal(resolvedRequest, path.join(tmpDirReal, "job.request.json"));
        assert.equal(fs.readFileSync(requestPath, "utf8"), "{\"ok\":true}\n");

        const linkPath = path.join(tmpDir, "outside-link");
        fs.symlinkSync(outsideDir, linkPath, "dir");

        assert.throws(
          () => resolveRuntimeTempPath(tmpDir, path.join(linkPath, "escape.json"), {
            tempDirReal: tmpDirReal,
          }),
          (error) => error.name === "CoreValidationError"
            && error.code === "INVALID_RUNTIME_TEMP_PATH"
            && /job temp directory/.test(error.message)
        );

        cleanupRuntimeTempPath(tmpDir, requestPath, { tempDirReal: tmpDirReal });
        assert.equal(fs.existsSync(requestPath), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
