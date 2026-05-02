import { DatabaseSync } from "node:sqlite";

const dbStartupWarnings = [];

export function getDbStartupWarnings() {
  return dbStartupWarnings.map((warning) => ({
    ...warning,
    details: warning.details ? { ...warning.details } : warning.details,
  }));
}

function resetDbStartupWarnings() {
  dbStartupWarnings.length = 0;
}

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
    project_id   TEXT NOT NULL,
    character_id TEXT NOT NULL,
    PRIMARY KEY (scene_id, project_id, character_id)
  );

  CREATE TABLE IF NOT EXISTS scene_places (
    scene_id   TEXT NOT NULL,
    project_id TEXT NOT NULL,
    place_id   TEXT NOT NULL,
    PRIMARY KEY (scene_id, project_id, place_id)
  );

  CREATE TABLE IF NOT EXISTS scene_tags (
    scene_id   TEXT NOT NULL,
    project_id TEXT NOT NULL,
    tag        TEXT NOT NULL,
    PRIMARY KEY (scene_id, project_id, tag)
  );

  CREATE TABLE IF NOT EXISTS scene_threads (
    scene_id   TEXT NOT NULL,
    project_id TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    beat       TEXT,
    PRIMARY KEY (scene_id, project_id, thread_id)
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
    type        TEXT,
    title       TEXT NOT NULL,
    summary     TEXT,
    file_path   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reference_doc_tags (
    doc_id TEXT NOT NULL,
    tag    TEXT NOT NULL,
    PRIMARY KEY (doc_id, tag)
  );

  CREATE TABLE IF NOT EXISTS reference_links (
    source_kind   TEXT NOT NULL,
    source_project_id TEXT NOT NULL DEFAULT '',
    source_id     TEXT NOT NULL,
    target_doc_id TEXT NOT NULL,
    relation      TEXT NOT NULL,
    origin        TEXT NOT NULL DEFAULT 'inferred',
    PRIMARY KEY (source_kind, source_project_id, source_id, target_doc_id, relation)
  );

  CREATE INDEX IF NOT EXISTS idx_reference_links_target_doc_id
    ON reference_links(target_doc_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS scenes_fts USING fts5(
    scene_id, project_id, logline, title, keywords
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS reference_docs_fts USING fts5(
    doc_id, project_id, title, summary, tags
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS async_jobs (
    job_id      TEXT NOT NULL PRIMARY KEY,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT,
    error       TEXT,
    result_json TEXT
  );
`;

// Each function is applied exactly once, in order, when version < its index+1.
// Each migration runs inside a transaction with the version bump — crash-safe.
// Migrations must be idempotent (guard against already-applied state).
// Never edit existing entries — add new ones at the end.
function migrateSceneJoinTableToProjectScope(db, tableName, tableSql, insertSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === "project_id")) {
    return {
      migrated: false,
      sourceCount: 0,
      migratedCount: 0,
      droppedCount: 0,
    };
  }

  const sourceCount = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0;
  db.exec(tableSql);
  db.exec(insertSql);
  const migratedCount = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}_migrating`).get()?.count ?? 0;
  const droppedCount = Math.max(0, sourceCount - migratedCount);
  db.exec(`DROP TABLE ${tableName};`);
  db.exec(`ALTER TABLE ${tableName}_migrating RENAME TO ${tableName};`);

  return {
    migrated: true,
    sourceCount,
    migratedCount,
    droppedCount,
  };
}

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
  // 3: add lightweight reference-doc metadata columns and FTS table
  (db) => {
    const referenceDocColumns = db.prepare(`PRAGMA table_info(reference_docs)`).all();
    if (!referenceDocColumns.some(c => c.name === "type")) {
      db.exec(`ALTER TABLE reference_docs ADD COLUMN type TEXT;`);
    }
    if (!referenceDocColumns.some(c => c.name === "summary")) {
      db.exec(`ALTER TABLE reference_docs ADD COLUMN summary TEXT;`);
    }

    const ftsSql = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reference_docs_fts'
    `).get()?.sql;
    if (typeof ftsSql !== "string") {
      db.exec(`
        CREATE VIRTUAL TABLE reference_docs_fts USING fts5(
          doc_id, project_id, title, summary, tags
        );
      `);
    }
  },
  // 4: add explicit reference links table
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reference_links (
        source_kind   TEXT NOT NULL,
        source_project_id TEXT NOT NULL DEFAULT '',
        source_id     TEXT NOT NULL,
        target_doc_id TEXT NOT NULL,
        relation      TEXT NOT NULL,
        PRIMARY KEY (source_kind, source_project_id, source_id, target_doc_id, relation)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reference_links_target_doc_id
        ON reference_links(target_doc_id);
    `);
  },
  // 5: ensure reference_links has project-scoped source key and target_doc_id index
  (db) => {
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'reference_links'
    `).all();

    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE reference_links (
          source_kind   TEXT NOT NULL,
          source_project_id TEXT NOT NULL DEFAULT '',
          source_id     TEXT NOT NULL,
          target_doc_id TEXT NOT NULL,
          relation      TEXT NOT NULL,
          PRIMARY KEY (source_kind, source_project_id, source_id, target_doc_id, relation)
        );
      `);
    } else {
      const columns = db.prepare(`PRAGMA table_info(reference_links)`).all();
      if (!columns.some(c => c.name === "source_project_id")) {
        db.exec(`
          CREATE TABLE reference_links_migrating (
            source_kind   TEXT NOT NULL,
            source_project_id TEXT NOT NULL DEFAULT '',
            source_id     TEXT NOT NULL,
            target_doc_id TEXT NOT NULL,
            relation      TEXT NOT NULL,
            PRIMARY KEY (source_kind, source_project_id, source_id, target_doc_id, relation)
          );
        `);
        db.exec(`
          INSERT OR IGNORE INTO reference_links_migrating
            (source_kind, source_project_id, source_id, target_doc_id, relation)
          SELECT source_kind, '', source_id, target_doc_id, relation
          FROM reference_links;
        `);
        db.exec(`DROP TABLE reference_links;`);
        db.exec(`ALTER TABLE reference_links_migrating RENAME TO reference_links;`);
      }
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reference_links_target_doc_id
        ON reference_links(target_doc_id);
    `);
  },
  // 6: add origin marker to reference_links so sync can preserve explicit tool-authored links
  (db) => {
    const columns = db.prepare(`PRAGMA table_info(reference_links)`).all();
    if (!columns.some(c => c.name === "origin")) {
      db.exec(`ALTER TABLE reference_links ADD COLUMN origin TEXT NOT NULL DEFAULT 'inferred';`);
    }
  },
  // 7: scope scene join tables by project_id so duplicate scene IDs across projects are safe
  (db) => {
    const charactersMigration = migrateSceneJoinTableToProjectScope(
      db,
      "scene_characters",
      `
        CREATE TABLE scene_characters_migrating (
          scene_id     TEXT NOT NULL,
          project_id   TEXT NOT NULL,
          character_id TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id, character_id)
        );
      `,
      `
        INSERT OR IGNORE INTO scene_characters_migrating (scene_id, project_id, character_id)
        SELECT sc.scene_id, s.project_id, sc.character_id
        FROM scene_characters sc
        JOIN scenes s ON s.scene_id = sc.scene_id
        WHERE (
          SELECT COUNT(*)
          FROM scenes sx
          WHERE sx.scene_id = sc.scene_id
        ) = 1;
      `
    );

    const placesMigration = migrateSceneJoinTableToProjectScope(
      db,
      "scene_places",
      `
        CREATE TABLE scene_places_migrating (
          scene_id   TEXT NOT NULL,
          project_id TEXT NOT NULL,
          place_id   TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id, place_id)
        );
      `,
      `
        INSERT OR IGNORE INTO scene_places_migrating (scene_id, project_id, place_id)
        SELECT sp.scene_id, s.project_id, sp.place_id
        FROM scene_places sp
        JOIN scenes s ON s.scene_id = sp.scene_id
        WHERE (
          SELECT COUNT(*)
          FROM scenes sx
          WHERE sx.scene_id = sp.scene_id
        ) = 1;
      `
    );

    const tagsMigration = migrateSceneJoinTableToProjectScope(
      db,
      "scene_tags",
      `
        CREATE TABLE scene_tags_migrating (
          scene_id   TEXT NOT NULL,
          project_id TEXT NOT NULL,
          tag        TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id, tag)
        );
      `,
      `
        INSERT OR IGNORE INTO scene_tags_migrating (scene_id, project_id, tag)
        SELECT st.scene_id, s.project_id, st.tag
        FROM scene_tags st
        JOIN scenes s ON s.scene_id = st.scene_id
        WHERE (
          SELECT COUNT(*)
          FROM scenes sx
          WHERE sx.scene_id = st.scene_id
        ) = 1;
      `
    );

    const threadsMigration = migrateSceneJoinTableToProjectScope(
      db,
      "scene_threads",
      `
        CREATE TABLE scene_threads_migrating (
          scene_id   TEXT NOT NULL,
          project_id TEXT NOT NULL,
          thread_id  TEXT NOT NULL,
          beat       TEXT,
          PRIMARY KEY (scene_id, project_id, thread_id)
        );
      `,
      `
        INSERT OR IGNORE INTO scene_threads_migrating (scene_id, project_id, thread_id, beat)
        SELECT st.scene_id, t.project_id, st.thread_id, st.beat
        FROM scene_threads st
        JOIN threads t ON t.thread_id = st.thread_id
        JOIN scenes s
          ON s.scene_id = st.scene_id
         AND s.project_id = t.project_id;

        INSERT OR IGNORE INTO scene_threads_migrating (scene_id, project_id, thread_id, beat)
        SELECT st.scene_id, s.project_id, st.thread_id, st.beat
        FROM scene_threads st
        JOIN scenes s ON s.scene_id = st.scene_id
        LEFT JOIN threads t ON t.thread_id = st.thread_id
        WHERE t.thread_id IS NULL
          AND (
            SELECT COUNT(*)
            FROM scenes sx
            WHERE sx.scene_id = st.scene_id
          ) = 1;
      `
    );

    const migrationSummaries = [
      ["scene_characters", charactersMigration],
      ["scene_places", placesMigration],
      ["scene_tags", tagsMigration],
      ["scene_threads", threadsMigration],
    ];
    const droppedByTable = {};
    let totalDropped = 0;

    for (const [tableName, summary] of migrationSummaries) {
      if (!summary?.migrated || summary.droppedCount <= 0) continue;
      droppedByTable[tableName] = {
        source_rows: summary.sourceCount,
        migrated_rows: summary.migratedCount,
        skipped_rows: summary.droppedCount,
      };
      totalDropped += summary.droppedCount;
    }

    if (totalDropped > 0) {
      dbStartupWarnings.push({
        code: "LEGACY_JOIN_ROWS_SKIPPED",
        message: "Legacy scene relationship rows were skipped during migration because scene_id was ambiguous across projects or duplicate links could not be preserved safely.",
        details: {
          skipped_rows_total: totalDropped,
          skipped_rows_by_table: droppedByTable,
          next_step: "Run sync() immediately after upgrade, then run enrich_scene(scene_id, project_id) for any stale scenes you touch.",
        },
      });
    }
  },
];

// The version every database should reach after openDb. Not the current DB value —
// query schema_version directly if you need the live version of a specific database.
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

function applyMigrations(db) {
  db.prepare(`INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0)`).run();
  for (;;) {
    db.exec(`BEGIN IMMEDIATE;`);
    try {
      const { version } = db.prepare(`SELECT version FROM schema_version WHERE id = 1`).get();
      if (version >= MIGRATIONS.length) {
        db.exec(`COMMIT;`);
        break;
      }
      MIGRATIONS[version](db);
      // WHERE version = ? ensures the bump is monotonic: a concurrent opener
      // that advanced the version first will cause this UPDATE to match 0 rows,
      // which is safe — the migration is already applied.
      db.prepare(`UPDATE schema_version SET version = ? WHERE id = 1 AND version = ?`).run(version + 1, version);
      db.exec(`COMMIT;`);
    } catch (err) {
      db.exec(`ROLLBACK;`);
      throw err;
    }
  }
}

export function openDb(dbPath) {
  resetDbStartupWarnings();
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  applyMigrations(db);
  return db;
}

export function checkpointJobCreate(db, job) {
  db.prepare(`
    INSERT OR IGNORE INTO async_jobs (job_id, kind, status, created_at, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(job.id, job.kind, job.status, job.createdAt, job.startedAt ?? null);
}

