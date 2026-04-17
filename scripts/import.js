#!/usr/bin/env node
/**
 * Import a Scrivener External Folder Sync output into mcp-writing sidecar format.
 *
 * Usage:
 *   node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [options]
 *
 *   <scrivener-sync-dir>  The folder Scrivener syncs into (e.g. ./txt)
 *                         Only Draft/ is imported automatically.
 *   <mcp-sync-dir>        The WRITING_SYNC_DIR root (e.g. ./my-project-sync)
 *
 * Options:
 *   --project <id>    Project ID to assign (default: derived from mcp-sync-dir name)
 *   --dry-run         Show what would be created without writing anything
 *
 * What it does (Draft folder):
 *   - Walks the Draft dir in filename order (NNN prefix = current binder sequence)
 *   - Skips empty files (non-compilation title cards) and Epigraphs
 *   - Detects Save the Cat beat markers ("-Beat Name-" empty files) and carries
 *     the beat name forward to the next prose scene's sidecar
 *   - Creates mcp-sync-dir/projects/<project>/scenes/ structure
 *   - Reconciles existing imports by stable Scrivener binder ID (`[123]` in the filename)
 *   - Writes a .meta.yaml sidecar for each scene while preserving existing editorial metadata
 *
 * What it does not do:
 *   - It does not infer structure from Scrivener Notes/
 *   - Non-draft content should be placed manually into the target sync dir
 *     using the world/characters, world/places, and world/reference conventions
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length < 2 || args[0] === "--help") {
  console.log("Usage: node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [--project <id>] [--dry-run]");
  process.exit(args[0] === "--help" ? 0 : 1);
}

const scrivenerDir = path.resolve(args[0]);
const mcpSyncDir   = path.resolve(args[1]);
const dryRun       = args.includes("--dry-run");
const projectIdx   = args.indexOf("--project");
const projectId    = projectIdx !== -1
  ? args[projectIdx + 1]
  : path.basename(mcpSyncDir).replace(/[^a-z0-9-]/gi, "-").toLowerCase();

if (!fs.existsSync(scrivenerDir)) {
  console.error(`Scrivener sync dir not found: ${scrivenerDir}`);
  process.exit(1);
}

const scenesDir = path.join(mcpSyncDir, "projects", projectId, "scenes");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse "NNN Title [binder_id].txt" → { seq, rawTitle, binderId, ext } or null
function parseFilename(filename) {
  const m = filename.match(/^(\d+)\s+(.+?)\s*\[(\d+)\]\.(txt|md)$/);
  if (!m) return null;
  return {
    seq: parseInt(m[1], 10),
    rawTitle: m[2].trim(),
    binderId: m[3],
    ext: m[4],
  };
}

function isBeatMarker(rawTitle) {
  return /^-[^-].+-$/.test(rawTitle.trim());
}

function parseBeat(rawTitle) {
  return rawTitle.trim().replace(/^-/, "").replace(/-$/, "").trim();
}

function isEpigraph(rawTitle) {
  return /^epigraph$/i.test(rawTitle.trim());
}

function cleanTitle(rawTitle) {
  return rawTitle.replace(/^Scene\s+/i, "").trim();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, "") // strip emoji
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function makeSceneId(binderId, title) {
  return `sc-${String(binderId).padStart(3, "0")}-${slugify(title).slice(0, 40)}`;
}

// ---------------------------------------------------------------------------
// Walk a directory (sorted by filename = binder order, non-recursive)
// ---------------------------------------------------------------------------
function walkSorted(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && (entry.name.endsWith(".txt") || entry.name.endsWith(".md"))) {
      files.push(full);
    }
  }
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function loadYamlFile(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function buildExistingSceneIndex(dir) {
  const byBinderId = new Map();
  if (!fs.existsSync(dir)) return byBinderId;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".meta.yaml")) continue;

    const sidecarPath = path.join(dir, entry.name);
    const proseCandidates = [
      sidecarPath.replace(/\.meta\.yaml$/, ".txt"),
      sidecarPath.replace(/\.meta\.yaml$/, ".md"),
    ];
    const prosePath = proseCandidates.find(candidate => fs.existsSync(candidate)) ?? null;
    const proseName = prosePath ? path.basename(prosePath) : entry.name.replace(/\.meta\.yaml$/, ".txt");
    const parsedName = parseFilename(proseName);
    const meta = loadYamlFile(sidecarPath);
    const binderId = meta.external_source === "scrivener" && meta.external_id
      ? String(meta.external_id)
      : parsedName?.binderId ?? null;

    if (!binderId) continue;

    byBinderId.set(String(binderId), {
      binderId: String(binderId),
      prosePath,
      sidecarPath,
      meta,
    });
  }

  return byBinderId;
}

function removeIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const draftDir = path.join(scrivenerDir, "Draft");
const hasDraft = fs.existsSync(draftDir);

// If there's a Draft/ subdir use that; otherwise treat scrivenerDir as Draft directly
const draftRoot = hasDraft ? draftDir : scrivenerDir;

const files = walkSorted(draftRoot);
const existingScenes = buildExistingSceneIndex(scenesDir);
let created = 0;
let skipped = 0;
let alreadyDone = 0;
let beatCarry = null; // last seen beat marker

if (!dryRun) {
  fs.mkdirSync(scenesDir, { recursive: true });
}

console.log(`Project:   ${projectId}`);
console.log(`Scenes to: ${scenesDir}`);
console.log(`Files:     ${files.length}\n`);

for (const file of files) {
  const filename = path.basename(file);
  const parsed = parseFilename(filename);

  if (!parsed) {
    console.log(`  SKIP  (unrecognised pattern) ${filename}`);
    skipped++;
    continue;
  }

  const { seq, rawTitle, binderId, ext } = parsed;
  const isEmpty = fs.statSync(file).size === 0;

  // Beat markers: always empty, carry beat name forward
  if (isBeatMarker(rawTitle)) {
    beatCarry = parseBeat(rawTitle);
    console.log(`  BEAT  "${beatCarry}"`);
    continue;
  }

  // Empty non-beat files: title cards, chapter headers excluded from compilation
  if (isEmpty) {
    console.log(`  SKIP  (empty) ${filename}`);
    skipped++;
    continue;
  }

  // Epigraphs: have content but aren't scenes
  if (isEpigraph(rawTitle)) {
    console.log(`  SKIP  (epigraph) ${filename}`);
    skipped++;
    continue;
  }

  // Scene file — create sidecar
  const title = cleanTitle(rawTitle);
  const existing = existingScenes.get(String(binderId)) ?? null;
  const sceneId = existing?.meta?.scene_id ?? makeSceneId(binderId, title);
  const destFile = path.join(scenesDir, `${seq.toString().padStart(3, "0")} ${rawTitle} [${binderId}].${ext}`);
  const sidecar = destFile.replace(/\.(txt|md)$/, ".meta.yaml");

  const meta = {
    ...(existing?.meta ?? {}),
    scene_id: sceneId,
    external_source: "scrivener",
    external_id: String(binderId),
    title,
    timeline_position: seq,
    ...(beatCarry ? { save_the_cat_beat: beatCarry } : {}),
    // Placeholders — fill in after reviewing
    // part: null,
    // chapter: null,
    // pov: null,
    // logline: null,
    // characters: [],
    // places: [],
    // tags: [],
  };

  if (!beatCarry && existing?.meta && Object.hasOwn(existing.meta, "save_the_cat_beat")) {
    delete meta.save_the_cat_beat;
  }

  if (dryRun) {
    console.log(`  DRY   ${path.basename(sidecar)}`);
    if (existing) {
      console.log(`        reconcile: binder ${binderId} -> existing scene_id ${sceneId}`);
    }
    console.log(`        scene_id: ${sceneId}, beat: ${beatCarry ?? "(none)"}`);
  } else {
    // Copy/update prose file in mcp-sync-dir scenes folder
    fs.copyFileSync(file, destFile);
    fs.writeFileSync(sidecar, yaml.dump(meta, { lineWidth: 120 }), "utf8");

    if (existing) {
      if (existing.prosePath && existing.prosePath !== destFile) removeIfExists(existing.prosePath);
      if (existing.sidecarPath && existing.sidecarPath !== sidecar) removeIfExists(existing.sidecarPath);
      console.log(`  OK    ${path.basename(sidecar)}  [reconciled binder ${binderId}, beat: ${beatCarry ?? "—"}]`);
    } else {
      console.log(`  OK    ${path.basename(sidecar)}  [beat: ${beatCarry ?? "—"}]`);
    }
    existingScenes.set(String(binderId), { binderId: String(binderId), prosePath: destFile, sidecarPath: sidecar, meta });
  }

  beatCarry = null; // consumed
  if (existing) alreadyDone++;
  else created++;
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Created:  ${created} sidecars${dryRun ? " (dry run)" : ""}`);
console.log(`Skipped:  ${skipped} (empty / epigraph / pattern)`);
if (alreadyDone) console.log(`Existing: ${alreadyDone} already had sidecars`);

console.log(`Non-draft content: manual`);
console.log(`  Place character/place/reference files directly in the target sync dir using the world/ folder conventions.`);

if (!dryRun && created > 0) {
  console.log(`\nNext steps:`);
  console.log(`  1. Start the service:`);
  console.log(`       WRITING_SYNC_DIR=${mcpSyncDir} DB_PATH=./writing.db npm start`);
  console.log(`  2. Call the sync tool to index everything`);
  console.log(`  3. Review part/chapter/pov fields in sidecars as needed`);
}
