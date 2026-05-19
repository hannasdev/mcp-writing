import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3073, 3072);
let writeSyncDir;

before(async () => {
  await ctx.setup();
  writeSyncDir = ctx.writeSyncDir;
});

after(async () => {
  await ctx.teardown();
});

const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
describe("update_scene_metadata tool", () => {
  test("updates logline and reflects in find_scenes", async () => {
    const newLogline = "Elena stands alone at the edge of the harbor, watching the ship leave.";
    const updateText = await callWriteTool("update_scene_metadata", {
      scene_id: "sc-001",
      project_id: "test-novel",
      fields: { logline: newLogline },
    });
    assert.ok(updateText.includes("Updated metadata"));

    const findText = await callWriteTool("find_scenes", { project_id: "test-novel", character: "elena" });
    assert.ok(findText.includes("alone at the edge"), `Expected updated logline in find_scenes, got: ${findText.slice(0, 300)}`);
  });

  test("returns error for unknown scene", async () => {
    const text = await callWriteTool("update_scene_metadata", {
      scene_id: "sc-999",
      project_id: "test-novel",
      fields: { logline: "Updated" },
    });
    assert.ok(text.toLowerCase().includes("not found"));
  });

  test("rejects structural field updates", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-unchaptered.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-unchaptered\ntitle: Loose Scene\n---\nUnchaptered prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);
    const sidecarFile = path.join(sceneDir, "sc-unchaptered.meta.yaml");
    const sidecarBefore = fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile, "utf8") : null;

    const updateText = await callWriteTool("update_scene_metadata", {
      scene_id: "sc-unchaptered",
      project_id: "test-novel",
      fields: {
        part: 1,
        chapter: firstChapter.sort_index,
        chapter_id: firstChapter.chapter_id,
        timeline_position: 3,
      },
    });
    const parsed = JSON.parse(updateText);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
    assert.match(parsed.error.message, /cannot change structural fields/);
    assert.deepEqual(parsed.error.details.blocked_fields, [
      "part",
      "chapter",
      "chapter_id",
      "timeline_position",
    ]);
    assert.deepEqual(parsed.error.details.allowed_structure_tools, [
      "assign_scene_to_chapter",
      "move_scene",
    ]);

    const sidecarAfter = fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile, "utf8") : null;
    assert.equal(sidecarAfter, sidecarBefore);
  });
});

