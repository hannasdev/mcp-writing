#!/usr/bin/env node
/**
 * Merge Scrivener project metadata into mcp-writing sidecar files.
 *
 * Usage:
 *   node scripts/merge-scrivx.js <path-to.scriv> <mcp-sync-dir> [options]
 *
 *   <path-to.scriv>   Path to the Scrivener .scriv bundle (the folder)
 *   <mcp-sync-dir>    The WRITING_SYNC_DIR root (e.g. ./sync)
 *
 * Options:
 *   --project <id>    Project ID (default: derived from mcp-sync-dir name)
 *   --dry-run         Show what would change without writing anything
 *
 * What it merges into scene sidecars:
 *   synopsis          - from Files/Data/<UUID>/synopsis.txt
 *   characters        - from Scrivener keywords (character names)
 *   save_the_cat_beat - from the savethecat! custom field (if present)
  *   causality         - integer rating (0 = unset)
  *   stakes            - integer rating
  *   scene_change      - string value from the "change" custom field
  *   scene_functions   - array of active function flags: character, mood, theme
 *
 * Fields are only written if they have a meaningful value (non-empty, non-zero).
 * Existing sidecar values are preserved and not overwritten by this script.
 */

import path from "node:path";
import { mergeScrivenerProjectMetadata } from "../scrivener-direct.js";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length < 2 || args[0] === "--help") {
  console.log("Usage: node scripts/merge-scrivx.js <path-to.scriv> <mcp-sync-dir> [--project <id>] [--dry-run]");
  process.exit(args[0] === "--help" ? 0 : 1);
}

const scrivPath  = path.resolve(args[0]);
const mcpSyncDir = path.resolve(args[1]);
const dryRun     = args.includes("--dry-run");
const projectIdx = args.indexOf("--project");
const projectId  = projectIdx !== -1
  ? args[projectIdx + 1]
  : path.basename(mcpSyncDir).replace(/[^a-z0-9-]/gi, "-").toLowerCase();

try {
  mergeScrivenerProjectMetadata({
    scrivPath,
    mcpSyncDir,
    projectId,
    dryRun,
    logger: line => console.log(line),
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
