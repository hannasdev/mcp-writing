import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import yaml from "js-yaml";
import { sidecarPath, syncAll } from "../sync/sync.js";
import {
  slugifyEntityName,
  renderCharacterSheetTemplate,
  renderPlaceSheetTemplate,
  renderCharacterArcTemplate,
} from "../world/world-entity-templates.js";
import { ReviewBundlePlanError } from "../review-bundles/review-bundles.js";

export function deriveLoglineFromProse(prose) {
  const compact = prose.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const sentence = compact.match(/^(.+?[.!?])(?:\s|$)/);
  const candidate = (sentence?.[1] ?? compact).trim();
  if (candidate.length <= 220) return candidate;
  return `${candidate.slice(0, 217).trimEnd()}...`;
}

export function inferCharacterIdsFromProse(dbHandle, prose, projectId) {
  const lower = prose.toLowerCase();
  const rows = dbHandle.prepare(`
    SELECT character_id, name
    FROM characters
    WHERE project_id = ? OR universe_id = (SELECT universe_id FROM projects WHERE project_id = ?)
    ORDER BY length(name) DESC
  `).all(projectId, projectId);

  const found = [];
  for (const row of rows) {
    if (!row.name) continue;
    const words = row.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && words.every(w => lower.includes(w))) {
      found.push(row.character_id);
    }
  }
  return [...new Set(found)].slice(0, 12);
}