describe("assign_scene_to_chapter tool", () => {
  test("assigns an unchaptered scene and reflects it in chapter-aware reads", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m5-assigned.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m5-assigned\ntitle: Assigned M5 Scene\ntimeline_position: 42\n---\nM5 assignment prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const secondChapter = chaptersParsed.results.find((row) => row.sort_index === 2);
    assert.ok(secondChapter);

    const assignText = await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m5-assigned",
      project_id: "test-novel",
      chapter_id: secondChapter.chapter_id,
    });
    const assignParsed = JSON.parse(assignText);
    assert.equal(assignParsed.ok, true);
    assert.equal(assignParsed.action, "assigned");
    assert.equal(assignParsed.chapter.chapter_id, secondChapter.chapter_id);
    assert.equal(assignParsed.updated_sidecar_count, 1);
    assert.deepEqual(assignParsed.diagnostics, []);

    const sidecarFile = path.join(sceneDir, "sc-m5-assigned.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.chapter_id, secondChapter.chapter_id);
    assert.equal(sidecar.chapter, 2);
    assert.equal(sidecar.chapter_title, secondChapter.title);

    const findText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: secondChapter.chapter_id,
    });
    const findParsed = JSON.parse(findText);
    assert.ok(findParsed.results.some((row) => row.scene_id === "sc-m5-assigned"));

    const chapterProseText = await callWriteTool("get_chapter_prose", {
      project_id: "test-novel",
      chapter_id: secondChapter.chapter_id,
    });
    assert.ok(chapterProseText.includes("M5 assignment prose."));

    const previewText = await callWriteTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "editor_detailed",
      chapter_id: secondChapter.chapter_id,
    });
    const previewParsed = JSON.parse(previewText);
    assert.ok(previewParsed.ordering.some((row) => row.scene_id === "sc-m5-assigned"));
  });

  test("clears an explicit chapter link for an unchaptered scene", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m5-clear.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m5-clear\ntitle: Clear M5 Scene\n---\nM5 clear prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m5-clear",
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
    });

    const clearText = await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m5-clear",
      project_id: "test-novel",
      chapter_id: null,
    });
    const clearParsed = JSON.parse(clearText);
    assert.equal(clearParsed.ok, true);
    assert.equal(clearParsed.action, "cleared");
    assert.equal(clearParsed.chapter, null);
    assert.equal(clearParsed.updated_sidecar_count, 1);
    assert.deepEqual(clearParsed.diagnostics, []);

    const sidecarFile = path.join(sceneDir, "sc-m5-clear.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.chapter_id, null);
    assert.equal(sidecar.chapter, null);
    assert.equal(sidecar.chapter_title, null);

    const findText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
    });
    const findParsed = JSON.parse(findText);
    assert.equal(findParsed.results.some((row) => row.scene_id === "sc-m5-clear"), false);
  });

  test("reports previous chapter from sidecar when index is stale", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m5-stale-index.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m5-stale-index\ntitle: Stale Index Scene\n---\nM5 stale index prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    const secondChapter = chaptersParsed.results.find((row) => row.sort_index === 2);
    assert.ok(firstChapter);
    assert.ok(secondChapter);

    await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m5-stale-index",
      project_id: "test-novel",
      chapter_id: firstChapter.chapter_id,
    });

    const sidecarFile = path.join(sceneDir, "sc-m5-stale-index.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    fs.writeFileSync(
      sidecarFile,
      yaml.dump({
        ...sidecar,
        chapter_id: secondChapter.chapter_id,
        chapter: secondChapter.sort_index,
        chapter_title: secondChapter.title,
      }),
      "utf8"
    );

    const clearText = await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m5-stale-index",
      project_id: "test-novel",
      chapter_id: null,
    });
    const clearParsed = JSON.parse(clearText);

    assert.equal(clearParsed.ok, true);
    assert.equal(clearParsed.previous_chapter_id, secondChapter.chapter_id);
  });

  test("rejects assignment when the scene path implies another chapter", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const secondChapter = chaptersParsed.results.find((row) => row.sort_index === 2);
    assert.ok(secondChapter);

    const assignText = await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-001",
      project_id: "test-novel",
      chapter_id: secondChapter.chapter_id,
    });
    const assignParsed = JSON.parse(assignText);

    assert.equal(assignParsed.ok, false);
    assert.equal(assignParsed.error.code, "VALIDATION_ERROR");
    assert.match(assignParsed.error.message, /file path implies another canonical chapter/);
    assert.equal(assignParsed.error.details.requested_chapter_id, secondChapter.chapter_id);
    assert.notEqual(assignParsed.error.details.path_chapter, null);
  });
});

describe("create_chapter tool", () => {
  test("creates a canonical chapter and returns follow-up guidance", async () => {
    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 New Crossing",
      sort_index: 99,
      logline: "A crossing appears at the edge of the map.",
    });
    const createParsed = JSON.parse(createText);

    assert.equal(createParsed.ok, true);
    assert.equal(createParsed.action, "created");
    assert.equal(createParsed.chapter.chapter_id, "ch-99-m7-new-crossing");
    assert.equal(createParsed.chapter.project_id, "test-novel");
    assert.equal(createParsed.chapter.title, "M7 New Crossing");
    assert.equal(createParsed.chapter.sort_index, 99);
    assert.equal(createParsed.diagnostics[0].code, "REPRESENTATION_DEFERRED");
    assert.ok(createParsed.next_steps.some((step) => step.includes("assign_scene_to_chapter")));

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    assert.ok(chaptersParsed.results.some((row) => row.chapter_id === "ch-99-m7-new-crossing"));
  });

  test("rejects creating a chapter at an occupied sort index", async () => {
    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Conflicting Chapter",
      sort_index: 1,
    });
    const createParsed = JSON.parse(createText);

    assert.equal(createParsed.ok, false);
    assert.equal(createParsed.error.code, "VALIDATION_ERROR");
    assert.match(createParsed.error.message, /sort_index 1 is already used/);
    assert.equal(createParsed.error.details.existing_chapter_id, firstChapter.chapter_id);
    assert.match(createParsed.error.details.next_step, /reorder_chapter/);
  });
});

