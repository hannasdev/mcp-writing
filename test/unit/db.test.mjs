import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, CURRENT_SCHEMA_VERSION } from "../../db.js";

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
      // Simulate a production database that already has both columns but no schema_version
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(`
        CREATE TABLE scenes (
          scene_id TEXT NOT NULL, project_id TEXT NOT NULL,
          title TEXT, chapter_title TEXT,
          file_path TEXT NOT NULL, updated_at TEXT NOT NULL,
          metadata_stale INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (scene_id, project_id)
        );
      `);
      legacy.exec(`
        CREATE VIRTUAL TABLE scenes_fts USING fts5(
          scene_id, project_id, logline, title, keywords
        );
      `);
      legacy.close();

      const db = openDb(dbPath);
      const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get();
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
// syncAll — integration-style unit test using a temp dir + in-memory DB
// ---------------------------------------------------------------------------
