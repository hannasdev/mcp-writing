import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import yaml from "js-yaml";
import { validateProjectId } from "./importer.js";

function attr(el, name) {
  return el?.getAttribute?.(name) ?? null;
}

function text(el) {
  return el?.textContent?.trim?.() ?? null;
}

function children(el, tag) {
  const out = [];
  if (!el?.childNodes) return out;
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && child.tagName === tag) out.push(child);
  }
  return out;
}

function walkYamls(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYamls(full, list);
    else if (entry.name.endsWith(".meta.yaml")) list.push(full);
  }
  return list;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildMergeDataFromProject(projectData, uuid) {
  const { metaByUUID, partByUUID, chapterByUUID } = projectData;
  const { customFields, characters, versions, synopsis } = metaByUUID[uuid] ?? {};
  const part = partByUUID[uuid] ?? null;
  const chapter = chapterByUUID[uuid] ?? null;

  if (!customFields && !characters && !versions && !synopsis && part === null && chapter === null) return null;

  const out = {};

  if (part !== null) out.part = part;
  if (chapter !== null) out.chapter = chapter;
  if (synopsis) out.synopsis = synopsis;
  if (characters?.length) out.characters = characters;
  if (versions?.length) out.versions = versions;

  const stcBeat = customFields?.["savethecat!"];
  if (stcBeat && typeof stcBeat === "string" && stcBeat.trim()) {
    out.save_the_cat_beat = stcBeat.trim();
  }

  const causality = Number(customFields?.["causality"] ?? 0);
  const stakes = Number(customFields?.["stakes"] ?? 0);
  if (causality) out.causality = causality;
  if (stakes) out.stakes = stakes;

  const change = customFields?.["change"];
  if (change && String(change).trim()) out.scene_change = String(change).trim();

  const fnFlags = [];
  if (customFields?.["f:character"] === "Yes" || customFields?.["f:character"] === true) fnFlags.push("character");
  if (customFields?.["f:mood"] === "Yes" || customFields?.["f:mood"] === true) fnFlags.push("mood");
  if (customFields?.["f:theme"] === "Yes" || customFields?.["f:theme"] === true) fnFlags.push("theme");
  if (fnFlags.length) out.scene_functions = fnFlags;

  return Object.keys(out).length ? out : null;
}

export function mergeSidecarData(existing, mergeData) {
  const merged = { ...existing };
  const newKeys = [];

  for (const [key, value] of Object.entries(mergeData)) {
    if (!(key in merged)) {
      merged[key] = value;
      newKeys.push(key);
    }
  }

  return {
    merged,
    changed: newKeys.length > 0,
    newKeys,
  };
}