export function readSupportingNotesForEntity(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext).toLowerCase();
  if (base !== "sheet") return [];

  const dir = path.dirname(filePath);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /\.(md|txt)$/i.test(name))
    .filter(name => !/^sheet\.(md|txt)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map(name => {
      const notePath = path.join(dir, name);
      try {
        const raw = fs.readFileSync(notePath, "utf8");
        const { content } = matter(raw);
        return {
          file_name: name,
          content: content.trim(),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(note => note.content);
}

export function readEntityMetadata(filePath) {
  const metaPath = sidecarPath(filePath);
  if (fs.existsSync(metaPath)) {
    try {
      return yaml.load(fs.readFileSync(metaPath, "utf8")) ?? {};
    } catch {
      return {};
    }
  }

  try {
    return matter(fs.readFileSync(filePath, "utf8")).data ?? {};
  } catch {
    return {};
  }
}

export function resolveBatchTargetScenes(dbHandle, {
  projectId,
  sceneIds,
  part,
  chapter,
  onlyStale,
}) {
  const projectExists = Boolean(
    dbHandle.prepare(`SELECT 1 FROM projects WHERE project_id = ? LIMIT 1`).get(projectId)
  );

  if (sceneIds?.length) {
    const placeholders = sceneIds.map(() => "?").join(",");
    const existingRows = dbHandle.prepare(
      `SELECT scene_id FROM scenes WHERE project_id = ? AND scene_id IN (${placeholders})`
    ).all(projectId, ...sceneIds);
    const existing = new Set(existingRows.map(row => row.scene_id));
    const missing = sceneIds.filter(sceneId => !existing.has(sceneId));
    if (missing.length > 0) {
      return { ok: false, code: "NOT_FOUND", message: `Requested scene IDs were not found in project '${projectId}'.`, details: { missing_scene_ids: missing, project_id: projectId } };
    }
  }

  const conditions = ["project_id = ?"];
  const params = [projectId];

  if (sceneIds?.length) {
    const placeholders = sceneIds.map(() => "?").join(",");
    conditions.push(`scene_id IN (${placeholders})`);
    params.push(...sceneIds);
  }
  if (part !== undefined) {
    conditions.push("part = ?");
    params.push(part);
  }
  if (chapter !== undefined) {
    conditions.push("chapter = ?");
    params.push(chapter);
  }
  if (onlyStale) {
    conditions.push("metadata_stale = 1");
  }

  const query = `
    SELECT scene_id, project_id, file_path
    FROM scenes
    WHERE ${conditions.join(" AND ")}
    ORDER BY part, chapter, timeline_position
  `;

  return {
    ok: true,
    rows: dbHandle.prepare(query).all(...params),
    project_exists: projectExists,
  };
}

export function createHelpers({ syncDir, syncDirReal, syncDirAbs, db, syncDirWritable }) {
  function isPathInsideSyncDir(candidatePath) {
    const resolvedCandidate = path.resolve(candidatePath);
    const canonicalCandidate = (() => {
      try {
        return fs.realpathSync(resolvedCandidate);
      } catch {
        return resolvedCandidate;
      }
    })();

    const rel = path.relative(syncDirReal, canonicalCandidate);
    return !(rel.startsWith("..") || path.isAbsolute(rel));
  }

  // Like isPathInsideSyncDir, but works for paths that do not yet exist by
  // walking up to the nearest existing ancestor before canonicalising.
  function isPathCandidateInsideSyncDir(candidatePath) {
    const resolvedCandidate = path.resolve(candidatePath);

    let existingAncestor = resolvedCandidate;
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) break;
      existingAncestor = parent;
    }

    const canonicalBase = (() => {
      try {
        return fs.realpathSync(existingAncestor);
      } catch {
        return existingAncestor;
      }
    })();

    const canonical = path.resolve(canonicalBase, path.relative(existingAncestor, resolvedCandidate));
    const rel = path.relative(syncDirReal, canonical);
    return !(rel.startsWith("..") || path.isAbsolute(rel));
  }

  function resolveOutputDirWithinSync(outputDir) {
    let resolvedOutputDir = path.resolve(outputDir);
    let existingAncestor = resolvedOutputDir;

    while (!fs.existsSync(existingAncestor)) {
      const parentDir = path.dirname(existingAncestor);
      if (parentDir === existingAncestor) {
        throw new ReviewBundlePlanError(
          "INVALID_OUTPUT_DIR",
          "output_dir must be inside WRITING_SYNC_DIR.",
          { output_dir: resolvedOutputDir, sync_dir: syncDirAbs }
        );
      }
      existingAncestor = parentDir;
    }

    let realExistingAncestor;
    try {
      realExistingAncestor = fs.realpathSync.native(existingAncestor);
    } catch (err) {
      throw new ReviewBundlePlanError(
        "INVALID_OUTPUT_DIR",
        "output_dir ancestor could not be resolved: path may be inaccessible.",
        { output_dir: outputDir, existing_ancestor: existingAncestor, cause: err.message }
      );
    }
    const relativeFromAncestor = path.relative(existingAncestor, resolvedOutputDir);
    resolvedOutputDir = path.resolve(realExistingAncestor, relativeFromAncestor);

    const relativeToSyncDir = path.relative(syncDirReal, resolvedOutputDir);
    if (relativeToSyncDir.startsWith("..") || path.isAbsolute(relativeToSyncDir)) {
      throw new ReviewBundlePlanError(
        "INVALID_OUTPUT_DIR",
        "output_dir must be inside WRITING_SYNC_DIR.",
        { output_dir: resolvedOutputDir, sync_dir: syncDirAbs }
      );
    }

    return { resolvedOutputDir, relativeToSyncDir };
  }

  function resolveProjectRoot(projectId) {
    if (projectId.includes("/")) {
      const [universeId, projectSlug] = projectId.split("/");
      return path.join(syncDir, "universes", universeId, projectSlug);
    }
    return path.join(syncDir, "projects", projectId);
  }

  function resolveWorldEntityDir({ kind, projectId, universeId, name }) {
    const slug = slugifyEntityName(name);
    const baseDir = projectId
      ? path.join(resolveProjectRoot(projectId), "world")
      : path.join(syncDir, "universes", universeId, "world");
    const bucket = kind === "character" ? "characters" : "places";
    return {
      slug,
      dir: path.join(baseDir, bucket, slug),
    };
  }

  function createCanonicalWorldEntity({ kind, name, notes, projectId, universeId, meta }) {
    const prefix = kind === "character" ? "char" : "place";
    const idKey = kind === "character" ? "character_id" : "place_id";
    const slug = slugifyEntityName(name);
    if (!slug) throw new Error("Name must contain at least one alphanumeric character.");

    const { dir } = resolveWorldEntityDir({ kind, projectId, universeId, name });
    const prosePath = path.join(dir, "sheet.md");
    const metaPath = sidecarPath(prosePath);
    const hadProse = fs.existsSync(prosePath);
    const hadMeta = fs.existsSync(metaPath);

    let shouldWriteMeta = !hadMeta;
    let payload;
    const derivedId = `${prefix}-${slug}`;
    if (hadMeta) {
      let parsedMeta;
      try {
        parsedMeta = yaml.load(fs.readFileSync(metaPath, "utf8"));
      } catch (err) {
        throw new Error(
          `Existing metadata sidecar is invalid YAML at ${metaPath}: ${err.message}`,
          { cause: err }
        );
      }

      if (parsedMeta != null && (typeof parsedMeta !== "object" || Array.isArray(parsedMeta))) {
        throw new Error(`Existing metadata sidecar must be a YAML mapping at ${metaPath}.`);
      }

      const existingMeta = parsedMeta ?? {};

      const backfilledId = existingMeta[idKey] ?? derivedId;
      const backfilledName = existingMeta.name ?? name;
      shouldWriteMeta = existingMeta[idKey] == null || existingMeta.name == null;
      payload = shouldWriteMeta
        ? {
          ...existingMeta,
          [idKey]: backfilledId,
          name: backfilledName,
        }
        : existingMeta;
    } else {
      payload = {
        [idKey]: derivedId,
        name,
        ...(meta ?? {}),
      };
    }

    fs.mkdirSync(dir, { recursive: true });

    if (!hadProse) {
      const defaultSheet = kind === "character"
        ? renderCharacterSheetTemplate(name)
        : renderPlaceSheetTemplate(name);
      const body = notes?.trim() ?? defaultSheet;
      fs.writeFileSync(prosePath, `${body}${body ? "\n" : ""}`, "utf8");
    }

    if (kind === "character") {
      const arcPath = path.join(dir, "arc.md");
      if (!fs.existsSync(arcPath)) {
        fs.writeFileSync(arcPath, `${renderCharacterArcTemplate(name)}\n`, "utf8");
      }
    }

    if (shouldWriteMeta) {
      fs.writeFileSync(metaPath, yaml.dump(payload, { lineWidth: 120 }), "utf8");
    }

    syncAll(db, syncDir, { writable: syncDirWritable });

    return {
      created: !hadProse && !hadMeta,
      id: payload[idKey],
      prose_path: prosePath,
      meta_path: metaPath,
      project_id: projectId ?? null,
      universe_id: universeId ?? null,
    };
  }

  return {
    isPathInsideSyncDir,
    isPathCandidateInsideSyncDir,
    resolveOutputDirWithinSync,
    resolveProjectRoot,
    resolveWorldEntityDir,
    createCanonicalWorldEntity,
  };
}
