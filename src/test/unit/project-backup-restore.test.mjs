import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../core/db.js";
import {
  buildProjectBackup,
  renderProjectBackupArtifact,
  writeProjectBackupFiles,
} from "../../structure/project-backup.js";
import { restoreProjectFromBackup } from "../../structure/project-backup-restore.js";

const UPDATED_AT = "2026-05-24T12:00:00.000Z";

function seedFixture(db, syncDir) {
  const scenePath = path.join(syncDir, "projects/test-novel/scenes/sc-first.md");
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  fs.writeFileSync(scenePath, "# First Scene\n", "utf8");

  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run("test-novel", null, "Test Novel");
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ch-01-first",
    "test-novel",
    "First",
    1,
    "Opening chapter.",
    "projects/test-novel/chapters/ch-01",
    null,
    0,
    UPDATED_AT
  );
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, part, chapter, chapter_title, pov, logline,
      scene_change, causality, stakes, scene_functions, save_the_cat_beat, timeline_position,
      story_time, word_count, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sc-first",
    "test-novel",
    "ch-01-first",
    "First Scene",
    1,
    1,
    "First",
    "Elena",
    "First scene logline.",
    null,
    null,
    null,
    null,
    null,
    1,
    null,
    1000,
    scenePath,
    "scene-checksum",
    0,
    UPDATED_AT
  );
  db.prepare(`
    INSERT INTO scene_tags (scene_id, project_id, tag)
    VALUES (?, ?, ?)
  `).run("sc-first", "test-novel", "opening");
}

function withFixture(fn) {
  const db = openDb(":memory:");
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-project-restore-sync-"));
  const backupDir = path.join(syncDir, "project-backups", "test-novel");
  try {
    seedFixture(db, syncDir);
    fs.mkdirSync(backupDir, { recursive: true });
    return fn({ db, syncDir, backupDir });
  } finally {
    db.close();
    fs.rmSync(syncDir, { recursive: true, force: true });
  }
}

function exportBackup(db, syncDir, backupDir) {
  const relativeBackupDir = path.relative(syncDir, backupDir).split(path.sep).join("/");
  const built = buildProjectBackup(db, {
    projectId: "test-novel",
    syncDir,
    applicationVersion: "9.9.9",
    backupLocation: `${relativeBackupDir}/`,
  });
  assert.equal(built.ok, true);
  writeProjectBackupFiles(built, { outputDir: backupDir });
  return built;
}

function restorePlan(db, syncDir, backupDir, options = {}) {
  return restoreProjectFromBackup(db, {
    syncDir,
    projectId: "test-novel",
    backupPath: backupDir,
    applicationVersion: "9.9.9",
    ...options,
  });
}

describe("restoreProjectFromBackup", () => {
  test("plans a trusted current backup without mutating SQLite", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.equal(result.action, "planned");
    assert.equal(result.dry_run, true);
    assert.equal(result.plan.totals.create, 0);
    assert.equal(result.plan.totals.update, 0);
    assert.equal(result.plan.totals.delete, 0);
    assert.ok(result.plan.totals.unchanged > 0);
    assert.deepEqual(result.diagnostics, []);
  }));

  test("distinguishes create, update, delete, and unchanged candidates", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    db.prepare(`
      UPDATE scenes
      SET title = ?
      WHERE project_id = ? AND scene_id = ?
    `).run("Changed Scene", "test-novel", "sc-first");
    db.prepare(`
      INSERT INTO scene_tags (scene_id, project_id, tag)
      VALUES (?, ?, ?)
    `).run("sc-first", "test-novel", "extra-current-tag");
    db.prepare(`
      DELETE FROM chapters
      WHERE project_id = ? AND chapter_id = ?
    `).run("test-novel", "ch-01-first");

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.equal(result.plan.totals.create, 1);
    assert.equal(result.plan.totals.update, 1);
    assert.equal(result.plan.totals.delete, 1);
    assert.ok(result.plan.totals.unchanged > 0);
    assert.equal(result.plan.destructive_change_count, 1);
    assert.ok(result.plan.changes.some(change => change.domain === "chapters" && change.action === "create"));
    assert.ok(result.plan.changes.some(change => change.domain === "scenes" && change.action === "update"));
    assert.ok(result.plan.changes.some(change => change.domain === "scene_tags" && change.action === "delete"));
  }));

  test("plans project creation when current SQLite state is missing the project", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    db.prepare(`DELETE FROM scene_tags WHERE project_id = ?`).run("test-novel");
    db.prepare(`DELETE FROM scenes WHERE project_id = ?`).run("test-novel");
    db.prepare(`DELETE FROM chapters WHERE project_id = ?`).run("test-novel");
    db.prepare(`DELETE FROM projects WHERE project_id = ?`).run("test-novel");

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.ok(result.plan.changes.some(change => change.domain === "projects" && change.action === "create"));
    assert.ok(result.plan.changes.some(change => change.domain === "scenes" && change.action === "create"));
  }));

  test("refuses tampered backup snapshots", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    const snapshotPath = path.join(backupDir, "canonical.snapshot.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    snapshot.project.name = "Tampered";
    fs.writeFileSync(snapshotPath, renderProjectBackupArtifact(snapshot), "utf8");

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.type === "project_restore_checksum_mismatch"));
    assert.equal(result.plan, null);
  }));

  test("refuses missing required file references", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    fs.rmSync(path.join(syncDir, "projects/test-novel/scenes/sc-first.md"));

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_file_reference_missing"]);
  }));

  test("keeps apply mode unavailable until the transactional restore milestone", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);

    const result = restorePlan(db, syncDir, backupDir, { dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_apply_not_implemented"]);
  }));
});