export function loadScrivenerProjectData(scrivPath) {
  const scrivPathAbs = path.resolve(scrivPath);
  if (!fs.existsSync(scrivPathAbs)) {
    throw new Error(`Scrivener bundle not found: ${scrivPathAbs}`);
  }
  if (!fs.statSync(scrivPathAbs).isDirectory()) {
    throw new Error(`Scrivener bundle must be a directory: ${scrivPathAbs}`);
  }

  const scrivxFiles = fs.readdirSync(scrivPathAbs).filter(f => f.endsWith(".scrivx"));
  const scrivxFilesSorted = scrivxFiles.sort((a, b) => a.localeCompare(b));
  if (!scrivxFilesSorted.length) {
    throw new Error(`No .scrivx file found in ${scrivPathAbs}`);
  }

  const bundleName = path.parse(scrivPathAbs).name;
  const preferredScrivx =
    scrivxFilesSorted.find(f => path.parse(f).name.toLowerCase() === bundleName.toLowerCase())
    ?? scrivxFilesSorted[0];
  const scrivxPath = path.join(scrivPathAbs, preferredScrivx);
  const dataDir = path.join(scrivPathAbs, "Files", "Data");

  const xml = fs.readFileSync(scrivxPath, "utf8");
  const dom = new DOMParser().parseFromString(xml, "text/xml");

  const syncNumToUUID = {};
  for (const el of dom.getElementsByTagName("SyncItem")) {
    const uuid = attr(el, "ID");
    const num = text(el);
    if (uuid && num) syncNumToUUID[num] = uuid;
  }

  const keywordMap = {};
  for (const el of dom.getElementsByTagName("Keyword")) {
    const id = attr(el, "ID");
    const title = children(el, "Title")[0];
    if (id && title) keywordMap[id] = text(title);
  }

  const metaByUUID = {};
  for (const item of dom.getElementsByTagName("BinderItem")) {
    const uuid = attr(item, "UUID");
    if (!uuid) continue;

    const customFields = {};
    for (const mdItem of item.getElementsByTagName("MetaDataItem")) {
      const fieldId = text(children(mdItem, "FieldID")[0]);
      const value = text(children(mdItem, "Value")[0]);
      if (fieldId !== null) customFields[fieldId] = value;
    }

    const characters = [];
    const versions = [];
    const kwEl = children(item, "Keywords")[0];
    if (kwEl) {
      for (const kwId of children(kwEl, "KeywordID")) {
        const name = keywordMap[text(kwId)];
        if (!name) continue;
        if (/^v\d[\d.a-z]*$/i.test(name)) versions.push(name);
        else characters.push(name);
      }
    }

    let synopsis = null;
    const synopsisFile = path.join(dataDir, uuid, "synopsis.txt");
    if (fs.existsSync(synopsisFile)) {
      const candidate = fs.readFileSync(synopsisFile, "utf8").trim();
      if (candidate) synopsis = candidate;
    }

    metaByUUID[uuid] = { customFields, characters, versions, synopsis };
  }

  const partByUUID = {};
  const chapterByUUID = {};
  let partNum = 0;
  let chapterNum = 0;

  function walkHierarchy(containerEl, currentPart, currentChapter) {
    for (const child of children(containerEl, "BinderItem")) {
      const uuid = attr(child, "UUID");
      const type = attr(child, "Type");
      const childrenEl = children(child, "Children")[0];

      if (type === "Folder" && currentPart === null) {
        partNum++;
        if (childrenEl) walkHierarchy(childrenEl, partNum, null);
      } else if (type === "Folder") {
        chapterNum++;
        if (uuid) {
          partByUUID[uuid] = currentPart;
          chapterByUUID[uuid] = chapterNum;
        }
        if (childrenEl) walkHierarchy(childrenEl, currentPart, chapterNum);
      } else if (type === "Text") {
        if (uuid && currentChapter !== null) {
          partByUUID[uuid] = currentPart;
          chapterByUUID[uuid] = currentChapter;
        }
      }
    }
  }

  const binderEl = dom.getElementsByTagName("Binder")[0];
  if (binderEl) {
    for (const el of children(binderEl, "BinderItem")) {
      if (attr(el, "Type") === "DraftFolder") {
        const draftChildrenEl = children(el, "Children")[0];
        if (draftChildrenEl) walkHierarchy(draftChildrenEl, null, null);
        break;
      }
    }
  }

  return {
    scrivPath: scrivPathAbs,
    syncNumToUUID,
    keywordMap,
    metaByUUID,
    partByUUID,
    chapterByUUID,
  };
}

