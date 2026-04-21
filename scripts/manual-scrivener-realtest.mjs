import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { importScrivenerSync, validateProjectId } from "../importer.js";
import { mergeScrivenerProjectMetadata } from "../scrivener-direct.js";

function usage() {
  return [
    "Usage:",
    "  node scripts/manual-scrivener-realtest.mjs \\",
    "    --source-dir <external-sync-dir> \\",
    "    --scriv-path <copied-project.scriv> \\",
    "    --project-id <project|universe/project> [options]",
    "",
    "Keep large real-data test assets outside the repository so they cannot be",
    "accidentally committed. Example external storage location:",
    "  $HOME/.mcp-writing-manual-data/",
    "",
    "Options:",
    "  --help                  Show this help message.",
    "  --sync-dir <path>       Temp sync root to write into.",
    "                         Default: ./tmp/manual-realtest-sync",
    "  --sample-count <n>      Number of sample sidecars to include. Default: 5",
    "  --no-clean              Reuse existing sync dir instead of recreating it.",
    "",
    "Example:",
    "  npm run manual:realtest -- \\",
    "    --source-dir <path-to-external-sync-source> \\",
    "    --scriv-path <path-to-external-test-data>/<project-name>.scriv \\",
    "    --project-id <universe>/<project-name> \\",
    "    --sync-dir <path-to-external-test-data>/manual-realtest-sync",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    syncDir: "./tmp/manual-realtest-sync",
    sampleCount: 5,
    clean: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--source-dir") {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      options.sourceDir = argv[++index];
    } else if (arg === "--scriv-path") {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      options.scrivPath = argv[++index];
    } else if (arg === "--project-id") {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      options.projectId = argv[++index];
    } else if (arg === "--sync-dir") {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      options.syncDir = argv[++index];
    } else if (arg === "--sample-count") {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      const sampleCountValue = argv[++index];
      if (!/^\d+$/.test(sampleCountValue)) {
        throw new Error("--sample-count must be a positive integer.");
      }
      options.sampleCount = Number(sampleCountValue);
    } else if (arg === "--no-clean") {
      options.clean = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function validateOptions(options) {
  if (options.help) return;

  if (!options.sourceDir || !options.scrivPath || !options.projectId) {
    throw new Error("Missing required arguments: --source-dir, --scriv-path, --project-id are required.");
  }

  if (!Number.isInteger(options.sampleCount) || options.sampleCount < 1) {
    throw new Error("--sample-count must be a positive integer.");
  }
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

function isSafeToDeleteSync(syncDir) {
  const resolvedPath = path.resolve(syncDir);

  // Never delete root or home directory
  const parsed = path.parse(resolvedPath);
  if (resolvedPath === parsed.root || resolvedPath === path.resolve(process.env.HOME || os.homedir())) {
    return false;
  }

  // Allow deletion only if path contains a manual-realtest marker or is in ./tmp or /tmp
  const hasMarker = resolvedPath.includes("manual-realtest");
  
  // Check if in tmp directories with proper path boundary checking
  const localTmpDir = path.resolve("./tmp");
  const isInLocalTmp =
    resolvedPath === localTmpDir || resolvedPath.startsWith(localTmpDir + path.sep);
  const isInSystemTmp =
    resolvedPath === "/tmp" || resolvedPath.startsWith("/tmp" + path.sep);
  const inTmpDir = isInLocalTmp || isInSystemTmp;
  
  return hasMarker || inTmpDir;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    process.exit(0);
  }

  validateOptions(options);

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
    if (!isSafeToDeleteSync(syncDir)) {
      throw new Error(
        `Safety check failed: --sync-dir must contain 'manual-realtest' or be in ./tmp or /tmp. Got: ${syncDir}`
      );
    }
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

  
  // Use scenesDir from import_write result (the actual written path) instead of re-deriving
  const importWriteResult = report.tests.find((test) => test.name === "import_write" && test.ok)?.result;
  const scenesDir = importWriteResult?.scenesDir;
  
  const sidecars = scenesDir && fs.existsSync(scenesDir) ? walkSidecars(scenesDir) : [];
  report.sidecarCount = sidecars.length;
  report.sampleSidecars = sidecars
    .slice(0, options.sampleCount)
    .map((filePath) => path.relative(syncDir, filePath));

  const failures = report.tests.filter((test) => !test.ok);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(usage());
  process.exit(1);
}