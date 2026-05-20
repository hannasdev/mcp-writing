import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../core/db.js";
import {
  buildStructureExport,
  defaultStructureExportFileName,
  writeStructureExportFile,
} from "../../structure/structure-export.js";
import { restoreStructureFromExport } from "../../structure/structure-restore.js";
import { checksumProse } from "../../sync/sync.js";

function seedProject(db, projectId = "test-novel") {
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run(projectId, null, projectId);
}

function writeProseFile(syncDir, relativePath, prose) {
  const filePath = path.join(syncDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, prose, "utf8");
  return filePath;
}

function seedTrustedExportFixture(db, syncDir) {
  const updatedAt = "2026-05-19T12:00:00.000Z";
  seedProject(db);
  const scenePath = writeProseFile(
    syncDir,
    "projects/test-novel/scenes/01-Arrival/sc-001.md",
    "Scene prose."
  );
  const epigraphPath = writeProseFile(
    syncDir,
    "projects/test-novel/scenes/01-Arrival/epigraph.md",
    "---\nepigraph_id: epi-arrival\n---\nEpigraph body."
  );

  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ch-01-arrival",
    "test-novel",
    "Arrival",
    1,
    "Arrival logline.",
    "projects/test-novel/scenes/01-Arrival",
    "chapter-checksum",
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, scene_role, title, chapter, chapter_title,
      timeline_position, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sc-001",
    "test-novel",
    "ch-01-arrival",
    null,
    "Scene One",
    1,
    "Arrival",
    1,
    scenePath,
    checksumProse("Scene prose."),
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO epigraphs (
      epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "epi-arrival",
    "test-novel",
    "ch-01-arrival",
    "Epigraph body.",
    epigraphPath,
    checksumProse("Epigraph body."),
    0,
    updatedAt
  );

  const built = buildStructureExport(db, { projectId: "test-novel", syncDir });
  assert.equal(built.ok, true);
  const exportPath = writeStructureExportFile(built.snapshot, {
    outputDir: path.join(syncDir, "structure-exports"),
    fileName: defaultStructureExportFileName("test-novel"),
  });
  return { exportPath, scenePath, epigraphPath };
}

