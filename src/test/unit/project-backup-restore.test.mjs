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
import { restoreProjectFromBackup } from "../../structure/project-backup-restore.js";

const UPDATED_AT = "2026-05-24T12:00:00.000Z";

function seedFixture(db, syncDir) {
  const scenePath = path.join(syncDir, "projects/test-novel/scenes/sc-first.md");
  const chapterPath = path.join(syncDir, "projects/test-novel/chapters/ch-01");
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  fs.mkdirSync(chapterPath, { recursive: true });
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
  db.prepare(`
    INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "char-elena",
    "test-novel",
    null,
    "Elena",
    "protagonist",
    null,
    null,
    null
  );
  db.prepare(`
    INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "char-marcus",
    "test-novel",
    null,
    "Marcus",
    "ally",
    null,
    null,
    null
  );
  db.prepare(`
    INSERT INTO character_relationships (from_character, to_character, relationship_type, strength, scene_id, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("char-elena", "char-marcus", "trusts", "strong", null, null);
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

function writeBundle(backupDir, { manifest, snapshot }) {
  fs.writeFileSync(path.join(backupDir, "manifest.json"), renderProjectBackupArtifact(manifest), "utf8");
  fs.writeFileSync(path.join(backupDir, "canonical.snapshot.json"), renderProjectBackupArtifact(snapshot), "utf8");
}

function writeMalformedSnapshotWithValidChecksums(backupDir, snapshot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  const nextManifestBase = {
    ...manifest,
    checksums: {
      ...manifest.checksums,
      canonical_snapshot_sha256: computeProjectBackupSnapshotChecksum(snapshot),
    },
  };
  const nextManifest = {
    ...nextManifestBase,
    checksums: {
      ...nextManifestBase.checksums,
      bundle_sha256: computeProjectBackupBundleChecksum({ manifest: nextManifestBase, snapshot }),
    },
  };
  writeBundle(backupDir, { manifest: nextManifest, snapshot });
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
    const built = exportBackup(db, syncDir, backupDir);

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.equal(result.action, "planned");
    assert.equal(result.dry_run, true);
    assert.equal(result.plan.totals.create, 0);
    assert.equal(result.plan.totals.update, 0);
    assert.equal(result.plan.totals.delete, 0);
    assert.ok(result.plan.totals.unchanged > 0);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      built.snapshot.character_relationships.map(row => [row.from_character, row.to_character, row.scene_id, row.note]),
      [["char-elena", "char-marcus", null, null]]
    );
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

  test("refuses non-string file reference fields without throwing", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: [
        {
          ...built.snapshot.scenes[0],
          file_path: {},
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_file_reference_invalid"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.diagnostics[0].details.field, "file_path");
    assert.equal(result.diagnostics[0].details.reason, "non_string_file_reference");
    assert.equal(result.plan, null);
  }));

  test("refuses file references that escape through symlinked directories", () => withFixture(({ db, syncDir, backupDir }) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-restore-file-escape-"));
    try {
      const outsideScenePath = path.join(outsideDir, "sc-first.md");
      fs.writeFileSync(outsideScenePath, "# Outside Scene\n", "utf8");
      const linkDir = path.join(syncDir, "projects/test-novel/symlink-scenes");
      fs.symlinkSync(outsideDir, linkDir, "dir");

      const built = exportBackup(db, syncDir, backupDir);
      writeMalformedSnapshotWithValidChecksums(backupDir, {
        ...built.snapshot,
        scenes: [
          {
            ...built.snapshot.scenes[0],
            file_path: "projects/test-novel/symlink-scenes/sc-first.md",
          },
        ],
      });

      const result = restorePlan(db, syncDir, backupDir);

      assert.equal(result.ok, false);
      assert.equal(result.action, "restore_refused");
      assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_file_reference_invalid"]);
      assert.equal(result.diagnostics[0].details.domain, "scenes");
      assert.equal(result.diagnostics[0].details.field, "file_path");
      assert.equal(result.diagnostics[0].details.reason, "outside_sync_root");
      assert.equal(result.diagnostics[0].details.resolved_path, fs.realpathSync.native(outsideScenePath));
      assert.equal(result.plan, null);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }));

  test("reports inaccessible file reference ancestors separately from sync root escapes", t => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    const backupScenePath = built.snapshot.scenes[0].file_path;
    const scenePath = path.isAbsolute(backupScenePath)
      ? path.resolve(backupScenePath)
      : path.resolve(syncDir, backupScenePath);
    const originalRealpathNative = fs.realpathSync.native;
    t.mock.method(fs.realpathSync, "native", targetPath => {
      if (path.resolve(targetPath) === scenePath) {
        throw new Error("EACCES: permission denied, realpath");
      }
      return originalRealpathNative(targetPath);
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_file_reference_invalid"]);
    assert.equal(
      result.diagnostics[0].message,
      "Backup scenes record file reference could not be resolved inside WRITING_SYNC_DIR."
    );
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.diagnostics[0].details.field, "file_path");
    assert.equal(result.diagnostics[0].details.reason, "ancestor_resolution_failed");
    assert.equal(result.diagnostics[0].details.resolved_path, scenePath);
    assert.equal(result.diagnostics[0].details.existing_ancestor, scenePath);
    assert.match(result.diagnostics[0].details.message, /Path ancestor could not be resolved/);
    assert.match(result.diagnostics[0].details.cause, /EACCES/);
    assert.equal(result.diagnostics[0].next_step, "Ensure the referenced path is accessible, then retry the dry run.");
    assert.equal(result.plan, null);
  }));

  test("refuses optional file references when present but missing", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      characters: built.snapshot.characters.map(row => row.character_id === "char-elena"
        ? {
            ...row,
            file_path: "projects/test-novel/world/characters/elena.md",
          }
        : row),
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_file_reference_missing"]);
    assert.equal(result.diagnostics[0].details.domain, "characters");
    assert.equal(result.diagnostics[0].details.field, "file_path");
    assert.equal(result.plan, null);
  }));

  test("refuses non-object manifests with restore diagnostics", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    const snapshot = JSON.parse(fs.readFileSync(path.join(backupDir, "canonical.snapshot.json"), "utf8"));
    writeBundle(backupDir, { manifest: null, snapshot });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_manifest"]);
    assert.equal(result.diagnostics[0].details.actual_type, "null");
    assert.equal(result.plan, null);
  }));

  test("refuses non-object canonical snapshots before planning", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, null);

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.actual_type, "null");
    assert.equal(result.plan, null);
  }));

  test("reports null singleton snapshot fields with a clear actual type", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      project: null,
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "project");
    assert.equal(result.diagnostics[0].details.actual_type, "null");
    assert.equal(result.plan, null);
  }));

  test("refuses incomplete canonical snapshots before treating missing domains as deletes", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    const { scenes: _scenes, ...incompleteSnapshot } = built.snapshot;
    writeMalformedSnapshotWithValidChecksums(backupDir, incompleteSnapshot);

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_incomplete_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.plan, null);
  }));

  test("refuses wrong-type canonical snapshot domains before file-reference validation", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: {},
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.plan, null);
  }));

  test("reports null canonical snapshot array domains with a clear actual type", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: null,
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.diagnostics[0].details.actual_type, "null");
    assert.equal(result.plan, null);
  }));

  test("refuses non-object rows in file-reference domains before file-reference validation", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: [null],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.diagnostics[0].details.index, 0);
    assert.equal(result.plan, null);
  }));

  test("refuses rows missing identity fields before planning", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: [{}],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(
      result.diagnostics.map(diagnostic => [diagnostic.details.domain, diagnostic.details.field]),
      [["scenes", "project_id"], ["scenes", "scene_id"]]
    );
    assert.equal(result.plan, null);
  }));

  test("refuses non-object rows in non-file domains before planning", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scene_tags: [null],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scene_tags");
    assert.equal(result.plan, null);
  }));

  test("refuses join rows missing one required identity key", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scene_tags: [{ project_id: "test-novel", tag: "opening" }],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "scene_tags");
    assert.equal(result.diagnostics[0].details.field, "scene_id");
    assert.equal(result.plan, null);
  }));

  test("allows empty source_project_id identity for universe-scoped reference links", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      reference_links: [
        {
          source_kind: "reference",
          source_project_id: "",
          source_id: "ref-universe",
          target_doc_id: "ref-target",
          relation: "mentions",
          origin: "explicit",
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.ok(result.plan.changes.some(change => (
      change.domain === "reference_links" &&
      change.action === "create" &&
      change.identity.source_project_id === ""
    )));
  }));

  test("refuses non-string identity field values before planning", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scene_tags: [
        {
          ...built.snapshot.scene_tags[0],
          tag: {},
        },
      ],
      character_relationships: [
        {
          ...built.snapshot.character_relationships[0],
          note: {},
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(
      result.diagnostics.map(diagnostic => [diagnostic.details.domain, diagnostic.details.field, diagnostic.details.reason]),
      [
        ["character_relationships", "note", "non_string_identity"],
        ["scene_tags", "tag", "non_string_identity"],
      ]
    );
    assert.equal(result.plan, null);
  }));

  test("refuses project-scoped rows whose project_id does not match the backup project", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: [
        {
          ...built.snapshot.scenes[0],
          project_id: "other-project",
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_wrong_project"]);
    assert.equal(result.diagnostics[0].details.domain, "scenes");
    assert.equal(result.diagnostics[0].details.row_project_id, "other-project");
    assert.equal(result.plan, null);
  }));

  test("refuses nullable-scope world rows that belong to another project", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      characters: [
        ...built.snapshot.characters,
        {
          character_id: "char-other",
          project_id: "other-project",
          universe_id: null,
          name: "Other",
          role: null,
          arc_summary: null,
          first_appearance: null,
          file_path: null,
        },
      ],
      places: [
        {
          place_id: "place-other",
          project_id: "other-project",
          universe_id: null,
          name: "Other Place",
          file_path: null,
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(
      result.diagnostics
        .map(diagnostic => [diagnostic.details.domain, diagnostic.details.row_project_id])
        .sort((a, b) => a[0].localeCompare(b[0])),
      [["characters", "other-project"], ["places", "other-project"]]
    );
    assert.equal(result.plan, null);
  }));

  test("refuses scoped world rows missing project scope fields", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    const scopedCharacter = {
      ...built.snapshot.characters.find(row => row.character_id === "char-elena"),
    };
    delete scopedCharacter.project_id;
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      characters: [
        scopedCharacter,
        ...built.snapshot.characters.filter(row => row.character_id !== "char-elena"),
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_invalid_snapshot"]);
    assert.equal(result.diagnostics[0].details.domain, "characters");
    assert.equal(result.diagnostics[0].details.field, "project_id");
    assert.equal(result.diagnostics[0].details.reason, "missing_project_scope");
    assert.equal(result.plan, null);
  }));

  test("refuses nullable-scope reference rows that belong to another project", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      reference_docs: [
        {
          doc_id: "ref-other",
          project_id: "other-project",
          universe_id: null,
          type: "note",
          title: "Other Reference",
          summary: null,
          file_path: "projects/other-project/world/reference/other.md",
        },
      ],
      reference_links: [
        {
          source_kind: "scene",
          source_project_id: "other-project",
          source_id: "sc-first",
          target_doc_id: "ref-other",
          relation: "mentions",
          origin: "explicit",
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(
      result.diagnostics.map(diagnostic => [diagnostic.details.domain, diagnostic.details.field, diagnostic.details.row_project_id]),
      [["reference_docs", "project_id", "other-project"], ["reference_links", "source_project_id", "other-project"]]
    );
    assert.equal(result.plan, null);
  }));

  test("refuses duplicate identities before planning can collapse rows", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      scenes: [built.snapshot.scenes[0], built.snapshot.scenes[0]],
      scene_tags: [built.snapshot.scene_tags[0], built.snapshot.scene_tags[0]],
      character_relationships: [
        built.snapshot.character_relationships[0],
        built.snapshot.character_relationships[0],
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(
      result.diagnostics.map(diagnostic => diagnostic.details.domain),
      ["character_relationships", "scene_tags", "scenes"]
    );
    assert.deepEqual(
      new Set(result.diagnostics.map(diagnostic => diagnostic.type)),
      new Set(["project_restore_duplicate_identity"])
    );
    assert.equal(result.plan, null);
  }));

  test("treats null and empty-string nullable identity fields as distinct", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      character_relationships: [
        ...built.snapshot.character_relationships,
        {
          ...built.snapshot.character_relationships[0],
          note: "",
        },
      ],
    });

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, true);
    assert.ok(result.plan.changes.some(change => (
      change.domain === "character_relationships" &&
      change.action === "create" &&
      change.identity.note === ""
    )));
    assert.ok(result.plan.changes.some(change => (
      change.domain === "character_relationships" &&
      change.action === "unchanged" &&
      change.identity.note === null
    )));
  }));

  test("refuses current SQLite duplicate identities before planning can collapse rows", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    db.prepare(`
      INSERT INTO character_relationships (from_character, to_character, relationship_type, strength, scene_id, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("char-elena", "char-marcus", "trusts", "strong", null, null);

    const result = restorePlan(db, syncDir, backupDir);

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_current_duplicate_identity"]);
    assert.equal(result.diagnostics[0].details.domain, "character_relationships");
    assert.deepEqual(result.diagnostics[0].details.identity, {
      from_character: "char-elena",
      to_character: "char-marcus",
      relationship_type: "trusts",
      scene_id: null,
      note: null,
    });
    assert.equal(result.plan, null);
  }));

  test("requires explicit confirmation before applying destructive restore plans", () => withFixture(({ db, syncDir, backupDir }) => {
    exportBackup(db, syncDir, backupDir);
    db.prepare(`
      INSERT INTO scene_tags (scene_id, project_id, tag)
      VALUES (?, ?, ?)
    `).run("sc-first", "test-novel", "extra-current-tag");

    const result = restorePlan(db, syncDir, backupDir, { dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_destructive_confirmation_required"]);
    assert.equal(result.plan.destructive_change_count, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scene_tags WHERE project_id = ? AND tag = ?`).get("test-novel", "extra-current-tag").count,
      1
    );
  }));

  test("applies a confirmed restore transaction and rebuilds covered canonical state", () => withFixture(({ db, syncDir, backupDir }) => {
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
    db.prepare(`
      INSERT INTO scenes_fts (scene_id, project_id, logline, title, keywords)
      VALUES (?, ?, ?, ?, ?)
    `).run("sc-first", "test-novel", "changed", "Changed Scene", "changed");

    const result = restorePlan(db, syncDir, backupDir, {
      dryRun: false,
      confirmDestructive: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "restored");
    assert.equal(result.dry_run, false);
    assert.equal(result.applied.restored, true);
    assert.equal(result.plan.totals.create, 1);
    assert.equal(result.plan.totals.update, 1);
    assert.equal(result.plan.totals.delete, 1);
    assert.equal(
      db.prepare(`SELECT title FROM scenes WHERE project_id = ? AND scene_id = ?`).get("test-novel", "sc-first").title,
      "First Scene"
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scene_tags WHERE project_id = ? AND tag = ?`).get("test-novel", "extra-current-tag").count,
      0
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE project_id = ? AND chapter_id = ?`).get("test-novel", "ch-01-first").count,
      1
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM scenes_fts WHERE project_id = ?`).get("test-novel").count,
      0
    );
  }));

  test("requires explicit confirmation before applying cross-scope restore plans", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      project: {
        ...built.snapshot.project,
        universe_id: "shared-universe",
      },
      universe: {
        universe_id: "shared-universe",
        name: "Shared Universe",
      },
    });

    const result = restorePlan(db, syncDir, backupDir, { dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_cross_scope_confirmation_required"]);
    assert.equal(result.plan.cross_scope_change_count, 1);
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM universes WHERE universe_id = ?`).get("shared-universe").count,
      0
    );
  }));

  test("rolls back all database changes when restore application fails", () => withFixture(({ db, syncDir, backupDir }) => {
    const built = exportBackup(db, syncDir, backupDir);
    db.prepare(`
      UPDATE scenes
      SET title = ?
      WHERE project_id = ? AND scene_id = ?
    `).run("Changed Scene", "test-novel", "sc-first");
    writeMalformedSnapshotWithValidChecksums(backupDir, {
      ...built.snapshot,
      project: {
        ...built.snapshot.project,
        name: null,
      },
    });

    const result = restorePlan(db, syncDir, backupDir, { dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.action, "restore_refused");
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.type), ["project_restore_write_failed"]);
    assert.equal(
      db.prepare(`SELECT title FROM scenes WHERE project_id = ? AND scene_id = ?`).get("test-novel", "sc-first").title,
      "Changed Scene"
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?`).get("test-novel").count,
      1
    );
  }));
});
