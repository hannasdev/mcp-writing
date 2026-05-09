#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    command: null,
    pr: null,
    ids: [],
    includeResolved: false,
    usedIdFlags: false,
    usedAllFlag: false,
    repo: "hannasdev/mcp-writing",
    comment: null,
    skipComment: false,
    sharedComment: false,
    commentsFile: null,
  };

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    return { ...args, command: "help" };
  }

  args.command = argv[0];

  function readFlagValue(flag, nextToken) {
    if (!nextToken || nextToken.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return nextToken;
  }

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--pr") {
      const value = readFlagValue("--pr", argv[i + 1]);
      if (!/^\d+$/.test(value)) {
        throw new Error("Provide a valid pull request number with --pr <number>");
      }
      args.pr = Number.parseInt(value, 10);
      i += 1;
      continue;
    }

    if (token === "--id") {
      const value = readFlagValue("--id", argv[i + 1]).trim();
      if (value.length === 0) {
        throw new Error("Provide a non-empty thread id with --id <id>");
      }
      args.ids.push(value);
      args.usedIdFlags = true;
      i += 1;
      continue;
    }

    if (token === "--ids") {
      const value = readFlagValue("--ids", argv[i + 1]);
      const parsed = value.split(",").map((part) => part.trim()).filter(Boolean);
      if (parsed.length === 0) {
        throw new Error("Provide at least one thread id with --ids <id1,id2>");
      }
      args.ids.push(...parsed);
      args.usedIdFlags = true;
      i += 1;
      continue;
    }

    if (token === "--all") {
      args.includeResolved = true;
      args.usedAllFlag = true;
      continue;
    }

    if (token === "--repo") {
      const value = readFlagValue("--repo", argv[i + 1]);
      args.repo = value;
      i += 1;
      continue;
    }

    if (token === "--comment") {
      const value = readFlagValue("--comment", argv[i + 1]);
      const trimmed = String(value).trim();
      if (trimmed.length === 0) {
        throw new Error("Provide a non-empty comment with --comment <text>");
      }
      args.comment = trimmed;
      i += 1;
      continue;
    }

    if (token === "--no-comment") {
      args.skipComment = true;
      continue;
    }

    if (token === "--shared-comment") {
      args.sharedComment = true;
      continue;
    }

    if (token === "--comments-file") {
      const value = readFlagValue("--comments-file", argv[i + 1]);
      args.commentsFile = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function ensurePrNumber(pr) {
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error("Provide a valid pull request number with --pr <number>");
  }
}

function parseRepo(repo) {
  const value = String(repo ?? "").trim();
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error("Provide repository as --repo <owner/name>");
  }
  return { owner: match[1], name: match[2] };
}

function runGhJson(args) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function fetchReviewThreads(pr, repo) {
  ensurePrNumber(pr);
  const { owner, name } = parseRepo(repo);

  const query = `query($owner:String!, $name:String!, $pr:Int!, $after:String) {
    repository(owner:$owner, name:$name) {
      pullRequest(number:$pr) {
        reviewThreads(first:100, after:$after) {
          nodes {
            id
            isResolved
            comments(first:20) {
              nodes {
                author { login }
                path
                line
                body
                url
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }`;

  const nodes = [];
  let after = null;

  while (true) {
    const ghArgs = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `pr=${pr}`,
    ];
    if (after) {
      ghArgs.push("-f", `after=${after}`);
    }

    const payload = runGhJson(ghArgs);
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const firstError = payload.errors[0];
      throw new Error(`GitHub GraphQL error: ${firstError?.message ?? "Unknown error"}`);
    }

    const repository = payload?.data?.repository;
    if (repository === null) {
      throw new Error(`Repository '${repo}' was not found or is not accessible.`);
    }

    const pullRequest = repository?.pullRequest;
    if (pullRequest === null) {
      throw new Error(`Pull request #${pr} was not found in repository '${repo}'.`);
    }

    const threadConnection = payload?.data?.repository?.pullRequest?.reviewThreads;
    const pageNodes = threadConnection?.nodes;
    if (!Array.isArray(pageNodes)) {
      throw new Error("Unexpected GraphQL response shape while reading review threads");
    }

    nodes.push(...pageNodes);

    const pageInfo = threadConnection?.pageInfo;
    if (!pageInfo?.hasNextPage) {
      break;
    }
    after = pageInfo.endCursor;
  }

  return nodes;
}

