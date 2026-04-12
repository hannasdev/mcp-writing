import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Pure utilities (no DB dependency — easy to unit test)
// ---------------------------------------------------------------------------

export function checksumProse(prose) {
  let hash = 5381;
  for (let i = 0; i < prose.length; i++) {
    hash = ((hash << 5) + hash) ^ prose.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

export function walkFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, fileList);
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
      fileList.push(full);
    }
  }
  return fileList;
}

export function inferProjectAndUniverse(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  const parts = rel.split(path.sep);

  if (parts[0] === "universes" && parts.length >= 3) {
    return { universe_id: parts[1], project_id: `${parts[1]}/${parts[2]}` };
  }
  if (parts[0] === "projects" && parts.length >= 2) {
    return { universe_id: null, project_id: parts[1] };
  }
  return { universe_id: null, project_id: parts[0] ?? "default" };
}

export function isWorldFile(syncDir, filePath) {
  const rel = path.relative(syncDir, filePath);
  return rel.includes(`${path.sep}world${path.sep}`) || rel.includes("/world/");
}

export function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw);
}

// ---------------------------------------------------------------------------
// DB-dependent sync (takes db + syncDir as arguments for testability)
// ---------------------------------------------------------------------------

export function indexWorldFile(db, syncDir, file, meta) {
  const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);
  const rel = path.relative(syncDir, file);

  if (rel.includes(`${path.sep}characters${path.sep}`) || rel.includes("/characters/")) {
    if (!meta.character_id) return;
    db.prepare(`
      INSERT INTO characters (character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (character_id) DO UPDATE SET
        name = excluded.name, role = excluded.role, arc_summary = excluded.arc_summary,
        first_appearance = excluded.first_appearance, file_path = excluded.file_path
    `).run(
      meta.character_id, project_id ?? null, universe_id ?? null,
      meta.name ?? meta.character_id, meta.role ?? null, meta.arc_summary ?? null,
      meta.first_appearance ?? null, file
    );
    db.prepare(`DELETE FROM character_traits WHERE character_id = ?`).run(meta.character_id);
    for (const t of (meta.traits ?? [])) {
      db.prepare(`INSERT OR IGNORE INTO character_traits (character_id, trait) VALUES (?, ?)`).run(
        meta.character_id, t
      );
    }
  } else if (rel.includes(`${path.sep}places${path.sep}`) || rel.includes("/places/")) {
    if (!meta.place_id) return;
    db.prepare(`
      INSERT INTO places (place_id, project_id, universe_id, name, file_path)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (place_id) DO UPDATE SET name = excluded.name, file_path = excluded.file_path
    `).run(
      meta.place_id, project_id ?? null, universe_id ?? null,
      meta.name ?? meta.place_id, file
    );
  }
}

export function indexSceneFile(db, syncDir, file, meta, prose) {
  const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);

  if (universe_id) {
    db.prepare(`INSERT OR IGNORE INTO universes (universe_id, name) VALUES (?, ?)`).run(
      universe_id, universe_id
    );
  }
  db.prepare(`INSERT OR IGNORE INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`).run(
    project_id, universe_id ?? null, project_id
  );

  const newChecksum = checksumProse(prose);
  const existing = db.prepare(
    `SELECT prose_checksum FROM scenes WHERE scene_id = ? AND project_id = ?`
  ).get(meta.scene_id, project_id);

  const isStale = existing && existing.prose_checksum !== newChecksum ? 1 : 0;

  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, title, part, chapter, pov, logline,
      save_the_cat_beat, timeline_position, story_time, word_count,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (scene_id, project_id) DO UPDATE SET
      title = excluded.title,
      part = excluded.part,
      chapter = excluded.chapter,
      pov = excluded.pov,
      logline = excluded.logline,
      save_the_cat_beat = excluded.save_the_cat_beat,
      timeline_position = excluded.timeline_position,
      story_time = excluded.story_time,
      word_count = excluded.word_count,
      file_path = excluded.file_path,
      prose_checksum = excluded.prose_checksum,
      metadata_stale = CASE WHEN excluded.prose_checksum != scenes.prose_checksum THEN 1 ELSE scenes.metadata_stale END,
      updated_at = excluded.updated_at
  `).run(
    meta.scene_id, project_id,
    meta.title ?? null, meta.part ?? null, meta.chapter ?? null,
    meta.pov ?? null, meta.logline ?? null,
    meta.save_the_cat_beat ?? meta.save_the_cat ?? null,
    meta.timeline_position ?? null, meta.story_time ?? null,
    meta.word_count ?? prose.split(/\s+/).filter(Boolean).length,
    file, newChecksum, isStale,
    new Date().toISOString()
  );

  db.prepare(`DELETE FROM scene_characters WHERE scene_id = ?`).run(meta.scene_id);
  db.prepare(`DELETE FROM scene_places WHERE scene_id = ?`).run(meta.scene_id);
  db.prepare(`DELETE FROM scene_tags WHERE scene_id = ?`).run(meta.scene_id);

  for (const c of (meta.characters ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_characters (scene_id, character_id) VALUES (?, ?)`).run(
      meta.scene_id, c
    );
  }
  for (const p of (meta.places ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_places (scene_id, place_id) VALUES (?, ?)`).run(
      meta.scene_id, p
    );
  }
  for (const t of (meta.tags ?? [])) {
    db.prepare(`INSERT OR IGNORE INTO scene_tags (scene_id, tag) VALUES (?, ?)`).run(
      meta.scene_id, t
    );
  }

  db.prepare(`INSERT OR REPLACE INTO scenes_fts (scene_id, logline, title) VALUES (?, ?, ?)`).run(
    meta.scene_id, meta.logline ?? "", meta.title ?? ""
  );

  return { isStale };
}

export function syncAll(db, syncDir) {
  const files = walkFiles(syncDir);
  let indexed = 0;
  let staleMarked = 0;

  for (const file of files) {
    try {
      const { data: meta, content: prose } = parseFile(file);

      if (isWorldFile(syncDir, file)) {
        indexWorldFile(db, syncDir, file, meta);
        continue;
      }

      if (!meta.scene_id) continue;

      const { isStale } = indexSceneFile(db, syncDir, file, meta, prose);
      if (isStale) staleMarked++;
      indexed++;
    } catch (err) {
      process.stderr.write(`[mcp-writing] Failed to index ${file}: ${err.message}\n`);
    }
  }

  process.stderr.write(
    `[mcp-writing] Sync complete: ${indexed} scenes indexed, ${staleMarked} marked stale\n`
  );
  return { indexed, staleMarked };
}
