import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export function validateProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return { ok: false, reason: "project_id must be a non-empty string." };
  }

  if (path.isAbsolute(projectId)) {
    return { ok: false, reason: "project_id must not be an absolute path." };
  }

  if (projectId.includes("\\")) {
    return { ok: false, reason: "project_id must not contain backslashes." };
  }

  const segments = projectId.split("/");
  if (segments.length < 1 || segments.length > 2) {
    return { ok: false, reason: "project_id must be '<project>' or '<universe>/<project>'." };
  }

  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      return { ok: false, reason: "project_id must not contain '.' or '..' path segments." };
    }
    if (!/^[a-z0-9-]+$/.test(segment)) {
      return { ok: false, reason: "project_id segments may contain only lowercase letters, numbers, and '-'." };
    }
  }

  return { ok: true };
}

// Parse "NNN Title [binder_id].txt" -> { seq, rawTitle, binderId, ext } or null
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

function resolveSyncRootFromPrefix(prefix, syncDirAbs) {
  const parsedRoot = path.parse(syncDirAbs).root;

  if (!prefix) {
    return parsedRoot ? path.resolve(parsedRoot) : path.resolve(syncDirAbs);
  }

  // On Windows, a regex prefix like "C:" would resolve relative to cwd on drive C.
  // Use the true drive root instead (e.g., "C:\\").
  if (/^[a-zA-Z]:$/.test(prefix)) {
    return parsedRoot || `${prefix}${path.sep}`;
  }

  return path.resolve(prefix);
}

function detectScopedSyncDir(syncDirAbs) {
  const normalized = syncDirAbs.split(path.sep).join("/");

  const universeMatch = normalized.match(/^(.*)\/universes\/([^/]+)\/([^/]+)(?:\/scenes)?$/);
  if (universeMatch) {
    const prefix = universeMatch[1];
    const universeId = universeMatch[2];
    const projectSlug = universeMatch[3];
    const syncRoot = resolveSyncRootFromPrefix(prefix, syncDirAbs);
    const projectRoot = path.join(syncRoot, "universes", universeId, projectSlug);
    return {
      projectId: `${universeId}/${projectSlug}`,
      scope: "universe",
      syncRoot,
      projectRoot,
    };
  }

  const projectMatch = normalized.match(/^(.*)\/projects\/([^/]+)(?:\/scenes)?$/);
  if (projectMatch) {
    const prefix = projectMatch[1];
    const projectSlug = projectMatch[2];
    const syncRoot = resolveSyncRootFromPrefix(prefix, syncDirAbs);
    const projectRoot = path.join(syncRoot, "projects", projectSlug);
    return {
      projectId: projectSlug,
      scope: "project",
      syncRoot,
      projectRoot,
    };
  }

  return null;
}

