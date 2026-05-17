import fs from "node:fs";
import path from "node:path";

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
