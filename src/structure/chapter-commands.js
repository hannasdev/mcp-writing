import { slugifyChapterValue } from "./structure-inference.js";

export function deriveCanonicalChapterId({ chapterId, sortIndex, title }) {
  if (chapterId) return chapterId;
  const slug = slugifyChapterValue(title) || `chapter-${sortIndex}`;
  return `ch-${String(sortIndex).padStart(2, "0")}-${slug}`;
}

export function buildCreateChapterPlan(db, {
  projectId,
  title,
  sortIndex,
  chapterId,
  logline = null,
  updatedAt = new Date().toISOString(),
}) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedChapterId = typeof chapterId === "string" ? chapterId.trim() : null;
  const normalizedLogline = typeof logline === "string" && logline.trim() ? logline.trim() : null;

  if (!normalizedTitle) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide a non-empty chapter title.",
      },
    };
  }

  if (!Number.isInteger(sortIndex) || sortIndex < 1) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "sort_index must be a positive integer.",
        details: { sort_index: sortIndex },
      },
    };
  }

  const project = db.prepare(`
    SELECT project_id
    FROM projects
    WHERE project_id = ?
  `).get(projectId);
  if (!project) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Project '${projectId}' not found.`,
        details: { project_id: projectId },
      },
    };
  }

  const resolvedChapterId = deriveCanonicalChapterId({
    chapterId: normalizedChapterId,
    sortIndex,
    title: normalizedTitle,
  });

  const existingById = db.prepare(`
    SELECT chapter_id, title, sort_index
    FROM chapters
    WHERE project_id = ? AND chapter_id = ?
  `).get(projectId, resolvedChapterId);
  if (existingById) {
    return {
      ok: false,
      error: {
        code: "ALREADY_EXISTS",
        message: `Chapter '${resolvedChapterId}' already exists in project '${projectId}'.`,
        details: {
          project_id: projectId,
          chapter_id: resolvedChapterId,
          existing_title: existingById.title,
          existing_sort_index: existingById.sort_index,
        },
      },
    };
  }

  const existingBySortIndex = db.prepare(`
    SELECT chapter_id, title, sort_index
    FROM chapters
    WHERE project_id = ? AND sort_index = ?
  `).get(projectId, sortIndex);
  if (existingBySortIndex) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `Chapter sort_index ${sortIndex} is already used in project '${projectId}'.`,
        details: {
          project_id: projectId,
          sort_index: sortIndex,
          existing_chapter_id: existingBySortIndex.chapter_id,
          existing_title: existingBySortIndex.title,
          next_step: "Use list_chapters to choose an unused sort_index, or wait for reorder_chapter when changing existing order.",
        },
      },
    };
  }

  const existingByTitle = db.prepare(`
    SELECT chapter_id, title, sort_index
    FROM chapters
    WHERE project_id = ? AND title = ?
  `).get(projectId, normalizedTitle);
  if (existingByTitle) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `Chapter title '${normalizedTitle}' is already used in project '${projectId}'.`,
        details: {
          project_id: projectId,
          title: normalizedTitle,
          existing_chapter_id: existingByTitle.chapter_id,
          existing_sort_index: existingByTitle.sort_index,
          next_step: "Use a distinct title, or wait for rename_chapter when changing an existing chapter title.",
        },
      },
    };
  }

  return {
    ok: true,
    chapter: {
      chapter_id: resolvedChapterId,
      project_id: projectId,
      title: normalizedTitle,
      sort_index: sortIndex,
      logline: normalizedLogline,
      source_path: null,
      source_checksum: null,
      metadata_stale: 0,
      updated_at: updatedAt,
    },
    diagnostics: [
      {
        code: "REPRESENTATION_DEFERRED",
        severity: "info",
        message: "Created canonical chapter state only; no scene files, sidecars, or Scrivener-compatible folders were generated.",
        next_step: "Use assign_scene_to_chapter to place unchaptered scenes in this chapter, then run diagnose_structure if folder-derived structure may disagree.",
      },
    ],
  };
}

export function insertCanonicalChapter(db, chapter) {
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chapter.chapter_id,
    chapter.project_id,
    chapter.title,
    chapter.sort_index,
    chapter.logline,
    chapter.source_path,
    chapter.source_checksum,
    chapter.metadata_stale,
    chapter.updated_at
  );
}