export function checkpointJobFinish(db, job) {
  // UPSERT so a terminal state is always recorded even if checkpointJobCreate
  // was skipped due to a best-effort failure.
  db.prepare(`
    INSERT INTO async_jobs
      (job_id, kind, status, created_at, started_at, finished_at, error, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status      = excluded.status,
      finished_at = excluded.finished_at,
      error       = excluded.error,
      result_json = excluded.result_json
  `).run(
    job.id,
    job.kind,
    job.status,
    job.createdAt,
    job.startedAt ?? null,
    job.finishedAt ?? null,
    job.error ?? null,
    job.result != null ? JSON.stringify(job.result) : null
  );
}

export function pruneJobCheckpoints(db, ttlMs) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  db.prepare(`
    DELETE FROM async_jobs WHERE finished_at IS NOT NULL AND finished_at < ?
  `).run(cutoff);
}

export function loadStalledJobs(db) {
  // 'cancelling' included defensively; in practice only 'running' rows exist
  // since we never write a 'cancelling' checkpoint between create and finish.
  return db.prepare(`
    SELECT job_id, kind, status, created_at, started_at
    FROM async_jobs WHERE status IN ('running', 'cancelling')
  `).all().map(row => ({
    id: row.job_id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: null,
    error: null,
    result: null,
    progress: null,
    child: null,
    onComplete: null,
    tmpDir: null,
    requestPath: null,
    resultPath: null,
  }));
}
