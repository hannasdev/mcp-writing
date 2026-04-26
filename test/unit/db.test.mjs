import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, CURRENT_SCHEMA_VERSION, SCHEMA, checkpointJobCreate, checkpointJobFinish, loadStalledJobs } from "../../db.js";

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
});

// ---------------------------------------------------------------------------
// syncAll — integration-style unit test using a temp dir + in-memory DB
// ---------------------------------------------------------------------------
