function chapterNotFoundError({ chapterNumber, chapterId }) {
  return {
    code: "NOT_FOUND",
    message: "Chapter not found for the provided project and identifier.",
    details: {
      chapter: chapterNumber ?? null,
      chapter_id: chapterId ?? null,
    },
  };
}

function ambiguousChapterError({ projectId, chapterNumber, candidates }) {
  return {
    code: "AMBIGUOUS_CHAPTER",
    message: `Compatibility chapter ${chapterNumber} resolves to multiple canonical chapter identities in project '${projectId}'. Use chapter_id instead.`,
    details: {
      project_id: projectId,
      chapter: chapterNumber,
      candidate_chapter_ids: candidates.map(row => row.chapter_id),
    },
  };
}

function selectCanonicalChapterById(db, { projectId, chapterId }) {
  return db.prepare(`
    SELECT chapter_id, project_id, title, sort_index, logline, metadata_stale
    FROM chapters
    WHERE project_id = ? AND chapter_id = ?
  `).get(projectId, chapterId);
}

function selectCanonicalChaptersByNumber(db, { projectId, chapterNumber }) {
  return db.prepare(`
    SELECT chapter_id, project_id, title, sort_index, logline, metadata_stale
    FROM chapters
    WHERE project_id = ? AND sort_index = ?
    ORDER BY chapter_id
  `).all(projectId, chapterNumber);
}

function selectSceneDerivedChaptersByNumber(db, { projectId, chapterNumber }) {
  return db.prepare(`
    SELECT
      chapter_id,
      project_id,
      COALESCE(MAX(chapter_title), chapter_id) AS title,
      chapter AS sort_index,
      NULL AS logline,
      MAX(metadata_stale) AS metadata_stale
    FROM scenes
    WHERE project_id = ?
      AND chapter = ?
      AND chapter_id IS NOT NULL
      AND chapter_id != ''
    GROUP BY chapter_id, project_id, chapter
    ORDER BY chapter_id
  `).all(projectId, chapterNumber);
}

export function resolveChapterByCompatibilityKey(db, { projectId, chapterNumber, chapterId }) {
  const result = resolveChapterByCompatibilityKeyDetailed(db, { projectId, chapterNumber, chapterId });
  return result?.chapter ?? null;
}

export function resolveChapterByCompatibilityKeyDetailed(db, { projectId, chapterNumber, chapterId }) {
  if (!projectId) return { chapter: null };
  if (chapterId) {
    return { chapter: selectCanonicalChapterById(db, { projectId, chapterId }) ?? null };
  }
  if (chapterNumber == null) return { chapter: null };

  const canonicalChapters = selectCanonicalChaptersByNumber(db, { projectId, chapterNumber });
  if (canonicalChapters.length > 1) {
    return { error: ambiguousChapterError({ projectId, chapterNumber, candidates: canonicalChapters }) };
  }
  if (canonicalChapters.length === 1) return { chapter: canonicalChapters[0] };

  const sceneDerivedChapters = selectSceneDerivedChaptersByNumber(db, { projectId, chapterNumber });
  if (sceneDerivedChapters.length > 1) {
    return { error: ambiguousChapterError({ projectId, chapterNumber, candidates: sceneDerivedChapters }) };
  }
  return { chapter: sceneDerivedChapters[0] ?? null };
}

export function resolveValidatedChapterFilter(db, { projectId, chapterNumber, chapterId }) {
  if (!projectId) return { chapter: null };
  if (!chapterId && chapterNumber == null) return { chapter: null };

  const resolvedById = chapterId
    ? resolveChapterByCompatibilityKeyDetailed(db, { projectId, chapterId })
    : null;
  const resolvedByNumber = chapterNumber != null
    ? resolveChapterByCompatibilityKeyDetailed(db, { projectId, chapterNumber })
    : null;

  if (resolvedById?.error) return { error: resolvedById.error };
  if (resolvedByNumber?.error) return { error: resolvedByNumber.error };

  if (chapterId && !resolvedById?.chapter) {
    return { error: chapterNotFoundError({ chapterNumber, chapterId }) };
  }
  if (chapterNumber != null && !resolvedByNumber?.chapter) {
    return { error: chapterNotFoundError({ chapterNumber, chapterId }) };
  }

  if (chapterId && chapterNumber != null) {
    if (resolvedById.chapter.chapter_id !== resolvedByNumber.chapter.chapter_id) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "chapter_id and chapter must refer to the same canonical chapter when both are provided.",
          details: {
            chapter_id: resolvedById.chapter.chapter_id,
            chapter: chapterNumber,
            resolved_chapter_id: resolvedByNumber.chapter.chapter_id,
          },
        },
      };
    }
    return { chapter: resolvedById.chapter };
  }

  return { chapter: resolvedById?.chapter ?? resolvedByNumber?.chapter ?? null };
}

export function resolveValidatedChapterNumberFilters(db, { projectId, chapterNumbers }) {
  if (!projectId || chapterNumbers == null) return { chapters: [] };
  const invalidChapterNumbers = chapterNumbers.filter(value => !Number.isInteger(value));
  if (invalidChapterNumbers.length > 0) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "chapters must contain only integer chapter numbers.",
        details: {
          project_id: projectId,
          invalid_chapters: invalidChapterNumbers,
          requested_chapters: chapterNumbers,
        },
      },
    };
  }
  const normalizedChapterNumbers = Array.from(new Set(chapterNumbers)).sort((a, b) => a - b);
  const chapters = [];
  const seenChapterIds = new Set();

  for (const chapterNumber of normalizedChapterNumbers) {
    const resolved = resolveValidatedChapterFilter(db, {
      projectId,
      chapterNumber,
    });

    if (resolved.error) {
      return {
        error: {
          ...resolved.error,
          details: {
            ...(resolved.error.details ?? {}),
            project_id: projectId,
            requested_chapters: normalizedChapterNumbers,
          },
        },
      };
    }

    if (!resolved.chapter) {
      return {
        error: {
          code: "NOT_FOUND",
          message: "Chapter not found for the provided project and identifier.",
          details: {
            project_id: projectId,
            chapter: chapterNumber,
            requested_chapters: normalizedChapterNumbers,
          },
        },
      };
    }

    if (!seenChapterIds.has(resolved.chapter.chapter_id)) {
      chapters.push(resolved.chapter);
      seenChapterIds.add(resolved.chapter.chapter_id);
    }
  }

  return {
    chapters,
    chapter_numbers: normalizedChapterNumbers,
  };
}