describe("restoreStructureFromExport", () => {
  test("reports invalid export locations as refused even in dry-run mode", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-"));
    const db = openDb(":memory:");
    try {
      seedProject(db);

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        structureExportPath: "../outside.structure.json",
      });

      assert.equal(result.ok, false);
      assert.equal(result.action, "restore_refused");
      assert.equal(result.dry_run, true);
      assert.equal(result.diagnostics[0].type, "structure_export_invalid_location");
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("restores missing canonical chapters and epigraphs transactionally", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-"));
    const db = openDb(":memory:");
    try {
      seedTrustedExportFixture(db, syncDir);

      db.prepare(`DELETE FROM epigraphs WHERE project_id = ?`).run("test-novel");
      db.prepare(`DELETE FROM chapters WHERE project_id = ?`).run("test-novel");
      db.prepare(`
        UPDATE scenes
        SET chapter_id = NULL, chapter = NULL, chapter_title = NULL, timeline_position = NULL
        WHERE scene_id = ? AND project_id = ?
      `).run("sc-001", "test-novel");

      const dryRun = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
      });

      assert.equal(dryRun.ok, true);
      assert.equal(dryRun.action, "planned");
      assert.equal(dryRun.planned_changes.chapters_created, 1);
      assert.equal(dryRun.planned_changes.scenes_updated, 1);
      assert.equal(dryRun.planned_changes.epigraphs_created, 1);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM chapters`).get().count, 0);

      const restored = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(restored.ok, true);
      assert.equal(restored.action, "restored");
      assert.deepEqual(restored.diagnostics, []);

      const chapter = db.prepare(`
        SELECT chapter_id, title, sort_index
        FROM chapters
        WHERE project_id = ? AND chapter_id = ?
      `).get("test-novel", "ch-01-arrival");
      assert.equal(chapter.chapter_id, "ch-01-arrival");
      assert.equal(chapter.title, "Arrival");
      assert.equal(chapter.sort_index, 1);

      const scene = db.prepare(`
        SELECT chapter_id, chapter, chapter_title, timeline_position
        FROM scenes
        WHERE project_id = ? AND scene_id = ?
      `).get("test-novel", "sc-001");
      assert.equal(scene.chapter_id, "ch-01-arrival");
      assert.equal(scene.chapter, 1);
      assert.equal(scene.chapter_title, "Arrival");
      assert.equal(scene.timeline_position, 1);

      const epigraph = db.prepare(`
        SELECT epigraph_id, chapter_id, body
        FROM epigraphs
        WHERE project_id = ? AND epigraph_id = ?
      `).get("test-novel", "epi-arrival");
      assert.equal(epigraph.epigraph_id, "epi-arrival");
      assert.equal(epigraph.chapter_id, "ch-01-arrival");
      assert.equal(epigraph.body, "Epigraph body.");
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("refuses a tampered export checksum without mutating state", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-tamper-"));
    const db = openDb(":memory:");
    try {
      const { exportPath } = seedTrustedExportFixture(db, syncDir);
      const snapshot = JSON.parse(fs.readFileSync(exportPath, "utf8"));
      snapshot.chapters[0].title = "Tampered";
      fs.writeFileSync(exportPath, JSON.stringify(snapshot, null, 2), "utf8");

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(result.ok, false);
      assert.equal(result.action, "restore_refused");
      assert.equal(result.summary.by_type.structure_export_checksum_mismatch, 1);
      assert.equal(
        db.prepare(`
          SELECT title FROM chapters WHERE project_id = ? AND chapter_id = ?
        `).get("test-novel", "ch-01-arrival").title,
        "Arrival"
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("refuses restore when exported prose file checksums no longer match disk", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-stale-file-"));
    const db = openDb(":memory:");
    try {
      const { scenePath, epigraphPath } = seedTrustedExportFixture(db, syncDir);
      fs.writeFileSync(scenePath, "Scene prose changed after export.", "utf8");
      fs.writeFileSync(epigraphPath, "---\nepigraph_id: epi-arrival\n---\nEpigraph changed after export.", "utf8");

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(result.ok, false);
      assert.equal(result.action, "restore_refused");
      assert.equal(result.summary.by_type.structure_export_file_checksum_mismatch, 2);
      assert.equal(
        db.prepare(`
          SELECT body FROM epigraphs WHERE project_id = ? AND epigraph_id = ?
        `).get("test-novel", "epi-arrival").body,
        "Epigraph body."
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("refuses restore when an exported file path is not a regular file", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-file-kind-"));
    const db = openDb(":memory:");
    try {
      const { scenePath } = seedTrustedExportFixture(db, syncDir);
      fs.rmSync(scenePath);
      fs.mkdirSync(scenePath);

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(result.ok, false);
      assert.equal(result.action, "restore_refused");
      assert.equal(result.summary.by_type.structure_export_file_not_regular, 1);
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("refuses extra current chapters that are absent from the export", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-conflict-"));
    const db = openDb(":memory:");
    try {
      seedTrustedExportFixture(db, syncDir);
      db.prepare(`
        INSERT INTO chapters (
          chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "ch-02-extra",
        "test-novel",
        "Extra",
        2,
        null,
        null,
        null,
        0,
        "2026-05-19T12:00:00.000Z"
      );

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(result.ok, false);
      assert.equal(result.summary.by_type.structure_restore_extra_chapter_conflict, 1);
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?`).get("test-novel").count,
        2
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("refuses extra current epigraphs that are absent from the export", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-restore-extra-epigraph-"));
    const db = openDb(":memory:");
    try {
      seedTrustedExportFixture(db, syncDir);
      db.prepare(`
        INSERT INTO chapters (
          chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "ch-02-extra",
        "test-novel",
        "Extra",
        2,
        null,
        null,
        null,
        0,
        "2026-05-19T12:00:00.000Z"
      );
      db.prepare(`
        INSERT INTO epigraphs (
          epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "epi-extra",
        "test-novel",
        "ch-02-extra",
        "Extra epigraph.",
        path.join(syncDir, "projects/test-novel/scenes/01-Arrival/extra-epigraph.md"),
        checksumProse("Extra epigraph."),
        0,
        "2026-05-19T12:00:00.000Z"
      );

      const result = restoreStructureFromExport(db, {
        syncDir,
        projectId: "test-novel",
        dryRun: false,
      });

      assert.equal(result.ok, false);
      assert.equal(result.summary.by_type.structure_restore_extra_epigraph_conflict, 1);
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM epigraphs WHERE project_id = ?`).get("test-novel").count,
        2
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});
