import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../core/db.js";
import { runStructureDiagnostics } from "../../structure/structure-diagnostics.js";
import { registerSyncTools } from "../../tools/sync.js";

function seedProject(db, projectId) {
  db.prepare(`
    INSERT INTO projects (project_id, universe_id, name)
    VALUES (?, ?, ?)
  `).run(projectId, null, projectId);
}

function seedChapter(db, {
  projectId,
  chapterId,
  sortIndex,
  title,
}) {
  db.prepare(`
    INSERT INTO chapters (
      chapter_id, project_id, title, sort_index, source_path, source_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(chapterId, projectId, title, sortIndex, null, "checksum", new Date().toISOString());
}

function seedScene(db, {
  sceneId,
  projectId,
  filePath,
  chapterId = null,
  chapter = null,
  chapterTitle = null,
  sceneRole = null,
}) {
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, scene_role, title, chapter, chapter_title,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    sceneId,
    projectId,
    chapterId,
    sceneRole,
    sceneId,
    chapter,
    chapterTitle,
    filePath,
    "checksum",
    new Date().toISOString()
  );
}

function seedEpigraph(db, {
  epigraphId,
  projectId,
  chapterId,
  filePath,
}) {
  db.prepare(`
    INSERT INTO epigraphs (
      epigraph_id, project_id, chapter_id, body, file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(epigraphId, projectId, chapterId, "Epigraph body.", filePath, "checksum", new Date().toISOString());
}

function writeSceneFile(syncDir, relativePath, sidecarYaml) {
  const filePath = path.join(syncDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "Scene prose.", "utf8");
  fs.writeFileSync(filePath.replace(/\.md$/, ".meta.yaml"), sidecarYaml, "utf8");
  return filePath;
}

function makeSyncToolHarness(db, { syncDir }) {
  const handlers = new Map();
  const server = {
    tool(name, _description, _schema, handler) {
      handlers.set(name, handler);
    },
  };

  function jsonResponse(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }

  function errorResponse(code, message, details) {
    return jsonResponse({
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  }

  registerSyncTools(server, {
    db,
    SYNC_DIR: syncDir,
    SYNC_DIR_ABS: syncDir,
    SYNC_DIR_REAL: syncDir,
    SYNC_DIR_WRITABLE: false,
    asyncJobs: new Map(),
    errorResponse,
    jsonResponse,
    validateRegexPatterns: () => ({ ok: true }),
    startAsyncJob: () => {
      throw new Error("startAsyncJob should not be called by diagnose_structure");
    },
    pruneAsyncJobs: () => {},
    toPublicJob: () => ({}),
    resolveProjectRoot: () => syncDir,
    resolveBatchTargetScenes: () => ({ ok: true, rows: [], project_exists: true }),
    maxScenesNextStep: () => "",
    isPathInsideSyncDir: () => true,
    deriveLoglineFromProse: () => "",
    inferCharacterIdsFromProse: () => [],
  });

  return {
    async call(name, args) {
      const handler = handlers.get(name);
      assert.ok(handler, `Expected tool '${name}' to be registered`);
      const result = await handler(args);
      return JSON.parse(result.content?.[0]?.text ?? "{}");
    },
  };
}

describe("runStructureDiagnostics", () => {
  test("reports unknown chapter links and numeric compatibility mismatches", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        sortIndex: 1,
        title: "Arrival",
      });
      seedScene(db, {
        sceneId: "sc-unknown",
        projectId: "test-novel",
        filePath: "/missing/sc-unknown.md",
        chapterId: "ch-99-missing",
      });
      seedScene(db, {
        sceneId: "sc-mismatch",
        projectId: "test-novel",
        filePath: "/missing/sc-mismatch.md",
        chapterId: "ch-01-arrival",
        chapter: 9,
        chapterTitle: "Wrong",
      });
      seedEpigraph(db, {
        epigraphId: "epi-unknown",
        projectId: "test-novel",
        chapterId: "ch-88-missing",
        filePath: "/missing/epigraph.md",
      });

      const result = runStructureDiagnostics(db);

      assert.equal(result.ok, false);
      assert.equal(result.summary.by_type.scene_unknown_chapter, 1);
      assert.equal(result.summary.by_type.epigraph_unknown_chapter, 1);
      assert.equal(result.summary.by_type.numeric_chapter_identity_mismatch, 1);
      assert.deepEqual(
        result.diagnostics.map(diagnostic => diagnostic.type).sort(),
        [
          "epigraph_unknown_chapter",
          "numeric_chapter_identity_mismatch",
          "scene_unknown_chapter",
        ]
      );
    } finally {
      db.close();
    }
  });

  test("reports observed folder ambiguity and canonical drift without mutating state", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-diagnostics-"));
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        sortIndex: 1,
        title: "Arrival",
      });
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-02-second",
        sortIndex: 2,
        title: "Second",
      });

      const arrivalPath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/01-Arrival/sc-001.md",
        "scene_id: sc-001\nchapter_id: ch-99-stale\n"
      );
      const duplicatePath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/01-Other/sc-002.md",
        "scene_id: sc-002\n"
      );
      const prologuePath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/prologue/sc-prologue-a.md",
        "scene_id: sc-prologue-a\n"
      );
      const secondProloguePath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/00-prologue/sc-prologue-b.md",
        "scene_id: sc-prologue-b\n"
      );
      const epigraphPath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/02-Second/epigraph.md",
        "epigraph_id: epi-second\nchapter_id: ch-01-arrival\n"
      );

      seedScene(db, {
        sceneId: "sc-001",
        projectId: "test-novel",
        filePath: arrivalPath,
        chapterId: "ch-99-stale",
      });
      seedScene(db, {
        sceneId: "sc-002",
        projectId: "test-novel",
        filePath: duplicatePath,
        chapterId: "ch-01-arrival",
      });
      seedScene(db, {
        sceneId: "sc-prologue-a",
        projectId: "test-novel",
        filePath: prologuePath,
        sceneRole: "prologue",
      });
      seedScene(db, {
        sceneId: "sc-prologue-b",
        projectId: "test-novel",
        filePath: secondProloguePath,
        sceneRole: "prologue",
      });
      seedEpigraph(db, {
        epigraphId: "epi-second",
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        filePath: epigraphPath,
      });

      const beforeScenes = db.prepare(`SELECT COUNT(*) AS count FROM scenes`).get().count;
      const beforeChapters = db.prepare(`SELECT COUNT(*) AS count FROM chapters`).get().count;

      const result = runStructureDiagnostics(db, { syncDir, projectId: "test-novel" });

      assert.equal(result.ok, false);
      assert.equal(result.checked.project_id, "test-novel");
      assert.equal(result.summary.by_type.duplicate_chapter_sort_index, 1);
      assert.equal(result.summary.by_type.folder_canonical_mismatch, 2);
      assert.equal(result.summary.by_type.multiple_scene_role, 1);
      assert.equal(result.summary.by_type.epigraph_chapter_conflict, 1);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM scenes`).get().count, beforeScenes);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM chapters`).get().count, beforeChapters);
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("reports unreadable structure metadata for scenes and epigraphs", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-read-failure-"));
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        sortIndex: 1,
        title: "Arrival",
      });

      const scenePath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/01-Arrival/sc-broken.md",
        "scene_id: [invalid\n"
      );
      const epigraphPath = writeSceneFile(
        syncDir,
        "projects/test-novel/scenes/01-Arrival/epigraph.md",
        "epigraph_id: [invalid\n"
      );

      seedScene(db, {
        sceneId: "sc-broken",
        projectId: "test-novel",
        filePath: scenePath,
        chapterId: "ch-01-arrival",
      });
      seedEpigraph(db, {
        epigraphId: "epi-broken",
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        filePath: epigraphPath,
      });

      const result = runStructureDiagnostics(db, { syncDir });

      assert.equal(result.ok, false);
      assert.equal(result.summary.by_type.structure_file_read_failed, 2);
      assert.deepEqual(
        result.diagnostics
          .filter(diagnostic => diagnostic.type === "structure_file_read_failed")
          .map(diagnostic => diagnostic.severity),
        ["info", "info"]
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });

  test("reports indexed file paths outside the active sync root", () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-current-root-"));
    const staleSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-stale-root-"));
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedChapter(db, {
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        sortIndex: 1,
        title: "Arrival",
      });

      const staleScenePath = writeSceneFile(
        staleSyncDir,
        "projects/test-novel/scenes/01-Arrival/sc-stale.md",
        "scene_id: sc-stale\n"
      );
      const staleEpigraphPath = writeSceneFile(
        staleSyncDir,
        "projects/test-novel/scenes/01-Arrival/epigraph.md",
        "epigraph_id: epi-stale\n"
      );

      seedScene(db, {
        sceneId: "sc-stale",
        projectId: "test-novel",
        filePath: staleScenePath,
        chapterId: "ch-01-arrival",
      });
      seedEpigraph(db, {
        epigraphId: "epi-stale",
        projectId: "test-novel",
        chapterId: "ch-01-arrival",
        filePath: staleEpigraphPath,
      });

      const result = runStructureDiagnostics(db, { syncDir });

      assert.equal(result.ok, false);
      assert.equal(result.summary.by_type.indexed_path_outside_sync_root, 2);
      assert.deepEqual(
        result.diagnostics
          .filter(diagnostic => diagnostic.type === "indexed_path_outside_sync_root")
          .map(diagnostic => diagnostic.details.file_path)
          .sort(),
        [staleEpigraphPath, staleScenePath].sort()
      );
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
      fs.rmSync(staleSyncDir, { recursive: true, force: true });
    }
  });
});

describe("diagnose_structure tool", () => {
  test("returns a read-only diagnostics envelope", async () => {
    const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-tool-"));
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, {
        sceneId: "sc-unknown",
        projectId: "test-novel",
        filePath: "/missing/sc-unknown.md",
        chapterId: "ch-99-missing",
      });

      const tools = makeSyncToolHarness(db, { syncDir });
      const result = await tools.call("diagnose_structure", { project_id: "test-novel" });

      assert.equal(result.ok, false);
      assert.equal(result.checked.project_id, "test-novel");
      assert.equal(result.summary.by_type.scene_unknown_chapter, 1);
      assert.match(result.next_steps[0], /Review diagnostics/);
    } finally {
      db.close();
      fs.rmSync(syncDir, { recursive: true, force: true });
    }
  });
});
