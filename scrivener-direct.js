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

function slugifyPathSegment(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function chapterFolderName(chapter, chapterTitle) {
  if (chapter === null || chapter === undefined) return null;
  const suffix = slugifyPathSegment(chapterTitle);
  return suffix ? `chapter-${chapter}-${suffix}` : `chapter-${chapter}`;
}

function sceneContainerDir(scenesDir, part, chapter, chapterTitle, organizeByChapters = true) {
  const segments = [scenesDir];
  if (!organizeByChapters) {
    return path.join(...segments);
  }
  if (part !== null && part !== undefined) segments.push(`part-${part}`);
  const chapterDir = chapterFolderName(chapter, chapterTitle);
  if (chapterDir) segments.push(chapterDir);
  return path.join(...segments);
}

function findProsePathForSidecar(sidecarPath) {
  const proseCandidates = [
    sidecarPath.replace(/\.meta\.yaml$/, ".md"),
    sidecarPath.replace(/\.meta\.yaml$/, ".txt"),
  ];
  return proseCandidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function moveFileIfNeeded(fromPath, toPath) {
  if (!fromPath || fromPath === toPath) return;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  if (fs.existsSync(toPath)) {
    return {
      moved: false,
      warning: {
        code: "relocate_destination_exists",
        message: "Skipped moving prose file because destination already exists.",
        from_path: fromPath,
        to_path: toPath,
      },
    };
  }

  try {
    fs.renameSync(fromPath, toPath);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(fromPath, toPath);
    fs.unlinkSync(fromPath);
  }

  return { moved: true };
}

const KNOWN_CUSTOM_FIELD_IDS = new Set([
  "savethecat!",
  "causality",
  "stakes",
  "change",
  "f:character",
  "f:mood",
  "f:theme",
]);

const MAX_RETURNED_WARNINGS = 25;

function recordWarning(summary, warning) {
  if (!summary[warning.code]) {
    summary[warning.code] = { count: 0, examples: [] };
  }

  const entry = summary[warning.code];
  entry.count++;

  if (entry.examples.length < 5) {
    const example = { message: warning.message };
    for (const key of ["file", "sync_number", "field_id", "value", "uuid"]) {
      if (warning[key] !== undefined && warning[key] !== null) {
        example[key] = warning[key];
      }
    }
    entry.examples.push(example);
  }
}

function pushWarning(warnings, warningSummary, warning) {
  recordWarning(warningSummary, warning);

  if (warnings.length < MAX_RETURNED_WARNINGS) {
    warnings.push(warning);
    return false;
  }

  return true;
}

function buildMergeDataFromProject(projectData, uuid) {
  const { metaByUUID, partByUUID, chapterByUUID, chapterTitleByUUID } = projectData;
  const { customFields, tags, synopsis } = metaByUUID[uuid] ?? {};
  const part = partByUUID[uuid] ?? null;
  const chapter = chapterByUUID[uuid] ?? null;
  const chapterTitle = chapterTitleByUUID[uuid] ?? null;
  const warnings = [];

  if (!customFields && !tags && !synopsis && part === null && chapter === null && !chapterTitle) {
    return { mergeData: null, warnings };
  }

  const out = {};

  if (part !== null) out.part = part;
  if (chapter !== null) out.chapter = chapter;
  if (chapterTitle) out.chapter_title = chapterTitle;
  if (synopsis) out.synopsis = synopsis;
  if (tags?.length) out.tags = tags;

  for (const [fieldId, value] of Object.entries(customFields ?? {})) {
    if (!KNOWN_CUSTOM_FIELD_IDS.has(fieldId) && String(value ?? "").trim()) {
      warnings.push({
        code: "ignored_custom_field",
        message: `Ignored unsupported Scrivener custom field '${fieldId}'.`,
        field_id: fieldId,
        value: String(value),
        uuid,
      });
    }
  }

  const stcBeat = customFields?.["savethecat!"];
  if (stcBeat && typeof stcBeat === "string" && stcBeat.trim()) {
    out.save_the_cat_beat = stcBeat.trim();
  }

  const causalityRaw = customFields?.["causality"];
  const stakesRaw = customFields?.["stakes"];
  const causality = Number(causalityRaw ?? 0);
  const stakes = Number(stakesRaw ?? 0);
  if (causalityRaw !== undefined && String(causalityRaw).trim() && Number.isNaN(causality)) {
    warnings.push({
      code: "invalid_custom_field_value",
      message: "Ignored non-numeric Scrivener custom field value for 'causality'.",
      field_id: "causality",
      value: String(causalityRaw),
      uuid,
    });
  }
  if (stakesRaw !== undefined && String(stakesRaw).trim() && Number.isNaN(stakes)) {
    warnings.push({
      code: "invalid_custom_field_value",
      message: "Ignored non-numeric Scrivener custom field value for 'stakes'.",
      field_id: "stakes",
      value: String(stakesRaw),
      uuid,
    });
  }
  if (causality) out.causality = causality;
  if (stakes) out.stakes = stakes;

  const change = customFields?.["change"];
  if (change && String(change).trim()) out.scene_change = String(change).trim();

  const fnFlags = [];
  if (customFields?.["f:character"] === "Yes" || customFields?.["f:character"] === true) fnFlags.push("character");
  if (customFields?.["f:mood"] === "Yes" || customFields?.["f:mood"] === true) fnFlags.push("mood");
  if (customFields?.["f:theme"] === "Yes" || customFields?.["f:theme"] === true) fnFlags.push("theme");
  if (fnFlags.length) out.scene_functions = fnFlags;

  return {
    mergeData: Object.keys(out).length ? out : null,
    warnings,
  };
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
    const metaEl = children(item, "MetaData")[0];
    if (metaEl) {
      for (const mdItem of children(metaEl, "MetaDataItem")) {
        const fieldId = text(children(mdItem, "FieldID")[0]);
        const value = text(children(mdItem, "Value")[0]);
        if (fieldId !== null) customFields[fieldId] = value;
      }
    }

    const tags = [];
    const kwEl = children(item, "Keywords")[0];
    if (kwEl) {
      for (const kwId of children(kwEl, "KeywordID")) {
        const name = keywordMap[text(kwId)];
        if (!name) continue;
        tags.push(name);
      }
    }

    let synopsis = null;
    const synopsisFile = path.join(dataDir, uuid, "synopsis.txt");
    if (fs.existsSync(synopsisFile)) {
      const candidate = fs.readFileSync(synopsisFile, "utf8").trim();
      if (candidate) synopsis = candidate;
    }

    metaByUUID[uuid] = {
      customFields,
      tags: [...new Set(tags)],
      synopsis,
    };
  }

  const partByUUID = {};
  const chapterByUUID = {};
  const chapterTitleByUUID = {};
  let partNum = 0;
  let chapterNum = 0;

  function walkHierarchy(containerEl, currentPart, currentChapter) {
    for (const child of children(containerEl, "BinderItem")) {
      const uuid = attr(child, "UUID");
      const type = attr(child, "Type");
      const childrenEl = children(child, "Children")[0];
      const title = text(children(child, "Title")[0]);

      if (type === "Folder" && currentPart === null) {
        partNum++;
        if (childrenEl) walkHierarchy(childrenEl, { number: partNum, title }, null);
      } else if (type === "Folder") {
        chapterNum++;
        const nextChapter = { number: chapterNum, title };
        if (uuid) {
          if (currentPart?.number !== null && currentPart?.number !== undefined) {
            partByUUID[uuid] = currentPart.number;
          }
          chapterByUUID[uuid] = chapterNum;
          if (title) chapterTitleByUUID[uuid] = title;
        }
        if (childrenEl) walkHierarchy(childrenEl, currentPart, nextChapter);
      } else if (type === "Text") {
        if (uuid && currentChapter?.number !== null && currentChapter?.number !== undefined) {
          if (currentPart?.number !== null && currentPart?.number !== undefined) {
            partByUUID[uuid] = currentPart.number;
          }
          chapterByUUID[uuid] = currentChapter.number;
          if (currentChapter.title) chapterTitleByUUID[uuid] = currentChapter.title;
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
    chapterTitleByUUID,
  };
}

export function mergeScrivenerProjectMetadata({
  scrivPath,
  mcpSyncDir,
  projectId,
  scenesDir: scenesDirOverride,
  dryRun = false,
  organizeByChapters = false,
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
  let skippedNoBracketId = 0;
  let relocated = 0;
  const fieldAddCounts = {};
  const previewChanges = [];
  const warnings = [];
  const warningSummary = {};
  let warningsTruncated = false;

  for (const sidecarPath of sidecarFiles) {
    const filename = path.basename(sidecarPath);
    const prosePath = findProsePathForSidecar(sidecarPath);
    const match = filename.match(/\[(\d+)\]\.meta\.yaml$/);
    if (!match) {
      logger(`  SKIP  (no bracket ID) ${filename}`);
      skippedNoBracketId++;
      warningsTruncated = pushWarning(warnings, warningSummary, {
        code: "missing_bracket_id",
        message: "Skipped sidecar because filename does not include a Scrivener sync number in brackets.",
        file: filename,
      }) || warningsTruncated;
      continue;
    }

    const syncNum = match[1];
    const uuid = projectData.syncNumToUUID[syncNum];
    if (!uuid) {
      logger(`  SKIP  (no UUID for [${syncNum}]) ${filename}`);
      noData++;
      warningsTruncated = pushWarning(warnings, warningSummary, {
        code: "missing_uuid_mapping",
        message: `Skipped sidecar because Scrivener sync number [${syncNum}] has no UUID mapping in the project.`,
        file: filename,
        sync_number: syncNum,
      }) || warningsTruncated;
      continue;
    }

    const { mergeData, warnings: mergeWarnings } = buildMergeDataFromProject(projectData, uuid);
    for (const warning of mergeWarnings) {
      warningsTruncated = pushWarning(warnings, warningSummary, { ...warning, file: filename }) || warningsTruncated;
    }

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
    const effective = changed ? merged : existing;
    const targetDir = sceneContainerDir(
      scenesDir,
      effective.part ?? null,
      effective.chapter ?? null,
      effective.chapter_title ?? null,
      organizeByChapters,
    );
    const targetSidecarPath = organizeByChapters ? path.join(targetDir, filename) : sidecarPath;
    const targetProsePath = prosePath
      ? (organizeByChapters ? path.join(targetDir, path.basename(prosePath)) : prosePath)
      : null;
    const needsMove = path.resolve(sidecarPath) !== path.resolve(targetSidecarPath)
      || (prosePath && targetProsePath && path.resolve(prosePath) !== path.resolve(targetProsePath));

    if (!changed && !needsMove) {
      unchanged++;
      continue;
    }

    for (const key of newKeys) {
      fieldAddCounts[key] = (fieldAddCounts[key] ?? 0) + 1;
    }

    if (previewChanges.length < 25) {
      previewChanges.push({
        file: filename,
        added_keys: [...newKeys],
        ...(needsMove ? { moved_to: path.relative(scenesDir, targetSidecarPath) || filename } : {}),
      });
    }

    let didRelocate = false;

    if (dryRun) {
      logger(`  DRY   ${filename}`);
      for (const key of newKeys) {
        logger(`        + ${key}: ${JSON.stringify(mergeData[key]).slice(0, 80)}`);
      }
      if (needsMove) {
        logger(`        -> ${path.relative(scenesDir, targetSidecarPath) || filename}`);
      }
      didRelocate = needsMove;
    } else {
      let proseMoveWarning = null;
      let shouldRelocateSidecar = organizeByChapters;

      if (
        shouldRelocateSidecar
        && path.resolve(sidecarPath) !== path.resolve(targetSidecarPath)
        && fs.existsSync(targetSidecarPath)
      ) {
        shouldRelocateSidecar = false;
        warningsTruncated = pushWarning(
          warnings,
          warningSummary,
          {
            code: "relocate_sidecar_destination_exists",
            message: "Skipped relocating sidecar because destination already exists.",
            from_path: sidecarPath,
            to_path: targetSidecarPath,
            file: filename,
          }
        ) || warningsTruncated;
      }

      if (shouldRelocateSidecar && prosePath && targetProsePath) {
        const moveResult = moveFileIfNeeded(prosePath, targetProsePath);
        if (moveResult?.warning) {
          proseMoveWarning = moveResult.warning;
          shouldRelocateSidecar = false;
          warningsTruncated = pushWarning(
            warnings,
            warningSummary,
            {
              ...moveResult.warning,
              file: filename,
            }
          ) || warningsTruncated;
        }
      }

      const finalSidecarPath = shouldRelocateSidecar ? targetSidecarPath : sidecarPath;
      fs.mkdirSync(path.dirname(finalSidecarPath), { recursive: true });
      fs.writeFileSync(finalSidecarPath, yaml.dump(effective, { lineWidth: 120 }), "utf8");
      if (
        shouldRelocateSidecar
        && path.resolve(sidecarPath) !== path.resolve(targetSidecarPath)
        && fs.existsSync(sidecarPath)
      ) {
        fs.unlinkSync(sidecarPath);
      }

      const changes = [];
      if (newKeys.length) changes.push(`+${newKeys.join(", ")}`);
      if (needsMove && shouldRelocateSidecar) {
        changes.push(`moved to ${path.relative(scenesDir, targetSidecarPath) || filename}`);
      }
      if (proseMoveWarning) {
        changes.push("sidecar kept in place (prose move skipped)");
      }
      logger(`  OK    ${filename}${changes.length ? `  [${changes.join("; ")}]` : ""}`);
      didRelocate = needsMove && shouldRelocateSidecar;
    }
    if (didRelocate) relocated++;
    updated++;
  }

  logger(`\n${"─".repeat(50)}`);
  logger(`Updated:   ${updated} sidecars${dryRun ? " (dry run)" : ""}`);
  if (relocated) logger(`Relocated: ${relocated} scene file pair(s)`);
  logger(`Unchanged: ${unchanged} (already complete or no new data)`);
  if (skippedNoBracketId) logger(`Skipped:   ${skippedNoBracketId} (no bracket ID in filename)`);
  if (noData) logger(`No data:   ${noData} (no matching binder entry)`);

  return {
    scrivPath: projectData.scrivPath,
    mcpSyncDir: mcpSyncDirAbs,
    projectId: resolvedProjectId,
    scenesDir,
    dryRun: Boolean(dryRun),
    sidecarFiles: sidecarFiles.length,
    updated,
    relocated,
    unchanged,
    skippedNoBracketId,
    noData,
    fieldAddCounts,
    previewChanges,
    warnings,
    warningsTruncated,
    warningSummary,
    stats: {
      syncMapEntries: Object.keys(projectData.syncNumToUUID).length,
      keywordMapEntries: Object.keys(projectData.keywordMap).length,
      binderItems: Object.keys(projectData.metaByUUID).length,
      partChapterAssignments: Object.keys(projectData.chapterByUUID).length,
    },
  };
}
