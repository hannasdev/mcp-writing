import fs from "node:fs";
import path from "node:path";
import { importScrivenerSync, validateProjectId } from "../importer.js";
import { mergeScrivenerProjectMetadata } from "../scrivener-direct.js";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/manual-scrivener-realtest.mjs \\",
      "    --source-dir <external-sync-dir> \\",
      "    --scriv-path <copied-project.scriv> \\",
      "    --project-id <project|universe/project> [options]",
      "",
      "Keep large real-data test assets outside the repository so they cannot be",
      "accidentally committed. Example external storage location:",
      "  /Users/hanna/.mcp-writing-manual-data/",
      "",
      "Options:",
      "  --sync-dir <path>       Temp sync root to write into.",
      "                         Default: ./tmp/manual-realtest-sync",
      "  --sample-count <n>      Number of sample sidecars to include. Default: 5",
      "  --no-clean              Reuse existing sync dir instead of recreating it.",
      "",
      "Example:",
      "  npm run manual:realtest -- \\",
      "    --source-dir /Users/hanna/Code/writing/universes/universe-1/book-1-the-lamb \\",
      "    --scriv-path /Users/hanna/.mcp-writing-manual-data/manual-test-data/Sebastian\\ the\\ Vampire.scriv \\",
      "    --project-id universe-1/book-1-the-lamb \\",
      "    --sync-dir /Users/hanna/.mcp-writing-manual-data/manual-realtest-sync",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    syncDir: "./tmp/manual-realtest-sync",
    sampleCount: 5,
    clean: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source-dir") options.sourceDir = argv[++index];
    else if (arg === "--scriv-path") options.scrivPath = argv[++index];
    else if (arg === "--project-id") options.projectId = argv[++index];
    else if (arg === "--sync-dir") options.syncDir = argv[++index];
    else if (arg === "--sample-count") options.sampleCount = parseInt(argv[++index], 10);
    else if (arg === "--no-clean") options.clean = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.sourceDir || !options.scrivPath || !options.projectId) {
    usage();
    throw new Error("Missing required arguments.");
  }

  if (!Number.isInteger(options.sampleCount) || options.sampleCount < 1) {
    throw new Error("--sample-count must be a positive integer.");
  }

  return options;
}

function walkSidecars(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSidecars(fullPath, out);
    else if (entry.name.endsWith(".meta.yaml")) out.push(fullPath);
  }
  return out;
}

function summarizeImport(result) {
  return {
    projectId: result.projectId,
    scenesDir: result.scenesDir,
    sourceFiles: result.sourceFiles,
    created: result.created,
    existing: result.existing,
    skipped: result.skipped,
    beatMarkersSeen: result.beatMarkersSeen,
    ignoredFiles: result.ignoredFiles,
    filesToProcess: result.filesToProcess,
    existingSidecars: result.existingSidecars,
    filePreviews: result.filePreviews,
    dryRun: result.dryRun,
    preflight: result.preflight,
  };
}

function summarizeMerge(result) {
  return {
    projectId: result.projectId,
    scenesDir: result.scenesDir,
    sidecarFiles: result.sidecarFiles,
    updated: result.updated,
    unchanged: result.unchanged,
    skippedNoBracketId: result.skippedNoBracketId,
    noData: result.noData,
    fieldAddCounts: result.fieldAddCounts,
    previewChanges: result.previewChanges,
    stats: result.stats,
  };
}

function runStep(name, fn) {
  try {
    return { name, ok: true, result: fn() };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectIdCheck = validateProjectId(options.projectId);
  if (!projectIdCheck.ok) {
    throw new Error(`Invalid --project-id '${options.projectId}': ${projectIdCheck.reason}`);
  }

  const syncDir = path.resolve(options.syncDir);
  const sourceDir = path.resolve(options.sourceDir);
  const scrivPath = path.resolve(options.scrivPath);

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`--source-dir not found or not a directory: ${sourceDir}`);
  }
  if (!fs.existsSync(scrivPath) || !fs.statSync(scrivPath).isDirectory()) {
    throw new Error(`--scriv-path not found or not a directory: ${scrivPath}`);
  }

  if (options.clean) {
    fs.rmSync(syncDir, { recursive: true, force: true });
  }
  fs.mkdirSync(syncDir, { recursive: true });

  const report = {
    syncDir,
    sourceDir,
    scrivPath,
    projectId: options.projectId,
    cleanStart: options.clean,
    tests: [],
  };

  report.tests.push(runStep("import_preflight", () => summarizeImport(importScrivenerSync({
    scrivenerDir: sourceDir,
    mcpSyncDir: syncDir,
    projectId: options.projectId,
    dryRun: true,
    preflight: true,
  }))));

  report.tests.push(runStep("import_write", () => summarizeImport(importScrivenerSync({
    scrivenerDir: sourceDir,
    mcpSyncDir: syncDir,
    projectId: options.projectId,
    dryRun: false,
    preflight: false,
  }))));

  report.tests.push(runStep("merge_dry_run", () => summarizeMerge(mergeScrivenerProjectMetadata({
    scrivPath,
    mcpSyncDir: syncDir,
    projectId: options.projectId,
    dryRun: true,
  }))));

  report.tests.push(runStep("merge_write", () => summarizeMerge(mergeScrivenerProjectMetadata({
    scrivPath,
    mcpSyncDir: syncDir,
    projectId: options.projectId,
    dryRun: false,
  }))));

  const scenesDir = options.projectId.includes("/")
    ? path.join(syncDir, "universes", ...options.projectId.split("/"), "scenes")
    : path.join(syncDir, "projects", options.projectId, "scenes");

  const sidecars = fs.existsSync(scenesDir) ? walkSidecars(scenesDir) : [];
  report.sidecarCount = sidecars.length;
  report.sampleSidecars = sidecars
    .slice(0, options.sampleCount)
    .map((filePath) => path.relative(syncDir, filePath));

  const failures = report.tests.filter((test) => !test.ok);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

main();