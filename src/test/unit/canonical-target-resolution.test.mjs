import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../core/db.js";
import {
  CANONICAL_TARGET_CANDIDATE_LIMITS,
  resolveCharacterTargetForProject,
  resolvePlaceTargetForProject,
  resolveSceneTarget,
} from "../../core/canonical-target-resolution.js";

function seedProject(db, projectId, { universeId = null } = {}) {
  if (universeId) {
    db.prepare(`INSERT OR IGNORE INTO universes (universe_id, name) VALUES (?, ?)`)
      .run(universeId, universeId);
  }
  db.prepare(`INSERT INTO projects (project_id, universe_id, name) VALUES (?, ?, ?)`)
    .run(projectId, universeId, projectId);
}

function seedScene(db, {
  projectId = "test-novel",
  sceneId,
  title = sceneId,
  chapterId = null,
  chapterTitle = null,
  timelinePosition = null,
} = {}) {
  db.prepare(`
    INSERT INTO scenes (
      scene_id, project_id, chapter_id, title, chapter_title, timeline_position,
      file_path, prose_checksum, metadata_stale, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    projectId,
    chapterId,
    title,
    chapterTitle,
    timelinePosition,
    `/tmp/${sceneId}.md`,
    "deadbeef",
    0,
    new Date().toISOString()
  );
}

function seedCharacter(db, {
  characterId,
  projectId = null,
  universeId = null,
  name = characterId,
  role = null,
  firstAppearance = null,
} = {}) {
  db.prepare(`
    INSERT INTO characters (
      character_id, project_id, universe_id, name, role, arc_summary, first_appearance, file_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(characterId, projectId, universeId, name, role, null, firstAppearance, `/tmp/${characterId}.md`);
}

function seedPlace(db, {
  placeId,
  projectId = null,
  universeId = null,
  name = placeId,
} = {}) {
  db.prepare(`
    INSERT INTO places (place_id, project_id, universe_id, name, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(placeId, projectId, universeId, name, `/tmp/${placeId}.md`);
}

describe("canonical target resolution", () => {
  test("resolves exact stable scene IDs without resolved_from details", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-arrival",
        title: "Arrival",
        chapterId: "ch-01-arrival",
        chapterTitle: "Arrival Chapter",
        timelinePosition: 10,
      });

      const result = resolveSceneTarget(db, {
        projectId: "test-novel",
        input: "sc-arrival",
      });

      assert.equal(result.ok, true);
      assert.equal(result.scene_id, "sc-arrival");
      assert.equal(result.canonical, true);
      assert.equal(result.resolved_from, undefined);
      assert.equal(result.match.match_type, "exact_id");
    } finally {
      db.close();
    }
  });

  test("resolves unique case-insensitive scene IDs and titles with canonical details", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { projectId: "test-novel", sceneId: "sc-harbor", title: "Harbor Argument" });

      const idResult = resolveSceneTarget(db, {
        projectId: "test-novel",
        input: "SC-HARBOR",
      });
      const titleResult = resolveSceneTarget(db, {
        projectId: "test-novel",
        input: "harbor argument",
      });

      assert.equal(idResult.ok, true);
      assert.equal(idResult.scene_id, "sc-harbor");
      assert.deepEqual(idResult.resolved_from.scene_id, {
        input: "SC-HARBOR",
        matched_field: "scene_id",
        match_type: "case_insensitive_id",
        id: "sc-harbor",
      });
      assert.equal(titleResult.ok, true);
      assert.equal(titleResult.scene_id, "sc-harbor");
      assert.deepEqual(titleResult.resolved_from.scene_id, {
        input: "harbor argument",
        matched_field: "title",
        match_type: "case_insensitive_title",
        id: "sc-harbor",
      });
    } finally {
      db.close();
    }
  });

  test("refuses ambiguous scene titles with deterministic candidate matches", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-b",
        title: "Harbor Argument",
        chapterId: "ch-02",
        chapterTitle: "Second",
        timelinePosition: 2,
      });
      seedScene(db, {
        projectId: "test-novel",
        sceneId: "sc-a",
        title: "harbor argument",
        chapterId: "ch-01",
        chapterTitle: "First",
        timelinePosition: 1,
      });

      const result = resolveSceneTarget(db, {
        projectId: "test-novel",
        input: "HARBOR ARGUMENT",
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "AMBIGUOUS_TARGET");
      assert.equal(result.error.details.lookup_kind, "scene");
      assert.deepEqual(
        result.error.details.candidate_matches.map(candidate => ({
          id: candidate.id,
          matched_field: candidate.matched_field,
          match_type: candidate.match_type,
          context: candidate.context,
        })),
        [
          {
            id: "sc-a",
            matched_field: "title",
            match_type: "case_insensitive_title",
            context: {
              project_id: "test-novel",
              title: "harbor argument",
              chapter_id: "ch-01",
              chapter_title: "First",
              timeline_position: 1,
            },
          },
          {
            id: "sc-b",
            matched_field: "title",
            match_type: "case_insensitive_title",
            context: {
              project_id: "test-novel",
              title: "Harbor Argument",
              chapter_id: "ch-02",
              chapter_title: "Second",
              timeline_position: 2,
            },
          },
        ]
      );
      assert.match(result.error.details.next_step, /find_scenes/);
    } finally {
      db.close();
    }
  });

  test("rejects empty and whitespace-only targets before display-field matching", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedScene(db, { projectId: "test-novel", sceneId: "sc-empty-title", title: null });
      seedCharacter(db, { characterId: "char-empty-name", projectId: "test-novel", name: "" });
      seedPlace(db, { placeId: "place-empty-name", projectId: "test-novel", name: "" });

      const sceneResult = resolveSceneTarget(db, {
        projectId: "test-novel",
        input: "   ",
      });
      const characterResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "\t",
      });
      const placeResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "",
      });

      for (const [kind, result] of [
        ["scene", sceneResult],
        ["character", characterResult],
        ["place", placeResult],
      ]) {
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "NOT_FOUND");
        assert.equal(result.error.details.lookup_kind, kind);
        assert.deepEqual(result.error.details.candidate_matches, []);
        assert.match(result.error.details.next_step, kind === "scene" ? /find_scenes/ : kind === "character" ? /list_characters/ : /list_places/);
      }
    } finally {
      db.close();
    }
  });

  test("resolves relationship-scoped characters by project, universe, and global records only", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel", { universeId: "shared-universe" });
      seedProject(db, "other-novel", { universeId: "other-universe" });
      seedCharacter(db, {
        characterId: "char-project-elena",
        projectId: "test-novel",
        name: "Project Elena",
        role: "lead",
      });
      seedCharacter(db, {
        characterId: "char-shared-elena",
        universeId: "shared-universe",
        name: "Shared Elena",
      });
      seedCharacter(db, {
        characterId: "char-global-elena",
        name: "Global Elena",
      });
      seedCharacter(db, {
        characterId: "char-other-elena",
        projectId: "other-novel",
        universeId: "other-universe",
        name: "Other Elena",
      });

      const projectResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "project elena",
      });
      const universeResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "CHAR-SHARED-ELENA",
      });
      const globalResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "Global Elena",
      });
      const otherResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "Other Elena",
      });

      assert.equal(projectResult.ok, true);
      assert.equal(projectResult.character_id, "char-project-elena");
      assert.equal(projectResult.character.project_id, "test-novel");
      assert.equal(projectResult.match.match_type, "case_insensitive_name");
      assert.equal(universeResult.ok, true);
      assert.equal(universeResult.character_id, "char-shared-elena");
      assert.equal(universeResult.character.universe_id, "shared-universe");
      assert.equal(universeResult.match.match_type, "case_insensitive_id");
      assert.equal(globalResult.ok, true);
      assert.equal(globalResult.character_id, "char-global-elena");
      assert.equal(globalResult.character.project_id, null);
      assert.equal(globalResult.character.universe_id, null);
      assert.equal(otherResult.ok, false);
      assert.equal(otherResult.error.code, "NOT_FOUND");
      assert.deepEqual(otherResult.error.details.candidate_matches, []);
    } finally {
      db.close();
    }
  });

  test("resolves exact stable character and place IDs without broadening caller input", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      seedCharacter(db, { characterId: "char-mira", projectId: "test-novel", name: "Mira Nystrom" });
      seedPlace(db, { placeId: "place-harbor", projectId: "test-novel", name: "Harbor District" });

      const characterResult = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "char-mira",
      });
      const placeResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "place-harbor",
      });

      assert.equal(characterResult.ok, true);
      assert.equal(characterResult.character_id, "char-mira");
      assert.equal(characterResult.canonical, true);
      assert.equal(characterResult.resolved_from, undefined);
      assert.equal(characterResult.match.match_type, "exact_id");
      assert.equal(placeResult.ok, true);
      assert.equal(placeResult.place_id, "place-harbor");
      assert.equal(placeResult.canonical, true);
      assert.equal(placeResult.resolved_from, undefined);
      assert.equal(placeResult.match.match_type, "exact_id");
    } finally {
      db.close();
    }
  });

  test("refuses ambiguous character names before mutation-oriented callers can guess", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel", { universeId: "shared-universe" });
      seedCharacter(db, { characterId: "char-project-mira", projectId: "test-novel", name: "Mira" });
      seedCharacter(db, { characterId: "char-shared-mira", universeId: "shared-universe", name: "mira" });

      const result = resolveCharacterTargetForProject(db, {
        projectId: "test-novel",
        input: "MIRA",
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "AMBIGUOUS_TARGET");
      assert.deepEqual(
        result.error.details.candidate_matches.map(candidate => [candidate.id, candidate.match_type]),
        [
          ["char-project-mira", "case_insensitive_name"],
          ["char-shared-mira", "case_insensitive_name"],
        ]
      );
      assert.match(result.error.details.next_step, /list_characters/);
    } finally {
      db.close();
    }
  });

  test("returns suggestion-only NOT_FOUND candidates with default and hard candidate caps", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel");
      for (let index = 1; index <= 12; index += 1) {
        seedPlace(db, {
          placeId: `place-harbor-${String(index).padStart(2, "0")}`,
          projectId: "test-novel",
          name: `Harbor Gate ${String(index).padStart(2, "0")}`,
        });
      }

      const defaultResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "Harbor",
      });
      const hardCapResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "Harbor",
        candidateLimit: 99,
      });

      assert.equal(defaultResult.ok, false);
      assert.equal(defaultResult.error.code, "NOT_FOUND");
      assert.equal(defaultResult.error.details.candidate_matches.length, CANONICAL_TARGET_CANDIDATE_LIMITS.default);
      assert.ok(defaultResult.error.details.candidate_matches.every(
        candidate => candidate.match_type === "near_match_suggestion"
      ));
      assert.deepEqual(
        defaultResult.error.details.candidate_matches.map(candidate => candidate.id),
        [
          "place-harbor-01",
          "place-harbor-02",
          "place-harbor-03",
          "place-harbor-04",
          "place-harbor-05",
        ]
      );
      assert.equal(hardCapResult.error.details.candidate_matches.length, CANONICAL_TARGET_CANDIDATE_LIMITS.hard);
      assert.match(hardCapResult.error.details.next_step, /list_places/);
    } finally {
      db.close();
    }
  });

  test("resolves places with the same relationship-tool scoping rule as characters", () => {
    const db = openDb(":memory:");
    try {
      seedProject(db, "test-novel", { universeId: "shared-universe" });
      seedProject(db, "other-novel", { universeId: "other-universe" });
      seedPlace(db, { placeId: "place-project-harbor", projectId: "test-novel", name: "Project Harbor" });
      seedPlace(db, { placeId: "place-shared-harbor", universeId: "shared-universe", name: "Shared Harbor" });
      seedPlace(db, { placeId: "place-global-harbor", name: "Global Harbor" });
      seedPlace(db, { placeId: "place-other-harbor", projectId: "other-novel", name: "Other Harbor" });

      const projectResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "PROJECT HARBOR",
      });
      const universeResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "Shared Harbor",
      });
      const globalResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "PLACE-GLOBAL-HARBOR",
      });
      const otherResult = resolvePlaceTargetForProject(db, {
        projectId: "test-novel",
        input: "Other Harbor",
      });

      assert.equal(projectResult.ok, true);
      assert.equal(projectResult.place_id, "place-project-harbor");
      assert.equal(universeResult.ok, true);
      assert.equal(universeResult.place_id, "place-shared-harbor");
      assert.equal(globalResult.ok, true);
      assert.equal(globalResult.place_id, "place-global-harbor");
      assert.equal(globalResult.match.match_type, "case_insensitive_id");
      assert.equal(otherResult.ok, false);
      assert.equal(otherResult.error.code, "NOT_FOUND");
      assert.deepEqual(otherResult.error.details.candidate_matches, []);
    } finally {
      db.close();
    }
  });
});