export function importScrivenerSync({
  scrivenerDir,
  mcpSyncDir,
  projectId,
  dryRun = false,
  preflight = false,
  ignorePatterns = [],
  logger = () => {},
}) {
  const scrivenerDirAbs = path.resolve(scrivenerDir);
  const mcpSyncDirAbs = path.resolve(mcpSyncDir);
  const scopedSyncDir = detectScopedSyncDir(mcpSyncDirAbs);
  const fallbackProjectId = path.basename(mcpSyncDirAbs).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const resolvedProjectId = projectId
    ? projectId
    : scopedSyncDir?.projectId ?? fallbackProjectId;

  const projectIdCheck = validateProjectId(resolvedProjectId);
  if (!projectIdCheck.ok) {
    throw new Error(`Invalid project_id '${resolvedProjectId}': ${projectIdCheck.reason}`);
  }

  if (scopedSyncDir && projectId && projectId !== scopedSyncDir.projectId) {
    throw new Error(
      `project_id '${projectId}' does not match WRITING_SYNC_DIR scope '${scopedSyncDir.projectId}'. `
      + "Set WRITING_SYNC_DIR to the sync root or use the matching project_id."
    );
  }

  if (!fs.existsSync(scrivenerDirAbs)) {
    throw new Error(`Scrivener sync dir not found: ${scrivenerDirAbs}`);
  }

  let scenesDir;
  let scenesBoundaryRoot;
  if (scopedSyncDir) {
    scenesBoundaryRoot = path.join(
      scopedSyncDir.syncRoot,
      scopedSyncDir.scope === "universe" ? "universes" : "projects"
    );
    scenesDir = path.join(scopedSyncDir.projectRoot, "scenes");
  } else {
    // Route universe/project IDs to universes/<universe>/<project>/scenes,
    // matching the convention used by inferProjectAndUniverse in sync.js.
    const segments = resolvedProjectId.split("/");
    if (segments.length === 2) {
      const [universeId, projectSlug] = segments;
      scenesBoundaryRoot = path.join(mcpSyncDirAbs, "universes");
      scenesDir = path.resolve(scenesBoundaryRoot, universeId, projectSlug, "scenes");
    } else {
      scenesBoundaryRoot = path.join(mcpSyncDirAbs, "projects");
      scenesDir = path.resolve(scenesBoundaryRoot, resolvedProjectId, "scenes");
    }
  }

  const relFromBoundary = path.relative(scenesBoundaryRoot, scenesDir);
  if (relFromBoundary.startsWith("..") || path.isAbsolute(relFromBoundary)) {
    throw new Error(`Invalid project_id '${resolvedProjectId}': resolved path escapes expected sync root.`);
  }
  const draftDir = path.join(scrivenerDirAbs, "Draft");
  const hasDraft = fs.existsSync(draftDir);
  const draftRoot = hasDraft ? draftDir : scrivenerDirAbs;

  const compiledIgnorePatterns = ignorePatterns.map(p => new RegExp(p));

  function isIgnored(filename) {
    return compiledIgnorePatterns.some(re => re.test(filename));
  }

  const rawFiles = walkSorted(draftRoot);
  const ignoredFiles = rawFiles.filter(f => isIgnored(path.basename(f)));
  const files = rawFiles.filter(f => !isIgnored(path.basename(f)));

  const existingScenes = buildExistingSceneIndex(scenesDir);

  let created = 0;
  let skipped = 0;
  let existing = 0;
  let beatMarkersSeen = 0;
  let beatCarry = null;

  if (preflight) {
    const previewFiles = files.map(f => path.relative(draftRoot, f));
    return {
      projectId: resolvedProjectId,
      scrivenerDir: scrivenerDirAbs,
      mcpSyncDir: mcpSyncDirAbs,
      scenesDir,
      preflight: true,
      dryRun: true,
      sourceFiles: rawFiles.length,
      ignoredFiles: ignoredFiles.length,
      ignoredFilenames: ignoredFiles.map(f => path.basename(f)),
      filesToProcess: files.length,
      filePreviews: previewFiles,
      existingSidecars: existingScenes.size,
      created: 0,
      existing: 0,
      skipped: 0,
      beatMarkersSeen: 0,
    };
  }

  if (!dryRun) {
    fs.mkdirSync(scenesDir, { recursive: true });
  }

  logger(`Project:   ${resolvedProjectId}`);
  logger(`Scenes to: ${scenesDir}`);
  logger(`Files:     ${files.length} (${ignoredFiles.length} ignored)`);
  logger("");

  for (const file of files) {
    const filename = path.basename(file);
    const parsed = parseFilename(filename);

    if (!parsed) {
      logger(`  SKIP  (unrecognised pattern) ${filename}`);
      skipped++;
      continue;
    }

    const { seq, rawTitle, binderId, ext } = parsed;
    const isEmpty = fs.statSync(file).size === 0;

    if (isBeatMarker(rawTitle)) {
      beatCarry = parseBeat(rawTitle);
      beatMarkersSeen++;
      logger(`  BEAT  "${beatCarry}"`);
      continue;
    }

    if (isEmpty) {
      logger(`  SKIP  (empty) ${filename}`);
      skipped++;
      continue;
    }

    if (isEpigraph(rawTitle)) {
      logger(`  SKIP  (epigraph) ${filename}`);
      skipped++;
      continue;
    }

    const title = cleanTitle(rawTitle);
    const existingScene = existingScenes.get(String(binderId)) ?? null;
    const sceneId = existingScene?.meta?.scene_id ?? makeSceneId(binderId, title);
    const destFile = path.join(scenesDir, `${seq.toString().padStart(3, "0")} ${rawTitle} [${binderId}].${ext}`);
    const sidecar = destFile.replace(/\.(txt|md)$/, ".meta.yaml");

    const meta = {
      ...(existingScene?.meta ?? {}),
      scene_id: sceneId,
      external_source: "scrivener",
      external_id: String(binderId),
      title,
      timeline_position: seq,
      ...(beatCarry ? { save_the_cat_beat: beatCarry } : {}),
    };

    if (!beatCarry && existingScene?.meta && Object.hasOwn(existingScene.meta, "save_the_cat_beat")) {
      delete meta.save_the_cat_beat;
    }

    if (dryRun) {
      logger(`  DRY   ${path.basename(sidecar)}`);
      if (existingScene) {
        logger(`        reconcile: binder ${binderId} -> existing scene_id ${sceneId}`);
      }
      logger(`        scene_id: ${sceneId}, beat: ${beatCarry ?? "(none)"}`);
    } else {
      fs.copyFileSync(file, destFile);
      fs.writeFileSync(sidecar, yaml.dump(meta, { lineWidth: 120 }), "utf8");

      if (existingScene) {
        if (existingScene.prosePath && existingScene.prosePath !== destFile) removeIfExists(existingScene.prosePath);
        if (existingScene.sidecarPath && existingScene.sidecarPath !== sidecar) removeIfExists(existingScene.sidecarPath);
        logger(`  OK    ${path.basename(sidecar)}  [reconciled binder ${binderId}, beat: ${beatCarry ?? "-"}]`);
      } else {
        logger(`  OK    ${path.basename(sidecar)}  [beat: ${beatCarry ?? "-"}]`);
      }

      existingScenes.set(String(binderId), {
        binderId: String(binderId),
        prosePath: destFile,
        sidecarPath: sidecar,
        meta,
      });
    }

    beatCarry = null;
    if (existingScene) existing++;
    else created++;
  }

  logger("");
  logger(`${"-".repeat(50)}`);
  logger(`Created:  ${created} sidecars${dryRun ? " (dry run)" : ""}`);
  logger(`Skipped:  ${skipped} (empty / epigraph / pattern)`);
  if (existing) logger(`Existing: ${existing} already had sidecars`);
  logger(`Beat markers seen: ${beatMarkersSeen}`);

  logger(`Non-draft content: manual`);
  logger(`  Place character/place/reference files directly in the target sync dir using the world/ folder conventions.`);

  return {
    projectId: resolvedProjectId,
    scrivenerDir: scrivenerDirAbs,
    mcpSyncDir: mcpSyncDirAbs,
    scenesDir,
    preflight: false,
    sourceFiles: rawFiles.length,
    ignoredFiles: ignoredFiles.length,
    created,
    skipped,
    existing,
    beatMarkersSeen,
    dryRun,
  };
}