describe("rename_chapter tool", () => {
  test("renames a canonical chapter and explicit scene compatibility fields", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m7-rename.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m7-rename\ntitle: Rename M7 Scene\n---\nM7 rename prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Before Rename",
      sort_index: 98,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m7-rename",
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });

    const renameText = await callWriteTool("rename_chapter", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      title: "M7 After Rename",
    });
    const renameParsed = JSON.parse(renameText);

    assert.equal(renameParsed.ok, true);
    assert.equal(renameParsed.action, "renamed");
    assert.equal(renameParsed.previous_title, "M7 Before Rename");
    assert.equal(renameParsed.chapter.title, "M7 After Rename");
    assert.equal(renameParsed.updated_scene_count, 1);
    assert.equal(renameParsed.updated_sidecar_count, 1);

    const sidecarFile = path.join(sceneDir, "sc-m7-rename.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(sidecar.chapter_title, "M7 After Rename");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const renamed = chaptersParsed.results.find((row) => row.chapter_id === createParsed.chapter.chapter_id);
    assert.equal(renamed.title, "M7 After Rename");

    const findText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });
    const findParsed = JSON.parse(findText);
    const renamedScene = findParsed.results.find((row) => row.scene_id === "sc-m7-rename");
    assert.equal(renamedScene.chapter_title, "M7 After Rename");
  });

  test("rejects renaming a chapter to an existing title", async () => {
    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Rename Conflict Source",
      sort_index: 97,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const renameText = await callWriteTool("rename_chapter", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      title: firstChapter.title,
    });
    const renameParsed = JSON.parse(renameText);

    assert.equal(renameParsed.ok, false);
    assert.equal(renameParsed.error.code, "VALIDATION_ERROR");
    assert.match(renameParsed.error.message, /already used/);
    assert.equal(renameParsed.error.details.existing_chapter_id, firstChapter.chapter_id);
  });
});

describe("reorder_chapter tool", () => {
  test("reorders a canonical chapter and explicit scene compatibility fields", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m7-reorder.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m7-reorder\ntitle: Reorder M7 Scene\n---\nM7 reorder prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Before Reorder",
      sort_index: 96,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    await callWriteTool("assign_scene_to_chapter", {
      scene_id: "sc-m7-reorder",
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });

    const reorderText = await callWriteTool("reorder_chapter", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      sort_index: 95,
    });
    const reorderParsed = JSON.parse(reorderText);

    assert.equal(reorderParsed.ok, true);
    assert.equal(reorderParsed.action, "reordered");
    assert.equal(reorderParsed.previous_sort_index, 96);
    assert.equal(reorderParsed.chapter.sort_index, 95);
    assert.equal(reorderParsed.updated_scene_count, 1);
    assert.equal(reorderParsed.updated_sidecar_count, 1);

    const sidecarFile = path.join(sceneDir, "sc-m7-reorder.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(sidecar.chapter, 95);
    assert.equal(sidecar.chapter_title, "M7 Before Reorder");

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const reordered = chaptersParsed.results.find((row) => row.chapter_id === createParsed.chapter.chapter_id);
    assert.equal(reordered.sort_index, 95);

    const findText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });
    const findParsed = JSON.parse(findText);
    const reorderedScene = findParsed.results.find((row) => row.scene_id === "sc-m7-reorder");
    assert.equal(reorderedScene.chapter, 95);
    assert.equal(reorderedScene.chapter_title, "M7 Before Reorder");
  });

  test("rejects reordering a chapter to an occupied sort index", async () => {
    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Reorder Conflict Source",
      sort_index: 94,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    const chaptersText = await callWriteTool("list_chapters", { project_id: "test-novel" });
    const chaptersParsed = JSON.parse(chaptersText);
    const firstChapter = chaptersParsed.results.find((row) => row.sort_index === 1);
    assert.ok(firstChapter);

    const reorderText = await callWriteTool("reorder_chapter", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      sort_index: 1,
    });
    const reorderParsed = JSON.parse(reorderText);

    assert.equal(reorderParsed.ok, false);
    assert.equal(reorderParsed.error.code, "VALIDATION_ERROR");
    assert.match(reorderParsed.error.message, /sort_index 1 is already used/);
    assert.equal(reorderParsed.error.details.existing_chapter_id, firstChapter.chapter_id);
    assert.match(reorderParsed.error.details.next_step, /Automatic resequencing/);
  });
});

