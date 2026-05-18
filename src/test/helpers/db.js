import { openDb } from "../../core/db.js";

export function insertTestScene(db, {
  sceneId,
  projectId = "test-novel",
  title = null,
  part = null,
  chapter = null,
  chapterId,
  chapterTitle = null,
  timelinePosition = null,
  metadataStale = 0,
  wordCount = null,
}) {
  const now = new Date().toISOString();
  let resolvedChapterId = chapterId ?? (chapter == null ? null : `ch-${String(chapter).padStart(2, "0")}-test`);
  let resolvedChapterTitle = chapterTitle ?? (chapter == null ? null : `Chapter ${chapter}`);

  if (resolvedChapterId && chapter != null) {
    const existingChapter = db.prepare(`
      SELECT chapter_id, title
      FROM chapters
      WHERE project_id = ? AND sort_index = ?
    `).get(projectId, chapter);

    if (existingChapter) {
      if (chapterId != null && existingChapter.chapter_id !== chapterId) {
        throw new Error(
          `insertTestScene chapterId '${chapterId}' conflicts with existing chapter '${existingChapter.chapter_id}' for project '${projectId}' chapter ${chapter}.`
        );
      }
      resolvedChapterId = existingChapter.chapter_id;
      resolvedChapterTitle = chapterTitle ?? existingChapter.title ?? resolvedChapterTitle;
    } else {
      db.prepare(`
        INSERT INTO chapters (
          chapter_id, project_id, title, sort_index, source_path, source_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resolvedChapterId,
        projectId,
        resolvedChapterTitle,
        chapter,
        `/tmp/chapter-${chapter}`,
        null,
        metadataStale,
        now
      );
    }
  }

  db.prepare(`
    INSERT INTO scenes (
      scene_id,
      project_id,
      chapter_id,
      title,
      part,
      chapter,
      chapter_title,
      timeline_position,
      word_count,
      file_path,
      prose_checksum,
      metadata_stale,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    resolvedChapterId,
    title,
    part,
    chapter,
    resolvedChapterTitle,
    timelinePosition,
    wordCount,
    `/tmp/${sceneId}.md`,
    "deadbeef",
    metadataStale,
    now
  );
}

export function setupReviewBundleTestDb() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("test-novel", null, "Test Novel");
  return db;
}
