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
 *   change            - integer rating
 *   scene_functions   - array of active function flags: character, mood, theme
 *
 * Fields are only written if they have a meaningful value (non-empty, non-zero).
 * Existing sidecar values are preserved and not overwritten by this script.
 */

import fs   from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import yaml from "js-yaml";

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

if (!fs.existsSync(scrivPath)) {
  console.error(`Scrivener bundle not found: ${scrivPath}`);
  process.exit(1);
}

// Find the .scrivx file inside the bundle
const scrivxFiles = fs.readdirSync(scrivPath).filter(f => f.endsWith(".scrivx"));
if (!scrivxFiles.length) {
  console.error(`No .scrivx file found in ${scrivPath}`);
  process.exit(1);
}
const scrivxPath  = path.join(scrivPath, scrivxFiles[0]);
const dataDir     = path.join(scrivPath, "Files", "Data");

// ---------------------------------------------------------------------------
// Parse scrivx with a full DOM parser (handles deep recursive BinderItem nesting)
// ---------------------------------------------------------------------------
const xml = fs.readFileSync(scrivxPath, "utf8");
const dom = new DOMParser().parseFromString(xml, "text/xml");

function attr(el, name) { return el.getAttribute(name); }
function text(el)       { return el.textContent?.trim() ?? null; }
function children(el, tag) {
  const out = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && child.tagName === tag) out.push(child);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build ExternalSyncMap: fileNumber (string) → UUID
// ---------------------------------------------------------------------------
const syncNumToUUID = {};
for (const el of dom.getElementsByTagName("SyncItem")) {
  const uuid = attr(el, "ID");
  const num  = text(el);
  if (uuid && num) syncNumToUUID[num] = uuid;
}
console.log(`Sync map: ${Object.keys(syncNumToUUID).length} entries`);

// ---------------------------------------------------------------------------
// Build keyword map: ID (string) → name
// ---------------------------------------------------------------------------
const keywordMap = {};
for (const el of dom.getElementsByTagName("Keyword")) {
  const id    = attr(el, "ID");
  const title = children(el, "Title")[0];
  if (id && title) keywordMap[id] = text(title);
}
console.log(`Keyword map: ${Object.keys(keywordMap).length} entries`);

// ---------------------------------------------------------------------------
// Walk ALL BinderItems, collect metadata per UUID
// ---------------------------------------------------------------------------
const metaByUUID = {};

for (const item of dom.getElementsByTagName("BinderItem")) {
  const uuid = attr(item, "UUID");
  if (!uuid) continue;

  // Custom metadata fields
  const customFields = {};
  for (const mdItem of item.getElementsByTagName("MetaDataItem")) {
    const fieldId = text(children(mdItem, "FieldID")[0]);
    const value   = text(children(mdItem, "Value")[0]);
    if (fieldId !== null) customFields[fieldId] = value;
  }

  // Keywords → character names
  const characters = [];
  // Keywords are directly on this BinderItem, not child items
  const kwEl = children(item, "Keywords")[0];
  if (kwEl) {
    for (const kwId of children(kwEl, "KeywordID")) {
      const name = keywordMap[text(kwId)];
      if (name) characters.push(name);
    }
  }

  // Synopsis file
  let synopsis = null;
  const synopsisFile = path.join(dataDir, uuid, "synopsis.txt");
  if (fs.existsSync(synopsisFile)) {
    const t = fs.readFileSync(synopsisFile, "utf8").trim();
    if (t) synopsis = t;
  }

  metaByUUID[uuid] = { customFields, characters, synopsis };
}

console.log(`Binder items collected: ${Object.keys(metaByUUID).length}`);

