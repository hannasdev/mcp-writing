#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    pr: null,
    branch: null,
    deleteRemote: false,
    repo: "hannasdev/mcp-writing",
    help: false,
  };

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    args.help = true;
    return args;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--pr") {
      const value = argv[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("Provide --pr <number>.");
      }
      args.pr = Number.parseInt(value, 10);
      i += 1;
      continue;
    }
    if (token === "--branch") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Provide --branch <name>.");
      }
      args.branch = value;
      i += 1;
      continue;
    }
    if (token === "--delete-remote") {
      args.deleteRemote = true;
      continue;
    }

    if (token === "--repo") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--") || !value.includes("/")) {
        throw new Error("Provide --repo <owner/repo>.");
      }
      args.repo = value;
      i += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown flag: ${token}`);
    }

    throw new Error(`Unexpected argument: ${token}`);
  }

  if (!args.pr || !args.branch) {
    throw new Error("Missing required flags: --pr <number> --branch <name>");
  }

  return args;
}

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function formatExecError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const parts = [];
  if (error.message) parts.push(String(error.message));
  if (error.stderr) parts.push(String(error.stderr).trim());
  if (error.stdout) parts.push(String(error.stdout).trim());
  return parts.filter(Boolean).join("\n");
}

function runSoft(cmd, cmdArgs) {
  try {
    const output = run(cmd, cmdArgs);
    return { ok: true, output };
  } catch (error) {
    const message = formatExecError(error);
    return { ok: false, output: message };
  }
}

function printHelp() {
  console.log([
    "post-merge-cleanup.mjs",
    "",
    "Usage:",
    "  node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr <number> --branch <name> [--repo <owner/repo>] [--delete-remote]",
    "",
    "Examples:",
    "  node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr 185 --branch fix/beta-epigraph-export-format",
    "  node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr 185 --branch fix/beta-epigraph-export-format --repo hannasdev/mcp-writing",
    "  node skills/post-merge-cleanup/scripts/post-merge-cleanup.mjs --pr 185 --branch fix/beta-epigraph-export-format --delete-remote",
  ].join("\n"));
}

function assertPrMerged(pr, repo) {
  const raw = run("gh", [
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "state,mergedAt",
    "--jq",
    "{state: .state, mergedAt: .mergedAt}",
  ]);
  const parsed = JSON.parse(raw);
  if (parsed.state !== "MERGED" || !parsed.mergedAt) {
    throw new Error(`PR #${pr} is not merged. state=${parsed.state}, mergedAt=${parsed.mergedAt}`);
  }
  return parsed;
}

function ensureMainSynced() {
  run("git", ["switch", "main"]);
  run("git", ["fetch", "origin", "main"]);
  run("git", ["merge", "--ff-only", "origin/main"]);
}

function deleteLocalBranch(branch) {
  const result = runSoft("git", ["branch", "-d", branch]);
  if (!result.ok) {
    if (result.output.includes("not found") || result.output.includes("not exist")) {
      return "already-missing";
    }
    throw new Error(`Failed to delete local branch '${branch}' with -d. ${result.output}`);
  }
  return "deleted";
}

function deleteRemoteBranch(branch) {
  const result = runSoft("git", ["push", "origin", "--delete", branch]);
  if (!result.ok) {
    if (result.output.includes("remote ref does not exist")) {
      return "already-missing";
    }
    throw new Error(`Failed to delete remote branch '${branch}'. ${result.output}`);
  }
  return "deleted";
}

function getThreadStatus(pr, repo) {
  const text = run("node", [
    "skills/review-comment-resolution/scripts/review-comments.mjs",
    "list",
    "--pr",
    String(pr),
    "--repo",
    repo,
  ]);
  const match = text.match(/Threads shown:\s+(\d+)\s+\(unresolved\)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const prStatus = assertPrMerged(args.pr, args.repo);
  ensureMainSynced();
  const localDelete = deleteLocalBranch(args.branch);
  const remoteDelete = args.deleteRemote ? deleteRemoteBranch(args.branch) : "skipped";
  const unresolved = getThreadStatus(args.pr, args.repo);
  const currentBranch = run("git", ["branch", "--show-current"]);

  console.log([
    "Post-merge cleanup complete.",
    `PR #${args.pr}: ${prStatus.state} at ${prStatus.mergedAt}`,
    `Repository: ${args.repo}`,
    `Current branch: ${currentBranch}`,
    `Local branch cleanup (${args.branch}): ${localDelete}`,
    `Remote branch cleanup (${args.branch}): ${remoteDelete}`,
    `Unresolved review threads: ${unresolved ?? "unknown"}`,
  ].join("\n"));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`post-merge-cleanup failed: ${message}`);
  process.exit(1);
}