function summarizeBody(body) {
  const singleLine = String(body ?? "").replace(/\s+/g, " ").trim();
  if (singleLine.length <= 180) {
    return singleLine;
  }
  return `${singleLine.slice(0, 177)}...`;
}

function buildThreadContext(thread) {
  const first = thread?.comments?.nodes?.[0] ?? {};
  return {
    path: first.path ?? "n/a",
    line: first.line ?? "n/a",
    summary: summarizeBody(first.body ?? ""),
  };
}

function buildDefaultReplyForThread(thread) {
  const { path, line, summary } = buildThreadContext(thread);
  return [
    `Addressed thread feedback for ${path}:${line}.`,
    `What changed: implemented the requested update for this comment (${summary}).`,
    "Validation: ran targeted checks/tests for this change.",
    "Resolving this thread.",
  ].join(" ");
}

function loadCommentsFromFile(filePath, threadIds) {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse --comments-file JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--comments-file must contain a JSON object mapping thread id to comment text");
  }

  const commentById = new Map();
  for (const id of threadIds) {
    const value = parsed[id];
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      throw new Error(`--comments-file is missing a non-empty comment for thread ${id}`);
    }
    commentById.set(id, text);
  }
  return commentById;
}

function printThreads({ pr, includeResolved, repo }) {
  const threads = fetchReviewThreads(pr, repo);
  const filtered = includeResolved ? threads : threads.filter((thread) => !thread.isResolved);

  console.log(`PR #${pr}`);
  console.log(`Threads shown: ${filtered.length} (${includeResolved ? "all" : "unresolved"})`);

  if (filtered.length === 0) {
    return;
  }

  for (const thread of filtered) {
    const first = thread.comments?.nodes?.[0] ?? {};
    const state = thread.isResolved ? "resolved" : "unresolved";
    console.log("---");
    console.log(`id: ${thread.id}`);
    console.log(`state: ${state}`);
    console.log(`author: ${first.author?.login ?? "unknown"}`);
    console.log(`path: ${first.path ?? "n/a"}`);
    console.log(`line: ${first.line ?? "n/a"}`);
    console.log(`summary: ${summarizeBody(first.body)}`);
    console.log(`url: ${first.url ?? "n/a"}`);
  }
}

function resolveThread(threadId) {
  const mutation = "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}";
  const payload = runGhJson(["api", "graphql", "-f", `query=${mutation}`, "-f", `id=${threadId}`]);
  const resolved = payload?.data?.resolveReviewThread?.thread?.isResolved;
  if (resolved !== true) {
    throw new Error(`Failed to resolve thread ${threadId}`);
  }
}

function replyToThread(threadId, body) {
  const mutation = "mutation($threadId:ID!, $body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}){comment{id body}}}";
  const payload = runGhJson([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-f",
    `threadId=${threadId}`,
    "-f",
    `body=${body}`,
  ]);
  const createdId = payload?.data?.addPullRequestReviewThreadReply?.comment?.id;
  if (!createdId) {
    throw new Error(`Failed to add reply comment for thread ${threadId}`);
  }
}

