#!/usr/bin/env node
/**
 * Import a Scrivener External Folder Sync output into mcp-writing sidecar format.
 *
 * Usage:
 *   node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [--project <id>] [--dry-run]
 */

import path from "node:path";
import { importScrivenerSync, validateProjectId } from "../importer.js";

function printUsage() {
  console.log("Usage: node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [--project <id>] [--dry-run]");
}

const args = process.argv.slice(2);
if (args.length < 2 || args[0] === "--help") {
  printUsage();
  process.exit(args[0] === "--help" ? 0 : 1);
}

const scrivenerDir = path.resolve(args[0]);
const mcpSyncDir = path.resolve(args[1]);
const dryRun = args.includes("--dry-run");
const projectIdx = args.indexOf("--project");
let projectId;
if (projectIdx !== -1) {
  const candidate = args[projectIdx + 1];
  if (!candidate || candidate.startsWith("--")) {
    console.error("Invalid --project value: expected a project id after --project.");
    printUsage();
    process.exit(1);
  }
  const projectIdCheck = validateProjectId(candidate);
  if (!projectIdCheck.ok) {
    console.error(`Invalid --project value '${candidate}': ${projectIdCheck.reason}`);
    printUsage();
    process.exit(1);
  }
  projectId = candidate;
}

try {
  const result = importScrivenerSync({
    scrivenerDir,
    mcpSyncDir,
    projectId,
    dryRun,
    logger: line => console.log(line),
  });

  if (!dryRun) {
    console.log("\nNext steps:");
    console.log("  1. Start the service:");
    console.log(`       WRITING_SYNC_DIR=${result.mcpSyncDir} DB_PATH=./writing.db npm start`);
    console.log("  2. Call the sync tool to index everything");
    console.log("  3. Review part/chapter/pov fields in sidecars as needed");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
