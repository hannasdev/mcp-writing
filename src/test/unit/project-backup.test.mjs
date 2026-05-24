import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../core/db.js";
import {
  buildProjectBackup,
  computeProjectBackupBundleChecksum,
  computeProjectBackupSnapshotChecksum,
  renderProjectBackupArtifact,
  writeProjectBackupFiles,
} from "../../structure/project-backup.js";

const SYNC_DIR = "/tmp/sync";
const UPDATED_AT = "2026-05-23T12:00:00.000Z";

function seedProjectBackupFixture(db) {
  db.prepare(`
    INSERT INTO universes (universe_id, name)
    VALUES (?, ?)
  `).run("shared-universe", "Shared Universe");
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run("test-novel", "shared-universe", "Test Novel");
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run("other-novel", "shared-universe", "Other Novel");

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
    `${SYNC_DIR}/projects/test-novel/chapters/ch-02`,
    "chapter-2-checksum",
    0,
    UPDATED_AT
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
    `${SYNC_DIR}/projects/test-novel/chapters/ch-01`,
    "chapter-1-checksum",
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
    "sc-second",
    "test-novel",
    "ch-02-second",
    "Second Scene",
    1,
    2,
    "Second",
    "Elena",
    "Second scene logline.",
    "turn",
    3,
    4,
    "reveal",
    "Debate",
    1,
    "Day 2",
    1200,
    `${SYNC_DIR}/projects/test-novel/chapters/ch-02/sc-second.md`,
    "scene-2-checksum",
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
    "arrival",
    1,
    2,
    "setup",
    "Opening Image",
    1,
    "Day 1",
    900,
    `${SYNC_DIR}/projects/test-novel/chapters/ch-01/sc-first.md`,
    "scene-1-checksum",
    0,
    UPDATED_AT
  );

  db.prepare(`
    INSERT INTO epigraphs (
      epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "epi-first",
    "test-novel",
    "ch-01-first",
    "This authored epigraph body must not enter the backup snapshot.",
    `${SYNC_DIR}/projects/test-novel/chapters/ch-01/epigraph.md`,
    "epigraph-checksum",
    0,
    UPDATED_AT
  );
  db.prepare(`
    INSERT INTO epigraph_characters (epigraph_id, project_id, character_id)
    VALUES (?, ?, ?)
  `).run("epi-first", "test-novel", "char-elena");
  db.prepare(`
    INSERT INTO epigraph_tags (epigraph_id, project_id, tag)
    VALUES (?, ?, ?)
  `).run("epi-first", "test-novel", "omen");

  db.prepare(`
    INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "char-elena",
    "test-novel",
    null,
    "Elena",
    "protagonist",
    "Learns the truth.",
    "sc-first",
    `${SYNC_DIR}/projects/test-novel/world/characters/elena.md`
  );
  db.prepare(`
    INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "char-shared",
    null,
    "shared-universe",
    "Shared Figure",
    "mentor",
    "Appears across books.",
    null,
    `${SYNC_DIR}/universes/shared-universe/world/characters/shared.md`
  );
  db.prepare(`
    INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "char-other",
    "other-novel",
    null,
    "Other Book Character",
    "foil",
    null,
    null,
    `${SYNC_DIR}/projects/other-novel/world/characters/other.md`
  );
  db.prepare(`
    INSERT INTO character_traits (character_id, trait)
    VALUES (?, ?)
  `).run("char-elena", "stubborn");
  db.prepare(`
    INSERT INTO character_relationships (from_character, to_character, relationship_type, strength, scene_id, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("char-elena", "char-other", "knows", "thin", "sc-first", "External reference stays diagnostic.");

  db.prepare(`
    INSERT INTO places (place_id, project_id, universe_id, name, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "place-harbor",
    "test-novel",
    null,
    "Harbor",
    `${SYNC_DIR}/projects/test-novel/world/places/harbor.md`
  );
  db.prepare(`
    INSERT INTO places (place_id, project_id, universe_id, name, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "place-other",
    "other-novel",
    null,
    "Other Place",
    `${SYNC_DIR}/projects/other-novel/world/places/other.md`
  );

  db.prepare(`
    INSERT INTO scene_characters (scene_id, project_id, character_id)
    VALUES (?, ?, ?)
  `).run("sc-first", "test-novel", "char-elena");
  db.prepare(`
    INSERT INTO scene_characters (scene_id, project_id, character_id)
    VALUES (?, ?, ?)
  `).run("sc-first", "test-novel", "char-other");
  db.prepare(`
    INSERT INTO scene_places (scene_id, project_id, place_id)
    VALUES (?, ?, ?)
  `).run("sc-first", "test-novel", "place-other");
  db.prepare(`
    INSERT INTO scene_tags (scene_id, project_id, tag)
    VALUES (?, ?, ?)
  `).run("sc-first", "test-novel", "harbor");
  db.prepare(`
    INSERT INTO threads (thread_id, project_id, name, status)
    VALUES (?, ?, ?, ?)
  `).run("thread-truth", "test-novel", "Truth", "active");
  db.prepare(`
    INSERT INTO scene_threads (scene_id, project_id, thread_id, beat)
    VALUES (?, ?, ?, ?)
  `).run("sc-first", "test-novel", "thread-truth", "seed");

  db.prepare(`
    INSERT INTO reference_docs (doc_id, project_id, universe_id, type, title, summary, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ref-law",
    "test-novel",
    null,
    "rule",
    "Harbor Law",
    "Sensitive reference summary.",
    `${SYNC_DIR}/projects/test-novel/world/reference/law.md`
  );
  db.prepare(`
    INSERT INTO reference_docs (doc_id, project_id, universe_id, type, title, summary, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ref-other",
    "other-novel",
    null,
    "rule",
    "Other Law",
    null,
    `${SYNC_DIR}/projects/other-novel/world/reference/other.md`
  );
  db.prepare(`
    INSERT INTO reference_doc_tags (doc_id, tag)
    VALUES (?, ?)
  `).run("ref-law", "legal");
  db.prepare(`
    INSERT INTO reference_links (source_kind, source_project_id, source_id, target_doc_id, relation, origin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("scene", "test-novel", "sc-first", "ref-other", "mentions", "explicit");
  db.prepare(`
    INSERT INTO reference_links (source_kind, source_project_id, source_id, target_doc_id, relation, origin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("scene", "other-novel", "sc-other", "ref-law", "mentions", "explicit");

  db.prepare(`
    INSERT INTO async_jobs (job_id, kind, status, created_at)
    VALUES (?, ?, ?, ?)
  `).run("job-secret", "test", "completed", UPDATED_AT);
}

describe("buildProjectBackup", () => {
  test("builds deterministic snapshot-first project backups", () => {
    const db = openDb(":memory:");
    try {
      seedProjectBackupFixture(db);

      const first = buildProjectBackup(db, {
        projectId: "test-novel",
        syncDir: SYNC_DIR,
        applicationVersion: "9.9.9",
      });
      const second = buildProjectBackup(db, {
        projectId: "test-novel",
        syncDir: SYNC_DIR,
        applicationVersion: "9.9.9",
      });

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(renderProjectBackupArtifact(first.snapshot), renderProjectBackupArtifact(second.snapshot));
      assert.equal(first.manifest.checksums.canonical_snapshot_sha256, second.manifest.checksums.canonical_snapshot_sha256);
      assert.equal(first.manifest.checksums.canonical_snapshot_sha256, computeProjectBackupSnapshotChecksum(first.snapshot));
      assert.equal(first.manifest.checksums.bundle_sha256, computeProjectBackupBundleChecksum(first));

      assert.equal(first.manifest.schema_version, 1);
      assert.equal(first.manifest.backup_location, "project-backups/test-novel/");
      assert.equal(first.manifest.compatibility.application_version, "9.9.9");
      assert.equal(typeof first.manifest.compatibility.sqlite_schema_version, "number");
      assert.equal(first.manifest.restore_policy.authority, "full_snapshot");
      assert.equal(first.manifest.restore_policy.custom_delta_chains, false);
      assert.equal(first.manifest.restore_policy.event_replay_required, false);
      assert.equal(first.manifest.operation_history.supported, true);
      assert.equal(first.manifest.operation_history.artifact, "operations.jsonl");
      assert.equal(first.manifest.operation_history.authority, false);

      assert.deepEqual(first.snapshot.chapters.map(row => row.chapter_id), ["ch-01-first", "ch-02-second"]);
      assert.deepEqual(first.snapshot.scenes.map(row => row.scene_id), ["sc-first", "sc-second"]);
      assert.equal(first.snapshot.operation_history.supported, true);
      assert.equal(first.snapshot.operation_history.authority, false);
      assert.equal(first.snapshot.chapters[0].source_path, "projects/test-novel/chapters/ch-01");
      assert.equal(first.snapshot.scenes[0].file_path, "projects/test-novel/chapters/ch-01/sc-first.md");
      assert.equal(first.snapshot.characters.find(row => row.character_id === "char-shared").file_path, "universes/shared-universe/world/characters/shared.md");
    } finally {
      db.close();
    }
  });

  test("keeps prose bodies and excluded runtime state out of restore authority", () => {
    const db = openDb(":memory:");
    try {
      seedProjectBackupFixture(db);

      const result = buildProjectBackup(db, {
        projectId: "test-novel",
        syncDir: SYNC_DIR,
      });

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.epigraphs[0].body, undefined);
      assert.equal(result.manifest.privacy.includes_authored_prose_bodies, false);
      assert.ok(result.manifest.coverage.excluded_tables.includes("async_jobs"));
      assert.ok(result.manifest.coverage.excluded_tables.includes("schema_version"));

      const rendered = renderProjectBackupArtifact(result.snapshot);
      assert.equal(rendered.includes("This authored epigraph body must not enter"), false);
      assert.equal(rendered.includes("job-secret"), false);
    } finally {
      db.close();
    }
  });

  test("represents cross-scope references without granting restore authority over other projects", () => {
    const db = openDb(":memory:");
    try {
      seedProjectBackupFixture(db);

      const result = buildProjectBackup(db, {
        projectId: "test-novel",
        syncDir: SYNC_DIR,
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.snapshot.external_references.character_ids, ["char-other"]);
      assert.deepEqual(result.snapshot.external_references.place_ids, ["place-other"]);
      assert.deepEqual(result.snapshot.external_references.reference_doc_ids, ["ref-other"]);
      assert.equal(result.snapshot.characters.some(row => row.character_id === "char-other"), false);
      assert.equal(result.snapshot.places.some(row => row.place_id === "place-other"), false);
      assert.equal(result.snapshot.reference_docs.some(row => row.doc_id === "ref-other"), false);
      assert.equal(result.snapshot.reference_links.some(row => row.source_project_id === "other-novel"), false);
      assert.equal(result.manifest.coverage.counts.external_character_references, 1);
    } finally {
      db.close();
    }
  });

  test("returns a structured not-found result for unknown projects", () => {
    const db = openDb(":memory:");
    try {
      const result = buildProjectBackup(db, { projectId: "missing" });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "NOT_FOUND");
      assert.equal(result.error.details.project_id, "missing");
    } finally {
      db.close();
    }
  });

  test("writes backup artifacts only when rendered content changes", () => {
    const db = openDb(":memory:");
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-project-backup-"));
    try {
      seedProjectBackupFixture(db);
      const result = buildProjectBackup(db, {
        projectId: "test-novel",
        syncDir: SYNC_DIR,
        backupLocation: "custom-backups/test-novel/",
      });

      assert.equal(result.ok, true);
      assert.equal(result.manifest.backup_location, "custom-backups/test-novel/");

      const firstWrite = writeProjectBackupFiles(result, { outputDir });
      assert.deepEqual(firstWrite.written, {
        manifest: true,
        canonical_snapshot: true,
        operations: true,
      });
      assert.equal(fs.readFileSync(firstWrite.operationLogPath, "utf8"), "");
      const manifestBefore = fs.statSync(firstWrite.manifestPath).mtimeMs;
      const snapshotBefore = fs.statSync(firstWrite.snapshotPath).mtimeMs;
      const operationsBefore = fs.statSync(firstWrite.operationLogPath).mtimeMs;

      const secondWrite = writeProjectBackupFiles(result, { outputDir });
      assert.deepEqual(secondWrite.written, {
        manifest: false,
        canonical_snapshot: false,
        operations: false,
      });
      assert.equal(fs.statSync(secondWrite.manifestPath).mtimeMs, manifestBefore);
      assert.equal(fs.statSync(secondWrite.snapshotPath).mtimeMs, snapshotBefore);
      assert.equal(fs.statSync(secondWrite.operationLogPath).mtimeMs, operationsBefore);
    } finally {
      db.close();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