describe("attach_epigraph tool", () => {
  test("attaches an existing canonical epigraph to another chapter and updates explicit sidecar linkage", async () => {
    const draftDir = path.join(writeSyncDir, "projects", "test-novel", "scenes", "Draft");
    const sourceDir = path.join(draftDir, "89-M7 Epigraph Source");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "epigraph.md"),
      "---\nepigraph_id: epi-m7-attach\n---\nM7 attach epigraph prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Epigraph Target",
      sort_index: 88,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    const sourceEpigraphsText = await callWriteTool("find_epigraphs", {
      project_id: "test-novel",
      chapter: 89,
    });
    const sourceEpigraphsParsed = JSON.parse(sourceEpigraphsText);
    const sourceEpigraph = sourceEpigraphsParsed.results.find((row) => row.epigraph_id === "epi-m7-attach");
    assert.ok(sourceEpigraph);

    const attachText = await callWriteTool("attach_epigraph", {
      project_id: "test-novel",
      epigraph_id: "epi-m7-attach",
      chapter_id: createParsed.chapter.chapter_id,
    });
    const attachParsed = JSON.parse(attachText);

    assert.equal(attachParsed.ok, true);
    assert.equal(attachParsed.action, "attached");
    assert.equal(attachParsed.epigraph.epigraph_id, "epi-m7-attach");
    assert.equal(attachParsed.epigraph.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(attachParsed.previous_chapter.chapter_id, sourceEpigraph.chapter_id);
    assert.equal(attachParsed.updated_sidecar_count, 1);
    assert.equal(attachParsed.diagnostics[0].code, "REPRESENTATION_NOT_MOVED");

    const sidecarFile = path.join(sourceDir, "epigraph.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.kind, "epigraph");
    assert.equal(sidecar.epigraph_id, "epi-m7-attach");
    assert.equal(sidecar.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(sidecar.chapter, 88);
    assert.equal(sidecar.chapter_title, "M7 Epigraph Target");

    const targetEpigraphsText = await callWriteTool("find_epigraphs", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });
    const targetEpigraphsParsed = JSON.parse(targetEpigraphsText);
    assert.ok(targetEpigraphsParsed.results.some((row) => row.epigraph_id === "epi-m7-attach"));
  });

  test("rejects attaching an epigraph to a chapter that already has one", async () => {
    const draftDir = path.join(writeSyncDir, "projects", "test-novel", "scenes", "Draft");
    const sourceDir = path.join(draftDir, "87-M7 Attach Conflict Source");
    const targetDir = path.join(draftDir, "86-M7 Attach Conflict Target");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "epigraph.md"),
      "---\nepigraph_id: epi-m7-conflict-source\n---\nSource conflict epigraph.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(targetDir, "epigraph.md"),
      "---\nepigraph_id: epi-m7-conflict-target\n---\nTarget conflict epigraph.",
      "utf8"
    );

    await callWriteTool("sync");

    const targetEpigraphsText = await callWriteTool("find_epigraphs", {
      project_id: "test-novel",
      chapter: 86,
    });
    const targetEpigraphsParsed = JSON.parse(targetEpigraphsText);
    const targetEpigraph = targetEpigraphsParsed.results.find((row) => row.epigraph_id === "epi-m7-conflict-target");
    assert.ok(targetEpigraph);

    const attachText = await callWriteTool("attach_epigraph", {
      project_id: "test-novel",
      epigraph_id: "epi-m7-conflict-source",
      chapter_id: targetEpigraph.chapter_id,
    });
    const attachParsed = JSON.parse(attachText);

    assert.equal(attachParsed.ok, false);
    assert.equal(attachParsed.error.code, "VALIDATION_ERROR");
    assert.equal(attachParsed.error.details.existing_epigraph_id, "epi-m7-conflict-target");
    assert.match(attachParsed.error.details.next_step, /find_epigraphs/);
  });
});

