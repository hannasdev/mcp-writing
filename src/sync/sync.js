import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import yaml from "js-yaml";
const { load: parseYaml, dump: stringifyYaml } = yaml;

// ---------------------------------------------------------------------------
// Pure utilities (no DB dependency — easy to unit test)
// ---------------------------------------------------------------------------

export function checksumProse(prose) {
  let hash = 5381;
  for (let i = 0; i < prose.length; i++) {
    hash = ((hash << 5) + hash) ^ prose.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

export function walkFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, fileList);
    } else if (entry.isSymbolicLink()) {
      try {
        if (fs.statSync(full).isDirectory()) walkFiles(full, fileList);
        else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) fileList.push(full);
      } catch { /* broken symlink — skip */ }
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
      fileList.push(full);
    }
  }
  return fileList;
}

export function walkSidecars(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSidecars(full, fileList);
    } else if (entry.isSymbolicLink()) {
      try {
        if (fs.statSync(full).isDirectory()) walkSidecars(full, fileList);
        else if (entry.name.endsWith(".meta.yaml")) fileList.push(full);
      } catch { /* broken symlink — skip */ }
    } else if (entry.name.endsWith(".meta.yaml")) {
      fileList.push(full);
    }
  }
  return fileList;
}

function isNestedMirrorPath(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath).split(path.sep).join("/");
  return rel.includes("/scenes/projects/") || rel.includes("/scenes/universes/");
}

export function sidecarPath(filePath) {
  return filePath.replace(/\.(md|txt)$/, ".meta.yaml");
}

export function inferScenePositionFromPath(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  const parts = rel.split(path.sep);
  let part = null;
  let chapter = null;

  for (const segment of parts) {
    const partMatch = segment.match(/^part-(\d+)(?:-.+)?$/i);
    if (partMatch) part = parseInt(partMatch[1], 10);

    const chapterMatch = segment.match(/^chapter-(\d+)(?:-.+)?$/i);
    if (chapterMatch) chapter = parseInt(chapterMatch[1], 10);
  }

  return { part, chapter };
}

function titleCaseFolderLabel(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function slugifyChapterValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferChapterStructureFromPath(syncDir, filePath, meta = {}) {
  const rel = path.relative(syncDir, filePath);
  const parts = rel.split(path.sep);
  let role = null;
  let chapterFolder = null;
  let chapterSortIndex = null;
  let chapterTitle = null;
  let chapterFolderKey = null;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    const normalized = segment.toLowerCase();

    if (normalized === "prologue" || normalized === "00-prologue") {
      role = "prologue";
      continue;
    }
    if (normalized === "epilogue" || normalized === "99-epilogue") {
      role = "epilogue";
      continue;
    }

    let match = segment.match(/^(\d+)-(.+)$/);
    if (!match) {
      match = segment.match(/^chapter-(\d+)(?:-(.+))?$/i);
    }
    if (!match) continue;

    chapterFolder = segment;
    chapterSortIndex = Number.parseInt(match[1], 10);
    chapterTitle = titleCaseFolderLabel(match[2] ?? `Chapter ${chapterSortIndex}`);
    chapterFolderKey = parts.slice(0, index + 1).join(path.sep);
  }

  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const explicitEpigraph = meta.kind === "epigraph"
    || meta.type === "epigraph"
    || typeof meta.epigraph_id === "string"
    || baseName === "epigraph";

  if (chapterSortIndex == null) {
    const fallback = inferScenePositionFromPath(syncDir, filePath);
    if (fallback.chapter != null) {
      chapterSortIndex = fallback.chapter;
      chapterTitle = titleCaseFolderLabel(meta.chapter_title ?? `Chapter ${fallback.chapter}`);
      chapterFolderKey = chapterFolderKey ?? parts.slice(0, Math.max(0, parts.length - 1)).join(path.sep);
    }
  }

  if (chapterSortIndex == null) {
    return {
      role,
      isEpigraph: explicitEpigraph,
      chapter: null,
    };
  }

  const chapterSlug = slugifyChapterValue(chapterTitle) || `chapter-${chapterSortIndex}`;
  return {
    role,
    isEpigraph: explicitEpigraph,
    chapter: {
      chapter_id: `ch-${String(chapterSortIndex).padStart(2, "0")}-${chapterSlug}`,
      sort_index: chapterSortIndex,
      title: chapterTitle,
      folder_name: chapterFolder ?? `chapter-${chapterSortIndex}`,
      folder_key: chapterFolderKey ?? parts.slice(0, Math.max(0, parts.length - 1)).join(path.sep),
    },
  };
}

export function normalizeSceneMetaForPath(syncDir, filePath, meta = {}) {
  const derived = inferScenePositionFromPath(syncDir, filePath);
  const chapterStructure = inferChapterStructureFromPath(syncDir, filePath, meta);
  const normalized = { ...meta };

  if (derived.part !== null) normalized.part = derived.part;
  if (derived.chapter !== null) normalized.chapter = derived.chapter;
  if (chapterStructure.chapter?.chapter_id) {
    normalized.chapter_id = chapterStructure.chapter.chapter_id;
    normalized.chapter = chapterStructure.chapter.sort_index;
    normalized.chapter_title = chapterStructure.chapter.title;
  }
  if (chapterStructure.role) {
    normalized.scene_role = chapterStructure.role;
  }

  return {
    meta: normalized,
    derived,
    chapterStructure,
    mismatches: {
      part: derived.part !== null && meta.part != null && meta.part !== derived.part,
      chapter: derived.chapter !== null && meta.chapter != null && meta.chapter !== derived.chapter,
    },
  };
}

// Structural directory names that are never project slugs under projects/<id>/.
const PROJECT_STRUCTURAL_DIRS = new Set(["world", "scenes", "misc", "fragments", "feedback", "draft"]);

export function isStructuralProjectId(name) {
  return typeof name === "string" && PROJECT_STRUCTURAL_DIRS.has(name.toLowerCase());
}

// Cache universe project root existence checks during sync scans.
const UNIVERSE_PROJECT_ROOT_CACHE = new Map();

// Returns true for known structural path segments directly under a project root
// (named dirs like "world", "scenes", and part-N / chapter-N path segments).
function isProjectStructuralDir(name) {
  const normalized = String(name ?? "").toLowerCase();
  return PROJECT_STRUCTURAL_DIRS.has(normalized)
    || /^part-\d+(?:-.+)?$/.test(normalized)
    || /^chapter-\d+(?:-.+)?$/.test(normalized);
}

function isBookSlug(name) {
  return /^book-[a-z0-9][a-z0-9-]*$/i.test(String(name ?? ""));
}

function hasUniverseProjectRoot(syncDir, universeId, projectSlug) {
  const key = `${syncDir}::${universeId}/${projectSlug}`;
  if (UNIVERSE_PROJECT_ROOT_CACHE.has(key)) {
    return UNIVERSE_PROJECT_ROOT_CACHE.get(key);
  }

  const exists = fs.existsSync(path.join(syncDir, "universes", universeId, projectSlug));
  UNIVERSE_PROJECT_ROOT_CACHE.set(key, exists);
  return exists;
}

