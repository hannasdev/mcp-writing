#!/usr/bin/env node
/**
 * Import a Scrivener External Folder Sync output into mcp-writing sidecar format.
 *
 * Usage:
 *   node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [--project <id>] [--dry-run]
 */

import path from "node:path";
import { importScrivenerSync } from "../importer.js";

const args = process.argv.slice(2);
if (args.length < 2 || args[0] === "--help") {
  console.log("Usage: node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [--project <id>] [--dry-run]");
  process.exit(args[0] === "--help" ? 0 : 1);
}

const scrivenerDir = path.resolve(args[0]);
const mcpSyncDir = path.resolve(args[1]);
const dryRun = args.includes("--dry-run");
const projectIdx = args.indexOf("--project");
const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;

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
