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
  "review-comment-resolution",
  "scripts",
  "review-comments.mjs"
);

function writeFakeGhBinary(binDir) {
  const fakeGhPath = path.join(binDir, "gh");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const args = process.argv.slice(2);
const logPath = process.env.GH_LOG;
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify(args) + "\\n");
}

function getArgValue(flag, flagType = "-f") {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flagType && args[i + 1] && args[i + 1].startsWith(flag + "=")) {
      return args[i + 1].slice((flag + "=").length);
    }
  }
  return undefined;
}

const owner = getArgValue("owner");
const name = getArgValue("name");
const pr = getArgValue("pr", "-F");

if (args[0] === "api" && args[1] === "graphql") {
  const query = getArgValue("query");

  if (query && query.includes("addPullRequestReviewThreadReply")) {
    process.stdout.write(JSON.stringify({
      data: {
        addPullRequestReviewThreadReply: {
          comment: { id: "comment-1", body: getArgValue("body") || "" }
        }
      }
    }));
    process.exit(0);
  }

  if (query && query.includes("resolveReviewThread")) {
    process.stdout.write(JSON.stringify({
      data: {
        resolveReviewThread: {
          thread: { id: "thread-1", isResolved: true }
        }
      }
    }));
    process.exit(0);
  }

  if (owner === "missing" && name === "repo") {
    process.stdout.write(JSON.stringify({
      data: {
        repository: null
      }
    }));
    process.exit(0);
  }

  if (pr === "999999") {
    process.stdout.write(JSON.stringify({
      data: {
        repository: {
          pullRequest: null
        }
      }
    }));
    process.exit(0);
  }

  const after = getArgValue("after");

  if (after === "cursor-1") {
    process.stdout.write(JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: "thread-2",
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        author: { login: "bot" },
                        path: "b.md",
                        line: 20,
                        body: "second page",
                        url: "https://example.test/t2"
                      }
                    ]
                  }
                }
              ],
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            }
          }
        }
      }
    }));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "thread-1",
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      author: { login: "bot" },
                      path: "a.md",
                      line: 10,
                      body: "first page",
                      url: "https://example.test/t1"
                    }
                  ]
                }
              }
            ],
            pageInfo: {
              hasNextPage: true,
              endCursor: "cursor-1"
            }
          }
        }
      }
    }
  }));
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "checks") {
  const repoIndex = args.indexOf("-R");
  const repoValue = repoIndex >= 0 ? args[repoIndex + 1] : null;
  const expectedRepo = process.env.EXPECT_REPO || "hannasdev/mcp-writing";

  if (repoValue !== expectedRepo) {
    process.stderr.write("repo mismatch\\n");
    process.exit(3);
  }

  process.stdout.write("checks ok\\n");
  process.exit(0);
}

