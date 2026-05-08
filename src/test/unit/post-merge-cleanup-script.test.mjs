import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../../..");
const helperScriptPath = path.join(
  root,
  "skills",
  "post-merge-cleanup",
  "scripts",
  "post-merge-cleanup.mjs"
);

function writeFakeGhBinary(binDir) {
  const fakeGhPath = path.join(binDir, "gh");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.GH_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");

if (args[0] === "pr" && args[1] === "view") {
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : null;
  const expectedRepo = process.env.EXPECT_REPO || "hannasdev/mcp-writing";
  if (repo !== expectedRepo) {
    process.stderr.write("repo mismatch\\n");
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({ state: "MERGED", mergedAt: "2026-05-08T13:00:00Z" }));
  process.exit(0);
}

process.stderr.write("unsupported fake gh invocation\\n");
process.exit(2);
`;
  fs.writeFileSync(fakeGhPath, script, { mode: 0o755 });
}

function writeFakeGitBinary(binDir) {
  const fakeGitPath = path.join(binDir, "git");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.GIT_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");

if (args[0] === "switch" && args[1] === "main") process.exit(0);
if (args[0] === "fetch" && args[1] === "origin" && args[2] === "main") process.exit(0);
if (args[0] === "merge" && args[1] === "--ff-only" && args[2] === "origin/main") process.exit(0);
if (args[0] === "branch" && args[1] === "-d") process.exit(0);
if (args[0] === "branch" && args[1] === "--show-current") {
  process.stdout.write("main\\n");
  process.exit(0);
}
if (args[0] === "push" && args[1] === "origin" && args[2] === "--delete") process.exit(0);

process.stderr.write("unsupported fake git invocation\\n");
process.exit(2);
`;
  fs.writeFileSync(fakeGitPath, script, { mode: 0o755 });
}

function writeFakeNodeBinary(binDir) {
  const fakeNodePath = path.join(binDir, "node");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.NODE_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");

if (args[0] === "skills/review-comment-resolution/scripts/review-comments.mjs" && args[1] === "list") {
  process.stdout.write("PR #186\\nThreads shown: 0 (unresolved)\\n");
  process.exit(0);
}

process.stderr.write("unsupported fake node invocation\\n");
process.exit(2);
`;
  fs.writeFileSync(fakeNodePath, script, { mode: 0o755 });
}

function runHelper(args, env = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "post-merge-cleanup-helper-test-"));
  const binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  writeFakeGhBinary(binDir);
  writeFakeGitBinary(binDir);
  writeFakeNodeBinary(binDir);

  const ghLogPath = path.join(tmpDir, "gh.log");
  const gitLogPath = path.join(tmpDir, "git.log");
  const nodeLogPath = path.join(tmpDir, "node.log");

  const result = spawnSync(
    process.execPath,
    [helperScriptPath, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        GH_LOG: ghLogPath,
        GIT_LOG: gitLogPath,
        NODE_LOG: nodeLogPath,
        PATH: `${binDir}:${process.env.PATH}`,
      },
      cwd: root,
    }
  );

  const readLog = (filePath) => (fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []);

  const ghLog = readLog(ghLogPath);
  const gitLog = readLog(gitLogPath);
  const nodeLog = readLog(nodeLogPath);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { result, ghLog, gitLog, nodeLog };
}

describe("post-merge-cleanup helper script", () => {
  test("rejects unknown flags", () => {
    const { result } = runHelper(["--pr", "186", "--branch", "fix/example", "--oops"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown flag: --oops/);
  });

  test("forwards --repo to gh pr view and review-comments helper", () => {
    const { result, ghLog, nodeLog } = runHelper(
      ["--pr", "186", "--branch", "fix/example", "--repo", "acme/example"],
      { EXPECT_REPO: "acme/example" }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const ghCall = ghLog.find((args) => args[0] === "pr" && args[1] === "view");
    assert.ok(ghCall);
    assert.ok(ghCall.includes("--repo"));
    assert.ok(ghCall.includes("acme/example"));

    const nodeCall = nodeLog.find((args) => args[0] === "skills/review-comment-resolution/scripts/review-comments.mjs");
    assert.ok(nodeCall);
    assert.ok(nodeCall.includes("--repo"));
    assert.ok(nodeCall.includes("acme/example"));
  });

  test("syncs main explicitly from origin/main", () => {
    const { result, gitLog } = runHelper(["--pr", "186", "--branch", "fix/example"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const fetchCall = gitLog.find((args) => args[0] === "fetch");
    const mergeCall = gitLog.find((args) => args[0] === "merge");

    assert.deepEqual(fetchCall, ["fetch", "origin", "main"]);
    assert.deepEqual(mergeCall, ["merge", "--ff-only", "origin/main"]);
  });
});
