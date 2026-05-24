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
import { runProjectBackupDiagnostics } from "../../structure/project-backup-diagnostics.js";

const UPDATED_AT = "2026-05-24T10:00:00.000Z";

function seedFixture(db) {
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run("test-novel", null, "Test Novel");
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run("other-novel", null, "Other Novel");
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
    "chapter-checksum",
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
    "projects/test-novel/chapters/ch-01/sc-first.md",
    "scene-checksum",
    0,
    UPDATED_AT
  );
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ch-other",
    "other-novel",
    "Other",
    1,
    null,
    "projects/other-novel/chapters/ch-other",
    null,
    0,
    UPDATED_AT
  );
}

function withFixture(fn) {
  const db = openDb(":memory:");
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-backup-diagnostics-sync-"));
  const backupDir = path.join(syncDir, "project-backups", "test-novel");
  try {
    seedFixture(db);
    fs.mkdirSync(backupDir, { recursive: true });
    return fn({ db, syncDir, backupDir });
  } finally {
    db.close();
    fs.rmSync(syncDir, { recursive: true, force: true });
  }
}

function exportFixtureBackup(db, syncDir, backupDir, projectId = "test-novel") {
  const relativeBackupDir = path.relative(syncDir, backupDir).split(path.sep).join("/");
  const built = buildProjectBackup(db, {
    projectId,
    syncDir,
    applicationVersion: "9.9.9",
    backupLocation: `${relativeBackupDir}/`,
  });
  assert.equal(built.ok, true);
  writeProjectBackupFiles(built, { outputDir: backupDir });
  return built;
}

function diagnose(db, syncDir, backupDir, projectId = "test-novel") {
  return runProjectBackupDiagnostics(db, {
    syncDir,
    backupDir,
    projectId,
    applicationVersion: "9.9.9",
  });
}

function diagnosticTypes(result) {
  return result.diagnostics.map(diagnostic => diagnostic.type);
}

describe("runProjectBackupDiagnostics", () => {
  test("reports a trusted current backup", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.equal(result.trust.trusted, true);
    assert.equal(result.trust.status, "current");
    assert.equal(result.trust.freshness, "current");
    assert.deepEqual(result.diagnostics, []);
  }));

  test("reports missing backup bundles", () => withFixture(({ db, syncDir, backupDir }) => {
    fs.rmSync(backupDir, { recursive: true, force: true });

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_missing"]);
    assert.equal(result.trust.status, "untrusted");
  }));

  test("reports partial backup bundles", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    fs.rmSync(path.join(backupDir, "canonical.snapshot.json"));

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_partial"]);
  }));

  test("reports unreadable JSON", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    fs.writeFileSync(path.join(backupDir, "manifest.json"), "{not-json", "utf8");

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_unreadable"]);
  }));

  test("refuses symlinked backup files as untrusted", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifestTargetPath = path.join(backupDir, "manifest-target.json");
    fs.renameSync(manifestPath, manifestTargetPath);
    fs.symlinkSync(manifestTargetPath, manifestPath);

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_unreadable"]);
    assert.equal(result.diagnostics[0].details.reason, "symlink");
  }));

  test("refuses non-regular backup files as untrusted", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    const snapshotPath = path.join(backupDir, "canonical.snapshot.json");
    fs.rmSync(snapshotPath);
    fs.mkdirSync(snapshotPath);

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_unreadable"]);
    assert.equal(result.diagnostics[0].details.reason, "not_regular");
  }));

  test("reports lstat failures as unreadable backup files", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    const originalLstatSync = fs.lstatSync;
    const manifestPath = path.join(backupDir, "manifest.json");
    fs.lstatSync = (filePath, ...args) => {
      if (filePath === manifestPath) {
        throw new Error("permission denied");
      }
      return originalLstatSync.call(fs, filePath, ...args);
    };
    try {
      const result = diagnose(db, syncDir, backupDir);

      assert.equal(result.ok, false);
      assert.deepEqual(diagnosticTypes(result), ["project_backup_unreadable"]);
      assert.equal(result.diagnostics[0].details.reason, "lstat_failed");
      assert.equal(result.diagnostics[0].details.message, "permission denied");
    } finally {
      fs.lstatSync = originalLstatSync;
    }
  }));

  test("reports wrong-project backup bundles", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir, "test-novel");

    const result = diagnose(db, syncDir, backupDir, "other-novel");

    assert.equal(result.ok, false);
    assert.deepEqual(new Set(diagnosticTypes(result)), new Set(["project_backup_wrong_project"]));
  }));

  test("reports current snapshot build failures without throwing", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    db.prepare(`
      UPDATE scenes
      SET file_path = ?
      WHERE project_id = ? AND scene_id = ?
    `).run(path.join(path.dirname(syncDir), "outside.md"), "test-novel", "sc-first");

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_current_snapshot_failed"]);
    assert.equal(result.diagnostics[0].severity, "error");
    assert.match(result.diagnostics[0].message, /outside sync_dir/);
    assert.equal(result.diagnostics[0].details.phase, "current_snapshot");
  }));

  test("reports incompatible schema versions", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schema_version = 999;
    fs.writeFileSync(manifestPath, renderProjectBackupArtifact(manifest), "utf8");

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.ok(diagnosticTypes(result).includes("project_backup_incompatible_schema"));
    assert.ok(diagnosticTypes(result).includes("project_backup_bundle_checksum_mismatch"));
  }));

  test("reports tampered snapshots", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    const snapshotPath = path.join(backupDir, "canonical.snapshot.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    snapshot.project.name = "Tampered";
    fs.writeFileSync(snapshotPath, renderProjectBackupArtifact(snapshot), "utf8");

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.ok(diagnosticTypes(result).includes("project_backup_checksum_mismatch"));
    assert.ok(diagnosticTypes(result).includes("project_backup_bundle_checksum_mismatch"));
  }));

  test("reports stale backups after canonical state changes", () => withFixture(({ db, syncDir, backupDir }) => {
    exportFixtureBackup(db, syncDir, backupDir);
    db.prepare(`
      UPDATE scenes
      SET title = ?
      WHERE project_id = ? AND scene_id = ?
    `).run("Updated Scene", "test-novel", "sc-first");

    const result = diagnose(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticTypes(result), ["project_backup_stale"]);
    assert.equal(result.trust.status, "stale");
    assert.equal(result.trust.freshness, "stale");
  }));
});