export function inferProjectAndUniverse(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  const parts = rel.split(path.sep);

  if (parts[0] === "universes" && parts.length >= 3) {
    // Case-sensitive "world" intentionally matches isWorldFile() which also uses lowercase.
    if (parts[2] === "world") {
      return { universe_id: parts[1], project_id: null };
    }
    return { universe_id: parts[1], project_id: `${parts[1]}/${parts[2]}` };
  }
  if (parts[0] === "projects" && parts.length >= 2) {
    // Detect accidental two-segment layout: projects/<universe>/<book>/...
    // This occurs when a universe-scoped project_id (e.g. "universe-1/book-1-the-lamb")
    // is written under projects/ instead of universes/.
    // Detection is deliberately conservative to avoid mis-classifying valid nested
    // project layouts (e.g. projects/my-novel/notes/...). All three conditions must hold:
    //   1. parts[2] matches a book-* slug pattern (book-1, book-one, book-1-the-lamb, …)
    //   2. parts[3] is a known structural directory (scenes, world, part-N, chapter-N, …)
    //   3. A matching universes/<universe>/<book> directory exists on disk
    if (
      parts.length >= 4
      && parts[2] !== undefined
      && parts[3] !== undefined
      && isBookSlug(parts[2])
      && isProjectStructuralDir(parts[3])
      && hasUniverseProjectRoot(syncDir, parts[1], parts[2])
    ) {
      return { universe_id: parts[1], project_id: `${parts[1]}/${parts[2]}` };
    }
    return { universe_id: null, project_id: parts[1] };
  }
  return { universe_id: null, project_id: parts[0] ?? "default" };
}

export function isWorldFile(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  return rel.includes(`${path.sep}world${path.sep}`) || rel.includes("/world/");
}

export function isReferenceFile(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath).split(path.sep).join("/").toLowerCase();
  return rel.startsWith("world/reference/") || rel.includes("/world/reference/") || rel.startsWith("notes/") || rel.includes("/notes/");
}

export function inferReferenceDocType(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath).split(path.sep).join("/").toLowerCase();
  if (rel.startsWith("world/reference/") || rel.includes("/world/reference/")) return "world";
  if (rel.startsWith("notes/continuity/") || rel.includes("/notes/continuity/")) return "continuity";
  if (rel.startsWith("notes/research/") || rel.includes("/notes/research/")) return "research";
  if (rel.startsWith("notes/style/") || rel.includes("/notes/style/")) return "style";
  return "reference";
}

function inferReferenceScopeFromSyncDir(syncDir) {
  const parts = path.resolve(syncDir).split(path.sep).filter(Boolean);
  const projectSlug = parts.at(-1);
  const parent = parts.at(-2);
  const universeId = parts.at(-2);
  const universeProjectSlug = parts.at(-1);
  const universeMarker = parts.at(-3);

  if (parent === "projects" && projectSlug) {
    return { universe_id: null, project_id: projectSlug };
  }

  if (parent === "universes" && projectSlug) {
    return { universe_id: projectSlug, project_id: null };
  }

  if (universeMarker === "universes" && universeId && universeProjectSlug) {
    return { universe_id: universeId, project_id: `${universeId}/${universeProjectSlug}` };
  }

  return null;
}

function inferReferenceProjectAndUniverse(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath).split(path.sep).join("/").toLowerCase();
  const scoped = inferReferenceScopeFromSyncDir(syncDir);
  if (
    scoped
    && (rel.startsWith("world/reference/") || rel.startsWith("notes/"))
  ) {
    return scoped;
  }

  return inferProjectAndUniverse(syncDir, filePath);
}

