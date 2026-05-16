export function resolveChapterByCompatibilityKey(db, { projectId, chapterNumber, chapterId }) {
  if (!projectId) return null;
  if (chapterId) {
    return db.prepare(`
      SELECT chapter_id, project_id, title, sort_index, logline, metadata_stale
      FROM chapters
      WHERE project_id = ? AND chapter_id = ?
    `).get(projectId, chapterId);
  }
  if (chapterNumber == null) return null;

  const canonicalChapter = db.prepare(`
    SELECT chapter_id, project_id, title, sort_index, logline, metadata_stale
    FROM chapters
    WHERE project_id = ? AND sort_index = ?
  `).get(projectId, chapterNumber);
  if (canonicalChapter) return canonicalChapter;

  return db.prepare(`
    SELECT chapter_id, project_id, chapter_title AS title, chapter AS sort_index, NULL AS logline, MAX(metadata_stale) AS metadata_stale
    FROM scenes
    WHERE project_id = ? AND chapter = ? AND chapter_id IS NOT NULL
    GROUP BY chapter_id, project_id, chapter_title, chapter
    ORDER BY chapter_id
    LIMIT 1
  `).get(projectId, chapterNumber);
}

export function resolveValidatedChapterFilter(db, { projectId, chapterNumber, chapterId }) {
  if (!projectId) return { chapter: null };
  if (!chapterId && chapterNumber == null) return { chapter: null };

  const resolvedById = chapterId
    ? resolveChapterByCompatibilityKey(db, { projectId, chapterId })
    : null;
  const resolvedByNumber = chapterNumber != null
    ? resolveChapterByCompatibilityKey(db, { projectId, chapterNumber })
    : null;

  if (chapterId && chapterNumber != null) {
    if (!resolvedById || !resolvedByNumber) {
      return {
        error: {
          code: "NOT_FOUND",
          message: "Chapter not found for the provided project and identifier.",
        },
      };
    }
    if (resolvedById.chapter_id !== resolvedByNumber.chapter_id) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "chapter_id and chapter must refer to the same canonical chapter when both are provided.",
        },
      };
    }
    return { chapter: resolvedById };
  }

  return { chapter: resolvedById ?? resolvedByNumber ?? null };
}
