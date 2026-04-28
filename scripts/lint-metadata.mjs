#!/usr/bin/env node
import path from "node:path";
import { lintMetadataInSyncDir } from "../src/sync/metadata-lint.js";

function parseArgs(argv) {
  const args = { syncDir: process.env.WRITING_SYNC_DIR ?? "./sync" };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if ((cur === "--sync-dir" || cur === "-d") && argv[i + 1]) {
      args.syncDir = argv[i + 1];
      i++;
    }
  }
  return args;
}

const { syncDir } = parseArgs(process.argv.slice(2));
const result = lintMetadataInSyncDir(syncDir);

process.stdout.write(`metadata lint: ${path.resolve(syncDir)}\n`);
process.stdout.write(`files checked: ${result.files_checked}\n`);
process.stdout.write(`errors: ${result.error_count}, warnings: ${result.warning_count}\n`);

for (const issue of [...result.errors, ...result.warnings]) {
  process.stdout.write(`[${issue.level}] ${issue.code} ${issue.file} :: ${issue.message}\n`);
}

if (!result.ok) process.exit(1);