describe("move_scene tool", () => {
  test("moves a scene to a canonical chapter and timeline position", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    const scenePath = path.join(sceneDir, "sc-m7-move.md");
    fs.writeFileSync(
      scenePath,
      "---\nscene_id: sc-m7-move\ntitle: Move M7 Scene\ntimeline_position: 3\n---\nM7 move prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Target",
      sort_index: 85,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    const moveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move",
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      timeline_position: 12,
    });
    const moveParsed = JSON.parse(moveText);

    assert.equal(moveParsed.ok, true);
    assert.equal(moveParsed.action, "moved");
    assert.equal(moveParsed.scene_id, "sc-m7-move");
    assert.equal(moveParsed.chapter.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(moveParsed.timeline_position, 12);
    assert.equal(moveParsed.previous_timeline_position, 3);
    assert.equal(moveParsed.updated_sidecar_count, 1);
    assert.equal(moveParsed.diagnostics[0].code, "REPRESENTATION_NOT_MOVED");

    const sidecarFile = path.join(sceneDir, "sc-m7-move.meta.yaml");
    const sidecar = yaml.load(fs.readFileSync(sidecarFile, "utf8"));
    assert.equal(sidecar.chapter_id, createParsed.chapter.chapter_id);
    assert.equal(sidecar.chapter, 85);
    assert.equal(sidecar.chapter_title, "M7 Move Target");
    assert.equal(sidecar.timeline_position, 12);

    const findText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
    });
    const findParsed = JSON.parse(findText);
    const movedScene = findParsed.results.find((row) => row.scene_id === "sc-m7-move");
    assert.equal(movedScene.timeline_position, 12);
    assert.equal(movedScene.chapter_id, createParsed.chapter.chapter_id);
  });

  test("rejects moving a scene to an occupied timeline position in the target chapter", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-occupied-a.md"),
      "---\nscene_id: sc-m7-move-occupied-a\ntitle: Move Occupied A\n---\nOccupied A prose.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-occupied-b.md"),
      "---\nscene_id: sc-m7-move-occupied-b\ntitle: Move Occupied B\n---\nOccupied B prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const createText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Conflict Target",
      sort_index: 84,
    });
    const createParsed = JSON.parse(createText);
    assert.equal(createParsed.ok, true);

    const firstMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-occupied-a",
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      timeline_position: 8,
    });
    const firstMoveParsed = JSON.parse(firstMoveText);
    assert.equal(firstMoveParsed.ok, true);

    const secondMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-occupied-b",
      project_id: "test-novel",
      chapter_id: createParsed.chapter.chapter_id,
      timeline_position: 8,
    });
    const secondMoveParsed = JSON.parse(secondMoveText);

    assert.equal(secondMoveParsed.ok, false);
    assert.equal(secondMoveParsed.error.code, "VALIDATION_ERROR");
    assert.equal(secondMoveParsed.error.details.existing_scene_id, "sc-m7-move-occupied-a");
    assert.match(secondMoveParsed.error.details.next_step, /Automatic resequencing/);
  });

  test("rejects moving chapters when existing timeline position is occupied in target", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-carry-position.md"),
      "---\nscene_id: sc-m7-move-carry-position\ntitle: Move Carry Position\ntimeline_position: 6\n---\nCarry position prose.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-carry-blocker.md"),
      "---\nscene_id: sc-m7-move-carry-blocker\ntitle: Move Carry Blocker\n---\nCarry blocker prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const sourceChapterText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Carry Source",
      sort_index: 81,
    });
    const sourceChapter = JSON.parse(sourceChapterText).chapter;

    const targetChapterText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Carry Target",
      sort_index: 80,
    });
    const targetChapter = JSON.parse(targetChapterText).chapter;

    const sourceMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-carry-position",
      project_id: "test-novel",
      chapter_id: sourceChapter.chapter_id,
    });
    assert.equal(JSON.parse(sourceMoveText).ok, true);

    const subjectSidecarFile = path.join(sceneDir, "sc-m7-move-carry-position.meta.yaml");
    const subjectSidecar = yaml.load(fs.readFileSync(subjectSidecarFile, "utf8"));
    delete subjectSidecar.timeline_position;
    fs.writeFileSync(subjectSidecarFile, yaml.dump(subjectSidecar), "utf8");

    const blockerMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-carry-blocker",
      project_id: "test-novel",
      chapter_id: targetChapter.chapter_id,
      timeline_position: 6,
    });
    assert.equal(JSON.parse(blockerMoveText).ok, true);

    const moveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-carry-position",
      project_id: "test-novel",
      chapter_id: targetChapter.chapter_id,
    });
    const moveParsed = JSON.parse(moveText);

    assert.equal(moveParsed.ok, false);
    assert.equal(moveParsed.error.code, "VALIDATION_ERROR");
    assert.equal(moveParsed.error.details.chapter_id, targetChapter.chapter_id);
    assert.equal(moveParsed.error.details.timeline_position, 6);
    assert.equal(moveParsed.error.details.existing_scene_id, "sc-m7-move-carry-blocker");
  });

  test("checks timeline conflicts against sidecar chapter when index is stale", async () => {
    const sceneDir = path.join(writeSyncDir, "projects", "test-novel", "scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-stale-subject.md"),
      "---\nscene_id: sc-m7-move-stale-subject\ntitle: Move Stale Subject\n---\nStale subject prose.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(sceneDir, "sc-m7-move-stale-blocker.md"),
      "---\nscene_id: sc-m7-move-stale-blocker\ntitle: Move Stale Blocker\n---\nStale blocker prose.",
      "utf8"
    );

    await callWriteTool("sync");

    const sourceChapterText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Stale Source",
      sort_index: 83,
    });
    const sourceChapter = JSON.parse(sourceChapterText).chapter;

    const targetChapterText = await callWriteTool("create_chapter", {
      project_id: "test-novel",
      title: "M7 Move Stale Target",
      sort_index: 82,
    });
    const targetChapter = JSON.parse(targetChapterText).chapter;

    const sourceMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-stale-subject",
      project_id: "test-novel",
      chapter_id: sourceChapter.chapter_id,
      timeline_position: 4,
    });
    assert.equal(JSON.parse(sourceMoveText).ok, true);

    const blockerMoveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-stale-blocker",
      project_id: "test-novel",
      chapter_id: targetChapter.chapter_id,
      timeline_position: 8,
    });
    assert.equal(JSON.parse(blockerMoveText).ok, true);

    const subjectSidecarFile = path.join(sceneDir, "sc-m7-move-stale-subject.meta.yaml");
    const subjectSidecar = yaml.load(fs.readFileSync(subjectSidecarFile, "utf8"));
    fs.writeFileSync(
      subjectSidecarFile,
      yaml.dump({
        ...subjectSidecar,
        chapter_id: targetChapter.chapter_id,
        chapter: targetChapter.sort_index,
        chapter_title: targetChapter.title,
      }),
      "utf8"
    );

    const moveText = await callWriteTool("move_scene", {
      scene_id: "sc-m7-move-stale-subject",
      project_id: "test-novel",
      timeline_position: 8,
    });
    const moveParsed = JSON.parse(moveText);

    assert.equal(moveParsed.ok, false);
    assert.equal(moveParsed.error.code, "VALIDATION_ERROR");
    assert.equal(moveParsed.error.details.chapter_id, targetChapter.chapter_id);
    assert.equal(moveParsed.error.details.existing_scene_id, "sc-m7-move-stale-blocker");
  });
});

