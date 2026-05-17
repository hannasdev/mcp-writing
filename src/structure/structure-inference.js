import path from "node:path";

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

export function slugifyChapterValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isExplicitChapterContainer(parts, index) {
  const parent = parts[index - 1]?.toLowerCase() ?? null;
  return parent === "draft" || parent === "scenes";
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
    if (!match || !isExplicitChapterContainer(parts, index)) continue;

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
      source_kind: chapterFolder ? "chapter_folder" : "legacy_layout",
    },
  };
}

export function buildSceneStructurePatch(syncDir, filePath, meta = {}, { chapter } = {}) {
  const derived = inferScenePositionFromPath(syncDir, filePath);
  const chapterStructure = inferChapterStructureFromPath(syncDir, filePath, meta);
  const patch = {};

  if (derived.part !== null) patch.part = derived.part;
  if (derived.chapter !== null) patch.chapter = derived.chapter;
  if (chapterStructure.chapter?.chapter_id) {
    patch.chapter_id = chapterStructure.chapter.chapter_id;
    patch.chapter = chapterStructure.chapter.sort_index;
    patch.chapter_title = chapterStructure.chapter.title;
  }
  if (chapterStructure.role) {
    patch.scene_role = chapterStructure.role;
  }
  if (chapter !== undefined) {
    if (chapter === null) {
      patch.chapter_id = null;
      patch.chapter = null;
      patch.chapter_title = null;
    } else {
      patch.chapter_id = chapter.chapter_id;
      patch.chapter = chapter.sort_index;
      patch.chapter_title = chapter.title ?? null;
    }
  }

  return {
    patch,
    derived,
    chapterStructure,
    mismatches: {
      part: derived.part !== null && meta.part != null && meta.part !== derived.part,
      chapter: derived.chapter !== null && meta.chapter != null && meta.chapter !== derived.chapter,
    },
  };
}

export function applySceneStructurePatch(syncDir, filePath, meta = {}, options = {}) {
  const plan = buildSceneStructurePatch(syncDir, filePath, meta, options);
  return {
    ...plan,
    meta: { ...meta, ...plan.patch },
  };
}

export function normalizeSceneMetaForPath(syncDir, filePath, meta = {}) {
  return applySceneStructurePatch(syncDir, filePath, meta);
}
