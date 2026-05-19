import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildStructureExport,
  defaultStructureExportFileName,
  renderStructureExport,
  writeStructureExportFile,
} from "../../structure/structure-export.js";
import { setupReviewBundleTestDb } from "../helpers/db.js";

function seedExportFixture(db) {
  const updatedAt = "2026-05-19T12:00:00.000Z";
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ch-02-second",
    "test-novel",
    "Second",
    2,
    "Second chapter.",
    "/tmp/sync/projects/test-novel/part-1/chapter-2",
    "chapter-2-checksum",
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, logline, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ch-01-first",
    "test-novel",
    "First",
    1,
    "First chapter.",
    "/tmp/sync/projects/test-novel/part-1/chapter-1",
    "chapter-1-checksum",
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, part, chapter, chapter_title, timeline_position,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sc-second",
    "test-novel",
    "ch-02-second",
    "Second Scene",
    1,
    2,
    "Second",
    1,
    "/tmp/sync/projects/test-novel/part-1/chapter-2/sc-second.md",
    "scene-2-checksum",
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, part, chapter, chapter_title, timeline_position,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sc-first",
    "test-novel",
    "ch-01-first",
    "First Scene",
    1,
    1,
    "First",
    1,
    "/tmp/sync/projects/test-novel/part-1/chapter-1/sc-first.md",
    "scene-1-checksum",
    0,
    updatedAt
  );
  db.prepare(`
    INSERT INTO epigraphs (
      epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "epi-first",
    "test-novel",
    "ch-01-first",
    "Epigraph body.",
    "/tmp/sync/projects/test-novel/part-1/chapter-1/epigraph.md",
    "epigraph-checksum",
    0,
    updatedAt
  );
}

describe("buildStructureExport", () => {
  test("builds deterministic SQLite-derived structure snapshots", () => {
    const db = setupReviewBundleTestDb();
    seedExportFixture(db);

    const first = buildStructureExport(db, { projectId: "test-novel", syncDir: "/tmp/sync" });
    const second = buildStructureExport(db, { projectId: "test-novel", syncDir: "/tmp/sync" });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(renderStructureExport(first.snapshot), renderStructureExport(second.snapshot));
    assert.equal(first.snapshot.export.canonical_source, "sqlite");
    assert.equal(first.snapshot.export.generated_transparency, true);
    assert.equal(first.snapshot.export.mutation_surface, false);
    assert.match(first.snapshot.export.structure_checksum, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.snapshot.chapters.map(chapter => chapter.chapter_id), ["ch-01-first", "ch-02-second"]);
    assert.deepEqual(first.snapshot.scenes.map(scene => scene.scene_id), ["sc-first", "sc-second"]);
    assert.equal(first.snapshot.chapters[0].source_path, "projects/test-novel/part-1/chapter-1");
    assert.equal(first.snapshot.scenes[0].file_path, "projects/test-novel/part-1/chapter-1/sc-first.md");
    assert.equal(first.snapshot.epigraphs[0].file_path, "projects/test-novel/part-1/chapter-1/epigraph.md");
  });

  test("returns a structured not-found result for unknown projects", () => {
    const db = setupReviewBundleTestDb();
    const result = buildStructureExport(db, { projectId: "missing", syncDir: "/tmp/sync" });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "NOT_FOUND");
    assert.equal(result.error.details.project_id, "missing");
  });

  test("rejects absolute stored paths outside sync_dir", () => {
    const db = setupReviewBundleTestDb();
    seedExportFixture(db);
    db.prepare(`
      UPDATE scenes
      SET file_path = ?
      WHERE scene_id = ?
    `).run("/tmp/elsewhere/sc-first.md", "sc-first");

    assert.throws(
      () => buildStructureExport(db, { projectId: "test-novel", syncDir: "/tmp/sync" }),
      /Cannot export path outside sync_dir/
    );
  });

  test("rejects relative stored paths outside sync_dir", () => {
    const db = setupReviewBundleTestDb();
    seedExportFixture(db);
    db.prepare(`
      UPDATE scenes
      SET file_path = ?
      WHERE scene_id = ?
    `).run("../elsewhere/sc-first.md", "sc-first");

    assert.throws(
      () => buildStructureExport(db, { projectId: "test-novel", syncDir: "/tmp/sync" }),
      /Cannot export path outside sync_dir/
    );
  });
});

describe("defaultStructureExportFileName", () => {
  test("derives a safe filename from nested project ids", () => {
    assert.equal(defaultStructureExportFileName("universe-one/book-one"), "universe-one-book-one.structure.json");
  });
});

describe("writeStructureExportFile", () => {
  test("rejects output_dir when it already exists as a file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "structure-export-"));
    const outputDir = path.join(root, "not-a-directory");
    fs.writeFileSync(outputDir, "file", "utf8");

    assert.throws(
      () => writeStructureExportFile({ export: {} }, { outputDir, fileName: "test.structure.json" }),
      /output_dir exists but is not a directory/
    );
  });
});