describe("update_character_sheet tool", () => {
  test("updates arc_summary and reflects in get_character_sheet", async () => {
    const text = await callWriteTool("update_character_sheet", {
      character_id: "elena",
      fields: { arc_summary: "Overcomes isolation to build genuine trust." },
    });
    assert.ok(text.includes("Updated character sheet"));

    const sheet = await callWriteTool("get_character_sheet", { character_id: "elena" });
    assert.ok(sheet.includes("Overcomes isolation"), `Expected updated arc, got: ${sheet.slice(0, 300)}`);
  });

  test("returns error for unknown character", async () => {
    const text = await callWriteTool("update_character_sheet", {
      character_id: "nobody",
      fields: { arc_summary: "X" },
    });
    assert.ok(text.toLowerCase().includes("not found"));
  });
});

describe("update_place_sheet tool", () => {
  test("updates name and reflects in list_places", async () => {
    const text = await callWriteTool("update_place_sheet", {
      place_id: "harbor-district",
      fields: { name: "Harbor District (Revised)" },
    });
    assert.ok(text.includes("Updated place sheet"));

    const listed = await callWriteTool("list_places");
    assert.ok(listed.includes("Harbor District (Revised)"), `Expected updated name in list_places, got: ${listed.slice(0, 300)}`);
  });

  test("updates associated_characters and tags in sidecar", async () => {
    const text = await callWriteTool("update_place_sheet", {
      place_id: "harbor-district",
      fields: { associated_characters: ["elena", "marcus"], tags: ["urban", "docks"] },
    });
    assert.ok(text.includes("Updated place sheet"));

    const sheet = await callWriteTool("get_place_sheet", { place_id: "harbor-district" });
    const parsed = JSON.parse(sheet);
    assert.equal(parsed.total_count, 1);
    assert.ok(parsed.results[0].associated_characters.includes("marcus"));
    assert.ok(parsed.results[0].tags.includes("docks"));
  });

  test("returns error for unknown place", async () => {
    const text = await callWriteTool("update_place_sheet", {
      place_id: "place-does-not-exist",
      fields: { name: "Ghost" },
    });
    assert.ok(text.toLowerCase().includes("not found"));
  });
});

