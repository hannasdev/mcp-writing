#!/usr/bin/env node
/**
 * Import a Scrivener External Folder Sync output into mcp-writing sidecar format.
 *
 * Usage:
 *   node scripts/import.js <scrivener-sync-dir> <mcp-sync-dir> [options]
 *
 *   <scrivener-sync-dir>  The folder Scrivener syncs into (e.g. ./txt)
 *   <mcp-sync-dir>        The WRITING_SYNC_DIR root (e.g. ./my-project-sync)
 *
 * Options:
 *   --project <id>    Project ID to assign (default: derived from mcp-sync-dir name)
 *   --dry-run         Show what would be created without writing anything
 *
 * What it does:
 *   - Walks the Scrivener sync dir in filename order (NNN prefix = binder sequence)
 *   - Skips empty files (non-compilation title cards) and Epigraphs
 *   - Detects Save the Cat beat markers ("-Beat Name-" empty files) and carries
 *     the beat name forward to the next prose scene's sidecar
 *   - Creates the mcp-sync-dir/projects/<project>/scenes/ structure
 *   - Writes a .meta.yaml sidecar for each scene (skips files that already have one)
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

// Parse "NNN Title [binder_id].txt" → { seq, rawTitle } or null
function parseFilename(filename) {
  const m = filename.match(/^(\d+)\s+(.+?)\s*\[\d+\]\.(txt|md)$/);
  if (!m) return null;
  return { seq: parseInt(m[1], 10), rawTitle: m[2].trim() };
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

function makeSceneId(seq, title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `sc-${String(seq).padStart(3, "0")}-${slug}`;
}

// ---------------------------------------------------------------------------
// Walk Scrivener sync dir (sorted by filename = binder order)
// ---------------------------------------------------------------------------
function walkSorted(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSorted(full).forEach(f => files.push(f));
    else if (entry.name.endsWith(".txt") || entry.name.endsWith(".md")) files.push(full);
  }
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const files = walkSorted(scrivenerDir);
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

  const { seq, rawTitle } = parsed;
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
  const title    = cleanTitle(rawTitle);
  const sceneId  = makeSceneId(seq, title);
  const destFile = path.join(scenesDir, filename);
  const sidecar  = destFile.replace(/\.(txt|md)$/, ".meta.yaml");

  if (fs.existsSync(sidecar)) {
    console.log(`  SKIP  (sidecar exists) ${filename}`);
    alreadyDone++;
    beatCarry = null; // beat was consumed by an existing scene
    continue;
  }

  const meta = {
    scene_id: sceneId,
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

  if (dryRun) {
    console.log(`  DRY   ${path.basename(sidecar)}`);
    console.log(`        scene_id: ${sceneId}, beat: ${beatCarry ?? "(none)"}`);
  } else {
    // Copy prose file into mcp-sync-dir scenes folder
    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(file, destFile);
    }
    fs.writeFileSync(sidecar, yaml.dump(meta, { lineWidth: 120 }), "utf8");
    console.log(`  OK    ${path.basename(sidecar)}  [beat: ${beatCarry ?? "—"}]`);
  }

  beatCarry = null; // consumed
  created++;
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Created:  ${created} sidecars${dryRun ? " (dry run)" : ""}`);
console.log(`Skipped:  ${skipped} (empty / epigraph / pattern)`);
if (alreadyDone) console.log(`Existing: ${alreadyDone} already had sidecars`);

if (!dryRun && created > 0) {
  console.log(`\nNext steps:`);
  console.log(`  1. Start the service:`);
  console.log(`       WRITING_SYNC_DIR=${mcpSyncDir} DB_PATH=./writing.db npm start`);
  console.log(`  2. Call the sync tool to index everything`);
  console.log(`  3. Review part/chapter/pov fields in sidecars as needed`);
}
