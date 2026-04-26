import { openDb } from "../../db.js";

export function insertTestScene(db, {
  sceneId,
  projectId = "test-novel",
  title = null,
  part = null,
  chapter = null,
  timelinePosition = null,
  metadataStale = 0,
  wordCount = null,
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO scenes (
      scene_id,
      project_id,
      title,
      part,
      chapter,
      timeline_position,
      word_count,
      file_path,
      prose_checksum,
      metadata_stale,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    title,
    part,
    chapter,
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
