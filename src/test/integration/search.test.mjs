import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3075, 3074);
let writeSyncDir, readSyncDir;

describe("search tools integration suite", { concurrency: 1 }, () => {
  before(async () => {
    await ctx.setup();
    writeSyncDir = ctx.writeSyncDir;
    readSyncDir = ctx.readSyncDir;
  });

  after(async () => {
    await ctx.teardown();
  });

  const callTool = (n, a) => ctx.callTool(n, a);
  const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
  const waitForAsyncJob = (id, t) => ctx.waitForAsyncJob(id, t);

  describe("find_scenes tool", () => {
  test("returns all 3 scenes with no filters", async () => {
    const text = await callTool("find_scenes");
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count, 3);
  });

  test("filters by character: elena appears in all 3 scenes", async () => {
    const text = await callTool("find_scenes", { character: "elena" });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count, 3);
  });

  test("resolves project-scoped character and POV filters from human-shaped input", async () => {
    await callWriteTool("update_scene_metadata", {
      scene_id: "sc-001",
      project_id: "test-novel",
      fields: { pov: "elena" },
    });

    const characterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "Elena Voss",
      page_size: 200,
    });
    const characterParsed = JSON.parse(characterText);
    assert.equal(characterParsed.total_count >= 3, true);
    assert.deepEqual(characterParsed.resolved_filters.character, {
      input: "Elena Voss",
      matched_field: "name",
      match_type: "case_insensitive_name",
      id: "elena",
    });

    const povText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      pov: "ELENA VOSS",
    });
    const povParsed = JSON.parse(povText);
    assert.equal(povParsed.total_count >= 1, true);
    assert.ok(povParsed.results.every(row => row.pov === "elena"));
    assert.ok(povParsed.results.some(row => row.scene_id === "sc-001"));
    assert.deepEqual(povParsed.resolved_filters.pov, {
      input: "ELENA VOSS",
      matched_field: "name",
      match_type: "case_insensitive_name",
      id: "elena",
    });
  });

  test("preserves project-scoped indexed character and POV ID filters without sheet rows", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-m5-orphan-indexed-character.md"),
      [
        "---",
        "scene_id: sc-m5-orphan-indexed-character",
        "title: M5 Orphan Indexed Character",
        "characters:",
        "  - m5-orphan-character",
        "pov: m5-orphan-pov",
        "---",
        "Orphan indexed ID prose.",
      ].join("\n"),
      "utf8"
    );
    await callWriteTool("sync");

    const characterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "M5-ORPHAN-CHARACTER",
    });
    const characterParsed = JSON.parse(characterText);
    assert.equal(characterParsed.total_count, 1);
    assert.equal(characterParsed.results[0].scene_id, "sc-m5-orphan-indexed-character");
    assert.deepEqual(characterParsed.resolved_filters.character, {
      input: "M5-ORPHAN-CHARACTER",
      matched_field: "character_id",
      match_type: "case_insensitive_id",
      id: "m5-orphan-character",
    });

    const povText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      pov: "M5-ORPHAN-POV",
    });
    const povParsed = JSON.parse(povText);
    assert.equal(povParsed.total_count, 1);
    assert.equal(povParsed.results[0].scene_id, "sc-m5-orphan-indexed-character");
    assert.deepEqual(povParsed.resolved_filters.pov, {
      input: "M5-ORPHAN-POV",
      matched_field: "character_id",
      match_type: "case_insensitive_id",
      id: "m5-orphan-pov",
    });

    fs.writeFileSync(
      path.join(sceneDir, "sc-m5-orphan-indexed-character-variant.md"),
      [
        "---",
        "scene_id: sc-m5-orphan-indexed-character-variant",
        "title: M5 Orphan Indexed Character Variant",
        "characters:",
        "  - M5-ORPHAN-CHARACTER",
        "pov: M5-ORPHAN-POV",
        "---",
        "Orphan indexed ID case variant prose.",
      ].join("\n"),
      "utf8"
    );
    await callWriteTool("sync");

    const variantCharacterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "m5-orphan-character",
      page_size: 200,
    });
    const variantCharacterParsed = JSON.parse(variantCharacterText);
    assert.equal(variantCharacterParsed.total_count, 2);
    assert.ok(variantCharacterParsed.results.some(row => row.scene_id === "sc-m5-orphan-indexed-character"));
    assert.ok(variantCharacterParsed.results.some(row => row.scene_id === "sc-m5-orphan-indexed-character-variant"));
    assert.equal(variantCharacterParsed.resolved_filters?.character, undefined);

    const variantPovText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      pov: "m5-orphan-pov",
      page_size: 200,
    });
    const variantPovParsed = JSON.parse(variantPovText);
    assert.equal(variantPovParsed.total_count, 2);
    assert.ok(variantPovParsed.results.some(row => row.scene_id === "sc-m5-orphan-indexed-character"));
    assert.ok(variantPovParsed.results.some(row => row.scene_id === "sc-m5-orphan-indexed-character-variant"));
    assert.equal(variantPovParsed.resolved_filters?.pov, undefined);
  });

  test("returns direct character and POV resolution failure envelopes for ambiguous and missing names", async () => {
    const characterDir = path.join(writeSyncDir, "projects", "test-novel", "world", "characters");
    fs.mkdirSync(characterDir, { recursive: true });
    for (const id of ["m5-ambiguous-a", "m5-ambiguous-b"]) {
      fs.writeFileSync(
        path.join(characterDir, `${id}.md`),
        [
          "---",
          `character_id: ${id}`,
          "name: M5 Ambiguous Alias",
          "---",
          "Ambiguous character prose.",
        ].join("\n"),
        "utf8"
      );
    }
    await callWriteTool("sync");

    const ambiguousCharacterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "M5 Ambiguous Alias",
    });
    const ambiguousCharacter = JSON.parse(ambiguousCharacterText);
    assert.equal(ambiguousCharacter.ok, false);
    assert.equal(ambiguousCharacter.error.code, "AMBIGUOUS_TARGET");
    assert.equal(ambiguousCharacter.error.details.argument, "character");
    assert.equal(ambiguousCharacter.error.details.project_id, "test-novel");
    assert.equal(ambiguousCharacter.error.details.candidate_matches.length, 2);

    const ambiguousPovText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      pov: "M5 Ambiguous Alias",
    });
    const ambiguousPov = JSON.parse(ambiguousPovText);
    assert.equal(ambiguousPov.ok, false);
    assert.equal(ambiguousPov.error.code, "AMBIGUOUS_TARGET");
    assert.equal(ambiguousPov.error.details.argument, "pov");
    assert.equal(ambiguousPov.error.details.project_id, "test-novel");
    assert.equal(ambiguousPov.error.details.candidate_matches.length, 2);

    const missingCharacterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "M5 Missing Character",
    });
    const missingCharacter = JSON.parse(missingCharacterText);
    assert.equal(missingCharacter.ok, false);
    assert.equal(missingCharacter.error.code, "NOT_FOUND");
    assert.equal(missingCharacter.error.details.argument, "character");
    assert.equal(missingCharacter.error.details.project_id, "test-novel");
    assert.match(missingCharacter.error.details.next_step, /list_characters/);

    const missingPovText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      pov: "M5 Missing POV",
    });
    const missingPov = JSON.parse(missingPovText);
    assert.equal(missingPov.ok, false);
    assert.equal(missingPov.error.code, "NOT_FOUND");
    assert.equal(missingPov.error.details.argument, "pov");
    assert.equal(missingPov.error.details.project_id, "test-novel");
    assert.match(missingPov.error.details.next_step, /list_characters/);
  });

  test("filters by character: marcus appears in 2 scenes", async () => {
    const text = await callTool("find_scenes", { character: "marcus" });
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 2);
  });

  test("filters by beat: Catalyst returns only sc-003", async () => {
    const text = await callTool("find_scenes", { beat: "Catalyst" });
    assert.ok(text.includes("sc-003"));
    assert.ok(!text.includes("sc-001"));
    assert.ok(!text.includes("sc-002"));
  });

  test("matches tag, beat, and chapter_id filters case-insensitively", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chapters = JSON.parse(chaptersText);
    const firstChapterId = chapters.results.find(row => row.sort_index === 1).chapter_id;

    const tagText = await callTool("find_scenes", { tag: "Harbor" });
    const tagParsed = JSON.parse(tagText);
    assert.equal(tagParsed.total_count >= 2, true);
    assert.deepEqual(tagParsed.resolved_filters.tag, {
      input: "Harbor",
      matched_field: "tag",
      match_type: "case_insensitive_value",
      value: "harbor",
    });

    const beatText = await callTool("find_scenes", { beat: "catalyst" });
    const beatParsed = JSON.parse(beatText);
    assert.equal(beatParsed.total_count, 1);
    assert.equal(beatParsed.results[0].scene_id, "sc-003");
    assert.deepEqual(beatParsed.resolved_filters.beat, {
      input: "catalyst",
      matched_field: "save_the_cat_beat",
      match_type: "case_insensitive_value",
      value: "Catalyst",
    });

    const chapterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: firstChapterId.toUpperCase(),
    });
    const chapterParsed = JSON.parse(chapterText);
    assert.equal(chapterParsed.total_count >= 2, true);
    assert.deepEqual(chapterParsed.resolved_filters.chapter_id, {
      input: firstChapterId.toUpperCase(),
      matched_field: "chapter_id",
      match_type: "case_insensitive_id",
      id: firstChapterId,
    });
  });

  test("does not report one resolved tag when multiple authored case variants exist", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-m5-tag-case-variant.md"),
      [
        "---",
        "scene_id: sc-m5-tag-case-variant",
        "title: M5 Tag Case Variant",
        "tags:",
        "  - Harbor",
        "---",
        "Tag case variant prose.",
      ].join("\n"),
      "utf8"
    );
    await callWriteTool("sync");

    const tagText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      tag: "HARBOR",
      page_size: 200,
    });
    const tagParsed = JSON.parse(tagText);
    assert.ok(tagParsed.results.some(row => row.scene_id === "sc-001"));
    assert.ok(tagParsed.results.some(row => row.scene_id === "sc-m5-tag-case-variant"));
    assert.equal(tagParsed.resolved_filters?.tag, undefined);
  });

  test("returns vocabulary suggestions without reading prose when structured filters miss", async () => {
    const text = await callTool("find_scenes", {
      project_id: "test-novel",
      tag: "harbur",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NO_RESULTS");
    assert.equal(parsed.error.details.lookup_kind, "scene_metadata_filters");
    assert.ok(parsed.error.details.candidate_matches.some(candidate => (
      candidate.target_kind === "tag" &&
      candidate.value === "harbor" &&
      candidate.match_type === "near_match_suggestion"
    )));
    assert.match(parsed.error.details.next_step, /Broaden filters/);
    assert.doesNotMatch(parsed.error.details.next_step, /prose/i);
  });

  test("filters by chapter 1 returns 2 scenes", async () => {
    const text = await callTool("find_scenes", { chapter: 1 });
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 2);
  });

  test("filters by tag harbor returns sc-001 and sc-002", async () => {
    const text = await callTool("find_scenes", { tag: "harbor" });
    assert.ok(text.includes("sc-001"));
    assert.ok(text.includes("sc-002"));
    assert.ok(!text.includes("sc-003"));
  });

  test("supports pagination with total_count", async () => {
    const text = await callTool("find_scenes", { page_size: 2, page: 1 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 3);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.page_size, 2);
    assert.equal(parsed.total_pages, 2);
    assert.equal(parsed.has_next_page, true);
    assert.equal(parsed.results.length, 2);
  });

  test("auto-paginates when result exceeds default page size", async () => {
    const text = await callTool("find_scenes", { character: "elena" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 3);
    assert.equal(parsed.page_size, 2);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.total_pages, 2);
    assert.equal(parsed.results.length, 2);
  });

  test("normalizes out-of-range page to last page", async () => {
    const text = await callTool("find_scenes", { page_size: 2, page: 999 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.page, parsed.total_pages);
    assert.equal(parsed.page, 2);
    assert.equal(parsed.results.length, 1);
  });

  test("suggests local parity recovery when stale scenes are present", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nParity hint marker for find_scenes.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("find_scenes", { character: "elena", page_size: 2, page: 1 });
    const parsed = JSON.parse(text);
    assert.equal(typeof parsed.warning, "string");
    assert.ok(parsed.warning.toLowerCase().includes("stale metadata"));
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("enrich_scene"));

    await callWriteTool("enrich_scene", { scene_id: "sc-001", project_id: "test-novel" });
  });

  test("includes next_step for stale unpaginated responses", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nParity hint marker for unpaginated find_scenes.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("find_scenes", { beat: "Catalyst" });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed), false);
    assert.equal(parsed.total_count, 1);
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("enrich_scene"));

    await callWriteTool("enrich_scene", { scene_id: "sc-003", project_id: "test-novel" });
  });

  test("finds one-sided scene relationship indexes from evidence workflows", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-search-character-only.md"),
      "---\nscene_id: sc-search-character-only\ntitle: Search Character Only\n---\nElena appears here without a place link.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sceneDir, "sc-search-place-only.md"),
      "---\nscene_id: sc-search-place-only\ntitle: Search Place Only\n---\nThe harbor district matters here without a character link.",
      "utf8"
    );

    await callWriteTool("sync");
    await callWriteTool("connect_scene_character_evidence", {
      project_id: "test-novel",
      scene_id: "sc-search-character-only",
      character_id: "elena",
    });
    await callWriteTool("connect_scene_place_evidence", {
      project_id: "test-novel",
      scene_id: "sc-search-place-only",
      place_id: "harbor-district",
    });

    const characterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      character: "elena",
      page_size: 200,
    });
    const characterParsed = JSON.parse(characterText);
    assert.ok(characterParsed.results.some((row) => row.scene_id === "sc-search-character-only"));

    const placeText = await callWriteTool("search_metadata", {
      query: '"harbor-district"',
      page_size: 200,
    });
    const placeParsed = JSON.parse(placeText);
    assert.ok(placeParsed.results.some((row) => row.scene_id === "sc-search-place-only"));
  });
});

