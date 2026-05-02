import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
    if (Array.isArray(parsed)) {
      assert.equal(parsed.length, 3);
    } else {
      assert.equal(parsed.total_count, 3);
    }
  });

  test("filters by character: elena appears in all 3 scenes", async () => {
    const text = await callTool("find_scenes", { character: "elena" });
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      assert.equal(parsed.length, 3);
    } else {
      assert.equal(parsed.total_count, 3);
    }
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

    const text = await callWriteTool("get_scene_prose", { scene_id: "sc-002" });
    assert.ok(text.includes("Metadata for this scene may be stale"));
    assert.ok(text.includes("Suggested next step"));
    assert.ok(text.includes("enrich_scene"));
    assert.ok(text.includes("project_id='test-novel'"));

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
});

describe("get_chapter_prose tool", () => {
  test("returns prose for both scenes in part 1 chapter 1", async () => {
    const text = await callTool("get_chapter_prose", {
      project_id: "test-novel",
      part: 1,
      chapter: 1,
    });
    assert.ok(text.includes("gangway") || text.includes("bait shed"),
      `Expected chapter prose keywords, got: ${text.slice(0, 200)}`);
  });
});

describe("get_arc tool", () => {
  test("elena arc returns 3 scenes", async () => {
    const text = await callTool("get_arc", { character_id: "elena" });
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      assert.equal(parsed.length, 3);
    } else {
      assert.equal(parsed.total_count, 3);
    }
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
    assert.ok(text.includes("elena"));
    assert.ok(text.includes("marcus"));
  });
});

describe("get_character_sheet tool", () => {
  test("elena sheet includes traits", async () => {
    const text = await callTool("get_character_sheet", { character_id: "elena" });
    const parsed = JSON.parse(text);
    assert.ok((text.includes("driven") || text.includes("walls")),
      `Expected trait keywords for elena, got: ${text.slice(0, 200)}`);
    assert.equal(typeof parsed.next_step, "string");
    assert.ok(parsed.next_step.includes("get_arc"));
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

    assert.equal(parsed.notes, "Canonical sheet content.");
    assert.equal(parsed.supporting_notes.length, 1);
    assert.equal(parsed.supporting_notes[0].file_name, "arc.md");
    assert.equal(parsed.supporting_notes[0].content, "Alba support arc notes.");
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
    assert.ok(text.includes("harbor-district"));
  });
});

describe("get_place_sheet tool", () => {
  test("harbor-district sheet includes associated_characters and tags", async () => {
    const text = await callTool("get_place_sheet", { place_id: "harbor-district" });
    const parsed = JSON.parse(text);

    assert.ok(parsed.associated_characters.includes("elena"));
    assert.ok(parsed.tags.includes("urban"));
    assert.ok(parsed.notes.includes("brine and diesel"));
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

    assert.equal(parsed.notes, "Canonical place sheet content.");
    assert.equal(parsed.associated_characters[0], "alba");
    assert.equal(parsed.tags[0], "lab");
    assert.equal(parsed.supporting_notes.length, 1);
    assert.equal(parsed.supporting_notes[0].file_name, "history.md");
    assert.equal(parsed.supporting_notes[0].content, "Aevi Labs support history notes.");
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
    assert.ok(text.includes("sc-003"));
  });

  test("search matches metadata keyword phrases from sidecar fields", async () => {
    const text = await callTool("search_metadata", { query: '"Daniel Nystrom"' });
    assert.ok(text.includes("sc-002"));
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
    assert.ok(text.toLowerCase().includes("no scenes"));
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
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, "world");
    assert.equal(parsed[0].title, "Vampirism in this universe");
    assert.ok(parsed[0].tags.includes("vampirism"));
  });

  test("supports exact tag filtering", async () => {
    const text = await callTool("search_reference", { query: "blood", tag: "continuity" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, "continuity");
    assert.equal(parsed[0].title, "Sebastian's struggle for blood replacement");
  });

  test("supports type filtering", async () => {
    const text = await callTool("search_reference", { query: "blood", type: "world" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, "world");
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
    assert.equal(parsed.references.length, 2);
    assert.ok(parsed.references.some(row => row.doc_id === "ref-blood-rules"));
    assert.ok(parsed.references.some(row => row.doc_id === "ref-sebastian-blood"));
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

    const listedText = await callWriteTool("list_scene_references", {
      scene_id: "sc-001",
      project_id: "test-novel",
    });
    const listedParsed = JSON.parse(listedText);
    assert.ok(listedParsed.references.some((row) => row.doc_id === "ref-apply-mode"));
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
});

describe("upsert_thread_link tool", () => {
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

    const sidecarText = fs.readFileSync(scenePath.replace(/\.md$/, ".meta.yaml"), "utf8");
    assert.ok(sidecarText.includes("reference_links:"));
    assert.ok(sidecarText.includes("target_doc_id: ref-upsert-target"));
    assert.ok(sidecarText.includes("relation: informs"));
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
    assert.equal(listedParsed.references.length, 1);
    assert.equal(listedParsed.references[0].doc_id, "ref-upsert-target");
    assert.equal(listedParsed.references[0].relation, "see_also");

    await callWriteTool("sync");

    const listedAfterSync = await callWriteTool("list_scene_references", {
      scene_id: "sc-upsert-ref-001",
      project_id: "test-novel",
    });
    const listedAfterSyncParsed = JSON.parse(listedAfterSync);
    assert.equal(listedAfterSyncParsed.references.length, 1);
    assert.equal(listedAfterSyncParsed.references[0].doc_id, "ref-upsert-target");
    assert.equal(listedAfterSyncParsed.references[0].relation, "see_also");
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
