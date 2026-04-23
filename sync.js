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

export function normalizeSceneMetaForPath(syncDir, filePath, meta = {}) {
  const derived = inferScenePositionFromPath(syncDir, filePath);
  const normalized = { ...meta };

  if (derived.part !== null) normalized.part = derived.part;
  if (derived.chapter !== null) normalized.chapter = derived.chapter;

  return {
    meta: normalized,
    derived,
    mismatches: {
      part: derived.part !== null && meta.part != null && meta.part !== derived.part,
      chapter: derived.chapter !== null && meta.chapter != null && meta.chapter !== derived.chapter,
    },
  };
}

// Structural directory names that are never project slugs under projects/<id>/.
const PROJECT_STRUCTURAL_DIRS = new Set(["world", "scenes", "misc", "fragments", "feedback", "draft"]);

// Cache universe project root existence checks during sync scans.
const UNIVERSE_PROJECT_ROOT_CACHE = new Map();

// Returns true for known structural path segments directly under a project root
// (named dirs like "world", "scenes", and part-N / chapter-N path segments).
function isProjectStructuralDir(name) {
  const normalized = String(name ?? "").toLowerCase();
  return PROJECT_STRUCTURAL_DIRS.has(normalized)
    || /^part-\d+$/.test(normalized)
    || /^chapter-\d+$/.test(normalized);
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
  }
}

export function indexSceneFile(db, syncDir, file, meta, prose) {
  const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);

  if (universe_id) {
    db.prepare(`INSERT OR IGNORE INTO universes (universe_id, name) VALUES (?, ?)`).run(
      universe_id, universe_id
    );
  }
  db.prepare(`INSERT OR IGNORE INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run(
    project_id, universe_id ?? null, project_id
  );

  const newChecksum = checksumProse(prose);
  const existing = db.prepare(
    `SELECT prose_checksum FROM scenes WHERE scene_id = ? AND project_id = ?`
  ).get(meta.scene_id, project_id);

  const isStale = existing && existing.prose_checksum !== newChecksum ? 1 : 0;

  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, title, part, chapter, chapter_title, pov, logline, scene_change,
      causality, stakes, scene_functions,
      save_the_cat_beat, timeline_position, story_time, word_count,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (scene_id, project_id) DO UPDATE SET
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
    meta.title ?? null, meta.part ?? null, meta.chapter ?? null, meta.chapter_title ?? null,
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

  db.prepare(`DELETE FROM scene_characters WHERE scene_id = ?`).run(meta.scene_id);
  db.prepare(`DELETE FROM scene_places WHERE scene_id = ?`).run(meta.scene_id);
  db.prepare(`DELETE FROM scene_tags WHERE scene_id = ?`).run(meta.scene_id);

  for (const c of (meta.characters ?? [])) {
    // Version continuity markers (e.g. v7.3, v3.3b) are tracked as tags, not characters
    if (/^v\d[\d.a-z]*$/i.test(c)) {
      db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run(meta.scene_id, c);
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
    db.prepare(`INSERT OR IGNORE INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run(
      meta.scene_id, cid
    );
  }
  for (const p of (meta.places ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run(
      meta.scene_id, p
    );
  }
  for (const t of (meta.tags ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run(
      meta.scene_id, t
    );
  }
  for (const v of (meta.versions ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run(
      meta.scene_id, v
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

  return { isStale };
}

const WARNING_TYPE_LABELS = {
  no_scene_id: "Skipped (no scene_id)",
  duplicate_scene_id: "Duplicate scene_id",
  path_metadata_mismatch: "Path/metadata mismatch",
  orphaned_sidecar: "Orphaned sidecar",
  moved_scene: "Moved scene",
  nested_mirror: "Ignored nested mirror path",
};

const WARNING_PATTERNS = [
  { type: "no_scene_id",            re: /^Skipped \(no scene_id\):/  },
  { type: "duplicate_scene_id",     re: /^Duplicate scene_id/        },
  { type: "path_metadata_mismatch", re: /^Path\/metadata mismatch/   },
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
  let skipped = 0;
  let sidecarsMigrated = 0;
  const seenSceneIds = new Map(); // scene_id+project_id → file path, for duplicate detection
  const indexedSceneIds = new Set(); // scene_id only — for orphaned sidecar move detection
  const warnings = [];

  const scanFiles = [];
  for (const file of files) {
    if (isNestedMirrorPath(syncDir, file)) {
      warnings.push(`Ignored nested mirror path: ${path.relative(syncDir, file)}`);
      continue;
    }
    scanFiles.push(file);
  }

  // --- Pass 1: world files (characters/places must be indexed before scenes
  // so that character name → ID resolution in scene_characters works) ---
  for (const file of scanFiles) {
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

  // --- Pass 2: scene files ---
  for (const file of scanFiles) {
    if (isWorldFile(syncDir, file)) continue;
    try {
      const { meta, sourceMeta, sidecarGenerated, derived, mismatches } = readMeta(file, syncDir, { writable });
      if (sidecarGenerated) sidecarsMigrated++;

      if (!meta.scene_id) {
        skipped++;
        if (!quiet) warnings.push(`Skipped (no scene_id): ${path.relative(syncDir, file)}`);
        continue;
      }

      // Duplicate scene_id detection
      const { project_id } = inferProjectAndUniverse(syncDir, file);
      const key = `${meta.scene_id}::${project_id}`;
      if (seenSceneIds.has(key)) {
        warnings.push(
          `Duplicate scene_id "${meta.scene_id}" in project "${project_id}":\n` +
          `  ${path.relative(syncDir, seenSceneIds.get(key))}\n` +
          `  ${path.relative(syncDir, file)}`
        );
      } else {
        seenSceneIds.set(key, file);
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
      const { isStale } = indexSceneFile(db, syncDir, file, meta, prose);
      indexedSceneIds.add(meta.scene_id);
      if (isStale) staleMarked++;
      indexed++;
    } catch (err) {
      process.stderr.write(`[mcp-writing] Failed to index ${file}: ${err.message}\n`);
    }
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
      `[mcp-writing] Sync complete: ${indexed} scenes indexed, ${staleMarked} marked stale` +
      (sidecarsMigrated ? `, ${sidecarsMigrated} sidecars auto-generated` : "") +
      (skipped ? `, ${skipped} files skipped` : "") + "\n"
    );
    for (const [type, entry] of Object.entries(warningSummary)) {
      const count = entry.count;
      const label = WARNING_TYPE_LABELS[type] ?? type;
      process.stderr.write(`[mcp-writing] WARNING: ${label}: ${count} file(s). First example: ${entry.examples[0]}\n`);
    }
  }
  return { indexed, staleMarked, skipped, sidecarsMigrated, warnings, warningSummary };
}