function resolveThreads({ pr, ids, repo, comment, skipComment, sharedComment, commentsFile }) {
  ensurePrNumber(pr);
  if (ids.length === 0) {
    throw new Error("Provide at least one thread id using --id or --ids");
  }
  if (comment && skipComment) {
    throw new Error("--comment and --no-comment cannot be used together");
  }
  if (commentsFile && skipComment) {
    throw new Error("--comments-file and --no-comment cannot be used together");
  }
  if (comment && commentsFile) {
    throw new Error("--comment and --comments-file cannot be used together");
  }
  if (sharedComment && skipComment) {
    throw new Error("--shared-comment and --no-comment cannot be used together");
  }
  if (sharedComment && commentsFile) {
    throw new Error("--shared-comment cannot be used with --comments-file");
  }
  if (sharedComment && !comment) {
    throw new Error("--shared-comment requires --comment <text>");
  }

  const threads = fetchReviewThreads(pr, repo);
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const uniqueIds = [...new Set(ids)];

  const unknownIds = uniqueIds.filter((id) => !threadById.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Thread id(s) are not part of PR #${pr}: ${unknownIds.join(", ")}`);
  }

  const alreadyResolved = uniqueIds.filter((id) => threadById.get(id)?.isResolved);
  if (alreadyResolved.length > 0) {
    throw new Error(`Thread id(s) are already resolved on PR #${pr}: ${alreadyResolved.join(", ")}`);
  }

  const replyByThreadId = new Map();
  if (!skipComment) {
    if (commentsFile) {
      const loaded = loadCommentsFromFile(commentsFile, uniqueIds);
      for (const id of uniqueIds) {
        replyByThreadId.set(id, loaded.get(id));
      }
    } else if (comment && sharedComment) {
      for (const id of uniqueIds) {
        replyByThreadId.set(id, comment);
      }
    } else if (comment) {
      for (const id of uniqueIds) {
        const thread = threadById.get(id);
        const { path, line } = buildThreadContext(thread);
        replyByThreadId.set(
          id,
          `Addressed thread feedback for ${path}:${line}. What changed: ${comment} Validation: ran targeted checks/tests. Resolving this thread.`
        );
      }
    } else {
      for (const id of uniqueIds) {
        replyByThreadId.set(id, buildDefaultReplyForThread(threadById.get(id)));
      }
    }
  }

  for (const id of uniqueIds) {
    const replyComment = replyByThreadId.get(id);
    if (replyComment) {
      replyToThread(id, replyComment);
      console.log(`commented: ${id}`);
    }
    resolveThread(id);
    console.log(`resolved: ${id}`);
  }

  const unresolved = fetchReviewThreads(pr, repo).filter((thread) => !thread.isResolved).length;
  console.log(`remaining unresolved threads: ${unresolved}`);
}

function printStatus(pr, repo) {
  ensurePrNumber(pr);
  const unresolved = fetchReviewThreads(pr, repo).filter((thread) => !thread.isResolved).length;
  console.log(`unresolved threads: ${unresolved}`);

  const checks = spawnSync("gh", ["pr", "checks", String(pr), "-R", repo], {
    stdio: "inherit",
    shell: false,
  });

  if (checks.error) {
    throw checks.error;
  }

  if (checks.status !== 0) {
    throw new Error(`gh pr checks exited with status ${checks.status}`);
  }
}

function printHelp() {
  console.log("review-comments helper");
  console.log("");
  console.log("Usage:");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs list --pr <number> [--all] [--repo <owner/name>]");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr <number> --ids <id1,id2> [--comment <text>] [--shared-comment] [--comments-file <path.json>] [--no-comment] [--repo <owner/name>]");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr <number> --id <id1> --id <id2> [--comment <text>] [--shared-comment] [--comments-file <path.json>] [--no-comment] [--repo <owner/name>]");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs status --pr <number> [--repo <owner/name>]");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "list") {
    if (args.usedIdFlags || args.comment !== null || args.skipComment || args.sharedComment || args.commentsFile !== null) {
      throw new Error("--id, --ids, --comment, --shared-comment, --comments-file, and --no-comment are not valid for 'list'. Use 'list' to view threads.");
    }
    printThreads({ pr: args.pr, includeResolved: args.includeResolved, repo: args.repo });
    return;
  }

  if (args.command === "resolve") {
    if (args.usedAllFlag) {
      throw new Error("--all is not valid for 'resolve'. Use --id or --ids to specify threads to resolve.");
    }
    if (args.ids.length === 0) {
      throw new Error("'resolve' requires --id <id> or --ids <id1,id2>.");
    }
    resolveThreads({
      pr: args.pr,
      ids: args.ids,
      repo: args.repo,
      comment: args.comment,
      skipComment: args.skipComment,
      sharedComment: args.sharedComment,
      commentsFile: args.commentsFile,
    });
    return;
  }

  if (args.command === "status") {
    if (args.usedIdFlags || args.usedAllFlag || args.comment !== null || args.skipComment || args.sharedComment || args.commentsFile !== null) {
      throw new Error("--id, --ids, --all, --comment, --shared-comment, --comments-file, and --no-comment are not valid for 'status'. Use 'status' to view PR review state.");
    }
    printStatus(args.pr, args.repo);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
