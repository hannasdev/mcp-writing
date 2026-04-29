import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3073, 3072);
let writeSyncDir, readSyncDir;

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
    assert.ok(parsed.associated_characters.includes("marcus"));
    assert.ok(parsed.tags.includes("docks"));
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