export function mergeScrivenerProjectMetadata({
  scrivPath,
  mcpSyncDir,
  projectId,
  scenesDir: scenesDirOverride,
  dryRun = false,
  logger = () => {},
}) {
  const mcpSyncDirAbs = path.resolve(mcpSyncDir);
  const resolvedProjectId = projectId
    ?? path.basename(mcpSyncDirAbs).replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  const projectIdCheck = validateProjectId(resolvedProjectId);
  if (!projectIdCheck.ok) {
    throw new Error(`Invalid project_id '${resolvedProjectId}': ${projectIdCheck.reason}`);
  }

  function deriveProjectRoot(pid) {
    if (pid.includes("/")) {
      const [universeId, projectSlug] = pid.split("/");
      return path.join(mcpSyncDirAbs, "universes", universeId, projectSlug);
    }
    return path.join(mcpSyncDirAbs, "projects", pid);
  }

  const scenesDir = scenesDirOverride
    ?? path.join(deriveProjectRoot(resolvedProjectId), "scenes");

  let scenesDirStat;
  try {
    scenesDirStat = fs.statSync(scenesDir);
  } catch {
    throw new Error(`Scenes directory not found or not a directory: ${scenesDir}`);
  }
  if (!scenesDirStat.isDirectory()) {
    throw new Error(`Scenes directory not found or not a directory: ${scenesDir}`);
  }

  const projectData = loadScrivenerProjectData(scrivPath);
  logger(`Sync map: ${Object.keys(projectData.syncNumToUUID).length} entries`);
  logger(`Keyword map: ${Object.keys(projectData.keywordMap).length} entries`);
  logger(`Binder items collected: ${Object.keys(projectData.metaByUUID).length}`);
  logger(`Part/chapter map: ${Object.keys(projectData.chapterByUUID).length} items assigned`);

  const sidecarFiles = walkYamls(scenesDir);
  logger(`\nScene sidecars to process: ${sidecarFiles.length}\n`);

  let updated = 0;
  let unchanged = 0;
  let noData = 0;
  const fieldAddCounts = {};
  const previewChanges = [];

  for (const sidecarPath of sidecarFiles) {
    const filename = path.basename(sidecarPath);
    const match = filename.match(/\[(\d+)\]\.meta\.yaml$/);
    if (!match) {
      logger(`  SKIP  (no bracket ID) ${filename}`);
      continue;
    }

    const syncNum = match[1];
    const uuid = projectData.syncNumToUUID[syncNum];
    if (!uuid) {
      logger(`  SKIP  (no UUID for [${syncNum}]) ${filename}`);
      noData++;
      continue;
    }

    const mergeData = buildMergeDataFromProject(projectData, uuid);
    if (!mergeData) {
      unchanged++;
      continue;
    }

    const existingRaw = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
    if (existingRaw !== null && existingRaw !== undefined && !isPlainObject(existingRaw)) {
      throw new Error(`Invalid sidecar YAML mapping at ${sidecarPath}`);
    }
    const existing = existingRaw ?? {};
    const { merged, changed, newKeys } = mergeSidecarData(existing, mergeData);

    if (!changed) {
      unchanged++;
      continue;
    }

    for (const key of newKeys) {
      fieldAddCounts[key] = (fieldAddCounts[key] ?? 0) + 1;
    }

    if (previewChanges.length < 25) {
      previewChanges.push({ file: filename, added_keys: [...newKeys] });
    }

    if (dryRun) {
      logger(`  DRY   ${filename}`);
      for (const key of newKeys) {
        logger(`        + ${key}: ${JSON.stringify(mergeData[key]).slice(0, 80)}`);
      }
    } else {
      fs.writeFileSync(sidecarPath, yaml.dump(merged, { lineWidth: 120 }), "utf8");
      logger(`  OK    ${filename}  [+${newKeys.join(", ")}]`);
    }
    updated++;
  }

  logger(`\n${"─".repeat(50)}`);
  logger(`Updated:   ${updated} sidecars${dryRun ? " (dry run)" : ""}`);
  logger(`Unchanged: ${unchanged} (already complete or no new data)`);
  if (noData) logger(`No data:   ${noData} (no matching binder entry)`);

  return {
    scrivPath: projectData.scrivPath,
    mcpSyncDir: mcpSyncDirAbs,
    projectId: resolvedProjectId,
    scenesDir,
    dryRun: Boolean(dryRun),
    sidecarFiles: sidecarFiles.length,
    updated,
    unchanged,
    noData,
    fieldAddCounts,
    previewChanges,
    stats: {
      syncMapEntries: Object.keys(projectData.syncNumToUUID).length,
      keywordMapEntries: Object.keys(projectData.keywordMap).length,
      binderItems: Object.keys(projectData.metaByUUID).length,
      partChapterAssignments: Object.keys(projectData.chapterByUUID).length,
    },
  };
}
