import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, CURRENT_SCHEMA_VERSION, SCHEMA } from "../../db.js";

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
// syncAll — integration-style unit test using a temp dir + in-memory DB
// ---------------------------------------------------------------------------
