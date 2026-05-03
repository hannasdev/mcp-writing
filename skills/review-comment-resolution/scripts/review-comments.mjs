#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    command: null,
    pr: null,
    ids: [],
    includeResolved: false,
  };

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    return { ...args, command: "help" };
  }

  args.command = argv[0];

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--pr") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --pr");
      }
      args.pr = Number.parseInt(value, 10);
      i += 1;
      continue;
    }

    if (token === "--id") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --id");
      }
      args.ids.push(value);
      i += 1;
      continue;
    }

    if (token === "--ids") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --ids");
      }
      const parsed = value.split(",").map((part) => part.trim()).filter(Boolean);
      args.ids.push(...parsed);
      i += 1;
      continue;
    }

    if (token === "--all") {
      args.includeResolved = true;
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

function runGhJson(args) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function fetchReviewThreads(pr) {
  ensurePrNumber(pr);

  const query = `query { repository(owner: \"hannasdev\", name: \"mcp-writing\") { pullRequest(number:${pr}) { reviewThreads(first:100) { nodes { id isResolved comments(first:20) { nodes { author { login } path line body url } } } } } } }`;
  const payload = runGhJson(["api", "graphql", "-f", `query=${query}`]);

  const nodes = payload?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error("Unexpected GraphQL response shape while reading review threads");
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

function printThreads({ pr, includeResolved }) {
  const threads = fetchReviewThreads(pr);
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

function resolveThreads({ pr, ids }) {
  ensurePrNumber(pr);
  if (ids.length === 0) {
    throw new Error("Provide at least one thread id using --id or --ids");
  }

  const threads = fetchReviewThreads(pr);
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

  for (const id of uniqueIds) {
    resolveThread(id);
    console.log(`resolved: ${id}`);
  }

  const unresolved = fetchReviewThreads(pr).filter((thread) => !thread.isResolved).length;
  console.log(`remaining unresolved threads: ${unresolved}`);
}

function printStatus(pr) {
  ensurePrNumber(pr);
  const unresolved = fetchReviewThreads(pr).filter((thread) => !thread.isResolved).length;
  console.log(`unresolved threads: ${unresolved}`);

  const checks = spawnSync("gh", ["pr", "checks", String(pr)], {
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
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs list --pr <number> [--all]");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr <number> --ids <id1,id2>");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs resolve --pr <number> --id <id1> --id <id2>");
  console.log("  node skills/review-comment-resolution/scripts/review-comments.mjs status --pr <number>");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "list") {
    printThreads({ pr: args.pr, includeResolved: args.includeResolved });
    return;
  }

  if (args.command === "resolve") {
    resolveThreads({ pr: args.pr, ids: args.ids });
    return;
  }

  if (args.command === "status") {
    printStatus(args.pr);
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
