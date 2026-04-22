import fs from "node:fs";
import matter from "gray-matter";
import { normalizeSceneMetaForPath, readMeta, writeMeta } from "./sync.js";

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCharacterRows(rows) {
  const clean = rows
    .filter(row => row?.character_id && row?.name)
    .map(row => ({
      character_id: row.character_id,
      name: String(row.name).trim(),
      tokens: String(row.name).toLowerCase().split(/\s+/).filter(Boolean),
    }))
    .filter(row => row.name.length > 0);

  const tokenMap = new Map();
  for (const row of clean) {
    for (const token of row.tokens) {
      if (!token || token.length < 3) continue;
      const ids = tokenMap.get(token) ?? [];
      ids.push(row.character_id);
      tokenMap.set(token, ids);
    }
  }

  return { clean, tokenMap };
}

function inferCharactersFromProse(prose, characterRows) {
  const { clean, tokenMap } = normalizeCharacterRows(characterRows);
  const inferred = new Set();
  const ambiguous_tokens = [];

  for (const row of clean) {
    if (row.tokens.length > 1) {
      const pattern = row.tokens.map(escapeRegex).join("\\s+");
      const regex = new RegExp(`\\b${pattern}\\b`, "i");
      if (regex.test(prose)) {
        inferred.add(row.character_id);
        continue;
      }
    }

    for (const token of row.tokens) {
      if (!token || token.length < 3) continue;
      const tokenRegex = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
      if (!tokenRegex.test(prose)) continue;

      const tokenIds = tokenMap.get(token) ?? [];
      if (tokenIds.length === 1) {
        inferred.add(row.character_id);
      } else if (!ambiguous_tokens.includes(token)) {
        ambiguous_tokens.push(token);
      }
    }
  }

  return {
    inferred_characters: [...inferred],
    ambiguous_tokens,
  };
}

export function runSceneCharacterBatch({ syncDir, args, onProgress }) {
  const {
    project_id,
    dry_run = true,
    replace_mode = "merge",
    include_match_details = false,
    target_scenes = [],
    character_rows = [],
  } = args;

  const targetScenes = Array.isArray(target_scenes) ? target_scenes : [];
  const characterRows = Array.isArray(character_rows) ? character_rows : [];

  const results = [];
  let processed_scenes = 0;
  let scenes_changed = 0;
  let failed_scenes = 0;
  let links_added = 0;
  let links_removed = 0;

  const emitProgress = () => {
    if (typeof onProgress !== "function") return;
    onProgress({
      total_scenes: targetScenes.length,
      processed_scenes,
      scenes_changed,
      failed_scenes,
    });
  };

  emitProgress();

  for (const scene of targetScenes) {
    try {
      const raw = fs.readFileSync(scene.file_path, "utf8");
      const { content: prose } = matter(raw);
      const { meta } = readMeta(scene.file_path, syncDir, { writable: !dry_run });

      const before_characters = [...new Set((meta.characters ?? []).map(String).filter(Boolean))];
      const inference = inferCharactersFromProse(prose, characterRows);
      const inferred_characters = inference.inferred_characters;

      const afterSet = new Set(before_characters);
      if (replace_mode === "replace") {
        afterSet.clear();
      }
      for (const characterId of inferred_characters) {
        afterSet.add(characterId);
      }

      const after_characters = [...afterSet];
      const beforeSet = new Set(before_characters);
      const added = after_characters.filter(id => !beforeSet.has(id));
      const afterSetLookup = new Set(after_characters);
      const removed = before_characters.filter(id => !afterSetLookup.has(id));
      const changed = added.length > 0 || removed.length > 0;

      if (!dry_run && changed) {
        const updatedMeta = normalizeSceneMetaForPath(syncDir, scene.file_path, {
          ...meta,
          characters: after_characters,
        }).meta;

        writeMeta(scene.file_path, updatedMeta);
      }

      scenes_changed += changed ? 1 : 0;
      links_added += added.length;
      links_removed += removed.length;

      const sceneStatus = changed
        ? "changed"
        : (inference.ambiguous_tokens.length > 0 ? "skipped_ambiguous" : "unchanged");

      results.push({
        scene_id: scene.scene_id,
        file_path: scene.file_path,
        before_characters,
        inferred_characters,
        after_characters,
        added,
        removed,
        changed,
        status: sceneStatus,
        ...(include_match_details ? { match_details: { ambiguous_tokens: inference.ambiguous_tokens } } : {}),
      });
    } catch (error) {
      failed_scenes += 1;
      results.push({
        scene_id: scene.scene_id,
        file_path: scene.file_path,
        before_characters: [],
        inferred_characters: [],
        after_characters: [],
        added: [],
        removed: [],
        changed: false,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      processed_scenes += 1;
      emitProgress();
    }
  }

  return {
    ok: true,
    project_id,
    dry_run: Boolean(dry_run),
    total_scenes: targetScenes.length,
    processed_scenes,
    scenes_changed,
    failed_scenes,
    links_added,
    links_removed,
    results,
    ...(failed_scenes > 0 ? { warning: "PARTIAL_SUCCESS: one or more scenes failed to process." } : {}),
  };
}