process.stderr.write("unsupported fake gh invocation\\n");
process.exit(2);
`;

  fs.writeFileSync(fakeGhPath, script, { mode: 0o755 });
  return fakeGhPath;
}

function runHelper(args, env = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-comments-helper-test-"));
  const binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  writeFakeGhBinary(binDir);

  const logPath = path.join(tmpDir, "gh.log");
  const result = spawnSync(
    process.execPath,
    [helperScriptPath, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        GH_LOG: logPath,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    }
  );

  const log = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { result, log };
}

describe("review-comments helper script", () => {
  test("list paginates review threads until hasNextPage=false", () => {
    const { result, log } = runHelper(["list", "--pr", "172"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /id: thread-1/);
    assert.match(result.stdout, /id: thread-2/);

    const graphqlCalls = log.filter((args) => args[0] === "api" && args[1] === "graphql");
    assert.equal(graphqlCalls.length, 2, "expected two paginated GraphQL calls");
  });

  test("status forwards --repo to gh pr checks -R", () => {
    const { result } = runHelper(
      ["status", "--pr", "172", "--repo", "acme/example-repo"],
      { EXPECT_REPO: "acme/example-repo" }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /unresolved threads: 2/);
  });

  test("resolve posts reply comment then resolves thread", () => {
    const { result, log } = runHelper(["resolve", "--pr", "172", "--id", "thread-1"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /commented: thread-1/);
    assert.match(result.stdout, /resolved: thread-1/);

    const graphqlCalls = log.filter((args) => args[0] === "api" && args[1] === "graphql");
    const hasReplyMutation = graphqlCalls.some((args) => args.some((arg) => typeof arg === "string" && arg.includes("addPullRequestReviewThreadReply")));
    const hasResolveMutation = graphqlCalls.some((args) => args.some((arg) => typeof arg === "string" && arg.includes("resolveReviewThread")));
    assert.equal(hasReplyMutation, true, "expected an addPullRequestReviewThreadReply mutation call");
    assert.equal(hasResolveMutation, true, "expected a resolveReviewThread mutation call");
  });

  test("resolve allows explicit no-comment mode", () => {
    const { result, log } = runHelper(["resolve", "--pr", "172", "--id", "thread-1", "--no-comment"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /commented:/);
    assert.match(result.stdout, /resolved: thread-1/);

    const graphqlCalls = log.filter((args) => args[0] === "api" && args[1] === "graphql");
    const hasReplyMutation = graphqlCalls.some((args) => args.some((arg) => typeof arg === "string" && arg.includes("addPullRequestReviewThreadReply")));
    assert.equal(hasReplyMutation, false, "did not expect addPullRequestReviewThreadReply in --no-comment mode");
  });

  test("resolve supports custom comment text", () => {
    const customComment = "Addressed in abc123. Added regression test.";
    const { result, log } = runHelper(["resolve", "--pr", "172", "--id", "thread-1", "--comment", customComment]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const graphqlCalls = log.filter((args) => args[0] === "api" && args[1] === "graphql");
    const replyCall = graphqlCalls.find((args) => args.some((arg) => typeof arg === "string" && arg.includes("addPullRequestReviewThreadReply")));
    assert.ok(replyCall, "expected addPullRequestReviewThreadReply call");
    assert.ok(replyCall.includes(`body=${customComment}`));
  });

  test("rejects malformed --pr values", () => {
    const { result } = runHelper(["list", "--pr", "172foo"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Provide a valid pull request number/);
  });

  test("rejects missing values when next token is another flag", () => {
    const { result } = runHelper(["resolve", "--pr", "172", "--id", "--repo", "hannasdev/mcp-writing"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing value for --id/);
  });

  test("rejects whitespace-only --id values", () => {
    const { result } = runHelper(["resolve", "--pr", "172", "--id", "   "]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Provide a non-empty thread id with --id <id>/);
  });

  test("rejects empty --ids payloads", () => {
    const { result } = runHelper(["resolve", "--pr", "172", "--ids", " , "]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Provide at least one thread id with --ids <id1,id2>/);
  });

  test("returns explicit repository-not-found errors", () => {
    const { result } = runHelper(["list", "--pr", "172", "--repo", "missing/repo"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Repository 'missing\/repo' was not found or is not accessible\./);
  });

  test("returns explicit pull-request-not-found errors", () => {
    const { result } = runHelper(["list", "--pr", "999999"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Pull request #999999 was not found in repository 'hannasdev\/mcp-writing'\./);
  });

  test("rejects --id flag with 'list' command", () => {
    const { result } = runHelper(["list", "--pr", "172", "--id", "thread-1"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--id, --ids, --comment, and --no-comment are not valid for 'list'/);
  });

  test("rejects --all flag with 'resolve' command", () => {
    const { result } = runHelper(["resolve", "--pr", "172", "--all"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--all is not valid for 'resolve'/);
  });

  test("requires --id or --ids for 'resolve' command", () => {
    const { result } = runHelper(["resolve", "--pr", "172"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /'resolve' requires --id/);
  });

  test("rejects --id and --all flags with 'status' command", () => {
    const { result } = runHelper(["status", "--pr", "172", "--id", "thread-1", "--all"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--id, --ids, --all, --comment, and --no-comment are not valid for 'status'/);
  });

  test("rejects --comment and --no-comment together", () => {
    const { result } = runHelper([
      "resolve",
      "--pr",
      "172",
      "--id",
      "thread-1",
      "--comment",
      "Addressed.",
      "--no-comment",
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--comment and --no-comment cannot be used together/);
  });
});
