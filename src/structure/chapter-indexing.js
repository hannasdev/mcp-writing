import fs from "node:fs";
import path from "node:path";
import { slugifyChapterValue } from "./structure-inference.js";

function deriveChapterId(chapterId, sortIndex, title) {
  return chapterId
    ?? (sortIndex != null && title
      ? `ch-${String(sortIndex).padStart(2, "0")}-${slugifyChapterValue(title) || `chapter-${sortIndex}`}`
      : null);
}

export function resolveCanonicalChapterRecord(db, {
  syncDir,
  projectId,
  derivedChapterId,
  sortIndex,
  title,
  sourcePath,
  allowSourcePathMatch = false,
}) {
  if (!projectId || sortIndex == null || !title) return null;

  const normalizedSourcePath = sourcePath ?? null;
  const bySourcePath = allowSourcePathMatch && normalizedSourcePath
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

  const byTitle = db.prepare(`
    SELECT chapter_id, title, sort_index, logline, source_path, source_checksum, metadata_stale
    FROM chapters
    WHERE project_id = ? AND title = ?
    ORDER BY chapter_id
  `).all(projectId, title);

  if (byTitle.length === 1) {
    const existingTitleSourcePath = byTitle[0].source_path ?? null;
    const existingTitleSourceExists = Boolean(
      syncDir
      && existingTitleSourcePath
      && fs.existsSync(path.join(syncDir, existingTitleSourcePath))
    );
    const canReuseByTitle = allowSourcePathMatch || byTitle[0].sort_index === sortIndex;
    if (canReuseByTitle && (!existingTitleSourceExists || existingTitleSourcePath === normalizedSourcePath)) {
      return {
        ...byTitle[0],
        chapter_id: byTitle[0].chapter_id,
        title,
        sort_index: sortIndex,
        source_path: normalizedSourcePath,
      };
    }
  }

  if (byTitle.length > 1) {
    return null;
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

export function parkConflictingChapterSortIndex(db, { projectId, chapterId, targetSortIndex }) {
  if (!projectId || !chapterId || targetSortIndex == null) return;

  const conflictingChapter = db.prepare(`
    SELECT chapter_id, sort_index
    FROM chapters
    WHERE project_id = ? AND sort_index = ? AND chapter_id != ?
  `).get(projectId, targetSortIndex, chapterId);

  if (!conflictingChapter) return;

  db.prepare(`
    UPDATE chapters
    SET sort_index = ?
    WHERE project_id = ? AND chapter_id = ?
  `).run(-1000000 - Number(conflictingChapter.sort_index), projectId, conflictingChapter.chapter_id);
}

export function upsertCanonicalChapterRecord(db, {
  projectId,
  chapterId,
  sortIndex,
  title,
  sourcePath,
  logline,
  buildSourceChecksum,
  updatedAt = new Date().toISOString(),
}) {
  if (!projectId || !chapterId || sortIndex == null || !title) return null;

  parkConflictingChapterSortIndex(db, {
    projectId,
    chapterId,
    targetSortIndex: sortIndex,
  });

  const existingChapter = db.prepare(
    `SELECT logline, source_checksum, metadata_stale FROM chapters WHERE chapter_id = ? AND project_id = ?`
  ).get(chapterId, projectId);
  const chapterLogline = logline ?? existingChapter?.logline ?? null;
  const chapterChecksum = buildSourceChecksum({
    sortIndex,
    title,
    logline: chapterLogline,
  });

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
    projectId,
    title,
    sortIndex,
    chapterLogline,
    sourcePath,
    chapterChecksum,
    existingChapter && existingChapter.source_checksum !== chapterChecksum ? 1 : 0,
    updatedAt
  );

  return {
    chapterId,
    logline: chapterLogline,
    sourceChecksum: chapterChecksum,
    metadataStale: existingChapter && existingChapter.source_checksum !== chapterChecksum ? 1 : 0,
  };
}

export function resolveIndexedChapterForFile(db, {
  syncDir,
  projectId,
  filePath,
  relativePath,
  meta = {},
  chapterStructure,
}) {
  let chapterId = meta.chapter_id ?? chapterStructure.chapter?.chapter_id ?? null;
  let chapterSortIndex = chapterStructure.chapter?.sort_index ?? meta.chapter ?? null;
  let chapterTitle = chapterStructure.chapter?.title ?? meta.chapter_title ?? (chapterSortIndex != null ? `Chapter ${chapterSortIndex}` : null);
  const chapterSourcePath = chapterStructure.chapter?.folder_key ?? path.dirname(filePath);
  const allowChapterSourcePathMatch = chapterStructure.chapter?.source_kind === "chapter_folder";
  let chapterWarning = null;
  let shouldUpsertChapter = false;
  const explicitSceneChapterId = !chapterStructure.isEpigraph ? meta.chapter_id ?? null : null;
  let explicitSceneCanonicalChapter = null;

  if (explicitSceneChapterId && !chapterStructure.chapter) {
    explicitSceneCanonicalChapter = db.prepare(`
      SELECT chapter_id, sort_index, title
      FROM chapters
      WHERE chapter_id = ? AND project_id = ?
    `).get(explicitSceneChapterId, projectId);
    if (explicitSceneCanonicalChapter) {
      chapterId = explicitSceneCanonicalChapter.chapter_id;
      chapterSortIndex = explicitSceneCanonicalChapter.sort_index ?? null;
      chapterTitle = explicitSceneCanonicalChapter.title ?? null;
    } else {
      chapterSortIndex = null;
      chapterTitle = null;
    }
  }

  const derivedChapterId = deriveChapterId(chapterId, chapterSortIndex, chapterTitle);

  if (!explicitSceneCanonicalChapter && chapterSortIndex != null && chapterTitle) {
    const canonicalChapter = resolveCanonicalChapterRecord(db, {
      syncDir,
      projectId,
      derivedChapterId,
      sortIndex: chapterSortIndex,
      title: chapterTitle,
      sourcePath: chapterSourcePath,
      allowSourcePathMatch: allowChapterSourcePathMatch,
    });
    if (canonicalChapter?.ambiguous) {
      chapterWarning = `Chapter structure warning: duplicate chapter order ${chapterSortIndex} in project "${projectId}" for ${canonicalChapter.existingSourcePath} and ${canonicalChapter.conflictingSourcePath}.`;
      chapterId = null;
    } else {
      chapterId = canonicalChapter?.chapter_id ?? chapterId;
    }
    shouldUpsertChapter = Boolean(chapterId);
  }

  if (!chapterStructure.isEpigraph && chapterId && (chapterSortIndex == null || !chapterTitle)) {
    const canonicalChapter = db.prepare(`
      SELECT chapter_id, sort_index, title
      FROM chapters
      WHERE chapter_id = ? AND project_id = ?
    `).get(chapterId, projectId);
    if (!canonicalChapter) {
      chapterWarning = `Scene references unknown chapter_id '${chapterId}': ${relativePath}`;
      chapterId = null;
    } else {
      chapterSortIndex = chapterSortIndex ?? canonicalChapter.sort_index ?? null;
      chapterTitle = chapterTitle ?? canonicalChapter.title ?? null;
    }
  }

  return {
    chapterId,
    chapterSortIndex,
    chapterTitle,
    chapterSourcePath,
    chapterWarning,
    upsertChapter: shouldUpsertChapter
      ? {
        chapterId,
        sortIndex: chapterSortIndex,
        title: chapterTitle,
        sourcePath: chapterSourcePath,
        logline: meta.chapter_logline,
      }
      : null,
  };
}