describe("get_scene_prose tool", () => {
  test("returns prose content for sc-001", async () => {
    const text = await callTool("get_scene_prose", { scene_id: "sc-001" });
    assert.ok(text.includes("gangway") || text.includes("Marcus"),
      `Expected prose keywords, got: ${text.slice(0, 200)}`);
  });

  test("returns prose content for sc-003", async () => {
    const text = await callTool("get_scene_prose", { scene_id: "sc-003" });
    assert.ok(text.includes("father") || text.includes("envelope"),
      `Expected prose keywords, got: ${text.slice(0, 200)}`);
  });

  test("returns not-found message for unknown scene", async () => {
    const text = await callTool("get_scene_prose", { scene_id: "sc-999" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.ok(parsed.error.details.next_step.includes("Run sync()"));
  });

  test("includes parity recovery suggestion when scene metadata is stale", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nParity hint marker for get_scene_prose.\n`, "utf8");
    await callWriteTool("sync");

    const result = await ctx.writeClient.callTool({ name: "get_scene_prose", arguments: { scene_id: "sc-002" } });
    const text = result.content?.[0]?.text ?? "";
    assert.ok(!text.includes("Metadata for this scene may be stale"));
    assert.ok(!text.includes("Suggested next step"));
    assert.equal(result.structuredContent.warning.includes("stale"), true);
    assert.ok(result.structuredContent.next_step.includes("enrich_scene"));
    assert.ok(result.structuredContent.next_step.includes("project_id test-novel"));

    await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
  });

  test("returns CONFLICT for ambiguous scene_id without project_id", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-prose", "scenes", "dup-scene.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-prose", "scenes", "dup-scene.md");
    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.writeFileSync(alphaScenePath, "---\nscene_id: sc-prose-shared-001\ntitle: Alpha Prose\n---\nAlpha prose body.");
    fs.writeFileSync(betaScenePath, "---\nscene_id: sc-prose-shared-001\ntitle: Beta Prose\n---\nBeta prose body.");

    await callWriteTool("sync");

    const text = await callWriteTool("get_scene_prose", { scene_id: "sc-prose-shared-001" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
    assert.ok(Array.isArray(parsed.error.details.project_ids));
    assert.ok(parsed.error.details.project_ids.includes("alpha-prose"));
    assert.ok(parsed.error.details.project_ids.includes("beta-prose"));
  });

  test("returns disambiguated prose when project_id is provided", async () => {
    const text = await callWriteTool("get_scene_prose", {
      scene_id: "sc-prose-shared-001",
      project_id: "beta-prose",
    });
    assert.ok(text.includes("Beta prose body."));
    assert.ok(!text.includes("Alpha prose body."));
  });

  test("does not leak character-filtered results across projects when scene_id is reused", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-find", "scenes", "shared.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-find", "scenes", "shared.md");
    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.writeFileSync(alphaScenePath, "---\nscene_id: sc-find-shared-001\ntitle: Alpha Shared\ncharacters:\n  - alpha-hero\ntags:\n  - alpha-tag\n---\nAlpha prose body.");
    fs.writeFileSync(betaScenePath, "---\nscene_id: sc-find-shared-001\ntitle: Beta Shared\ncharacters:\n  - beta-hero\ntags:\n  - beta-tag\n---\nBeta prose body.");

    await callWriteTool("sync");

    const findText = await callWriteTool("find_scenes", { character: "alpha-hero" });
    const findParsed = JSON.parse(findText);
    assert.equal(findParsed.total_count, 1);
    assert.equal(findParsed.results[0].project_id, "alpha-find");
    assert.equal(findParsed.results[0].scene_id, "sc-find-shared-001");

    const arcText = await callWriteTool("get_arc", { character_id: "beta-hero" });
    const arcParsed = JSON.parse(arcText);
    assert.equal(arcParsed.total_count, 1);
    assert.equal(arcParsed.results[0].project_id, "beta-find");
    assert.equal(arcParsed.results[0].scene_id, "sc-find-shared-001");
  });
});

describe("get_chapter_prose tool", () => {
  test("returns prose for both scenes in chapter 1 compatibility mode", async () => {
    const result = await ctx.client.callTool({
      name: "get_chapter_prose",
      arguments: {
        project_id: "test-novel",
        chapter: 1,
      },
    });
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("gangway") || text.includes("bait shed"),
      `Expected chapter prose keywords, got: ${text.slice(0, 200)}`);
    assert.ok(!text.includes("Suggested next step"));
    assert.ok(result.structuredContent.next_step.includes("find_scenes + get_scene_prose"));
  });
});

describe("canonical chapter and epigraph tools", () => {
  test("lists canonical chapters and supports chapter_id scene filtering", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    assert.equal(chaptersParsed.total_count >= 2, true);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const scenesText = await callTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
    });
    const scenesParsed = JSON.parse(scenesText);
    assert.equal(scenesParsed.total_count, 2);
    assert.ok(scenesParsed.results.every((row) => row.chapter_id === firstChapter.chapter_id));
  });

  test("requires project_id when filtering scenes by chapter_id", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const scenesText = await callWriteTool("find_scenes", {
      chapter_id: firstChapter.chapter_id,
    });
    const scenesParsed = JSON.parse(scenesText);
    assert.equal(scenesParsed.ok, false);
    assert.equal(scenesParsed.error.code, "VALIDATION_ERROR");
  });

  test("rejects conflicting mixed chapter filters across chapter-aware tools", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const findScenesText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
      chapter: 2,
    });
    const findScenesParsed = JSON.parse(findScenesText);
    assert.equal(findScenesParsed.ok, false);
    assert.equal(findScenesParsed.error.code, "VALIDATION_ERROR");

    const chapterProseText = await callWriteTool("get_chapter_prose", {
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
      chapter: 2,
    });
    const chapterProseParsed = JSON.parse(chapterProseText);
    assert.equal(chapterProseParsed.ok, false);
    assert.equal(chapterProseParsed.error.code, "VALIDATION_ERROR");

    const epigraphsText = await callWriteTool("find_epigraphs", {
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
      chapter: 2,
    });
    const epigraphsParsed = JSON.parse(epigraphsText);
    assert.equal(epigraphsParsed.ok, false);
    assert.equal(epigraphsParsed.error.code, "VALIDATION_ERROR");
  });

  test("requires chapter_id or chapter for get_chapter_prose", async () => {
    const chapterProseText = await callWriteTool("get_chapter_prose", {
      project_id: "test-novel",
    });
    const chapterProseParsed = JSON.parse(chapterProseText);
    assert.equal(chapterProseParsed.ok, false);
    assert.equal(chapterProseParsed.error.code, "VALIDATION_ERROR");
  });

  test("indexes explicit epigraph files and returns them through find_epigraphs", async () => {
    const projectId = "epigraph-search";
    const chapterDir = path.join(writeSyncDir, "projects", projectId, "Draft", "03-A New Dawn");
    fs.mkdirSync(chapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(chapterDir, "sc-004.md"),
      "---\nscene_id: sc-004\ntitle: Dawn Scene\nchapter_title: A New Dawn\ncharacters:\n  - elena\n---\nMorning prose."
    );
    fs.writeFileSync(
      path.join(chapterDir, "epigraph.md"),
      "---\nepigraph_id: epi-dawn\ntags:\n  - omen\n---\nThis is the hour before the hinge turns."
    );

    await callWriteTool("sync");

    const chaptersText = await callWriteTool("list_chapters", { project_id: projectId });
    const chaptersParsed = JSON.parse(chaptersText);
    const dawnChapter = chaptersParsed.results.find((row) => row.title === "A New Dawn");
    assert.ok(dawnChapter);

    const epigraphsText = await callWriteTool("find_epigraphs", {
      project_id: projectId,
      chapter_id: dawnChapter.chapter_id,
    });
    const epigraphsParsed = JSON.parse(epigraphsText);
    assert.equal(epigraphsParsed.total_count, 1);
    assert.equal(epigraphsParsed.results[0].epigraph_id, "epi-dawn");
    assert.match(epigraphsParsed.results[0].body, /hinge turns/);

    const compatibleEpigraphsText = await callWriteTool("find_epigraphs", {
      project_id: projectId,
      chapter_id: dawnChapter.chapter_id,
      chapter: 3,
    });
    const compatibleEpigraphsParsed = JSON.parse(compatibleEpigraphsText);
    assert.equal(compatibleEpigraphsParsed.total_count, 1);
    assert.equal(compatibleEpigraphsParsed.results[0].epigraph_id, "epi-dawn");
  });
});

describe("get_arc tool", () => {
  test("elena arc returns 3 scenes", async () => {
    const text = await callTool("get_arc", { character_id: "elena" });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count, 3);
  });

  test("elena arc first scene is sc-001", async () => {
    const text = await callTool("get_arc", { character_id: "elena" });
    const ids = [...text.matchAll(/"scene_id": "([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids[0], "sc-001");
  });

  test("marcus arc returns 2 scenes", async () => {
    const text = await callTool("get_arc", { character_id: "marcus" });
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 2);
  });

  test("supports pagination with total_count", async () => {
    const text = await callTool("get_arc", { character_id: "elena", page_size: 2, page: 2 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 3);
    assert.equal(parsed.page, 2);
    assert.equal(parsed.page_size, 2);
    assert.equal(parsed.total_pages, 2);
    assert.equal(parsed.has_prev_page, true);
    assert.equal(parsed.results.length, 1);
  });

  test("auto-paginates when result exceeds default page size", async () => {
    const text = await callTool("get_arc", { character_id: "elena" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 3);
    assert.equal(parsed.page_size, 2);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.results.length, 2);
  });

  test("includes next_step for stale unpaginated arc responses", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nParity hint marker for unpaginated get_arc.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("get_arc", { character_id: "marcus" });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed), false);
    assert.equal(parsed.total_count, 2);
    assert.equal(typeof parsed.warning, "string");
    assert.ok(parsed.warning.toLowerCase().includes("stale metadata"));
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("enrich_scene"));

    await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
  });
});

describe("list_characters tool", () => {
  test("lists elena and marcus", async () => {
    const text = await callTool("list_characters");
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count >= 2, true);
    const ids = parsed.results.map((row) => row.character_id);
    assert.ok(ids.includes("elena"));
    assert.ok(ids.includes("marcus"));
  });
});

describe("get_character_sheet tool", () => {
  test("elena sheet includes traits", async () => {
    const text = await callTool("get_character_sheet", { character_id: "elena" });
    const parsed = JSON.parse(text);
    const row = parsed.results[0];
    assert.ok((text.includes("driven") || text.includes("walls")),
      `Expected trait keywords for elena, got: ${text.slice(0, 200)}`);
    assert.equal(parsed.total_count, 1);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("get_arc"));
    assert.equal(Array.isArray(row.traits), true);
  });

  test("marcus sheet includes arc_summary", async () => {
    const text = await callTool("get_character_sheet", { character_id: "marcus" });
    assert.ok(text.includes("loyalty") || text.includes("patient"),
      `Expected arc keywords for marcus, got: ${text.slice(0, 200)}`);
  });

  test("returns adjacent support notes for nested character folders", async () => {
    const charDir = path.join(writeSyncDir, "projects", "test-novel", "world", "characters", "alba-hartmann");
    fs.mkdirSync(charDir, { recursive: true });
    fs.writeFileSync(
      path.join(charDir, "sheet.md"),
      "---\ncharacter_id: alba\nname: Alba Hartmann\nrole: scientist\n---\nCanonical sheet content."
    );
    fs.writeFileSync(path.join(charDir, "arc.md"), "Alba support arc notes.");
    await callWriteTool("sync");

    const text = await callWriteTool("get_character_sheet", { character_id: "alba" });
    const parsed = JSON.parse(text);
    const row = parsed.results[0];

    assert.equal(parsed.total_count, 1);
    assert.equal(row.notes, "Canonical sheet content.");
    assert.equal(row.supporting_notes.length, 1);
    assert.equal(row.supporting_notes[0].file_name, "arc.md");
    assert.equal(row.supporting_notes[0].content, "Alba support arc notes.");
  });

  test("returns next_step guidance on unknown character", async () => {
    const text = await callTool("get_character_sheet", { character_id: "char-does-not-exist" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.equal(typeof parsed.error.details?.next_step, "string");
    assert.ok(parsed.error.details.next_step.includes("list_characters"));
  });
});

describe("list_places tool", () => {
  test("lists harbor-district", async () => {
    const text = await callTool("list_places");
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count >= 1, true);
    const ids = parsed.results.map((row) => row.place_id);
    assert.ok(ids.includes("harbor-district"));
  });
});

describe("get_place_sheet tool", () => {
  test("harbor-district sheet includes associated_characters and tags", async () => {
    const text = await callTool("get_place_sheet", { place_id: "harbor-district" });
    const parsed = JSON.parse(text);
    const row = parsed.results[0];

    assert.equal(parsed.total_count, 1);
    assert.ok(row.associated_characters.includes("elena"));
    assert.ok(row.tags.includes("urban"));
    assert.ok(row.notes.includes("brine and diesel"));
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("find_scenes"));
  });

  test("returns adjacent support notes for nested place folders", async () => {
    const placeDir = path.join(writeSyncDir, "projects", "test-novel", "world", "places", "aevi-labs");
    fs.mkdirSync(placeDir, { recursive: true });
    fs.writeFileSync(
      path.join(placeDir, "sheet.md"),
      "---\nplace_id: aevi-labs\nname: Aevi Labs\nassociated_characters:\n  - alba\ntags:\n  - lab\n---\nCanonical place sheet content."
    );
    fs.writeFileSync(path.join(placeDir, "history.md"), "Aevi Labs support history notes.");
    await callWriteTool("sync");

    const text = await callWriteTool("get_place_sheet", { place_id: "aevi-labs" });
    const parsed = JSON.parse(text);
    const row = parsed.results[0];

    assert.equal(parsed.total_count, 1);
    assert.equal(row.notes, "Canonical place sheet content.");
    assert.equal(row.associated_characters[0], "alba");
    assert.equal(row.tags[0], "lab");
    assert.equal(row.supporting_notes.length, 1);
    assert.equal(row.supporting_notes[0].file_name, "history.md");
    assert.equal(row.supporting_notes[0].content, "Aevi Labs support history notes.");
  });

  test("returns next_step guidance on unknown place", async () => {
    const text = await callTool("get_place_sheet", { place_id: "place-does-not-exist" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.equal(typeof parsed.error.details?.next_step, "string");
    assert.ok(parsed.error.details.next_step.includes("list_places"));
  });
});

describe("search_metadata tool", () => {
  test("search envelope returns sc-003 (logline)", async () => {
    const text = await callTool("search_metadata", { query: "envelope" });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.total_count >= 1, true);
    assert.ok(parsed.results.some((row) => row.scene_id === "sc-003"));
  });

  test("search matches metadata keyword phrases from sidecar fields", async () => {
    const text = await callTool("search_metadata", { query: '"Daniel Nystrom"' });
    const parsed = JSON.parse(text);
    assert.equal(Array.isArray(parsed.results), true);
    assert.ok(parsed.results.some((row) => row.scene_id === "sc-002"));
  });

  test("supports pagination with total_count", async () => {
    const text = await callTool("search_metadata", { query: "envelope", page_size: 1, page: 1 });
    const parsed = JSON.parse(text);
    assert.ok(parsed.total_count >= 1);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.page_size, 1);
    assert.ok(parsed.total_pages >= 1);
    assert.equal(parsed.results.length, 1);
  });

  test("search with no match returns helpful message", async () => {
    const text = await callTool("search_metadata", { query: "dragons" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NO_RESULTS");
    assert.match(parsed.error.message, /keyword metadata search/);
    assert.equal(parsed.error.details.search_type, "keyword_metadata_fts");
    assert.ok(parsed.error.details.searched_fields.includes("scene.title"));
    assert.match(parsed.error.details.next_step, /exact metadata keywords/);
    assert.match(parsed.error.details.next_step, /not semantic or prose search/);
  });

  test("returns INVALID_QUERY on malformed FTS syntax", async () => {
    // An unmatched double-quote is invalid FTS5 syntax and previously crashed the server
    const text = await callTool("search_metadata", { query: '"unmatched' });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_QUERY");
  });
});

describe("search_reference tool", () => {
  test("finds reference docs by title and summary text", async () => {
    const text = await callTool("search_reference", { query: "vampirism" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 1);
    assert.equal(parsed.results[0].type, "world");
    assert.equal(parsed.results[0].title, "Vampirism in this universe");
    assert.ok(parsed.results[0].tags.includes("vampirism"));
  });

  test("supports exact tag filtering", async () => {
    const text = await callTool("search_reference", { query: "blood", tag: "continuity" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 1);
    assert.equal(parsed.results[0].type, "continuity");
    assert.equal(parsed.results[0].title, "Sebastian's struggle for blood replacement");
  });

  test("supports type filtering", async () => {
    const text = await callTool("search_reference", { query: "blood", type: "world" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.total_count, 1);
    assert.equal(parsed.results[0].type, "world");
  });

  test("returns INVALID_QUERY on malformed FTS syntax", async () => {
    const text = await callTool("search_reference", { query: '"unmatched' });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_QUERY");
  });
});

describe("reference link tools", () => {
  test("list_scene_references returns direct scene -> reference links", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "scenes", "sc-ref-001.md");
    const worldRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "blood-rules.md");
    const continuityRefPath = path.join(writeSyncDir, "projects", "test-novel", "Notes", "continuity", "sebastian-blood-notes.md");

    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.mkdirSync(path.dirname(worldRefPath), { recursive: true });
    fs.mkdirSync(path.dirname(continuityRefPath), { recursive: true });

    fs.writeFileSync(
      worldRefPath,
      "---\ndoc_id: ref-blood-rules\ntitle: Blood Rules\ntags:\n  - vampirism\n---\nReference body."
    );
    fs.writeFileSync(
      continuityRefPath,
      "---\ndoc_id: ref-sebastian-blood\ntitle: Sebastian Blood Notes\ntags:\n  - continuity\n---\nReference body."
    );
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-ref-001\ntitle: Reference Scene\nreference_ids:\n  - ref-blood-rules\n  - ref-sebastian-blood\n---\nScene prose."
    );

    await callWriteTool("sync");

    const text = await callWriteTool("list_scene_references", {
      scene_id: "sc-ref-001",
      project_id: "test-novel",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.scene_id, "sc-ref-001");
    assert.equal(parsed.project_id, "test-novel");
    assert.equal(parsed.total_count, 2);
    assert.equal(parsed.results.length, 2);
    assert.ok(parsed.results.some(row => row.doc_id === "ref-blood-rules"));
    assert.ok(parsed.results.some(row => row.doc_id === "ref-sebastian-blood"));
  });

  test("list_scene_references returns CONFLICT for ambiguous scene_id without project_id", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-novel", "scenes", "shared.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-novel", "scenes", "shared.md");
    const alphaRefPath = path.join(writeSyncDir, "projects", "alpha-novel", "world", "reference", "alpha.md");
    const betaRefPath = path.join(writeSyncDir, "projects", "beta-novel", "world", "reference", "beta.md");

    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(alphaRefPath), { recursive: true });
    fs.mkdirSync(path.dirname(betaRefPath), { recursive: true });

    fs.writeFileSync(alphaRefPath, "---\ndoc_id: ref-alpha\ntitle: Alpha Ref\n---\nAlpha");
    fs.writeFileSync(betaRefPath, "---\ndoc_id: ref-beta\ntitle: Beta Ref\n---\nBeta");
    fs.writeFileSync(
      alphaScenePath,
      "---\nscene_id: sc-shared-001\ntitle: Alpha Shared\nreference_ids:\n  - ref-alpha\n---\nAlpha scene prose."
    );
    fs.writeFileSync(
      betaScenePath,
      "---\nscene_id: sc-shared-001\ntitle: Beta Shared\nreference_ids:\n  - ref-beta\n---\nBeta scene prose."
    );

    await callWriteTool("sync");

    const text = await callWriteTool("list_scene_references", { scene_id: "sc-shared-001" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
    assert.ok(Array.isArray(parsed.error.details.project_ids));
    assert.ok(parsed.error.details.project_ids.includes("alpha-novel"));
    assert.ok(parsed.error.details.project_ids.includes("beta-novel"));
  });

  test("get_reference_doc returns metadata plus one-hop related docs", async () => {
    const sourcePath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "vamp-lore.md");
    const targetPath = path.join(writeSyncDir, "projects", "test-novel", "Notes", "continuity", "vamp-history.md");

    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    fs.writeFileSync(
      sourcePath,
      "---\ndoc_id: ref-vamp-lore\ntitle: Vamp Lore\nrelated_reference_ids:\n  - ref-vamp-history\ntags:\n  - lore\n---\nLore body."
    );
    fs.writeFileSync(
      targetPath,
      "---\ndoc_id: ref-vamp-history\ntitle: Vamp History\ntags:\n  - history\n---\nHistory body."
    );

    await callWriteTool("sync");

    const text = await callWriteTool("get_reference_doc", {
      doc_id: "ref-vamp-lore",
      include_related: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.doc_id, "ref-vamp-lore");
    assert.ok(parsed.tags.includes("lore"));
    assert.equal(parsed.related.length, 1);
    assert.equal(parsed.related[0].doc_id, "ref-vamp-history");
    assert.ok(parsed.related[0].tags.includes("history"));
  });

  test("suggest_scene_references apply mode persists explicit scene links on write server", async () => {
    const refPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "apply-mode-target.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ndoc_id: ref-apply-mode\ntitle: Apply Mode Target\n---\nReference body."
    );

    await callWriteTool("sync");

    const linkText = await callWriteTool("upsert_reference_link", {
      source_kind: "character",
      source_id: "elena",
      source_project_id: "test-novel",
      target_doc_id: "ref-apply-mode",
      relation: "informs",
    });
    const linkParsed = JSON.parse(linkText);
    assert.equal(linkParsed.ok, true);

    const applyText = await callWriteTool("suggest_scene_references", {
      scene_id: "sc-001",
      project_id: "test-novel",
      mode: "apply",
      selected_doc_ids: ["ref-apply-mode"],
      max_apply: 1,
    });
    const applyParsed = JSON.parse(applyText);

    assert.equal(applyParsed.mode, "apply");
    assert.equal(applyParsed.applied_count, 1);
    assert.equal(applyParsed.applied_links[0].target_doc_id, "ref-apply-mode");
    assert.equal(applyParsed.applied_links[0].origin, "explicit");
    assert.deepEqual(applyParsed.mutation_order, [
      "validated_request",
      "sqlite_commit",
      "project_backup_refresh",
      "compatibility_output_refresh",
    ]);
    assert.equal(applyParsed.compatibility_output.generated_transparency, true);
    assert.equal(applyParsed.compatibility_output.mutation_surface, false);
    assert.equal(applyParsed.compatibility_output.refreshed, true);
    assert.deepEqual(applyParsed.compatibility_diagnostics, []);
    assert.equal(applyParsed.backup_refresh.ok, true);
    assert.deepEqual(applyParsed.backup_warnings, []);

    const listedText = await callWriteTool("list_scene_references", {
      scene_id: "sc-001",
      project_id: "test-novel",
    });
    const listedParsed = JSON.parse(listedText);
    assert.ok(listedParsed.results.some((row) => row.doc_id === "ref-apply-mode"));
  });

});

describe("list_threads tool", () => {
  test("returns structured empty result when none created", async () => {
    const text = await callTool("list_threads", { project_id: "test-novel" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.project_id, "test-novel");
    assert.equal(parsed.total_count, 0);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.results.length, 0);
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("get_thread_arc"));
  });

  test("supports pagination fields on explicit page request", async () => {
    const text = await callTool("list_threads", { project_id: "test-novel", page_size: 1, page: 1 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.project_id, "test-novel");
    assert.equal(parsed.total_count, 0);
    assert.equal(parsed.page, 1);
    assert.equal(parsed.page_size, 1);
    assert.equal(parsed.total_pages, 1);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("get_thread_arc"));
  });
});

describe("thread arc tool", () => {
  test("returns not-found message for unknown thread", async () => {
    const text = await callTool("get_thread_arc", { thread_id: "thread-does-not-exist" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
  });

  test("includes next_step for stale thread arc responses", async () => {
    await callWriteTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-stale-001",
      thread_name: "Stale Thread",
      scene_id: "sc-001",
      beat: "Opening",
    });

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nParity hint marker for get_thread_arc.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("get_thread_arc", { thread_id: "thread-stale-001" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.thread.thread_id, "thread-stale-001");
    assert.equal(typeof parsed.warning, "string");
    assert.ok(parsed.warning.toLowerCase().includes("stale metadata"));
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("enrich_scene"));

    await callWriteTool("enrich_scene", { scene_id: "sc-001", project_id: "test-novel" });
  });

  test("does not leak thread scenes across projects when scene_id is reused", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-thread", "scenes", "shared.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-thread", "scenes", "shared.md");
    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.writeFileSync(alphaScenePath, "---\nscene_id: sc-thread-shared-001\ntitle: Alpha Thread Scene\n---\nAlpha thread prose.");
    fs.writeFileSync(betaScenePath, "---\nscene_id: sc-thread-shared-001\ntitle: Beta Thread Scene\n---\nBeta thread prose.");

    await callWriteTool("sync");
    await callWriteTool("upsert_thread_link", {
      project_id: "alpha-thread",
      thread_id: "thread-alpha-only",
      thread_name: "Alpha Only",
      scene_id: "sc-thread-shared-001",
      beat: "Alpha beat",
    });
    await callWriteTool("upsert_thread_link", {
      project_id: "beta-thread",
      thread_id: "thread-beta-only",
      thread_name: "Beta Only",
      scene_id: "sc-thread-shared-001",
      beat: "Beta beat",
    });

    const alphaText = await callWriteTool("get_thread_arc", { thread_id: "thread-alpha-only" });
    const alphaParsed = JSON.parse(alphaText);
    assert.equal(alphaParsed.total_count, 1);
    assert.equal(alphaParsed.results[0].project_id, "alpha-thread");
    assert.equal(alphaParsed.results[0].thread_beat, "Alpha beat");

    const betaText = await callWriteTool("get_thread_arc", { thread_id: "thread-beta-only" });
    const betaParsed = JSON.parse(betaText);
    assert.equal(betaParsed.total_count, 1);
    assert.equal(betaParsed.results[0].project_id, "beta-thread");
    assert.equal(betaParsed.results[0].thread_beat, "Beta beat");
  });
});

describe("upsert_thread_link tool", () => {
  test("track_thread_arc creates thread and scene link through outcome workflow", async () => {
    const text = await callWriteTool("track_thread_arc", {
      project_id: "test-novel",
      thread_id: "thread-outcome-001",
      thread_name: "Outcome Thread",
      scene_id: "sc-001",
      beat: "setup",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "tracked");
    assert.equal(parsed.thread.thread_id, "thread-outcome-001");
    assert.equal(parsed.thread.project_id, "test-novel");
    assert.equal(parsed.link.scene_id, "sc-001");
    assert.equal(parsed.link.beat, "setup");
    assert.deepEqual(parsed.mutation_order, [
      "validated_request",
      "sqlite_commit",
      "project_backup_refresh",
    ]);
    assert.equal(parsed.backup_refresh.ok, true);
    assert.deepEqual(parsed.backup_warnings, []);
  });

  test("creates thread and scene link", async () => {
    const text = await callWriteTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-test-001",
      thread_name: "Test Thread",
      scene_id: "sc-001",
      beat: "Opening",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "upserted");
    assert.equal(parsed.thread.thread_id, "thread-test-001");
    assert.equal(parsed.thread.project_id, "test-novel");
    assert.equal(parsed.link.scene_id, "sc-001");
    assert.equal(parsed.link.beat, "Opening");
    assert.deepEqual(parsed.mutation_order, [
      "validated_request",
      "sqlite_commit",
      "project_backup_refresh",
    ]);
    assert.equal(parsed.backup_refresh.ok, true);
    assert.deepEqual(parsed.backup_warnings, []);
  });

  test("rejects invalid project id before writing thread links", async () => {
    const text = await callWriteTool("upsert_thread_link", {
      project_id: "../outside",
      thread_id: "thread-invalid-project",
      thread_name: "Invalid Project",
      scene_id: "sc-001",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_PROJECT_ID");
  });

  test("updates existing link beat idempotently", async () => {
    const text = await callWriteTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-test-001",
      thread_name: "Test Thread",
      scene_id: "sc-001",
      beat: "Revised Beat",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.link.beat, "Revised Beat");
  });

  test("returns conflict when reusing thread_id across projects", async () => {
    const text = await callWriteTool("upsert_thread_link", {
      project_id: "other-project",
      thread_id: "thread-test-001",
      thread_name: "Conflicting Thread",
      scene_id: "sc-001",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
  });

  test("returns not-found envelope on read server for unknown scene", async () => {
    const text = await callTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-read-only",
      thread_name: "Read Only",
      scene_id: "sc-999",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
  });
});

describe("upsert_reference_link tool", () => {
  test("creates scene -> reference link with normalized relation", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "scenes", "sc-upsert-ref-001.md");
    const targetRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "upsert-target.md");

    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.mkdirSync(path.dirname(targetRefPath), { recursive: true });

    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-upsert-ref-001\ntitle: Upsert Reference Scene\n---\nScene prose."
    );
    fs.writeFileSync(
      targetRefPath,
      "---\ndoc_id: ref-upsert-target\ntitle: Upsert Target\n---\nReference body."
    );

    await callWriteTool("sync");

    const text = await callWriteTool("upsert_reference_link", {
      source_kind: "scene",
      source_id: "sc-upsert-ref-001",
      source_project_id: "test-novel",
      target_doc_id: "ref-upsert-target",
      relation: "Informs",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "upserted");
    assert.equal(parsed.link.source_kind, "scene");
    assert.equal(parsed.link.source_project_id, "test-novel");
    assert.equal(parsed.link.source_id, "sc-upsert-ref-001");
    assert.equal(parsed.link.target_doc_id, "ref-upsert-target");
    assert.equal(parsed.link.relation, "informs");
    assert.deepEqual(parsed.mutation_order, [
      "validated_request",
      "sqlite_commit",
      "project_backup_refresh",
      "compatibility_output_refresh",
    ]);
    assert.equal(parsed.compatibility_output.generated_transparency, true);
    assert.equal(parsed.compatibility_output.mutation_surface, false);
    assert.equal(parsed.compatibility_output.refreshed, true);
    assert.deepEqual(parsed.compatibility_diagnostics, []);
    assert.equal(parsed.backup_refresh.ok, true);
    assert.deepEqual(parsed.backup_warnings, []);

    const sidecarText = fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8");
    assert.ok(sidecarText.includes("reference_links:"));
    assert.ok(sidecarText.includes("target_doc_id: ref-upsert-target"));
    assert.ok(sidecarText.includes("relation: informs"));
  });

  test("preserves path-conflicting structural sidecar fields when linking scene references", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-7", "chapter-8", "sc-upsert-ref-structural.md");
    const sidecarPath = scenePath.replace(/\.md$/, ".meta.yaml");
    const targetRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "upsert-structural-target.md");

    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.mkdirSync(path.dirname(targetRefPath), { recursive: true });
    fs.writeFileSync(scenePath, "Scene reference structural preservation prose.", "utf8");
    fs.writeFileSync(
      sidecarPath,
      yaml.dump({
        scene_id: "sc-upsert-ref-structural",
        title: "Upsert Reference Structural",
        part: 3,
        chapter: 4,
        chapter_id: "ch-upsert-preserved",
        chapter_title: "Upsert Preserved Chapter",
        timeline_position: 41,
      }),
      "utf8"
    );
    fs.writeFileSync(
      targetRefPath,
      "---\ndoc_id: ref-upsert-structural-target\ntitle: Upsert Structural Target\n---\nReference body.",
      "utf8"
    );

    try {
      await callWriteTool("sync");

      const text = await callWriteTool("upsert_reference_link", {
        source_kind: "scene",
        source_id: "sc-upsert-ref-structural",
        source_project_id: "test-novel",
        target_doc_id: "ref-upsert-structural-target",
        relation: "informs",
      });
      const parsed = JSON.parse(text);
      assert.equal(parsed.ok, true);

      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
      assert.equal(sidecar.part, 3);
      assert.equal(sidecar.chapter, 4);
      assert.equal(sidecar.chapter_id, "ch-upsert-preserved");
      assert.equal(sidecar.chapter_title, "Upsert Preserved Chapter");
      assert.equal(sidecar.timeline_position, 41);
      assert.deepEqual(sidecar.reference_ids, ["ref-upsert-structural-target"]);
    } finally {
      fs.rmSync(scenePath, { force: true });
      fs.rmSync(sidecarPath, { force: true });
      fs.rmSync(targetRefPath, { force: true });
      await callWriteTool("sync");
    }
  });

  test("updates existing relation for same source and target", async () => {
    const text = await callWriteTool("upsert_reference_link", {
      source_kind: "scene",
      source_id: "sc-upsert-ref-001",
      source_project_id: "test-novel",
      target_doc_id: "ref-upsert-target",
      relation: "see_also",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.link.relation, "see_also");

    const listed = await callWriteTool("list_scene_references", {
      scene_id: "sc-upsert-ref-001",
      project_id: "test-novel",
    });
    const listedParsed = JSON.parse(listed);
    assert.equal(listedParsed.results.length, 1);
    assert.equal(listedParsed.results[0].doc_id, "ref-upsert-target");
    assert.equal(listedParsed.results[0].relation, "see_also");

    await callWriteTool("sync");

    const listedAfterSync = await callWriteTool("list_scene_references", {
      scene_id: "sc-upsert-ref-001",
      project_id: "test-novel",
    });
    const listedAfterSyncParsed = JSON.parse(listedAfterSync);
    assert.equal(listedAfterSyncParsed.results.length, 1);
    assert.equal(listedAfterSyncParsed.results[0].doc_id, "ref-upsert-target");
    assert.equal(listedAfterSyncParsed.results[0].relation, "see_also");
  });

  test("returns conflict for ambiguous scene source without project scope", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-upsert", "scenes", "shared.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-upsert", "scenes", "shared.md");
    const targetRefPath = path.join(writeSyncDir, "projects", "alpha-upsert", "world", "reference", "ambiguous-target.md");

    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(targetRefPath), { recursive: true });

    fs.writeFileSync(alphaScenePath, "---\nscene_id: sc-upsert-shared\ntitle: Alpha Shared\n---\nAlpha prose.");
    fs.writeFileSync(betaScenePath, "---\nscene_id: sc-upsert-shared\ntitle: Beta Shared\n---\nBeta prose.");
    fs.writeFileSync(targetRefPath, "---\ndoc_id: ref-upsert-ambiguous\ntitle: Ambiguous Target\n---\nRef body.");

    await callWriteTool("sync");

    const text = await callWriteTool("upsert_reference_link", {
      source_kind: "scene",
      source_id: "sc-upsert-shared",
      target_doc_id: "ref-upsert-ambiguous",
      relation: "informs",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
    assert.ok(parsed.error.details.project_ids.includes("alpha-upsert"));
    assert.ok(parsed.error.details.project_ids.includes("beta-upsert"));
  });

  test("creates and updates reference -> reference links", async () => {
    const sourceRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "ref-upsert-source.md");
    const targetRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "ref-upsert-target-2.md");
    fs.mkdirSync(path.dirname(sourceRefPath), { recursive: true });
    fs.mkdirSync(path.dirname(targetRefPath), { recursive: true });

    fs.writeFileSync(sourceRefPath, "---\ndoc_id: ref-upsert-source\ntitle: Upsert Source\n---\nSource body.");
    fs.writeFileSync(targetRefPath, "---\ndoc_id: ref-upsert-target-2\ntitle: Upsert Target 2\n---\nTarget body.");
    await callWriteTool("sync");

    const createdText = await callWriteTool("upsert_reference_link", {
      source_kind: "reference",
      source_id: "ref-upsert-source",
      source_project_id: "test-novel",
      target_doc_id: "ref-upsert-target-2",
      relation: "Related",
    });
    const created = JSON.parse(createdText);
    assert.equal(created.ok, true);
    assert.equal(created.link.source_kind, "reference");
    assert.equal(created.link.source_project_id, "test-novel");
    assert.equal(created.link.relation, "related");

    const updatedText = await callWriteTool("upsert_reference_link", {
      source_kind: "reference",
      source_id: "ref-upsert-source",
      source_project_id: "test-novel",
      target_doc_id: "ref-upsert-target-2",
      relation: "history_of",
    });
    const updated = JSON.parse(updatedText);
    assert.equal(updated.ok, true);
    assert.equal(updated.link.relation, "history_of");

    const referenceDocText = await callWriteTool("get_reference_doc", {
      doc_id: "ref-upsert-source",
      include_related: true,
    });
    const referenceDoc = JSON.parse(referenceDocText);
    assert.equal(referenceDoc.related.length, 1);
    assert.equal(referenceDoc.related[0].doc_id, "ref-upsert-target-2");
    assert.equal(referenceDoc.related[0].relation, "history_of");

    const sourceRefFrontmatter = fs.readFileSync(sourceRefPath, "utf8");
    assert.ok(sourceRefFrontmatter.includes("reference_links:"));
    assert.ok(sourceRefFrontmatter.includes("target_doc_id: ref-upsert-target-2"));
    assert.ok(sourceRefFrontmatter.includes("relation: history_of"));
  });

  test("commits reference link but rejects compatibility output through a symlink escape", async () => {
    const sourceRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "ref-upsert-symlink-source.md");
    const targetRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "ref-upsert-symlink-target.md");
    const outsideTargetPath = path.join(path.dirname(writeSyncDir), "mcp-writing-reference-outside-target.md");
    const outsideBefore = "---\ndoc_id: outside-target\ntitle: Outside\n---\nOutside body.";
    fs.mkdirSync(path.dirname(sourceRefPath), { recursive: true });
    fs.writeFileSync(sourceRefPath, "---\ndoc_id: ref-upsert-symlink-source\ntitle: Symlink Source\n---\nSource body.", "utf8");
    fs.writeFileSync(targetRefPath, "---\ndoc_id: ref-upsert-symlink-target\ntitle: Symlink Target\n---\nTarget body.", "utf8");
    await callWriteTool("sync");

    try {
      fs.writeFileSync(outsideTargetPath, outsideBefore, "utf8");
      fs.unlinkSync(sourceRefPath);
      fs.symlinkSync(outsideTargetPath, sourceRefPath);

      const text = await callWriteTool("upsert_reference_link", {
        source_kind: "reference",
        source_id: "ref-upsert-symlink-source",
        source_project_id: "test-novel",
        target_doc_id: "ref-upsert-symlink-target",
        relation: "related",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.compatibility_output.refreshed, false);
      assert.equal(parsed.compatibility_diagnostics[0].code, "INVALID_METADATA_PATH");
      assert.equal(fs.readFileSync(outsideTargetPath, "utf8"), outsideBefore);

      const referenceDocText = await callWriteTool("get_reference_doc", {
        doc_id: "ref-upsert-symlink-source",
        include_related: true,
      });
      const referenceDoc = JSON.parse(referenceDocText);
      assert.equal(referenceDoc.related.length, 1);
      assert.equal(referenceDoc.related[0].doc_id, "ref-upsert-symlink-target");
      assert.equal(referenceDoc.related[0].relation, "related");
    } finally {
      if (fs.lstatSync(sourceRefPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
        fs.unlinkSync(sourceRefPath);
      }
      fs.rmSync(outsideTargetPath, { force: true });
    }
  });

  test("canonicalizes legacy explicit link fields on reference upsert", async () => {
    const sourceRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "ref-upsert-source.md");
    fs.writeFileSync(
      sourceRefPath,
      "---\ndoc_id: ref-upsert-source\ntitle: Upsert Source\nrelated_reference_links:\n  - target_doc_id: ref-upsert-target-2\n    relation: see_also\nexplicit_reference_links:\n  - target_doc_id: ref-upsert-target-2\n    relation: depends_on\n---\nSource body."
    );
    await callWriteTool("sync");

    const updatedText = await callWriteTool("upsert_reference_link", {
      source_kind: "reference",
      source_id: "ref-upsert-source",
      source_project_id: "test-novel",
      target_doc_id: "ref-upsert-target-2",
      relation: "related",
    });
    const updated = JSON.parse(updatedText);
    assert.equal(updated.ok, true);

    const canonicalFrontmatter = fs.readFileSync(sourceRefPath, "utf8");
    assert.ok(canonicalFrontmatter.includes("reference_links:"));
    assert.ok(!canonicalFrontmatter.includes("related_reference_links:"));
    assert.ok(!canonicalFrontmatter.includes("explicit_reference_links:"));

    const referenceDocText = await callWriteTool("get_reference_doc", {
      doc_id: "ref-upsert-source",
      include_related: true,
    });
    const referenceDoc = JSON.parse(referenceDocText);
    const targetRows = referenceDoc.related.filter((row) => row.doc_id === "ref-upsert-target-2");
    assert.equal(targetRows.length, 1);
    assert.equal(targetRows[0].relation, "related");
  });

  test("returns conflict for reference source with mismatched source_project_id", async () => {
    const text = await callWriteTool("upsert_reference_link", {
      source_kind: "reference",
      source_id: "ref-upsert-source",
      source_project_id: "wrong-project",
      target_doc_id: "ref-upsert-target-2",
      relation: "related",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
  });

  test("rejects reference self-links", async () => {
    const sourceRefPath = path.join(writeSyncDir, "projects", "test-novel", "world", "reference", "self-link.md");
    fs.mkdirSync(path.dirname(sourceRefPath), { recursive: true });
    fs.writeFileSync(
      sourceRefPath,
      "---\ndoc_id: ref-self-link\ntitle: Self Link\n---\nReference body."
    );
    await callWriteTool("sync");

    const text = await callWriteTool("upsert_reference_link", {
      source_kind: "reference",
      source_id: "ref-self-link",
      target_doc_id: "ref-self-link",
      relation: "related",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
  });
});

  describe("get_relationship_arc tool", () => {
    test("returns no data message when no relationships exist", async () => {
      const text = await callTool("get_relationship_arc", {
        from_character: "elena",
        to_character: "marcus",
      });
      assert.ok(text.toLowerCase().includes("no relationship data"));
    });
  });
});
