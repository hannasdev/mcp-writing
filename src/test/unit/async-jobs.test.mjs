import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAsyncJobManager } from "../../runtime/async-jobs.js";

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createDbStub() {
  return {
    prepare() {
      return {
        run() {},
      };
    },
  };
}

test("pruneAsyncJobs cleans runtime temp directory through boundary helper", () => {
  withTempDir("async-jobs-outside-", (outsideDir) => {
    const outsideFile = path.join(outsideDir, "outside.txt");
    fs.writeFileSync(outsideFile, "keep", "utf8");

    withTempDir("async-jobs-job-", (tmpDir) => {
      const tmpDirReal = fs.realpathSync.native(tmpDir);
      const requestPath = path.join(tmpDir, "request.json");
      const resultPath = path.join(tmpDir, "result.json");
      const linkPath = path.join(tmpDir, "outside-link");
      fs.writeFileSync(requestPath, "{}", "utf8");
      fs.writeFileSync(resultPath, "{}", "utf8");
      fs.symlinkSync(outsideFile, linkPath);

      const asyncJobs = new Map([
        ["job-1", {
          id: "job-1",
          kind: "test",
          status: "completed",
          createdAt: "2024-01-01T00:00:00.000Z",
          startedAt: "2024-01-01T00:00:00.000Z",
          finishedAt: "2024-01-01T00:00:01.000Z",
          tmpDir,
          tmpDirReal,
          requestPath,
          resultPath,
        }],
      ]);
      const { pruneAsyncJobs } = createAsyncJobManager({
        db: createDbStub(),
        asyncJobs,
        ttlMs: 0,
        runnerDir: process.cwd(),
      });

      pruneAsyncJobs();

      assert.equal(asyncJobs.size, 0);
      assert.equal(fs.existsSync(tmpDir), false);
      assert.equal(fs.readFileSync(outsideFile, "utf8"), "keep");
    });
  });
});

test("pruneAsyncJobs cleans legacy request and result files without tmpDir", () => {
  withTempDir("async-jobs-legacy-", (tmpDir) => {
    const requestPath = path.join(tmpDir, "request.json");
    const resultPath = path.join(tmpDir, "result.json");
    fs.writeFileSync(requestPath, "{}", "utf8");
    fs.writeFileSync(resultPath, "{}", "utf8");

    const asyncJobs = new Map([
      ["job-1", {
        id: "job-1",
        kind: "test",
        status: "completed",
        createdAt: "2024-01-01T00:00:00.000Z",
        startedAt: "2024-01-01T00:00:00.000Z",
        finishedAt: "2024-01-01T00:00:01.000Z",
        requestPath,
        resultPath,
      }],
    ]);
    const { pruneAsyncJobs } = createAsyncJobManager({
      db: createDbStub(),
      asyncJobs,
      ttlMs: 0,
      runnerDir: process.cwd(),
    });

    pruneAsyncJobs();

    assert.equal(asyncJobs.size, 0);
    assert.equal(fs.existsSync(requestPath), false);
    assert.equal(fs.existsSync(resultPath), false);
    assert.equal(fs.existsSync(tmpDir), true);
  });
});
