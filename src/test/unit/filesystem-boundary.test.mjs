import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureDirectoryInsideBoundary,
  resolveGeneratedOutputDirWithinSync,
  resolveGeneratedOutputPath,
  writeGeneratedOutputFile,
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
});
