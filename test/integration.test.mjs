/**
 * Integration tests — generate fixture sync data in temp directories,
 * spawn the server as a child process, then call each tool via MCP client.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEST_PORT = 3099;
const WRITE_PORT = 3098;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WRITE_URL = `http://localhost:${WRITE_PORT}`;

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------
let serverProc;
let client;
let writeServerProc;
let writeClient;
let readSyncDir;
let writeSyncDir;
let scrivenerImportDir;

async function waitForServer(url, retries = 20, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

function spawnServer(port, syncDir, extraEnv = {}) {
  const proc = spawn(
    process.execPath,
    ["--experimental-sqlite", path.join(ROOT, "index.js")],
    {
      env: {
        ...process.env,
        WRITING_SYNC_DIR: syncDir,
        DB_PATH: ":memory:",
        HTTP_PORT: String(port),
        ...extraEnv,
      },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  proc.on("error", err => { throw new Error(`Failed to start server: ${err.message}`); });
  return proc;
}

async function connectClient(url) {
  const c = new Client({ name: "integration-test-client", version: "1.0.0" });
  const transport = new SSEClientTransport(new URL(`${url}/sse`));
  await c.connect(transport);
  return c;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function writeFileSyncWithDirs(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createTestSyncFixture(syncDir) {
  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md"),
    `---
scene_id: sc-001
title: The Return
part: 1
chapter: 1
characters: [elena, marcus]
places: [harbor-district]
logline: Elena returns to the harbor district after three years away and runs into Marcus.
save_the_cat: Opening Image
pov: elena
timeline_position: 1
story_time: "Day 1, late afternoon"
tags: [reunion, tension, harbor]
---

The ferry docked at quarter past four, which meant Elena had seventeen minutes before the evening freight shift began and the harbor became impassable. She had timed it deliberately. She did not want to see anyone she knew.

She was at the bottom of the gangway when she heard her name.

Marcus was standing by the storage shed with a clipboard in one hand and an expression she recognized -- the particular look he got when he was pretending not to be surprised. He was very bad at pretending.

"You could have called," he said.

"I could have," she agreed, and kept walking.

He fell into step beside her anyway, which was exactly what she had expected him to do.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.meta.yaml"),
    `scene_id: sc-001
title: The Return
part: 1
chapter: 1
characters:
  - elena
  - marcus
places:
  - harbor-district
logline: >-
  Elena returns to the harbor district after three years away and runs into
  Marcus.
save_the_cat: Opening Image
pov: elena
timeline_position: 1
story_time: 'Day 1, late afternoon'
tags:
  - reunion
  - tension
  - harbor
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md"),
    `---
scene_id: sc-002
title: The Argument
part: 1
chapter: 1
characters: [elena, marcus]
places: [harbor-district]
logline: Elena and Marcus argue about why she left; she deflects, he pushes back harder than before.
save_the_cat: Theme Stated
pov: elena
timeline_position: 2
story_time: "Day 1, evening"
tags: [conflict, backstory, harbor]
---

They ended up at the old bait shed because the wind had picked up and it was the nearest shelter. The shed smelled the same as it always had -- salt and something faintly chemical. Elena had spent half her childhood in this shed. She wished she were somewhere else.

"You didn't call me," Marcus said. "You didn't write. Three years."

"I was busy."

"Everyone is busy. That's not an answer."

She looked at the water instead of him. "It's the one I've got."

He was quiet for a long time. When he spoke again, his voice had changed -- less patient, more tired. "I'm not angry you left, Elena. I'm angry you decided I wouldn't understand."

She didn't have an answer for that either.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.meta.yaml"),
    `scene_id: sc-002
title: The Argument
part: 1
chapter: 1
characters:
  - elena
  - marcus
places:
  - harbor-district
logline: >-
  Elena and Marcus argue about why she left; she deflects, he pushes back harder
  than before.
save_the_cat: Theme Stated
pov: elena
timeline_position: 2
story_time: 'Day 1, evening'
tags:
  - conflict
  - backstory
  - harbor
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.md"),
    `---
scene_id: sc-003
title: The Offer
part: 1
chapter: 2
characters: [elena]
places: [harbor-district]
logline: Elena receives an envelope at her old address -- an offer she doesn't understand yet, but can't ignore.
save_the_cat: Catalyst
pov: elena
timeline_position: 3
story_time: "Day 2, morning"
tags: [mystery, catalyst, solo]
---

The envelope had been slipped under the door of the flat she no longer lived in. The landlord had kept it for her -- "figured you'd be back eventually," he said, in a tone that suggested he had not figured this at all.

Her name was on the front in handwriting she didn't recognize. Inside was a single card with an address across town and a time: 9 p.m., two days from now.

No name. No explanation.

She turned the card over. On the back, in smaller writing: *You know what happened to your father. We do too.*

Elena sat down on the floor of the empty flat and stared at the card for a long time.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.meta.yaml"),
    `scene_id: sc-003
title: The Offer
part: 1
chapter: 2
characters:
  - elena
places:
  - harbor-district
logline: >-
  Elena receives an envelope at her old address -- an offer she doesn't
  understand yet, but can't ignore.
save_the_cat: Catalyst
pov: elena
timeline_position: 3
story_time: 'Day 2, morning'
tags:
  - mystery
  - catalyst
  - solo
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "elena.md"),
    `---
character_id: elena
name: Elena Voss
role: protagonist
traits: [driven, guarded, perceptive, self-sabotaging]
arc_summary: Learns to trust others without losing herself.
first_appearance: sc-001
tags: [main-cast]
---

Elena grew up in the harbor district, the daughter of a dockworker who disappeared when she was twelve. She has spent most of her adult life building walls and calling it independence. Perceptive to a fault -- she sees through people quickly, which makes her both valuable and exhausting to be around.

Her self-sabotaging streak shows up most clearly in relationships. When things get close, she finds a reason to leave first.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "elena.meta.yaml"),
    `character_id: elena
name: Elena Voss
role: protagonist
traits:
  - driven
  - guarded
  - perceptive
  - self-sabotaging
arc_summary: Learns to trust others without losing herself.
first_appearance: sc-001
tags:
  - main-cast
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "marcus.md"),
    `---
character_id: marcus
name: Marcus Hale
role: supporting
traits: [patient, idealistic, stubborn, warm]
arc_summary: Has to decide whether loyalty to Elena is worth the cost to himself.
first_appearance: sc-001
tags: [main-cast]
---

Marcus runs a small freight operation out of the harbor. He has known Elena since they were teenagers and is one of the few people she has never fully pushed away -- not for lack of trying on her part.

He is patient in a way that sometimes reads as passive. He is not passive. He is waiting for the right moment, which he has been doing for approximately fifteen years.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "marcus.meta.yaml"),
    `character_id: marcus
name: Marcus Hale
role: supporting
traits:
  - patient
  - idealistic
  - stubborn
  - warm
arc_summary: Has to decide whether loyalty to Elena is worth the cost to himself.
first_appearance: sc-001
tags:
  - main-cast
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "places", "harbor-district.md"),
    `---
place_id: harbor-district
name: The Harbor District
associated_characters: [elena, marcus]
tags: [urban, working-class, recurring]
---

The harbor district is loud and smells of brine and diesel. The buildings closest to the water are old enough to have survived two floods and a fire. Most of the businesses that used to operate here have moved inland; the ones that remain are either too stubborn or too poor to follow.

It is the kind of place people are from, not the kind of place people choose.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "places", "harbor-district.meta.yaml"),
    `place_id: harbor-district
name: The Harbor District
associated_characters:
  - elena
  - marcus
tags:
  - urban
  - working-class
  - recurring
`
  );
}

function createScrivenerDraftFixture(baseDir) {
  const draftDir = path.join(baseDir, "Draft");
  fs.mkdirSync(draftDir, { recursive: true });

  fs.writeFileSync(
    path.join(draftDir, "001 Scene Arrival [10].txt"),
    "Elena arrives at the station and scans for familiar faces.\n",
    "utf8"
  );

  fs.writeFileSync(path.join(draftDir, "002 -Setup- [11].txt"), "", "utf8");

  fs.writeFileSync(
    path.join(draftDir, "003 Epigraph [12].txt"),
    "A city remembers what its people forget.\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(draftDir, "004 Scene Debate [13].txt"),
    "Marcus challenges Elena's plan in the stairwell.\n",
    "utf8"
  );

  fs.writeFileSync(path.join(draftDir, "005 Chapter Card [14].txt"), "", "utf8");
  fs.writeFileSync(path.join(draftDir, "006 Notes.txt"), "Not in expected filename format.\n", "utf8");
}

before(async () => {
  // Read-only server against generated fixture sync dir
  readSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-read-test-"));
  createTestSyncFixture(readSyncDir);
  serverProc = spawnServer(TEST_PORT, readSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2" });
  await waitForServer(BASE_URL);
  client = await connectClient(BASE_URL);

  // Writable server against a temp copy of generated fixture
  writeSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-test-"));
  copyDirSync(readSyncDir, writeSyncDir);
  writeServerProc = spawnServer(WRITE_PORT, writeSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2" });
  await waitForServer(WRITE_URL);
  writeClient = await connectClient(WRITE_URL);

  scrivenerImportDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-scrivener-import-"));
  createScrivenerDraftFixture(scrivenerImportDir);
});

after(async () => {
  try { await client.close(); } catch {}
  try { await writeClient.close(); } catch {}
  if (serverProc) serverProc.kill();
  if (writeServerProc) writeServerProc.kill();
  if (readSyncDir) fs.rmSync(readSyncDir, { recursive: true, force: true });
  if (writeSyncDir) fs.rmSync(writeSyncDir, { recursive: true, force: true });
  if (scrivenerImportDir) fs.rmSync(scrivenerImportDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.content?.[0]?.text ?? "";
}

async function callWriteTool(name, args = {}) {
  const result = await writeClient.callTool({ name, arguments: args });
  return result.content?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("sync tool", () => {
  test("returns scene indexed count after initial sync", async () => {
    const text = await callTool("sync");
    assert.match(text, /3 scenes indexed/);
  });
});

describe("import_scrivener_sync tool", () => {
  test("dry-run returns machine-readable counts without writing files", async () => {
    const projectId = "import-preview";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.dry_run, true);
    assert.equal(parsed.import.created, 2);
    assert.equal(parsed.import.existing, 0);
    assert.equal(parsed.import.skipped, 3);
    assert.equal(parsed.import.beat_markers_seen, 1);
    assert.equal(parsed.sync, null);
    assert.equal(fs.existsSync(scenesDir), false);
  });

  test("non-dry-run writes sidecars and returns counts", async () => {
    const projectId = "import-apply";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.dry_run, false);
    assert.equal(parsed.import.created, 2);
    assert.equal(parsed.import.existing, 0);
    assert.equal(parsed.import.skipped, 3);
    assert.equal(parsed.import.beat_markers_seen, 1);
    assert.equal(parsed.sync, null);

    assert.equal(fs.existsSync(scenesDir), true);
    const files = fs.readdirSync(scenesDir);
    const sidecars = files.filter(name => name.endsWith(".meta.yaml"));
    assert.equal(sidecars.length, 2);
    assert.ok(sidecars.some(name => name.includes("001 Scene Arrival [10].meta.yaml")));
    assert.ok(sidecars.some(name => name.includes("004 Scene Debate [13].meta.yaml")));
  });

  test("rejects path traversal in project_id", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "../../escape",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_PROJECT_ID");
  });

  test("rejects non-slug project_id segments", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "my_universe/MyProject",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_PROJECT_ID");
  });

  test("universe-scoped project_id routes to universes/<universe>/<project>/scenes", async () => {
    const projectId = "aether/book-one";
    const expectedScenesDir = path.join(writeSyncDir, "universes", "aether", "book-one", "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.project_id, projectId);
    assert.equal(parsed.import.scenes_dir, expectedScenesDir);
    assert.equal(fs.existsSync(expectedScenesDir), true);
    const sidecars = fs.readdirSync(expectedScenesDir).filter(n => n.endsWith(".meta.yaml"));
    assert.equal(sidecars.length, 2);
  });
});

describe("get_runtime_config tool", () => {
  test("returns active runtime paths and capability flags", async () => {
    const text = await callTool("get_runtime_config");
    const parsed = JSON.parse(text);

    assert.equal(parsed.sync_dir, readSyncDir);
    assert.equal(parsed.db_path, ":memory:");
    assert.equal(parsed.http_port, TEST_PORT);

    assert.equal(typeof parsed.sync_dir_writable, "boolean");
    assert.equal(typeof parsed.git_available, "boolean");
    assert.equal(typeof parsed.git_enabled, "boolean");
  });
});

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
    assert.ok(text.toLowerCase().includes("not found"));
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
    assert.ok(text.includes("driven") || text.includes("walls"),
      `Expected trait keywords for elena, got: ${text.slice(0, 200)}`);
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
});

describe("search_metadata tool", () => {
  test("search envelope returns sc-003 (logline)", async () => {
    const text = await callTool("search_metadata", { query: "envelope" });
    assert.ok(text.includes("sc-003"));
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

describe("list_threads tool", () => {
  test("returns structured empty result when none created", async () => {
    const text = await callTool("list_threads", { project_id: "test-novel" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.project_id, "test-novel");
    assert.equal(parsed.total_count, 0);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.results.length, 0);
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
  });
});

describe("thread arc tool", () => {
  test("returns not-found message for unknown thread", async () => {
    const text = await callTool("get_thread_arc", { thread_id: "thread-does-not-exist" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
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

describe("enrich_scene tool", () => {
  test("returns not-found envelope for unknown scene", async () => {
    const text = await callWriteTool("enrich_scene", { scene_id: "sc-999", project_id: "test-novel" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "NOT_FOUND");
  });

  test("clears stale warning after re-enrichment", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nFresh prose delta for enrich_scene test.\n`, "utf8");

    await callWriteTool("sync");
    const staleArcText = await callWriteTool("get_arc", { character_id: "elena" });
    const staleArc = JSON.parse(staleArcText);
    assert.ok(staleArc.warning);

    const enrichText = await callWriteTool("enrich_scene", { scene_id: "sc-001", project_id: "test-novel" });
    const enrich = JSON.parse(enrichText);
    assert.equal(enrich.ok, true);
    assert.equal(enrich.action, "enriched");
    assert.equal(enrich.scene_id, "sc-001");

    const freshArcText = await callWriteTool("get_arc", { character_id: "elena" });
    const freshArc = JSON.parse(freshArcText);
    assert.equal(freshArc.warning, undefined);
  });
});

describe("api contract resilience", () => {
  test("returns envelope with results + total_count across paginated tools", async () => {
    const fsText = await callTool("find_scenes", { page_size: 1, page: 1 });
    const gaText = await callTool("get_arc", { character_id: "elena", page_size: 1, page: 1 });
    const smText = await callTool("search_metadata", { query: "envelope", page_size: 1, page: 1 });
    const ltText = await callTool("list_threads", { project_id: "test-novel", page_size: 1, page: 1 });

    const rows = [JSON.parse(fsText), JSON.parse(gaText), JSON.parse(smText), JSON.parse(ltText)];
    for (const row of rows) {
      assert.ok("results" in row);
      assert.ok("total_count" in row);
      assert.ok(Array.isArray(row.results));
    }
  });

  test("sets warning after prose edit marks scene metadata stale", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nStale marker line for integration test.\n`, "utf8");

    const syncText = await callWriteTool("sync");
    assert.ok(syncText.includes("marked stale"));

    const arcText = await callWriteTool("get_arc", { character_id: "elena" });
    const arc = JSON.parse(arcText);
    assert.ok(arc.warning);
    assert.ok(arc.warning.toLowerCase().includes("stale metadata"));
  });

  test("returns structured get_thread_arc payload for existing thread", async () => {
    await callWriteTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-test-arc",
      thread_name: "Arc Thread",
      scene_id: "sc-001",
      beat: "Start",
    });
    await callWriteTool("upsert_thread_link", {
      project_id: "test-novel",
      thread_id: "thread-test-arc",
      thread_name: "Arc Thread",
      scene_id: "sc-003",
      beat: "Progress",
    });

    const text = await callWriteTool("get_thread_arc", { thread_id: "thread-test-arc", page_size: 10, page: 1 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.thread.thread_id, "thread-test-arc");
    assert.equal(parsed.total_count, 2);
    assert.equal(Array.isArray(parsed.results), true);
    assert.equal(parsed.results[0].scene_id, "sc-001");
    assert.equal(parsed.results[1].scene_id, "sc-003");
  });
});

describe("error envelope consistency", () => {
  test("uses uniform envelope for not-found, no-results, and read-only errors", async () => {
    const cases = [
      { text: await callTool("get_scene_prose", { scene_id: "sc-999" }), code: "NOT_FOUND" },
      { text: await callTool("search_metadata", { query: "dragons" }), code: "NO_RESULTS" },
      { text: await callTool("get_thread_arc", { thread_id: "thread-does-not-exist" }), code: "NOT_FOUND" },
      {
        text: await callWriteTool("update_scene_metadata", {
          scene_id: "sc-999",
          project_id: "test-novel",
          fields: { logline: "read-only test" },
        }),
        code: "NOT_FOUND",
      },
    ];

    for (const c of cases) {
      const parsed = JSON.parse(c.text);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error);
      assert.equal(parsed.error.code, c.code);
      assert.equal(typeof parsed.error.message, "string");
      assert.ok(parsed.error.message.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Write-back tools (against writable server)
// ---------------------------------------------------------------------------
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

describe("get_relationship_arc tool", () => {
  test("returns no data message when no relationships exist", async () => {
    const text = await callTool("get_relationship_arc", {
      from_character: "elena",
      to_character: "marcus",
    });
    assert.ok(text.toLowerCase().includes("no relationship data"));
  });
});

describe("commit_edit preflight diagnostics", () => {
  test("returns STALE_PATH when indexed prose file is missing", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Tighten opening paragraph",
      revised_prose: "Revised prose for stale path test.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const originalContent = fs.readFileSync(scenePath, "utf8");
    try {
      fs.unlinkSync(scenePath);

      const commitText = await callWriteTool("commit_edit", {
        scene_id: "sc-001",
        proposal_id: proposal.proposal_id,
      });
      const commitResult = JSON.parse(commitText);

      assert.equal(commitResult.ok, false);
      assert.equal(commitResult.error.code, "STALE_PATH");
      assert.equal(commitResult.error.details?.prose_write_diagnostics?.exists, false);
    } finally {
      if (!fs.existsSync(scenePath)) {
        fs.writeFileSync(scenePath, originalContent, "utf8");
      }
    }
  });

  test("returns INVALID_PROSE_PATH when indexed prose path points to a directory", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-003",
      instruction: "Try writing to non-file path",
      revised_prose: "Revised prose for invalid path test.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const originalScenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.md");
    const replacementPath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003-original.md");
    try {
      fs.renameSync(originalScenePath, replacementPath);
      fs.mkdirSync(originalScenePath, { recursive: true });

      const commitText = await callWriteTool("commit_edit", {
        scene_id: "sc-003",
        proposal_id: proposal.proposal_id,
      });
      const commitResult = JSON.parse(commitText);

      assert.equal(commitResult.ok, false);
      assert.equal(commitResult.error.code, "INVALID_PROSE_PATH");
      assert.equal(commitResult.error.details?.prose_write_diagnostics?.is_file, false);
    } finally {
      if (fs.existsSync(originalScenePath) && fs.statSync(originalScenePath).isDirectory()) {
        fs.rmSync(originalScenePath, { recursive: true, force: true });
      }
      if (fs.existsSync(replacementPath) && !fs.existsSync(originalScenePath)) {
        fs.renameSync(replacementPath, originalScenePath);
      }
    }
  });
});
