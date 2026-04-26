import { DatabaseSync } from "node:sqlite";

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS universes (
    universe_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    project_id  TEXT PRIMARY KEY,
    universe_id TEXT REFERENCES universes(universe_id),
    name        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scenes (
    scene_id          TEXT NOT NULL,
    project_id        TEXT NOT NULL REFERENCES projects(project_id),
    title             TEXT,
    part              INTEGER,
    chapter           INTEGER,
    chapter_title     TEXT,
    pov               TEXT,
    logline           TEXT,
    scene_change      TEXT,
    causality         INTEGER,
    stakes            INTEGER,
    scene_functions   TEXT,
    save_the_cat_beat TEXT,
    timeline_position INTEGER,
    story_time        TEXT,
    word_count        INTEGER,
    file_path         TEXT NOT NULL,
    prose_checksum    TEXT,
    metadata_stale    INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (scene_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS scene_characters (
    scene_id     TEXT NOT NULL,
    character_id TEXT NOT NULL,
    PRIMARY KEY (scene_id, character_id)
  );

  CREATE TABLE IF NOT EXISTS scene_places (
    scene_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    PRIMARY KEY (scene_id, place_id)
  );

  CREATE TABLE IF NOT EXISTS scene_tags (
    scene_id TEXT NOT NULL,
    tag      TEXT NOT NULL,
    PRIMARY KEY (scene_id, tag)
  );

  CREATE TABLE IF NOT EXISTS scene_threads (
    scene_id  TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    beat      TEXT,
    PRIMARY KEY (scene_id, thread_id)
  );

  CREATE TABLE IF NOT EXISTS characters (
    character_id     TEXT NOT NULL PRIMARY KEY,
    project_id       TEXT,
    universe_id      TEXT,
    name             TEXT NOT NULL,
    role             TEXT,
    arc_summary      TEXT,
    first_appearance TEXT,
    file_path        TEXT
  );

  CREATE TABLE IF NOT EXISTS character_traits (
    character_id TEXT NOT NULL,
    trait        TEXT NOT NULL,
    PRIMARY KEY (character_id, trait)
  );

  CREATE TABLE IF NOT EXISTS character_relationships (
    from_character    TEXT NOT NULL,
    to_character      TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    strength          TEXT,
    scene_id          TEXT,
    note              TEXT
  );

  CREATE TABLE IF NOT EXISTS places (
    place_id    TEXT NOT NULL PRIMARY KEY,
    project_id  TEXT,
    universe_id TEXT,
    name        TEXT NOT NULL,
    file_path   TEXT
  );

  CREATE TABLE IF NOT EXISTS threads (
    thread_id  TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS reference_docs (
    doc_id      TEXT NOT NULL PRIMARY KEY,
    project_id  TEXT,
    universe_id TEXT,
    title       TEXT NOT NULL,
    file_path   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reference_doc_tags (
    doc_id TEXT NOT NULL,
    tag    TEXT NOT NULL,
    PRIMARY KEY (doc_id, tag)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS scenes_fts USING fts5(
    scene_id, project_id, logline, title, keywords
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
`;

// Each function is applied exactly once, in order, when version < its index+1.
// Each migration runs inside a transaction with the version bump — crash-safe.
// Migrations must be idempotent (guard against already-applied state).
// Never edit existing entries — add new ones at the end.
const MIGRATIONS = [
  // 1: add chapter_title column to scenes
  (db) => {
    const sceneColumns = db.prepare(`PRAGMA table_info(scenes)`).all();
    if (!sceneColumns.some(c => c.name === "chapter_title")) {
      db.exec(`ALTER TABLE scenes ADD COLUMN chapter_title TEXT;`);
    }
  },
  // 2: rebuild FTS table to include keywords column (preserve existing rows)
  (db) => {
    const ftsSql = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scenes_fts'
    `).get()?.sql;
    if (typeof ftsSql === "string" && !ftsSql.toLowerCase().includes("keywords")) {
      db.exec(`
        CREATE VIRTUAL TABLE scenes_fts_migrating USING fts5(
          scene_id, project_id, logline, title, keywords
        );
      `);
      db.exec(`
        INSERT INTO scenes_fts_migrating (scene_id, project_id, logline, title, keywords)
        SELECT scene_id, project_id, logline, title, ''
        FROM scenes_fts;
      `);
      db.exec(`DROP TABLE scenes_fts;`);
      db.exec(`ALTER TABLE scenes_fts_migrating RENAME TO scenes_fts;`);
    }
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

function applyMigrations(db) {
  db.prepare(`INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0)`).run();
  const version = db.prepare(`SELECT version FROM schema_version WHERE id = 1`).get().version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec(`BEGIN IMMEDIATE;`);
    try {
      MIGRATIONS[i](db);
      db.prepare(`UPDATE schema_version SET version = ? WHERE id = 1`).run(i + 1);
      db.exec(`COMMIT;`);
    } catch (err) {
      db.exec(`ROLLBACK;`);
      throw err;
    }
  }
}

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  applyMigrations(db);
  return db;
}
