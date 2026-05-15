import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openDb,
  getDbStartupWarnings,
  CURRENT_SCHEMA_VERSION,
  SCHEMA,
  checkpointJobCreate,
  checkpointJobFinish,
  loadStalledJobs,
  pruneJobCheckpoints,
} from "../../core/db.js";

function makeTempPath() {
  return path.join(os.tmpdir(), `mcp-writing-db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

describe("openDb", () => {
  test("fresh database reaches current schema version", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get();
      assert.equal(row?.version, CURRENT_SCHEMA_VERSION);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("existing production database (all columns present) upgrades cleanly to current version", () => {
    const dbPath = makeTempPath();
    try {
      // Simulate a production database created before schema_version was introduced:
      // full current schema is present (all tables and columns) but no schema_version table.
      // Using SCHEMA ensures the fixture stays in sync with real production structure.
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(SCHEMA);
      legacy.exec(`DROP TABLE schema_version;`);
      legacy.close();

      const db = openDb(dbPath);
      const row = db.prepare(`SELECT id, version FROM schema_version WHERE id = 1`).get();
      assert.equal(row?.id, 1);
      assert.equal(row?.version, CURRENT_SCHEMA_VERSION);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("migrates legacy scenes_fts schema and preserves existing rows", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE VIRTUAL TABLE scenes_fts USING fts5(
          scene_id, project_id, logline, title
        );
      `);
      legacyDb.prepare(`
        INSERT INTO scenes_fts (scene_id, project_id, logline, title)
        VALUES (?, ?, ?, ?)
      `).run("sc-legacy", "test-novel", "Legacy envelope logline", "Legacy Scene");
      legacyDb.close();

      const db = openDb(dbPath);

      const ftsSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'scenes_fts'
      `).get()?.sql;
      assert.ok(typeof ftsSql === "string" && ftsSql.toLowerCase().includes("keywords"));

      const matches = db.prepare(`
        SELECT scene_id
        FROM scenes_fts
        WHERE scenes_fts MATCH 'envelope'
      `).all();
      assert.equal(matches.length, 1);
      assert.equal(matches[0].scene_id, "sc-legacy");

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("subsequent openDb calls on an already-migrated database are idempotent", () => {
    const dbPath = makeTempPath();
    try {
      openDb(dbPath).close();
      const db = openDb(dbPath);
      const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get();
      assert.equal(row?.version, CURRENT_SCHEMA_VERSION);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("migrates legacy reference_docs schema and creates reference_docs_fts", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE reference_docs (
          doc_id TEXT NOT NULL PRIMARY KEY,
          project_id TEXT,
          universe_id TEXT,
          title TEXT NOT NULL,
          file_path TEXT NOT NULL
        );
      `);
      legacyDb.exec(`
        CREATE TABLE reference_doc_tags (
          doc_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (doc_id, tag)
        );
      `);
      legacyDb.close();

      const db = openDb(dbPath);
      const columns = db.prepare(`PRAGMA table_info(reference_docs)`).all();
      assert.ok(columns.some(column => column.name === "type"));
      assert.ok(columns.some(column => column.name === "summary"));

      const ftsSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'reference_docs_fts'
      `).get()?.sql;
      assert.ok(typeof ftsSql === "string" && ftsSql.toLowerCase().includes("summary"));

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("creates reference_links table for legacy databases", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
      `);
      // Simulate database at previous migration level.
      legacyDb.exec(`INSERT INTO schema_version (id, version) VALUES (1, 3);`);
      legacyDb.close();

      const db = openDb(dbPath);
      const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'reference_links'
      `).get();
      assert.equal(table?.name, "reference_links");

      const columns = db.prepare(`PRAGMA table_info(reference_links)`).all();
      assert.ok(columns.some(column => column.name === "source_project_id"));
      assert.ok(columns.some(column => column.name === "origin"));

      const index = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_reference_links_target_doc_id'
      `).get();
      assert.equal(index?.name, "idx_reference_links_target_doc_id");

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("migrates legacy scene join tables to include project_id", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          universe_id TEXT,
          name TEXT NOT NULL
        );
        CREATE TABLE scenes (
          scene_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT,
          file_path TEXT NOT NULL,
          prose_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id)
        );
        CREATE TABLE scene_characters (
          scene_id TEXT NOT NULL,
          character_id TEXT NOT NULL,
          PRIMARY KEY (scene_id, character_id)
        );
        CREATE TABLE scene_places (
          scene_id TEXT NOT NULL,
          place_id TEXT NOT NULL,
          PRIMARY KEY (scene_id, place_id)
        );
        CREATE TABLE scene_tags (
          scene_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (scene_id, tag)
        );
        CREATE TABLE scene_threads (
          scene_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          beat TEXT,
          PRIMARY KEY (scene_id, thread_id)
        );
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
      `);
      legacyDb.exec(`INSERT INTO schema_version (id, version) VALUES (1, 6);`);
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("test-novel", null, "test-novel");
      legacyDb.prepare(`
        INSERT INTO scenes (scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("sc-001", "test-novel", "Scene 1", "/tmp/sc-001.md", "deadbeef", 0, new Date().toISOString());
      legacyDb.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-001", "char-mira");
      legacyDb.prepare(`INSERT INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run("sc-001", "place-hospital");
      legacyDb.prepare(`INSERT INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run("sc-001", "harbor");
      legacyDb.prepare(`INSERT INTO scene_threads (scene_id, thread_id, beat) VALUES (?, ?, ?)`).run("sc-001", "thread-1", "Opening");
      legacyDb.close();

      const db = openDb(dbPath);

      const characterColumns = db.prepare(`PRAGMA table_info(scene_characters)`).all();
      assert.ok(characterColumns.some((column) => column.name === "project_id"));
      const threadColumns = db.prepare(`PRAGMA table_info(scene_threads)`).all();
      assert.ok(threadColumns.some((column) => column.name === "project_id"));

      const characterRow = db.prepare(`
        SELECT scene_id, project_id, character_id
        FROM scene_characters
        WHERE scene_id = 'sc-001'
      `).get();
      assert.deepEqual({ ...characterRow }, {
        scene_id: "sc-001",
        project_id: "test-novel",
        character_id: "char-mira",
      });

      const threadRow = db.prepare(`
        SELECT scene_id, project_id, thread_id, beat
        FROM scene_threads
        WHERE scene_id = 'sc-001'
      `).get();
      assert.deepEqual({ ...threadRow }, {
        scene_id: "sc-001",
        project_id: "test-novel",
        thread_id: "thread-1",
        beat: "Opening",
      });

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("scene_threads migration avoids cross-project fan-out when scene_id is duplicated", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          universe_id TEXT,
          name TEXT NOT NULL
        );
        CREATE TABLE scenes (
          scene_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT,
          file_path TEXT NOT NULL,
          prose_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id)
        );
        CREATE TABLE threads (
          thread_id TEXT NOT NULL PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE scene_threads (
          scene_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          beat TEXT,
          PRIMARY KEY (scene_id, thread_id)
        );
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
      `);
      legacyDb.exec(`INSERT INTO schema_version (id, version) VALUES (1, 6);`);
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("alpha", null, "alpha");
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("beta", null, "beta");
      const sceneSql = `
        INSERT INTO scenes (scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      legacyDb.prepare(sceneSql).run("sc-shared", "alpha", "Alpha Scene", "/tmp/alpha.md", "aaa", 0, new Date().toISOString());
      legacyDb.prepare(sceneSql).run("sc-shared", "beta", "Beta Scene", "/tmp/beta.md", "bbb", 0, new Date().toISOString());
      legacyDb.prepare(`
        INSERT INTO threads (thread_id, project_id, name, status)
        VALUES (?, ?, ?, ?)
      `).run("thread-alpha", "alpha", "Alpha Thread", "active");
      legacyDb.prepare(`INSERT INTO scene_threads (scene_id, thread_id, beat) VALUES (?, ?, ?)`).run("sc-shared", "thread-alpha", "Opening");
      legacyDb.close();

      const db = openDb(dbPath);
      const rows = db.prepare(`
        SELECT scene_id, project_id, thread_id, beat
        FROM scene_threads
        ORDER BY project_id
      `).all();

      assert.equal(rows.length, 1);
      assert.deepEqual({ ...rows[0] }, {
        scene_id: "sc-shared",
        project_id: "alpha",
        thread_id: "thread-alpha",
        beat: "Opening",
      });
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("scene_characters/places/tags migration skips ambiguous duplicated scene_id rows", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          universe_id TEXT,
          name TEXT NOT NULL
        );
        CREATE TABLE scenes (
          scene_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT,
          file_path TEXT NOT NULL,
          prose_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id)
        );
        CREATE TABLE scene_characters (
          scene_id TEXT NOT NULL,
          character_id TEXT NOT NULL,
          PRIMARY KEY (scene_id, character_id)
        );
        CREATE TABLE scene_places (
          scene_id TEXT NOT NULL,
          place_id TEXT NOT NULL,
          PRIMARY KEY (scene_id, place_id)
        );
        CREATE TABLE scene_tags (
          scene_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (scene_id, tag)
        );
        CREATE TABLE scene_threads (
          scene_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          beat TEXT,
          PRIMARY KEY (scene_id, thread_id)
        );
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
      `);
      legacyDb.exec(`INSERT INTO schema_version (id, version) VALUES (1, 6);`);
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("alpha", null, "alpha");
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run("beta", null, "beta");

      const sceneSql = `
        INSERT INTO scenes (scene_id, project_id, title, file_path, prose_checksum, metadata_stale, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      legacyDb.prepare(sceneSql).run("sc-shared", "alpha", "Alpha Scene", "/tmp/alpha.md", "aaa", 0, new Date().toISOString());
      legacyDb.prepare(sceneSql).run("sc-shared", "beta", "Beta Scene", "/tmp/beta.md", "bbb", 0, new Date().toISOString());

      legacyDb.prepare(`INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run("sc-shared", "char-mira");
      legacyDb.prepare(`INSERT INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run("sc-shared", "place-harbor");
      legacyDb.prepare(`INSERT INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run("sc-shared", "opening");
      legacyDb.close();

      const db = openDb(dbPath);
      const warnings = getDbStartupWarnings();

      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scene_characters`).get().count, 0);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scene_places`).get().count, 0);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scene_tags`).get().count, 0);
      assert.ok(Array.isArray(warnings));
      assert.ok(warnings.some((warning) => warning.code === "LEGACY_JOIN_ROWS_SKIPPED"));
      const skippedWarning = warnings.find((warning) => warning.code === "LEGACY_JOIN_ROWS_SKIPPED");
      assert.ok((skippedWarning?.details?.skipped_rows_total ?? 0) > 0);
      assert.equal(typeof skippedWarning?.details?.next_step, "string");
      assert.ok(skippedWarning?.details?.next_step.includes("sync()"));

      if (skippedWarning?.details?.skipped_rows_by_table && typeof skippedWarning.details.skipped_rows_by_table === "object") {
        skippedWarning.details.skipped_rows_by_table.scene_tags = 9999;
        const warningsAgain = getDbStartupWarnings();
        const skippedAgain = warningsAgain.find((warning) => warning.code === "LEGACY_JOIN_ROWS_SKIPPED");
        assert.notEqual(skippedAgain?.details?.skipped_rows_by_table?.scene_tags, 9999);
      }

      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("backfills canonical chapters from legacy scene chapter fields", () => {
    const dbPath = makeTempPath();
    try {
      const legacyDb = new DatabaseSync(dbPath);
      legacyDb.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
      `);
      legacyDb.exec(`INSERT INTO schema_version (id, version) VALUES (1, 8);`);
      legacyDb.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          universe_id TEXT,
          name TEXT NOT NULL
        );
        CREATE TABLE scenes (
          scene_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          scene_role TEXT,
          title TEXT,
          part INTEGER,
          chapter INTEGER,
          chapter_title TEXT,
          pov TEXT,
          logline TEXT,
          scene_change TEXT,
          causality INTEGER,
          stakes INTEGER,
          scene_functions TEXT,
          save_the_cat_beat TEXT,
          timeline_position INTEGER,
          story_time TEXT,
          word_count INTEGER,
          file_path TEXT NOT NULL,
          prose_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scene_id, project_id)
        );
        CREATE TABLE chapters (
          chapter_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          sort_index INTEGER NOT NULL,
          logline TEXT,
          source_path TEXT,
          source_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (chapter_id, project_id),
          UNIQUE (project_id, sort_index)
        );
        CREATE TABLE epigraphs (
          epigraph_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          body TEXT NOT NULL,
          file_path TEXT NOT NULL,
          prose_checksum TEXT,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (epigraph_id, project_id),
          UNIQUE (project_id, chapter_id)
        );
        CREATE TABLE epigraph_characters (
          epigraph_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          character_id TEXT NOT NULL,
          PRIMARY KEY (epigraph_id, project_id, character_id)
        );
        CREATE TABLE epigraph_tags (
          epigraph_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (epigraph_id, project_id, tag)
        );
      `);
      legacyDb.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`)
        .run("test-novel", null, "Test Novel");
      const updatedAt = "2026-01-01T00:00:00.000Z";
      legacyDb.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, chapter, chapter_title, timeline_position,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Arrival",
        3,
        "A New Dawn",
        1,
        "/tmp/test-novel/Draft/03-A New Dawn/sc-001.md",
        "deadbeef",
        0,
        updatedAt
      );
      legacyDb.close();

      const db = openDb(dbPath);
      const chapter = db.prepare(`
        SELECT chapter_id, title, sort_index
        FROM chapters
        WHERE project_id = 'test-novel'
      `).get();
      assert.equal(chapter.chapter_id, "ch-03-a-new-dawn");
      assert.equal(chapter.title, "A New Dawn");
      assert.equal(chapter.sort_index, 3);

      const scene = db.prepare(`
        SELECT chapter_id
        FROM scenes
        WHERE scene_id = 'sc-001' AND project_id = 'test-novel'
      `).get();
      assert.equal(scene.chapter_id, "ch-03-a-new-dawn");
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// async job checkpointing
// ---------------------------------------------------------------------------

describe("checkpointJobCreate / checkpointJobFinish / loadStalledJobs", () => {
  function makeJob(overrides = {}) {
    return {
      id: `job-${Math.random().toString(36).slice(2)}`,
      kind: "import_scrivener_sync",
      status: "running",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      result: null,
      ...overrides,
    };
  }

  test("checkpointJobCreate persists a running job", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const job = makeJob();
      checkpointJobCreate(db, job);
      const row = db.prepare(`SELECT * FROM async_jobs WHERE job_id = ?`).get(job.id);
      assert.equal(row.job_id, job.id);
      assert.equal(row.kind, job.kind);
      assert.equal(row.status, "running");
      assert.equal(row.finished_at, null);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("checkpointJobFinish updates status, finished_at, and error", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const job = makeJob();
      checkpointJobCreate(db, job);
      job.status = "failed";
      job.error = "something went wrong";
      job.finishedAt = new Date().toISOString();
      checkpointJobFinish(db, job);
      const row = db.prepare(`SELECT * FROM async_jobs WHERE job_id = ?`).get(job.id);
      assert.equal(row.status, "failed");
      assert.equal(row.error, "something went wrong");
      assert.ok(row.finished_at);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("checkpointJobFinish stores result_json for completed jobs", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const job = makeJob();
      checkpointJobCreate(db, job);
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      job.result = { ok: true, scenes_changed: 3 };
      checkpointJobFinish(db, job);
      const row = db.prepare(`SELECT result_json FROM async_jobs WHERE job_id = ?`).get(job.id);
      assert.deepEqual(JSON.parse(row.result_json), job.result);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("loadStalledJobs returns running and cancelling jobs only", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const running = makeJob({ status: "running" });
      const cancelling = makeJob({ status: "cancelling" });
      const completed = makeJob({ status: "completed" });
      for (const j of [running, cancelling, completed]) {
        checkpointJobCreate(db, j);
      }
      const stalled = loadStalledJobs(db);
      const ids = stalled.map(j => j.id);
      assert.ok(ids.includes(running.id));
      assert.ok(ids.includes(cancelling.id));
      assert.ok(!ids.includes(completed.id));
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("loadStalledJobs returns empty array when no stalled jobs", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      assert.deepEqual(loadStalledJobs(db), []);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("async_jobs table exists on fresh database", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='async_jobs'`
      ).get();
      assert.ok(row, "async_jobs table should exist");
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("checkpointJobFinish upserts even when checkpointJobCreate was never called", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const job = makeJob({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "create was skipped",
      });
      checkpointJobFinish(db, job);
      const row = db.prepare(`SELECT * FROM async_jobs WHERE job_id = ?`).get(job.id);
      assert.ok(row, "row should exist despite skipped create");
      assert.equal(row.status, "failed");
      assert.equal(row.error, "create was skipped");
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("pruneJobCheckpoints deletes finished rows older than TTL", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const old = makeJob({ status: "completed" });
      checkpointJobCreate(db, old);
      old.status = "completed";
      old.finishedAt = new Date(Date.now() - 90000).toISOString(); // 90s ago
      checkpointJobFinish(db, old);

      const recent = makeJob({ status: "completed" });
      checkpointJobCreate(db, recent);
      recent.status = "completed";
      recent.finishedAt = new Date().toISOString();
      checkpointJobFinish(db, recent);

      pruneJobCheckpoints(db, 60000); // TTL = 60s

      const rows = db.prepare(`SELECT job_id FROM async_jobs`).all().map(r => r.job_id);
      assert.ok(!rows.includes(old.id), "old finished job should be pruned");
      assert.ok(rows.includes(recent.id), "recent finished job should be kept");
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });

  test("pruneJobCheckpoints does not delete running jobs", () => {
    const dbPath = makeTempPath();
    try {
      const db = openDb(dbPath);
      const job = makeJob();
      checkpointJobCreate(db, job);
      pruneJobCheckpoints(db, 0); // TTL = 0 (prune everything finished)
      const row = db.prepare(`SELECT job_id FROM async_jobs WHERE job_id = ?`).get(job.id);
      assert.ok(row, "running job with null finished_at should not be pruned");
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// syncAll — integration-style unit test using a temp dir + in-memory DB
// ---------------------------------------------------------------------------