// ---------------------------------------------------------------------------
// Build final lookup: syncNum (string) → enriched metadata
// ---------------------------------------------------------------------------
function buildMergeData(uuid) {
  const { customFields, characters, synopsis } = metaByUUID[uuid] ?? {};
  if (!customFields && !characters && !synopsis) return null;

  const out = {};

  if (synopsis) out.synopsis = synopsis;
  if (characters?.length) out.characters = characters;

  const stcBeat = customFields?.["savethecat!"];
  if (stcBeat && typeof stcBeat === "string" && stcBeat.trim()) {
    out.save_the_cat_beat = stcBeat.trim();
  }

  const causality = Number(customFields?.["causality"] ?? 0);
  const stakes    = Number(customFields?.["stakes"]    ?? 0);
  const change    = Number(customFields?.["change"]    ?? 0);
  if (causality) out.causality = causality;
  if (stakes)    out.stakes    = stakes;
  if (change)    out.change    = change;

  // Boolean function flags — collect the active ones into an array
  const fnFlags = [];
  if (customFields?.["f:character"] === "Yes" || customFields?.["f:character"] === true) fnFlags.push("character");
  if (customFields?.["f:mood"]      === "Yes" || customFields?.["f:mood"]      === true) fnFlags.push("mood");
  if (customFields?.["f:theme"]     === "Yes" || customFields?.["f:theme"]     === true) fnFlags.push("theme");
  if (fnFlags.length) out.scene_functions = fnFlags;

  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Walk existing sidecars in the scenes directory and merge
// ---------------------------------------------------------------------------
const scenesDir = path.join(mcpSyncDir, "projects", projectId, "scenes");
if (!fs.existsSync(scenesDir)) {
  console.error(`Scenes directory not found: ${scenesDir}`);
  process.exit(1);
}

// Collect all .meta.yaml files recursively
function walkYamls(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYamls(full, list);
    else if (entry.name.endsWith(".meta.yaml")) list.push(full);
  }
  return list;
}

const sidecarFiles = walkYamls(scenesDir);
console.log(`\nScene sidecars to process: ${sidecarFiles.length}\n`);

let updated = 0;
let unchanged = 0;
let noData = 0;

for (const sidecarPath of sidecarFiles) {
  const filename = path.basename(sidecarPath); // e.g. "001 Prologue [0].meta.yaml"
  const m = filename.match(/\[(\d+)\]\.meta\.yaml$/);
  if (!m) {
    console.log(`  SKIP  (no bracket ID) ${filename}`);
    continue;
  }

  const syncNum = m[1];
  const uuid = syncNumToUUID[syncNum];
  if (!uuid) {
    console.log(`  SKIP  (no UUID for [${syncNum}]) ${filename}`);
    noData++;
    continue;
  }

  const mergeData = buildMergeData(uuid);
  if (!mergeData) {
    unchanged++;
    continue;
  }

  // Read existing sidecar
  const existing = yaml.load(fs.readFileSync(sidecarPath, "utf8")) ?? {};

  // Merge: only add fields that don't already exist in the sidecar
  let changed = false;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(mergeData)) {
    if (!(key in merged)) {
      merged[key] = value;
      changed = true;
    }
  }

  if (!changed) {
    unchanged++;
    continue;
  }

  if (dryRun) {
    const newKeys = Object.keys(mergeData).filter(k => !(k in existing));
    console.log(`  DRY   ${filename}`);
    for (const k of newKeys) {
      const v = mergeData[k];
      console.log(`        + ${k}: ${JSON.stringify(v).slice(0, 80)}`);
    }
  } else {
    fs.writeFileSync(sidecarPath, yaml.dump(merged, { lineWidth: 120 }), "utf8");
    const newKeys = Object.keys(mergeData).filter(k => !(k in existing));
    console.log(`  OK    ${filename}  [+${newKeys.join(", ")}]`);
  }
  updated++;
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Updated:   ${updated} sidecars${dryRun ? " (dry run)" : ""}`);
console.log(`Unchanged: ${unchanged} (already complete or no new data)`);
if (noData) console.log(`No data:   ${noData} (no matching binder entry)`);