function slugifyReferencePart(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(md|txt)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveReferenceDocId(syncDir, filePath, meta = {}) {
  if (typeof meta.doc_id === "string" && meta.doc_id.trim()) return meta.doc_id.trim();

  const rel = path.relative(syncDir, filePath).split(path.sep).join("/");
  const slug = rel
    .split("/")
    .map(slugifyReferencePart)
    .filter(Boolean)
    .join("-");
  return `ref-${slug}`;
}

export function deriveReferenceTitle(filePath, meta = {}, content = "") {
  if (typeof meta.title === "string" && meta.title.trim()) return meta.title.trim();

  const heading = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) return heading;

  const base = path.basename(filePath, path.extname(filePath));
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeReferenceTags(tags) {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(",")
      : [];

  return [...new Set(
    values
      .map(tag => String(tag).trim())
      .filter(Boolean)
  )];
}

export function normalizeReferenceIdList(values) {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [];

  return [...new Set(
    rawValues
      .map(value => String(value).trim())
      .filter(Boolean)
  )];
}

function normalizeReferenceRelation(value, fallbackRelation) {
  const normalized = String(value ?? fallbackRelation ?? "").trim().toLowerCase();
  if (/^[a-z][a-z0-9_-]*$/.test(normalized)) return normalized;
  return String(fallbackRelation ?? "related").trim().toLowerCase();
}

export function normalizeReferenceLinkList(values, { defaultRelation = "related" } = {}) {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [];

  const links = [];
  for (const value of rawValues) {
    if (typeof value === "string") {
      const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
      for (const targetDocId of parts) {
        links.push({ targetDocId, relation: normalizeReferenceRelation(defaultRelation, defaultRelation) });
      }
      continue;
    }

    if (!value || typeof value !== "object") continue;
    const targetDocId = String(value.target_doc_id ?? value.doc_id ?? value.id ?? "").trim();
    if (!targetDocId) continue;
    links.push({
      targetDocId,
      relation: normalizeReferenceRelation(value.relation, defaultRelation),
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const link of links) {
    const key = `${link.targetDocId}::${link.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

export function deriveReferenceSummary(meta = {}, content = "") {
  if (typeof meta.summary === "string" && meta.summary.trim()) return meta.summary.trim();

  const body = content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!body) return null;
  return body.length <= 240 ? body : `${body.slice(0, 237).trimEnd()}...`;
}

function indexReferenceLinksForSource(db, {
  sourceKind,
  sourceProjectId = "",
  sourceId,
  targetDocIds,
  relation,
}) {
  db.prepare(`
    DELETE FROM reference_links
    WHERE source_kind = ? AND source_project_id = ? AND source_id = ? AND origin = 'inferred'
  `).run(sourceKind, sourceProjectId, sourceId);

  const insertReferenceLink = db.prepare(`
    INSERT OR IGNORE INTO reference_links (
      source_kind, source_project_id, source_id, target_doc_id, relation, origin
    )
    SELECT ?, ?, ?, ?, ?, 'inferred'
    WHERE NOT EXISTS (
      SELECT 1
      FROM reference_links existing
      WHERE existing.source_kind = ?
        AND existing.source_project_id = ?
        AND existing.source_id = ?
        AND existing.target_doc_id = ?
        AND existing.origin = 'explicit'
    )
  `);

  for (const targetDocId of targetDocIds) {
    if (sourceKind === "reference" && sourceId === targetDocId) continue;
    insertReferenceLink.run(
      sourceKind,
      sourceProjectId,
      sourceId,
      targetDocId,
      relation,
      sourceKind,
      sourceProjectId,
      sourceId,
      targetDocId
    );
  }
}

function indexExplicitReferenceLinksForSource(db, {
  sourceKind,
  sourceProjectId = "",
  sourceId,
  links,
  defaultRelation,
}) {
  db.prepare(`
    DELETE FROM reference_links
    WHERE source_kind = ? AND source_project_id = ? AND source_id = ? AND origin = 'explicit'
  `).run(sourceKind, sourceProjectId, sourceId);

  const insertReferenceLink = db.prepare(`
    INSERT OR IGNORE INTO reference_links (
      source_kind, source_project_id, source_id, target_doc_id, relation, origin
    ) VALUES (?, ?, ?, ?, ?, 'explicit')
  `);

  for (const link of links) {
    if (sourceKind === "reference" && sourceId === link.targetDocId) continue;
    insertReferenceLink.run(
      sourceKind,
      sourceProjectId,
      sourceId,
      link.targetDocId,
      normalizeReferenceRelation(link.relation, defaultRelation)
    );
  }
}

function collectExplicitReferenceLinks(meta, fields, { defaultRelation }) {
  const hasField = fields.some((field) => Object.prototype.hasOwnProperty.call(meta, field));
  if (!hasField) {
    return { hasField: false, links: [] };
  }

  const rawValues = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(meta, field)) continue;
    const value = meta[field];
    if (Array.isArray(value)) {
      rawValues.push(...value);
    } else if (value !== undefined && value !== null) {
      rawValues.push(value);
    }
  }

  return {
    hasField: true,
    links: normalizeReferenceLinkList(rawValues, { defaultRelation }),
  };
}

export function worldEntityKindForPath(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  if (rel.includes(`${path.sep}characters${path.sep}`) || rel.includes("/characters/")) return "character";
  if (rel.includes(`${path.sep}places${path.sep}`) || rel.includes("/places/")) return "place";
  return null;
}

function worldEntityMarker(kind) {
  return kind === "character" ? "characters" : "places";
}

export function worldEntityFolderKey(syncDir, filePath, kind = worldEntityKindForPath(syncDir, filePath)) {
  if (!kind) return null;
  const rel = path.relative(syncDir, filePath);
  const parts = rel.split(path.sep);
  const markerIndex = parts.indexOf(worldEntityMarker(kind));
  if (markerIndex === -1) return null;
  const after = parts.slice(markerIndex + 1);
  if (after.length <= 1) return null;
  return parts.slice(0, markerIndex + 2).join(path.sep);
}

export function isCanonicalWorldEntityFile(syncDir, filePath, meta = {}) {
  const kind = worldEntityKindForPath(syncDir, filePath);
  if (!kind) return false;

  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (meta?.canonical === true) return true;
  if (base === "sheet") return true;

  return worldEntityFolderKey(syncDir, filePath, kind) === null;
}

export function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw);
}

/**
 * Read metadata for a scene file. Priority: sidecar > frontmatter.
 * If sidecar doesn't exist but frontmatter does, auto-generates the sidecar.
 * Returns { meta, sidecarGenerated }.
 */
export function readMeta(filePath, syncDir, { writable = false } = {}) {
  const sidecar = sidecarPath(filePath);

  if (fs.existsSync(sidecar)) {
    const raw = fs.readFileSync(sidecar, "utf8");
    const parsed = parseYaml(raw) ?? {};
    return { ...normalizeSceneMetaForPath(syncDir, filePath, parsed), sourceMeta: parsed, sidecarGenerated: false };
  }

  // Fall back to frontmatter
  const { data: frontmatter } = parseFile(filePath);
  if (!Object.keys(frontmatter).length) {
    return { ...normalizeSceneMetaForPath(syncDir, filePath, {}), sourceMeta: {}, sidecarGenerated: false };
  }

  const normalized = normalizeSceneMetaForPath(syncDir, filePath, frontmatter);

  // Auto-migrate: write sidecar from frontmatter (only if writable)
  if (writable) {
    try {
      fs.writeFileSync(sidecar, stringifyYaml(normalized.meta), "utf8");
      return { ...normalized, sourceMeta: frontmatter, sidecarGenerated: true };
    } catch { /* empty */ }
  }

  return { ...normalized, sourceMeta: frontmatter, sidecarGenerated: false };
}

/**
 * Write metadata back to the sidecar file for a scene.
 */
export function writeMeta(filePath, meta) {
  fs.writeFileSync(sidecarPath(filePath), stringifyYaml(meta), "utf8");
}

/**
 * Check whether the sync dir is writable.
 */
export function isSyncDirWritable(syncDir) {
  try {
    const probe = path.join(syncDir, ".mcp-write-check");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function collectOwnershipSample(rootDir, limit = 200) {
  const samples = [];
  const stack = [rootDir];

  while (stack.length && samples.length < limit) {
    const current = stack.pop();
    samples.push(current);

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (samples.length + stack.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        samples.push(full);
        if (samples.length >= limit) break;
      }
    }
  }

  return samples;
}

export function getSyncOwnershipDiagnostics(syncDir, { sampleLimit = 200 } = {}) {
  let runtimeUid = typeof process.getuid === "function" ? process.getuid() : null;
  const runtimeUidOverrideRaw = process.env.RUNTIME_UID_OVERRIDE;
  const runtimeUidOverrideAllowed = process.env.NODE_ENV === "test" || process.env.ALLOW_RUNTIME_UID_OVERRIDE === "1";
  let runtimeUidOverrideApplied = false;
  let runtimeUidOverrideIgnored = false;
  let runtimeUidOverrideInvalid = false;

  if (runtimeUidOverrideRaw !== undefined) {
    if (!runtimeUidOverrideAllowed) {
      runtimeUidOverrideIgnored = true;
    } else {
      const parsed = Number.parseInt(runtimeUidOverrideRaw, 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        runtimeUid = parsed;
        runtimeUidOverrideApplied = true;
      } else {
        runtimeUidOverrideInvalid = true;
      }
    }
  }
  let syncDirPathExists;
  let syncDirIsDirectory;
  try {
    const stat = fs.statSync(syncDir);
    syncDirPathExists = true;
    syncDirIsDirectory = stat.isDirectory();
  } catch {
    syncDirPathExists = false;
    syncDirIsDirectory = false;
  }

  const diagnostics = {
    sync_dir: path.resolve(syncDir),
    sync_dir_path_exists: syncDirPathExists,
    sync_dir_is_directory: syncDirIsDirectory,
    // Backwards-compatible: "exists" now means "exists and is a directory".
    sync_dir_exists: syncDirIsDirectory,
    supported: runtimeUid !== null,
    runtime_uid: runtimeUid,
    runtime_uid_override_requested: runtimeUidOverrideRaw !== undefined,
    runtime_uid_override_applied: runtimeUidOverrideApplied,
    runtime_uid_override_ignored: runtimeUidOverrideIgnored,
    runtime_uid_override_invalid: runtimeUidOverrideInvalid,
    sampled_paths: 0,
    sample_limit: sampleLimit,
    root_owned_paths: 0,
    non_runtime_owned_paths: 0,
    unreadable_paths: 0,
    root_owned_examples: [],
    non_runtime_owned_examples: [],
  };

  if (!diagnostics.sync_dir_is_directory || runtimeUid === null) {
    return diagnostics;
  }

  const sample = collectOwnershipSample(syncDir, sampleLimit);
  diagnostics.sampled_paths = sample.length;

  for (const filePath of sample) {
    try {
      const stat = fs.statSync(filePath);
      const rel = path.relative(syncDir, filePath) || ".";
      if (stat.uid === 0) {
        diagnostics.root_owned_paths++;
        if (diagnostics.root_owned_examples.length < 5) diagnostics.root_owned_examples.push(rel);
      }
      if (stat.uid !== runtimeUid) {
        diagnostics.non_runtime_owned_paths++;
        if (diagnostics.non_runtime_owned_examples.length < 5) diagnostics.non_runtime_owned_examples.push(rel);
      }
    } catch {
      diagnostics.unreadable_paths++;
    }
  }

  return diagnostics;
}

export function getFileWriteDiagnostics(filePath) {
  const runtimeUid = typeof process.getuid === "function" ? process.getuid() : null;
  const resolvedPath = path.resolve(filePath);
  const parentDir = path.dirname(resolvedPath);
  const diagnostics = {
    path: resolvedPath,
    parent_dir: parentDir,
    exists: false,
    is_file: false,
    writable: false,
    parent_dir_writable: false,
    supported: runtimeUid !== null,
    runtime_uid: runtimeUid,
    owner_uid: null,
    root_owned: false,
    stat_error_code: null,
    stat_error_message: null,
  };

  try {
    fs.accessSync(parentDir, fs.constants.W_OK);
    diagnostics.parent_dir_writable = true;
  } catch {
    diagnostics.parent_dir_writable = false;
  }

  try {
    const stat = fs.statSync(resolvedPath);
    diagnostics.exists = true;
    diagnostics.is_file = stat.isFile();
    diagnostics.owner_uid = typeof stat.uid === "number" ? stat.uid : null;
    diagnostics.root_owned = stat.uid === 0;
  } catch (err) {
    diagnostics.stat_error_code = typeof err?.code === "string" ? err.code : null;
    diagnostics.stat_error_message = typeof err?.message === "string" ? err.message : String(err);
    return diagnostics;
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.W_OK);
    diagnostics.writable = diagnostics.is_file;
  } catch {
    diagnostics.writable = false;
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// DB-dependent sync (takes db + syncDir as arguments for testability)
// ---------------------------------------------------------------------------

export function indexWorldFile(db, syncDir, file, meta) {
  const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);
  const kind = worldEntityKindForPath(syncDir, file);

  if (!kind || !isCanonicalWorldEntityFile(syncDir, file, meta)) return;

  const indexWorldEntityReferenceLinks = ({ sourceKind, sourceId }) => {
    const explicitReferenceLinks = collectExplicitReferenceLinks(
      meta,
      ["reference_links", "explicit_reference_links"],
      { defaultRelation: "informs" }
    );

    if (explicitReferenceLinks.hasField) {
      indexExplicitReferenceLinksForSource(db, {
        sourceKind,
        sourceProjectId: project_id ?? "",
        sourceId,
        links: explicitReferenceLinks.links,
        defaultRelation: "informs",
      });
    }
  };

  if (kind === "character") {
    if (!meta.character_id) return;

    db.prepare(`
      INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (character_id) DO UPDATE SET
        name = excluded.name, role = excluded.role, arc_summary = excluded.arc_summary,
        first_appearance = excluded.first_appearance, file_path = excluded.file_path
    `).run(
      meta.character_id, project_id ?? null, universe_id ?? null,
      meta.name ?? meta.character_id, meta.role ?? null, meta.arc_summary ?? null,
      meta.first_appearance ?? null, file
    );
    db.prepare(`DELETE FROM character_traits WHERE character_id = ?`).run(meta.character_id);
    for (const t of (meta.traits ?? [])) {
      db.prepare(`INSERT OR IGNORE INTO character_traits (character_id, trait) VALUES (?, ?)`).run(
        meta.character_id, t
      );
    }
    indexWorldEntityReferenceLinks({ sourceKind: "character", sourceId: meta.character_id });
  } else if (kind === "place") {
    if (!meta.place_id) return;

    db.prepare(`
      INSERT INTO places (place_id, project_id, universe_id, name, file_path)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (place_id) DO UPDATE SET name = excluded.name, file_path = excluded.file_path
    `).run(
      meta.place_id, project_id ?? null, universe_id ?? null,
      meta.name ?? meta.place_id, file
    );
    indexWorldEntityReferenceLinks({ sourceKind: "place", sourceId: meta.place_id });
  }
}

export function indexReferenceFile(db, syncDir, file, meta = {}, content = "") {
  const { universe_id, project_id } = inferReferenceProjectAndUniverse(syncDir, file);
  const docId = deriveReferenceDocId(syncDir, file, meta);
  const type = inferReferenceDocType(syncDir, file);
  const title = deriveReferenceTitle(file, meta, content);
  const summary = deriveReferenceSummary(meta, content);
  const tags = normalizeReferenceTags(meta.tags);
  const relatedReferenceIds = normalizeReferenceIdList(
    meta.related_reference_ids ?? meta.related_references ?? meta.related_docs ?? meta.related
  );
  const explicitReferenceLinks = collectExplicitReferenceLinks(
    meta,
    ["reference_links", "related_reference_links", "explicit_reference_links"],
    { defaultRelation: "related" }
  );

  db.prepare(`
    INSERT INTO reference_docs (doc_id, project_id, universe_id, type, title, summary, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (doc_id) DO UPDATE SET
      project_id = excluded.project_id,
      universe_id = excluded.universe_id,
      type = excluded.type,
      title = excluded.title,
      summary = excluded.summary,
      file_path = excluded.file_path
  `).run(
    docId,
    project_id ?? null,
    universe_id ?? null,
    type,
    title,
    summary ?? null,
    file
  );

  db.prepare(`DELETE FROM reference_doc_tags WHERE doc_id = ?`).run(docId);
  for (const tag of tags) {
    db.prepare(`INSERT OR IGNORE INTO reference_doc_tags (doc_id, tag) VALUES (?, ?)`).run(docId, tag);
  }

  db.prepare(`DELETE FROM reference_docs_fts WHERE doc_id = ?`).run(docId);
  db.prepare(`
    INSERT INTO reference_docs_fts (doc_id, project_id, title, summary, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    docId,
    project_id ?? "",
    title,
    summary ?? "",
    tags.join(" ")
  );

  if (explicitReferenceLinks.hasField) {
    indexExplicitReferenceLinksForSource(db, {
      sourceKind: "reference",
      sourceProjectId: project_id ?? "",
      sourceId: docId,
      links: explicitReferenceLinks.links,
      defaultRelation: "related",
    });
  }

  indexReferenceLinksForSource(db, {
    sourceKind: "reference",
    sourceProjectId: project_id ?? "",
    sourceId: docId,
    targetDocIds: relatedReferenceIds,
    relation: "related",
  });

  return docId;
}

function pruneMissingReferenceDocs(db, seenDocIds) {
  const rows = db.prepare(`SELECT doc_id, project_id FROM reference_docs`).all();
  for (const row of rows) {
    if (seenDocIds.has(row.doc_id)) continue;
    db.prepare(`
      DELETE FROM reference_links
      WHERE source_kind = 'reference' AND source_project_id = ? AND source_id = ?
    `).run(row.project_id ?? "", row.doc_id);
    db.prepare(`DELETE FROM reference_links WHERE target_doc_id = ?`).run(row.doc_id);
    db.prepare(`DELETE FROM reference_doc_tags WHERE doc_id = ?`).run(row.doc_id);
    db.prepare(`DELETE FROM reference_docs_fts WHERE doc_id = ?`).run(row.doc_id);
    db.prepare(`DELETE FROM reference_docs WHERE doc_id = ?`).run(row.doc_id);
  }
}

function canPruneReferenceDocs(syncDir) {
  const resolvedSyncDir = path.resolve(syncDir);
  const scopedRoot = inferReferenceScopeFromSyncDir(resolvedSyncDir);
  if (scopedRoot) return true;

  // Flat project roots and broad workspace roots can safely prune because
  // they can observe the full set of reference docs in their scope.
  const hasBroadRootChild = ["projects", "universes", "scenes"].some((name) => {
    try {
      return fs.statSync(path.join(resolvedSyncDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  return hasBroadRootChild;
}

function inferSceneProjectScopeFromSyncDir(syncDir) {
  const parts = path.resolve(syncDir).split(path.sep).filter(Boolean);
  if (parts.length < 2) return null;

  const tail = parts.at(-1);
  const parent = parts.at(-2);

  if (parent === "projects" && tail) {
    return tail;
  }

  if (tail === "scenes" && parts.length >= 3 && parts.at(-3) === "projects") {
    return parts.at(-2);
  }

  if (parts.length >= 3 && parts.at(-3) === "universes") {
    return `${parts.at(-2)}/${parts.at(-1)}`;
  }

  if (tail === "scenes" && parts.length >= 4 && parts.at(-4) === "universes") {
    return `${parts.at(-3)}/${parts.at(-2)}`;
  }

  return null;
}

function canPruneScenes(syncDir) {
  const resolvedSyncDir = path.resolve(syncDir);

  if (inferSceneProjectScopeFromSyncDir(resolvedSyncDir)) {
    return true;
  }

  const hasBroadRootChild = ["projects", "universes", "scenes"].some((name) => {
    try {
      return fs.statSync(path.join(resolvedSyncDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  return hasBroadRootChild;
}

function pruneMissingScenes(db, seenSceneKeys, syncDir) {
  const projectScope = inferSceneProjectScopeFromSyncDir(syncDir);
  const rows = projectScope
    ? db.prepare(`SELECT scene_id, project_id FROM scenes WHERE project_id = ?`).all(projectScope)
    : db.prepare(`SELECT scene_id, project_id FROM scenes`).all();

  for (const row of rows) {
    const key = `${row.scene_id}::${row.project_id}`;
    if (seenSceneKeys.has(key)) continue;

    db.prepare(`DELETE FROM scenes_fts WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
    db.prepare(`
      DELETE FROM reference_links
      WHERE source_kind = 'scene' AND source_project_id = ? AND source_id = ?
    `).run(row.project_id ?? "", row.scene_id);
    db.prepare(`DELETE FROM scenes WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
    db.prepare(`DELETE FROM scene_characters WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
    db.prepare(`DELETE FROM scene_places WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
    db.prepare(`DELETE FROM scene_tags WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
    db.prepare(`DELETE FROM scene_threads WHERE scene_id = ? AND project_id = ?`).run(row.scene_id, row.project_id);
  }
}

function pruneMissingChapters(db, seenChapterKeys, syncDir) {
  const projectScope = inferSceneProjectScopeFromSyncDir(syncDir);
  const rows = projectScope
    ? db.prepare(`SELECT chapter_id, project_id FROM chapters WHERE project_id = ?`).all(projectScope)
    : db.prepare(`SELECT chapter_id, project_id FROM chapters`).all();

  for (const row of rows) {
    const key = `${row.chapter_id}::${row.project_id}`;
    if (seenChapterKeys.has(key)) continue;
    db.prepare(`DELETE FROM epigraph_characters WHERE project_id = ? AND epigraph_id IN (SELECT epigraph_id FROM epigraphs WHERE project_id = ? AND chapter_id = ?)`)
      .run(row.project_id, row.project_id, row.chapter_id);
    db.prepare(`DELETE FROM epigraph_tags WHERE project_id = ? AND epigraph_id IN (SELECT epigraph_id FROM epigraphs WHERE project_id = ? AND chapter_id = ?)`)
      .run(row.project_id, row.project_id, row.chapter_id);
    db.prepare(`DELETE FROM epigraphs WHERE project_id = ? AND chapter_id = ?`).run(row.project_id, row.chapter_id);
    db.prepare(`DELETE FROM chapters WHERE chapter_id = ? AND project_id = ?`).run(row.chapter_id, row.project_id);
  }
}

function pruneMissingEpigraphs(db, seenEpigraphKeys, syncDir) {
  const projectScope = inferSceneProjectScopeFromSyncDir(syncDir);
  const rows = projectScope
    ? db.prepare(`SELECT epigraph_id, project_id FROM epigraphs WHERE project_id = ?`).all(projectScope)
    : db.prepare(`SELECT epigraph_id, project_id FROM epigraphs`).all();

  for (const row of rows) {
    const key = `${row.epigraph_id}::${row.project_id}`;
    if (seenEpigraphKeys.has(key)) continue;
    db.prepare(`DELETE FROM epigraph_characters WHERE epigraph_id = ? AND project_id = ?`).run(row.epigraph_id, row.project_id);
    db.prepare(`DELETE FROM epigraph_tags WHERE epigraph_id = ? AND project_id = ?`).run(row.epigraph_id, row.project_id);
    db.prepare(`DELETE FROM epigraphs WHERE epigraph_id = ? AND project_id = ?`).run(row.epigraph_id, row.project_id);
  }
}

function resolveCanonicalChapterRecord(db, {
  syncDir,
  projectId,
  derivedChapterId,
  sortIndex,
  title,
  sourcePath,
}) {
  if (!projectId || sortIndex == null || !title) return null;

  const normalizedSourcePath = sourcePath ?? null;
  const bySourcePath = normalizedSourcePath
    ? db.prepare(`
        SELECT chapter_id, title, sort_index, logline, source_checksum, metadata_stale
        FROM chapters
        WHERE project_id = ? AND source_path = ?
      `).get(projectId, normalizedSourcePath)
    : null;

  if (bySourcePath) {
    return {
      ...bySourcePath,
      chapter_id: bySourcePath.chapter_id,
      title,
      sort_index: sortIndex,
      source_path: normalizedSourcePath,
    };
  }

  const bySortIndex = db.prepare(`
    SELECT chapter_id, title, sort_index, logline, source_path, source_checksum, metadata_stale
    FROM chapters
    WHERE project_id = ? AND sort_index = ?
  `).get(projectId, sortIndex);

  if (bySortIndex) {
    const existingSourceExists = Boolean(
      syncDir
      && bySortIndex.source_path
      && fs.existsSync(path.join(syncDir, bySortIndex.source_path))
    );
    if (
      normalizedSourcePath
      && bySortIndex.source_path
      && bySortIndex.source_path !== normalizedSourcePath
      && existingSourceExists
    ) {
      return {
        ambiguous: true,
        existingSourcePath: bySortIndex.source_path,
        conflictingSourcePath: normalizedSourcePath,
        sort_index: sortIndex,
      };
    }
    return {
      ...bySortIndex,
      chapter_id: bySortIndex.chapter_id,
      title,
      sort_index: sortIndex,
      source_path: normalizedSourcePath,
    };
  }

  return {
    chapter_id: derivedChapterId,
    title,
    sort_index: sortIndex,
    source_path: normalizedSourcePath,
    logline: null,
    source_checksum: null,
    metadata_stale: 0,
  };
}

export function indexSceneFile(db, syncDir, file, meta, prose) {
  const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);
  const chapterStructure = inferChapterStructureFromPath(syncDir, file, meta);
  const referenceIds = normalizeReferenceIdList(meta.reference_ids ?? meta.references);
  const explicitSceneLinks = collectExplicitReferenceLinks(
    meta,
    ["reference_links", "explicit_reference_links"],
    { defaultRelation: "informs" }
  );

  if (universe_id) {
    db.prepare(`INSERT OR IGNORE INTO universes (universe_id, name) VALUES (?, ?)`).run(
      universe_id, universe_id
    );
  }
  db.prepare(`INSERT OR IGNORE INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run(
    project_id, universe_id ?? null, project_id
  );

  let chapterId = meta.chapter_id ?? chapterStructure.chapter?.chapter_id ?? null;
  const chapterSortIndex = chapterStructure.chapter?.sort_index ?? meta.chapter ?? null;
  const chapterTitle = chapterStructure.chapter?.title ?? meta.chapter_title ?? null;
  const chapterSourcePath = chapterStructure.chapter?.folder_key ?? path.dirname(file);
  let chapterWarning = null;

  if (chapterId && chapterSortIndex != null && chapterTitle) {
    const canonicalChapter = resolveCanonicalChapterRecord(db, {
      syncDir,
      projectId: project_id,
      derivedChapterId: chapterId,
      sortIndex: chapterSortIndex,
      title: chapterTitle,
      sourcePath: chapterSourcePath,
    });
    if (canonicalChapter?.ambiguous) {
      chapterWarning = `Chapter structure warning: duplicate chapter order ${chapterSortIndex} in project "${project_id}" for ${canonicalChapter.existingSourcePath} and ${canonicalChapter.conflictingSourcePath}.`;
      chapterId = null;
    } else {
      chapterId = canonicalChapter?.chapter_id ?? chapterId;
    }
    if (chapterId) {
      const chapterChecksum = checksumProse(`${chapterSortIndex}:${chapterTitle}:${meta.chapter_logline ?? ""}`);
      const existingChapter = db.prepare(
        `SELECT source_checksum, metadata_stale FROM chapters WHERE chapter_id = ? AND project_id = ?`
      ).get(chapterId, project_id);
      db.prepare(`
        INSERT INTO chapters (
          chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (chapter_id, project_id) DO UPDATE SET
          title = excluded.title,
          sort_index = excluded.sort_index,
          logline = excluded.logline,
          source_path = excluded.source_path,
          source_checksum = excluded.source_checksum,
          metadata_stale = CASE
            WHEN excluded.source_checksum != chapters.source_checksum THEN 1
            ELSE chapters.metadata_stale
          END,
          updated_at = excluded.updated_at
      `).run(
        chapterId,
        project_id,
        chapterTitle,
        chapterSortIndex,
        meta.chapter_logline ?? null,
        chapterSourcePath,
        chapterChecksum,
        existingChapter && existingChapter.source_checksum !== chapterChecksum ? 1 : 0,
        new Date().toISOString()
      );
    }
  }

  if (chapterStructure.isEpigraph) {
    if (!chapterId) {
      const reason = chapterWarning
        ?? (chapterStructure.chapter && chapterSortIndex != null
          ? `Ambiguous chapter linkage from duplicate chapter order ${chapterSortIndex}: ${path.relative(syncDir, file)}`
          : `Epigraph requires explicit chapter linkage: ${path.relative(syncDir, file)}`);
      return { isStale: 0, skippedAsEpigraph: true, warning: reason };
    }

    const epigraphId = meta.epigraph_id ?? `epi-${slugifyChapterValue(`${project_id}-${chapterId}`)}`;
    const epigraphChecksum = checksumProse(prose);
    const existingEpigraph = db.prepare(
      `SELECT prose_checksum FROM epigraphs WHERE epigraph_id = ? AND project_id = ?`
    ).get(epigraphId, project_id);

    db.prepare(`
      INSERT INTO epigraphs (
        epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (epigraph_id, project_id) DO UPDATE SET
        chapter_id = excluded.chapter_id,
        body = excluded.body,
        file_path = excluded.file_path,
        prose_checksum = excluded.prose_checksum,
        metadata_stale = CASE
          WHEN excluded.prose_checksum != epigraphs.prose_checksum THEN 1
          ELSE epigraphs.metadata_stale
        END,
        updated_at = excluded.updated_at
    `).run(
      epigraphId,
      project_id,
      chapterId,
      prose,
      file,
      epigraphChecksum,
      existingEpigraph && existingEpigraph.prose_checksum !== epigraphChecksum ? 1 : 0,
      new Date().toISOString()
    );

    db.prepare(`DELETE FROM epigraph_characters WHERE epigraph_id = ? AND project_id = ?`).run(epigraphId, project_id);
    db.prepare(`DELETE FROM epigraph_tags WHERE epigraph_id = ? AND project_id = ?`).run(epigraphId, project_id);
    for (const characterId of (meta.characters ?? [])) {
      db.prepare(`INSERT OR IGNORE INTO epigraph_characters (epigraph_id, project_id, character_id) VALUES (?, ?, ?)`)
        .run(epigraphId, project_id, characterId);
    }
    for (const tag of (meta.tags ?? [])) {
      db.prepare(`INSERT OR IGNORE INTO epigraph_tags (epigraph_id, project_id, tag) VALUES (?, ?, ?)`)
        .run(epigraphId, project_id, tag);
    }

    return {
      isStale: existingEpigraph && existingEpigraph.prose_checksum !== epigraphChecksum ? 1 : 0,
      skippedAsEpigraph: true,
      chapterId,
      epigraphId,
    };
  }

  const newChecksum = checksumProse(prose);
  const existing = db.prepare(
    `SELECT prose_checksum FROM scenes WHERE scene_id = ? AND project_id = ?`
  ).get(meta.scene_id, project_id);

  const isStale = existing && existing.prose_checksum !== newChecksum ? 1 : 0;

  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, scene_role, title, part, chapter, chapter_title, pov, logline, scene_change,
      causality, stakes, scene_functions,
      save_the_cat_beat, timeline_position, story_time, word_count,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (scene_id, project_id) DO UPDATE SET
      chapter_id = excluded.chapter_id,
      scene_role = excluded.scene_role,
      title = excluded.title,
      part = excluded.part,
      chapter = excluded.chapter,
      chapter_title = excluded.chapter_title,
      pov = excluded.pov,
      logline = excluded.logline,
      scene_change = excluded.scene_change,
      causality = excluded.causality,
      stakes = excluded.stakes,
      scene_functions = excluded.scene_functions,
      save_the_cat_beat = excluded.save_the_cat_beat,
      timeline_position = excluded.timeline_position,
      story_time = excluded.story_time,
      word_count = excluded.word_count,
      file_path = excluded.file_path,
      prose_checksum = excluded.prose_checksum,
      metadata_stale = CASE WHEN excluded.prose_checksum != scenes.prose_checksum THEN 1 ELSE scenes.metadata_stale END,
      updated_at = excluded.updated_at
  `).run(
    meta.scene_id, project_id,
    chapterId, meta.scene_role ?? chapterStructure.role ?? null,
    meta.title ?? null, meta.part ?? null, chapterSortIndex, chapterTitle,
    meta.pov ?? null, meta.logline ?? meta.synopsis ?? null,
    meta.scene_change ?? meta.change ?? null,
    meta.causality ?? null, meta.stakes ?? null,
    meta.scene_functions?.length ? JSON.stringify(meta.scene_functions) : null,
    meta.save_the_cat_beat ?? meta.save_the_cat ?? null,
    meta.timeline_position ?? null, meta.story_time ?? null,
    meta.word_count ?? prose.split(/\s+/).filter(Boolean).length,
    file, newChecksum, isStale,
    new Date().toISOString()
  );

  db.prepare(`DELETE FROM scene_characters WHERE scene_id = ? AND project_id = ?`).run(meta.scene_id, project_id);
  db.prepare(`DELETE FROM scene_places WHERE scene_id = ? AND project_id = ?`).run(meta.scene_id, project_id);
  db.prepare(`DELETE FROM scene_tags WHERE scene_id = ? AND project_id = ?`).run(meta.scene_id, project_id);

  for (const c of (meta.characters ?? [])) {
    // Version continuity markers (e.g. v7.3, v3.3b) are tracked as tags, not characters
    if (/^v\d[\d.a-z]*$/i.test(c)) {
      db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, project_id, tag) VALUES (?, ?, ?)`).run(meta.scene_id, project_id, c);
      continue;
    }
    let cid = c;
    // If the value looks like a name rather than an ID, try to resolve it
    if (!/^char-/.test(c)) {
      // 1. Exact name match (case-insensitive)
      let row = db.prepare(`SELECT character_id FROM characters WHERE lower(name) = lower(?)`).get(c);
      // 2. Word-overlap: all words in the keyword appear in the stored name
      //    Handles "Victor Sidorin" → "Victor Alexeyvich Sidorin"
      if (!row) {
        const words = c.toLowerCase().split(/\s+/).filter(Boolean);
        const all = db.prepare(`SELECT character_id, name FROM characters`).all();
        const match = all.find(r =>
          words.every(w => r.name.toLowerCase().includes(w))
        );
        if (match) row = match;
      }
      if (row) cid = row.character_id;
    }
    db.prepare(`INSERT OR IGNORE INTO scene_characters (scene_id, project_id, character_id) VALUES (?, ?, ?)`).run(
      meta.scene_id, project_id, cid
    );
  }
  for (const p of (meta.places ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_places (scene_id, project_id, place_id) VALUES (?, ?, ?)`).run(
      meta.scene_id, project_id, p
    );
  }
  for (const t of (meta.tags ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, project_id, tag) VALUES (?, ?, ?)`).run(
      meta.scene_id, project_id, t
    );
  }
  for (const v of (meta.versions ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, project_id, tag) VALUES (?, ?, ?)`).run(
      meta.scene_id, project_id, v
    );
  }

  const keywordTokens = [
    ...(meta.tags ?? []),
    ...(meta.characters ?? []),
    ...(meta.places ?? []),
    ...(meta.versions ?? []),
  ]
    .filter(Boolean)
    .map(String)
    .map(s => s.trim())
    .filter(Boolean)
    .join(" ");

  db.prepare(`INSERT OR REPLACE INTO scenes_fts (scene_id, project_id, logline, title, keywords) VALUES (?, ?, ?, ?, ?)`).run(
    meta.scene_id,
    project_id,
    meta.logline ?? meta.synopsis ?? "",
    meta.title ?? "",
    keywordTokens,
  );

  if (explicitSceneLinks.hasField) {
    indexExplicitReferenceLinksForSource(db, {
      sourceKind: "scene",
      sourceProjectId: project_id ?? "",
      sourceId: meta.scene_id,
      links: explicitSceneLinks.links,
      defaultRelation: "informs",
    });
  }

  indexReferenceLinksForSource(db, {
    sourceKind: "scene",
    sourceProjectId: project_id ?? "",
    sourceId: meta.scene_id,
    targetDocIds: referenceIds,
    relation: "informs",
  });

  return { isStale, chapterId, warning: chapterWarning };
}

const WARNING_TYPE_LABELS = {
  no_scene_id: "Skipped (no scene_id)",
  duplicate_scene_id: "Duplicate scene_id",
  path_metadata_mismatch: "Path/metadata mismatch",
  chapter_structure: "Chapter structure",
  orphaned_sidecar: "Orphaned sidecar",
  moved_scene: "Moved scene",
  nested_mirror: "Ignored nested mirror path",
};

const WARNING_PATTERNS = [
  { type: "no_scene_id",            re: /^Skipped \(no scene_id\):/  },
  { type: "duplicate_scene_id",     re: /^Duplicate scene_id/        },
  { type: "path_metadata_mismatch", re: /^Path\/metadata mismatch/   },
  { type: "chapter_structure",      re: /^(Chapter structure warning|Epigraph requires explicit chapter linkage)/ },
  { type: "moved_scene",            re: /^Moved scene detected:/      },
  { type: "orphaned_sidecar",       re: /^Orphaned sidecar/          },
  { type: "nested_mirror",          re: /^Ignored nested mirror path:/ },
];

const MAX_WARNING_EXAMPLES = 5;

function buildWarningSummary(warnings) {
  const summary = {};
  for (const w of warnings) {
    const firstLine = w.split("\n")[0];
    const match = WARNING_PATTERNS.find(p => p.re.test(firstLine));
    const type = match?.type ?? "other";
    if (!summary[type]) summary[type] = { count: 0, examples: [] };
    summary[type].count++;
    if (summary[type].examples.length < MAX_WARNING_EXAMPLES) {
      summary[type].examples.push(firstLine);
    }
  }
  return summary;
}

export function syncAll(db, syncDir, { quiet = false, writable = false } = {}) {
  // Reset per-run inference cache so filesystem changes between sync calls
  // (for example after imports or path repairs) are reflected immediately.
  UNIVERSE_PROJECT_ROOT_CACHE.clear();

  const files = walkFiles(syncDir);
  let indexed = 0;
  let staleMarked = 0;
  let epigraphsIndexed = 0;
  let epigraphsStaleMarked = 0;
  let skipped = 0;
  let sidecarsMigrated = 0;
  const seenSceneIds = new Map(); // scene_id+project_id → file path, for duplicate detection
  const seenSceneKeys = new Set();
  const indexedSceneIds = new Set(); // scene_id only — for orphaned sidecar move detection
  const seenChapterKeys = new Set();
  const seenEpigraphKeys = new Set();
  const indexedReferenceDocIds = new Set();
  let sceneIndexFailures = 0;
  const warnings = [];
  const chapterFoldersByProject = new Map();
  const roleFoldersByProject = new Map();

  const scanFiles = [];
  for (const file of files) {
    if (isNestedMirrorPath(syncDir, file)) {
      warnings.push(`Ignored nested mirror path: ${path.relative(syncDir, file)}`);
      continue;
    }
    scanFiles.push(file);
  }

  // --- Pass 1: world files and reference docs (characters/places must be indexed
  // before scenes so that character name -> ID resolution in scene_characters works) ---
  for (const file of scanFiles) {
    if (isReferenceFile(syncDir, file)) {
      try {
        const { data, content } = parseFile(file);
        const docId = indexReferenceFile(db, syncDir, file, data, content);
        indexedReferenceDocIds.add(docId);
      } catch (err) {
        process.stderr.write(`[mcp-writing] Failed to index ${file}: ${err.message}\n`);
      }
      continue;
    }

    if (!isWorldFile(syncDir, file)) continue;
    try {
      const { meta } = readMeta(file, syncDir, { writable });
      if (!Object.keys(meta).length) {
        const { data } = parseFile(file);
        indexWorldFile(db, syncDir, file, data);
      } else {
        indexWorldFile(db, syncDir, file, meta);
      }
    } catch (err) {
      process.stderr.write(`[mcp-writing] Failed to index ${file}: ${err.message}\n`);
    }
  }

  if (canPruneReferenceDocs(syncDir)) {
    pruneMissingReferenceDocs(db, indexedReferenceDocIds);
  }

  // --- Pass 2: scene files ---
  for (const file of scanFiles) {
    if (isWorldFile(syncDir, file) || isReferenceFile(syncDir, file)) continue;
    try {
      const { meta, sourceMeta, sidecarGenerated, derived, mismatches } = readMeta(file, syncDir, { writable });
      if (sidecarGenerated) sidecarsMigrated++;
      const chapterStructure = inferChapterStructureFromPath(syncDir, file, meta);

      if (!meta.scene_id && !chapterStructure.isEpigraph) {
        skipped++;
        if (!quiet) warnings.push(`Skipped (no scene_id): ${path.relative(syncDir, file)}`);
        continue;
      }

      // Duplicate scene_id detection
      const { project_id } = inferProjectAndUniverse(syncDir, file);
      const key = `${meta.scene_id}::${project_id}`;
      if (meta.scene_id && seenSceneIds.has(key)) {
        warnings.push(
          `Duplicate scene_id "${meta.scene_id}" in project "${project_id}":\n` +
          `  ${path.relative(syncDir, seenSceneIds.get(key))}\n` +
          `  ${path.relative(syncDir, file)}`
        );
      } else if (meta.scene_id) {
        seenSceneIds.set(key, file);
      }
      if (meta.scene_id) seenSceneKeys.add(key);

      if (chapterStructure.role) {
        const roleKey = `${project_id}::${chapterStructure.role}`;
        const existingRoleFolder = roleFoldersByProject.get(roleKey);
        const currentRoleFolder = path.dirname(file);
        if (!existingRoleFolder) {
          roleFoldersByProject.set(roleKey, currentRoleFolder);
        } else if (existingRoleFolder !== currentRoleFolder) {
          warnings.push(
            `Chapter structure warning: multiple ${chapterStructure.role} folders in project "${project_id}": ${path.relative(syncDir, existingRoleFolder)} and ${path.relative(syncDir, currentRoleFolder)}.`
          );
        }
      }

      if (mismatches.part || mismatches.chapter) {
        const details = [];
        if (mismatches.part) details.push(`part metadata ${sourceMeta.part} != path part ${derived.part}`);
        if (mismatches.chapter) details.push(`chapter metadata ${sourceMeta.chapter} != path chapter ${derived.chapter}`);
        warnings.push(
          `Path/metadata mismatch for scene "${meta.scene_id}": ${path.relative(syncDir, file)} (${details.join(", ")}). Using path-derived values.`
        );
      }

      const { data: _frontmatter, content: prose } = parseFile(file);
      const result = indexSceneFile(db, syncDir, file, meta, prose);
      if (result.warning) {
        warnings.push(result.warning);
      }
      if (chapterStructure.chapter && result.chapterId) {
        seenChapterKeys.add(`${result.chapterId}::${project_id}`);
        const chapterMapKey = `${project_id}::${chapterStructure.chapter.sort_index}`;
        const existingChapterFolder = chapterFoldersByProject.get(chapterMapKey);
        if (!existingChapterFolder) {
          chapterFoldersByProject.set(chapterMapKey, {
            title: chapterStructure.chapter.title,
            folder_key: chapterStructure.chapter.folder_key,
          });
        } else if (existingChapterFolder.folder_key !== chapterStructure.chapter.folder_key) {
          warnings.push(
            `Chapter structure warning: duplicate chapter order ${chapterStructure.chapter.sort_index} in project "${project_id}" for ${chapterStructure.chapter.folder_key} and ${existingChapterFolder.folder_key}.`
          );
        }
      }
      if (result.skippedAsEpigraph) {
        if (result.epigraphId) {
          const epigraphId = result.epigraphId;
          seenEpigraphKeys.add(`${epigraphId}::${project_id}`);
        }
        epigraphsIndexed++;
        if (result.isStale) epigraphsStaleMarked++;
        continue;
      }
      const { isStale } = result;
      indexedSceneIds.add(meta.scene_id);
      if (isStale) staleMarked++;
      indexed++;
    } catch (err) {
      sceneIndexFailures++;
      process.stderr.write(`[mcp-writing] Failed to index ${file}: ${err.message}\n`);
    }
  }

  if (canPruneScenes(syncDir) && sceneIndexFailures === 0) {
    pruneMissingScenes(db, seenSceneKeys, syncDir);
    pruneMissingEpigraphs(db, seenEpigraphKeys, syncDir);
    pruneMissingChapters(db, seenChapterKeys, syncDir);
  }

  // --- Orphaned sidecar detection ---
  const sidecars = walkSidecars(syncDir).filter(sidecar => !isNestedMirrorPath(syncDir, sidecar));
  for (const sidecar of sidecars) {
    const prose = sidecar.replace(/\.meta\.yaml$/, ".md");
    const proseTxt = sidecar.replace(/\.meta\.yaml$/, ".txt");
    if (!fs.existsSync(prose) && !fs.existsSync(proseTxt)) {
      let orphanedSceneId = null;
      try {
        const raw = fs.readFileSync(sidecar, "utf8");
        orphanedSceneId = (parseYaml(raw) ?? {}).scene_id ?? null;
      } catch { /* empty */ }

      if (orphanedSceneId && indexedSceneIds.has(orphanedSceneId)) {
        warnings.push(
          `Moved scene detected: sidecar for "${orphanedSceneId}" is at stale path ${path.relative(syncDir, sidecar)} — prose file has moved. Consider relocating the sidecar alongside the prose file.`
        );
      } else {
        const label = orphanedSceneId ? `scene "${orphanedSceneId}"` : "unknown scene";
        warnings.push(
          `Orphaned sidecar (${label}, no matching .md/.txt and not indexed): ${path.relative(syncDir, sidecar)}`
        );
      }
    }
  }

  const warningSummary = buildWarningSummary(warnings);

  if (!quiet) {
    process.stderr.write(
      `[mcp-writing] Sync complete: ${indexed} scenes indexed, ${staleMarked} scenes marked stale` +
      (epigraphsIndexed ? `, ${epigraphsIndexed} epigraphs indexed, ${epigraphsStaleMarked} epigraphs marked stale` : "") +
      (sidecarsMigrated ? `, ${sidecarsMigrated} sidecars auto-generated` : "") +
      (skipped ? `, ${skipped} files skipped` : "") + "\n"
    );
    for (const [type, entry] of Object.entries(warningSummary)) {
      const count = entry.count;
      const label = WARNING_TYPE_LABELS[type] ?? type;
      process.stderr.write(`[mcp-writing] WARNING: ${label}: ${count} file(s). First example: ${entry.examples[0]}\n`);
    }
  }
  return {
    indexed,
    staleMarked,
    epigraphsIndexed,
    epigraphsStaleMarked,
    skipped,
    sidecarsMigrated,
    warnings,
    warningSummary,
  };
}
