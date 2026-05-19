export function indexCanonicalEpigraph(db, {
  projectId,
  chapterId,
  chapterSortIndex,
  chapterStructure,
  meta = {},
  prose,
  file,
  relativePath,
  chapterWarning = null,
  buildProseChecksum,
  buildDefaultEpigraphId,
  managedStructure = false,
  updatedAt = new Date().toISOString(),
}) {
  const defaultEpigraphId = chapterId
    ? buildDefaultEpigraphId({ projectId, chapterId })
    : null;
  const requestedEpigraphId = meta.epigraph_id ?? defaultEpigraphId;
  const epigraphChecksum = buildProseChecksum(prose);

  if (managedStructure) {
    const existingEpigraph = db.prepare(`
      SELECT epigraph_id, chapter_id, prose_checksum
      FROM epigraphs
      WHERE project_id = ? AND file_path = ?
      LIMIT 1
    `).get(projectId, file);

    if (!existingEpigraph) {
      return {
        isStale: 0,
        skippedAsEpigraph: true,
        warning: `Managed structure sync ignored file-derived epigraph linkage: ${relativePath}`,
      };
    }

    const epigraphIsStale = existingEpigraph.prose_checksum !== null && existingEpigraph.prose_checksum !== epigraphChecksum ? 1 : 0;
    db.prepare(`
      UPDATE epigraphs
      SET body = ?,
          file_path = ?,
          prose_checksum = ?,
          metadata_stale = CASE
            WHEN ? != prose_checksum THEN 1
            ELSE metadata_stale
          END,
          updated_at = ?
      WHERE epigraph_id = ? AND project_id = ?
    `).run(
      prose,
      file,
      epigraphChecksum,
      epigraphChecksum,
      updatedAt,
      existingEpigraph.epigraph_id,
      projectId
    );

    return {
      isStale: epigraphIsStale,
      skippedAsEpigraph: true,
      epigraphIndexed: true,
      chapterId: existingEpigraph.chapter_id,
      epigraphId: existingEpigraph.epigraph_id,
      warning: requestedEpigraphId && requestedEpigraphId !== existingEpigraph.epigraph_id
        ? `Managed structure sync ignored file-derived epigraph_id '${requestedEpigraphId}': ${relativePath}`
        : chapterId && chapterId !== existingEpigraph.chapter_id
          ? `Managed structure sync ignored file-derived epigraph linkage: ${relativePath}`
          : null,
    };
  }

  const canonicalChapter = chapterId
    ? db.prepare(`SELECT chapter_id FROM chapters WHERE chapter_id = ? AND project_id = ?`).get(chapterId, projectId)
    : null;
  if (!chapterId || !canonicalChapter) {
    const reason = chapterWarning
      ?? (chapterId
        ? `Epigraph references unknown chapter_id '${chapterId}': ${relativePath}`
        : null)
      ?? (chapterStructure.chapter && chapterSortIndex != null
        ? `Ambiguous chapter linkage from duplicate chapter order ${chapterSortIndex}: ${relativePath}`
        : `Epigraph requires explicit chapter linkage: ${relativePath}`);
    return { isStale: 0, skippedAsEpigraph: true, warning: reason };
  }

  const epigraphById = db.prepare(`
    SELECT epigraph_id, chapter_id, prose_checksum
    FROM epigraphs
    WHERE epigraph_id = ? AND project_id = ?
  `).get(requestedEpigraphId, projectId);
  const epigraphByChapter = db.prepare(`
    SELECT epigraph_id, chapter_id, prose_checksum
    FROM epigraphs
    WHERE chapter_id = ? AND project_id = ?
  `).get(chapterId, projectId);

  if (
    epigraphById
    && epigraphById.chapter_id !== chapterId
    && (!epigraphByChapter || epigraphByChapter.epigraph_id !== epigraphById.epigraph_id)
  ) {
    return {
      isStale: 0,
      skippedAsEpigraph: true,
      warning: `Epigraph identity conflict for chapter '${chapterId}': requested epigraph_id '${requestedEpigraphId}' already belongs to another chapter in project '${projectId}'.`,
    };
  }

  const existingEpigraph = epigraphByChapter ?? epigraphById ?? null;
  const epigraphId = meta.epigraph_id
    ? requestedEpigraphId
    : (epigraphByChapter?.epigraph_id ?? requestedEpigraphId);
  const previousEpigraphId = existingEpigraph?.epigraph_id ?? epigraphId;
  const existingChecksum = existingEpigraph?.prose_checksum ?? null;
  const epigraphIsStale = existingChecksum !== null && existingChecksum !== epigraphChecksum ? 1 : 0;

  if (existingEpigraph) {
    db.prepare(`
      UPDATE epigraphs
      SET epigraph_id = ?,
          chapter_id = ?,
          body = ?,
          file_path = ?,
          prose_checksum = ?,
          metadata_stale = CASE
            WHEN ? != prose_checksum THEN 1
            ELSE metadata_stale
          END,
          updated_at = ?
      WHERE epigraph_id = ? AND project_id = ?
    `).run(
      epigraphId,
      chapterId,
      prose,
      file,
      epigraphChecksum,
      epigraphChecksum,
      updatedAt,
      previousEpigraphId,
      projectId
    );
  } else {
    db.prepare(`
      INSERT INTO epigraphs (
        epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epigraphId,
      projectId,
      chapterId,
      prose,
      file,
      epigraphChecksum,
      0,
      updatedAt
    );
  }

  db.prepare(`DELETE FROM epigraph_characters WHERE epigraph_id = ? AND project_id = ?`).run(previousEpigraphId, projectId);
  db.prepare(`DELETE FROM epigraph_tags WHERE epigraph_id = ? AND project_id = ?`).run(previousEpigraphId, projectId);
  if (previousEpigraphId !== epigraphId) {
    db.prepare(`DELETE FROM epigraph_characters WHERE epigraph_id = ? AND project_id = ?`).run(epigraphId, projectId);
    db.prepare(`DELETE FROM epigraph_tags WHERE epigraph_id = ? AND project_id = ?`).run(epigraphId, projectId);
  }
  for (const characterId of (meta.characters ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO epigraph_characters (epigraph_id, project_id, character_id) VALUES (?, ?, ?)`)
      .run(epigraphId, projectId, characterId);
  }
  for (const tag of (meta.tags ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO epigraph_tags (epigraph_id, project_id, tag) VALUES (?, ?, ?)`)
      .run(epigraphId, projectId, tag);
  }

  return {
    isStale: epigraphIsStale,
    skippedAsEpigraph: true,
    epigraphIndexed: true,
    chapterId,
    epigraphId,
  };
}
