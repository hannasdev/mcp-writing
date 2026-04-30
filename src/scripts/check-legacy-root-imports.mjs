import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const SCAN_PATHS = ["src", "index.js"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs"]);
const LEGACY_ROOT_MODULES = new Set([
  "async-jobs.js",
  "async-progress.js",
  "db.js",
  "git.js",
  "helpers.js",
  "importer.js",
  "metadata-lint.js",
  "prose-styleguide.js",
  "prose-styleguide-drift.js",
  "prose-styleguide-skill.js",
  "review-bundles.js",
  "review-bundles-planner.js",
  "review-bundles-renderer.js",
  "review-bundles-writer.js",
  "runtime-diagnostics.js",
  "scene-character-batch.js",
  "scene-character-normalization.js",
  "scrivener-direct.js",
  "sync.js",
  "workflow-catalogue.js",
  "world-entity-templates.js",
]);

const findings = [];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function lineNumberForIndex(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function hasLegacyRootImport(specifier, importerPath) {
  if (!specifier || !specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importerPath), specifier);
  const relativeToRoot = toPosix(path.relative(ROOT, resolved));
  if (relativeToRoot.includes("/")) return false;
  return LEGACY_ROOT_MODULES.has(relativeToRoot);
}

function scanFile(absolutePath) {
  const source = fs.readFileSync(absolutePath, "utf8");
  const importRegex =
    /(?:\bfrom\s*["']([^"']+)["'])|(?:^\s*import\s*["']([^"']+)["'])|(?:\bimport\s*\(\s*["']([^"']+)["']\s*\))/gm;

  for (const match of source.matchAll(importRegex)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? null;
    if (!hasLegacyRootImport(specifier, absolutePath)) continue;
    findings.push({
      file: path.relative(ROOT, absolutePath),
      line: lineNumberForIndex(source, match.index ?? 0),
      specifier,
    });
  }
}

function walk(absolutePath) {
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      walk(path.join(absolutePath, entry.name));
    }
    return;
  }
  if (isSourceFile(absolutePath)) scanFile(absolutePath);
}

for (const relativePath of SCAN_PATHS) {
  const absolutePath = path.join(ROOT, relativePath);
  if (fs.existsSync(absolutePath)) {
    walk(absolutePath);
  }
}

if (findings.length > 0) {
  console.error("Found legacy root-module imports that should use src/** paths:");
  for (const finding of findings) {
    console.error(`- ${toPosix(finding.file)}:${finding.line} -> ${finding.specifier}`);
  }
  process.exit(1);
}

console.log("No legacy root-module imports found.");