describe("update_scene_metadata status field", () => {
  test("sets and reads back status via sidecar", async () => {
    const text = await callWriteTool("update_scene_metadata", {
      scene_id: "sc-001",
      project_id: "test-novel",
      fields: { status: "needs-revision" },
    });
    assert.ok(text.includes("Updated metadata"));

    // Verify the status field was written to the sidecar on disk
    const sidecarFile = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.meta.yaml");
    const raw = fs.readFileSync(sidecarFile, "utf8");
    assert.ok(raw.includes("needs-revision"), `Expected status in sidecar, got: ${raw.slice(0, 300)}`);
  });
});

describe("create_character_sheet tool", () => {
  test("creates a project-scoped canonical character sheet and indexes it", async () => {
    const text = await callWriteTool("create_character_sheet", {
      name: "Mira Nystrom",
      project_id: "test-novel",
      notes: "Canonical character sheet starter.",
      fields: {
        role: "protagonist",
        traits: ["driven"],
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, "char-mira-nystrom");
    assert.ok(fs.existsSync(parsed.prose_path));
    assert.ok(fs.existsSync(parsed.meta_path));
    assert.ok(fs.existsSync(path.join(path.dirname(parsed.prose_path), "arc.md")));

    const listed = await callWriteTool("list_characters", { project_id: "test-novel" });
    assert.ok(listed.includes("char-mira-nystrom"));
  });

  test("reuses an existing canonical folder and returns exists", async () => {
    const existingDir = path.join(
      writeSyncDir,
      "projects",
      "test-novel",
      "world",
      "characters",
      "leah-quinn"
    );
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, "sheet.md"), "# Leah Quinn\n\nExisting notes.\n", "utf8");

    const text = await callWriteTool("create_character_sheet", {
      name: "Leah Quinn",
      project_id: "test-novel",
      fields: {
        role: "support",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "exists");
    assert.equal(parsed.id, "char-leah-quinn");
    assert.ok(fs.existsSync(parsed.prose_path));
    assert.ok(fs.existsSync(parsed.meta_path));
    assert.ok(fs.existsSync(path.join(path.dirname(parsed.prose_path), "arc.md")));

    const sidecarRaw = fs.readFileSync(parsed.meta_path, "utf8");
    assert.ok(sidecarRaw.includes("character_id: char-leah-quinn"));
  });

  test("does not rewrite existing valid sidecar when no backfill is needed", async () => {
    const existingDir = path.join(
      writeSyncDir,
      "projects",
      "test-novel",
      "world",
      "characters",
      "leah-preserve"
    );
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, "sheet.md"), "# Leah Preserve\n\nExisting notes.\n", "utf8");

    const metaPath = path.join(existingDir, "sheet.meta.yaml");
    const originalMeta = "# keep this comment\ncharacter_id: char-leah-preserve\nname: Leah Preserve\nrole: support\n";
    fs.writeFileSync(metaPath, originalMeta, "utf8");

    const text = await callWriteTool("create_character_sheet", {
      name: "Leah Preserve",
      project_id: "test-novel",
      fields: {
        role: "lead",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "exists");
    assert.equal(parsed.id, "char-leah-preserve");
    assert.equal(fs.readFileSync(metaPath, "utf8"), originalMeta);
  });

  test("returns error and preserves sidecar when existing YAML is invalid", async () => {
    const existingDir = path.join(
      writeSyncDir,
      "projects",
      "test-novel",
      "world",
      "characters",
      "leah-invalid-yaml"
    );
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, "sheet.md"), "# Leah Invalid YAML\n\nExisting notes.\n", "utf8");

    const metaPath = path.join(existingDir, "sheet.meta.yaml");
    const invalidYaml = "name: [unterminated\n";
    fs.writeFileSync(metaPath, invalidYaml, "utf8");

    const text = await callWriteTool("create_character_sheet", {
      name: "Leah Invalid YAML",
      project_id: "test-novel",
      fields: {
        role: "support",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "IO_ERROR");
    assert.ok(parsed.error.message.includes("invalid YAML"));
    assert.equal(fs.readFileSync(metaPath, "utf8"), invalidYaml);
  });

  test("returns error when existing sidecar is not a YAML mapping", async () => {
    const existingDir = path.join(
      writeSyncDir,
      "projects",
      "test-novel",
      "world",
      "characters",
      "leah-array-meta"
    );
    fs.mkdirSync(existingDir, { recursive: true });
    fs.writeFileSync(path.join(existingDir, "sheet.md"), "# Leah Array Meta\n\nExisting notes.\n", "utf8");

    const metaPath = path.join(existingDir, "sheet.meta.yaml");
    fs.writeFileSync(metaPath, "- one\n- two\n", "utf8");

    const text = await callWriteTool("create_character_sheet", {
      name: "Leah Array Meta",
      project_id: "test-novel",
      fields: {
        role: "support",
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "IO_ERROR");
    assert.ok(parsed.error.message.includes("YAML mapping"));
    assert.equal(fs.readFileSync(metaPath, "utf8"), "- one\n- two\n");
  });
});

describe("create_place_sheet tool", () => {
  test("creates a project-scoped canonical place sheet and indexes it", async () => {
    const text = await callWriteTool("create_place_sheet", {
      name: "University Hospital",
      project_id: "test-novel",
      notes: "Canonical place sheet starter.",
      fields: {
        associated_characters: ["elena"],
        tags: ["hospital"],
      },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, "place-university-hospital");
    assert.ok(fs.existsSync(parsed.prose_path));
    assert.ok(fs.existsSync(parsed.meta_path));

    const sheet = await callWriteTool("get_place_sheet", { place_id: "place-university-hospital" });
    assert.ok(sheet.includes("hospital"));
    assert.ok(sheet.includes("Canonical place sheet starter"));
  });
});

describe("flag_scene tool", () => {
  test("attaches a flag note to a scene", async () => {
    const text = await callWriteTool("flag_scene", {
      scene_id: "sc-001",
      project_id: "test-novel",
      note: "Continuity issue: Elena cannot know about the envelope yet.",
    });
    assert.ok(text.toLowerCase().includes("flagged"));
  });

  test("flag persists in sidecar", async () => {
    await callWriteTool("flag_scene", {
      scene_id: "sc-002",
      project_id: "test-novel",
      note: "Pacing is too slow here.",
    });
    // Re-sync and check that flagged scene is still indexed (flag is metadata, doesn't break sync)
    const syncText = await callWriteTool("sync");
    assert.ok(syncText.includes("scenes indexed"));
  });

  test("returns error for unknown scene", async () => {
    const text = await callWriteTool("flag_scene", {
      scene_id: "sc-999",
      project_id: "test-novel",
      note: "Should fail.",
    });
    assert.ok(text.toLowerCase().includes("not found"));
  });
});
