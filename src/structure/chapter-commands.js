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

export function buildRenameChapterPlan(db, {
  projectId,
  chapterId,
  title,
  updatedAt = new Date().toISOString(),
}) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";

  if (!normalizedTitle) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide a non-empty chapter title.",
      },
    };
  }

  const chapter = db.prepare(`
    SELECT chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale
    FROM chapters
    WHERE project_id = ? AND chapter_id = ?
  `).get(projectId, chapterId);
  if (!chapter) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Chapter '${chapterId}' not found in project '${projectId}'.`,
        details: { project_id: projectId, chapter_id: chapterId },
      },
    };
  }

  const existingByTitle = db.prepare(`
    SELECT chapter_id, title, sort_index
    FROM chapters
    WHERE project_id = ? AND title = ? AND chapter_id != ?
  `).get(projectId, normalizedTitle, chapterId);
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
        },
      },
    };
  }

  const diagnostics = [];
  if (chapter.source_path) {
    diagnostics.push({
      code: "REPRESENTATION_NOT_RENAMED",
      severity: "warning",
      message: "Renamed canonical chapter state and explicit scene compatibility fields only; the existing chapter source folder was not renamed.",
      next_step: "Run diagnose_structure after sync if folder-derived structure still reports the old title.",
      details: {
        source_path: chapter.source_path,
      },
    });
  }

  return {
    ok: true,
    previousChapter: chapter,
    chapter: {
      ...chapter,
      title: normalizedTitle,
      updated_at: updatedAt,
    },
    diagnostics,
  };
}

export function buildReorderChapterPlan(db, {
  projectId,
  chapterId,
  sortIndex,
  updatedAt = new Date().toISOString(),
}) {
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

  const chapter = db.prepare(`
    SELECT chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale
    FROM chapters
    WHERE project_id = ? AND chapter_id = ?
  `).get(projectId, chapterId);
  if (!chapter) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Chapter '${chapterId}' not found in project '${projectId}'.`,
        details: { project_id: projectId, chapter_id: chapterId },
      },
    };
  }

  const existingBySortIndex = db.prepare(`
    SELECT chapter_id, title, sort_index
    FROM chapters
    WHERE project_id = ? AND sort_index = ? AND chapter_id != ?
  `).get(projectId, sortIndex, chapterId);
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
          next_step: "Choose an unused sort_index. Automatic resequencing is not part of this command yet.",
        },
      },
    };
  }

  const diagnostics = [];
  if (chapter.source_path) {
    diagnostics.push({
      code: "REPRESENTATION_NOT_REORDERED",
      severity: "warning",
      message: "Reordered canonical chapter state and explicit scene compatibility fields only; the existing chapter source folder was not renamed or moved.",
      next_step: "Run diagnose_structure after sync if folder-derived structure still reports the old order.",
      details: {
        source_path: chapter.source_path,
      },
    });
  }

  return {
    ok: true,
    previousChapter: chapter,
    chapter: {
      ...chapter,
      sort_index: sortIndex,
      updated_at: updatedAt,
    },
    diagnostics,
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

export function renameCanonicalChapter(db, chapter) {
  db.prepare(`
    UPDATE chapters
    SET title = ?,
        updated_at = ?
    WHERE project_id = ? AND chapter_id = ?
  `).run(
    chapter.title,
    chapter.updated_at,
    chapter.project_id,
    chapter.chapter_id
  );

  db.prepare(`
    UPDATE scenes
    SET chapter_title = ?,
        updated_at = ?
    WHERE project_id = ? AND chapter_id = ?
  `).run(
    chapter.title,
    chapter.updated_at,
    chapter.project_id,
    chapter.chapter_id
  );
}

export function reorderCanonicalChapter(db, chapter) {
  db.prepare(`
    UPDATE chapters
    SET sort_index = ?,
        updated_at = ?
    WHERE project_id = ? AND chapter_id = ?
  `).run(
    chapter.sort_index,
    chapter.updated_at,
    chapter.project_id,
    chapter.chapter_id
  );

  db.prepare(`
    UPDATE scenes
    SET chapter = ?,
        chapter_title = ?,
        updated_at = ?
    WHERE project_id = ? AND chapter_id = ?
  `).run(
    chapter.sort_index,
    chapter.title,
    chapter.updated_at,
    chapter.project_id,
    chapter.chapter_id
  );
}
