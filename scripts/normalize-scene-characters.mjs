#!/usr/bin/env node
import path from "node:path";
import { openDb } from "../db.js";
import { buildCharacterNormalizationContext, normalizeSceneCharacters } from "../scene-character-normalization.js";
import { normalizeSceneMetaForPath, readMeta, syncAll, writeMeta } from "../sync.js";

function readRequiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    syncDir: process.env.WRITING_SYNC_DIR ?? "./sync",
    projectId: null,
    write: false,
    json: false,
    limit: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sync-dir" || arg === "-d") {
      opts.syncDir = readRequiredValue(argv, i, arg);
      i++;
    } else if (arg === "--project-id" || arg === "-p") {
      opts.projectId = readRequiredValue(argv, i, arg);
      i++;
    } else if (arg === "--limit" || arg === "-n") {
      opts.limit = Number.parseInt(readRequiredValue(argv, i, arg), 10);
      i++;
    } else if (arg === "--write") {
      opts.write = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }

  return opts;
}

function usage() {
  return [
    "Usage:",
    "  node --experimental-sqlite scripts/normalize-scene-characters.mjs [--sync-dir <dir>] [--project-id <id>] [--limit <n>] [--write] [--json]",
    "",
    "Options:",
    "  --sync-dir, -d   WRITING_SYNC_DIR root (default: env WRITING_SYNC_DIR or ./sync)",
    "  --project-id, -p Restrict to one project_id",
    "  --limit, -n      Process at most N scenes",
    "  --write          Apply changes (default: dry-run)",
    "  --json           Emit machine-readable JSON summary",
    "",
    "Note: Uses an in-memory sqlite index for analysis; no mcp.sqlite file is created in sync_dir.",
  ].join("\n");
}

function queryRows(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function resolveCharacterRows(db, projectId) {
  return queryRows(
    db,
    `SELECT character_id, name
       FROM characters
      WHERE project_id = ?
         OR universe_id = (SELECT universe_id FROM projects WHERE project_id = ?)
      ORDER BY length(name) DESC`,
    projectId,
    projectId
  );
}

function resolveScenes(db, projectId, limit) {
  const limitClause = Number.isInteger(limit) ? ` LIMIT ${limit}` : "";
  if (!projectId) {
    return queryRows(
      db,
      `SELECT scene_id, project_id, file_path
         FROM scenes
        ORDER BY project_id, part, chapter, timeline_position, scene_id${limitClause}`
    );
  }
  return queryRows(
    db,
    `SELECT scene_id, project_id, file_path
       FROM scenes
      WHERE project_id = ?
      ORDER BY part, chapter, timeline_position, scene_id${limitClause}`,
    projectId
  );
}

function runNormalization({ syncDir, projectId, write, limit }) {
  const db = openDb(":memory:");
  try {
    // Refresh index so character/name resolution uses current canonical sheets and sidecars.
    syncAll(db, syncDir, { quiet: true, writable: false });

    const scenes = resolveScenes(db, projectId, limit);
    const contextCache = new Map();

    const getContextForProject = (sceneProjectId) => {
      const key = sceneProjectId ?? "__none__";
      if (contextCache.has(key)) return contextCache.get(key);

      const context = buildCharacterNormalizationContext(resolveCharacterRows(db, sceneProjectId));
      contextCache.set(key, context);
      return context;
    };

    const changed = [];
    let processedScenes = 0;

    for (const scene of scenes) {
      const { meta } = readMeta(scene.file_path, syncDir, { writable: false });
      if (!Array.isArray(meta.characters) || meta.characters.length === 0) {
        processedScenes++;
        continue;
      }

      const normalized = normalizeSceneCharacters(meta.characters, getContextForProject(scene.project_id));
      processedScenes++;

      if (!normalized.changed) continue;

      if (write) {
        const updatedMeta = normalizeSceneMetaForPath(syncDir, scene.file_path, {
          ...meta,
          characters: normalized.after,
        }).meta;
        writeMeta(scene.file_path, updatedMeta);
      }

      changed.push({
        scene_id: scene.scene_id,
        project_id: scene.project_id,
        file_path: scene.file_path,
        before_characters: normalized.before,
        after_characters: normalized.after,
        added: normalized.added,
        removed: normalized.removed,
      });
    }

    return {
      ok: true,
      mode: write ? "write" : "dry_run",
      sync_dir: path.resolve(syncDir),
      project_id: projectId,
      processed_scenes: processedScenes,
      scenes_changed: changed.length,
      character_reference_count: [...contextCache.values()].reduce((sum, ctx) => sum + ctx.clean.length, 0),
      changes: changed,
    };
  } finally {
    db.close();
  }
}

function printTextSummary(result) {
  process.stdout.write(`normalize-scene-characters (${result.mode})\n`);
  process.stdout.write(`sync_dir: ${result.sync_dir}\n`);
  process.stdout.write(`project_id: ${result.project_id ?? "(all projects)"}\n`);
  process.stdout.write(`processed_scenes: ${result.processed_scenes}\n`);
  process.stdout.write(`scenes_changed: ${result.scenes_changed}\n`);
  process.stdout.write(`character_reference_count: ${result.character_reference_count}\n`);

  const preview = result.changes.slice(0, 20);
  for (const row of preview) {
    process.stdout.write(`- ${row.scene_id} (${row.project_id})\n`);
    process.stdout.write(`  added: ${row.added.join(", ") || "(none)"}\n`);
    process.stdout.write(`  removed: ${row.removed.join(", ") || "(none)"}\n`);
  }
  if (result.changes.length > preview.length) {
    process.stdout.write(`... ${result.changes.length - preview.length} more changed scene(s)\n`);
  }

  if (result.mode === "write") {
    process.stdout.write("next_step: run sync() to refresh DB indexes from updated sidecars\n");
  }
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const result = runNormalization({
      syncDir: path.resolve(opts.syncDir),
      projectId: opts.projectId,
      write: opts.write,
      limit: opts.limit,
    });

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    printTextSummary(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }
}

main();