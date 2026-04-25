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
import yaml from "js-yaml";

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
let scrivenerProjectDir;

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

async function waitForExit(proc, timeoutMs = 5000) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Process did not exit in time")), timeoutMs);
    proc.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
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
  - Daniel Nystrom
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

Elena Voss sat down on the floor of the empty flat and stared at the card for a long time.
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

function createScrivenerProjectBundleFixture(baseDir) {
  const scrivDir = path.join(baseDir, "Sebastian the Vampire.scriv");
  const scrivxPath = path.join(scrivDir, "Sebastian the Vampire.scrivx");
  fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-10"), { recursive: true });
  fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-13"), { recursive: true });

  fs.writeFileSync(
    path.join(scrivDir, "Files", "Data", "UUID-10", "synopsis.txt"),
    "Elena arrives at the station and scans for familiar faces.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(scrivDir, "Files", "Data", "UUID-13", "synopsis.txt"),
    "Marcus challenges Elena's plan in the stairwell.\n",
    "utf8"
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-10">10</SyncItem>
    <SyncItem ID="UUID-13">13</SyncItem>
  </ExternalSyncMap>
  <Keywords>
    <Keyword ID="kw-elena"><Title>Elena Voss</Title></Keyword>
    <Keyword ID="kw-version"><Title>v1.1</Title></Keyword>
  </Keywords>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-1">
              <Title>Arrival</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-10">
                  <Keywords>
                    <KeywordID>kw-elena</KeywordID>
                    <KeywordID>kw-version</KeywordID>
                  </Keywords>
                  <MetaData>
                    <MetaDataItem><FieldID>savethecat!</FieldID><Value>Setup</Value></MetaDataItem>
                    <MetaDataItem><FieldID>causality</FieldID><Value>2</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:character</FieldID><Value>Yes</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
                <BinderItem Type="Text" UUID="UUID-13">
                  <MetaData>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>3</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

  fs.mkdirSync(scrivDir, { recursive: true });
  fs.writeFileSync(scrivxPath, xml, "utf8");
  return scrivDir;
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

  const scrivenerProjectBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-scrivener-project-"));
  scrivenerProjectDir = createScrivenerProjectBundleFixture(scrivenerProjectBaseDir);
});

after(async () => {
  try { await client.close(); } catch {}
  try { await writeClient.close(); } catch {}
  if (serverProc) serverProc.kill();
  if (writeServerProc) writeServerProc.kill();
  if (readSyncDir) fs.rmSync(readSyncDir, { recursive: true, force: true });
  if (writeSyncDir) fs.rmSync(writeSyncDir, { recursive: true, force: true });
  if (scrivenerImportDir) fs.rmSync(scrivenerImportDir, { recursive: true, force: true });
  if (scrivenerProjectDir) fs.rmSync(path.dirname(scrivenerProjectDir), { recursive: true, force: true });
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

async function waitForAsyncJob(jobId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await callWriteTool("get_async_job_status", { job_id: jobId });
    const parsed = JSON.parse(text);
    const status = parsed.job?.status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      return parsed;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for async job ${jobId}`);
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

describe("setup_prose_styleguide_config tool", () => {
  test("writes a sync-root styleguide config from language defaults", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_us",
      voice_notes: "Fast-paced thriller voice.",
      overwrite: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scope, "sync_root");
    assert.equal(parsed.config.language, "english_us");
    assert.equal(parsed.config.spelling, "us");
    assert.equal(parsed.config.voice_notes, "Fast-paced thriller voice.");

    assert.equal(typeof parsed.file_path, "string");
    assert.equal(parsed.file_path.length > 0, true);
  });

  test("requires project_id for project_root scope", async () => {
    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      language: "english_uk",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "PROJECT_ID_REQUIRED");
  });

  test("writes a project-root config for a simple project ID", async () => {
    const projectId = "styleguide-test-proj";

    const text = await callWriteTool("setup_prose_styleguide_config", {
      scope: "project_root",
      project_id: projectId,
      language: "english_uk",
      overrides: { tense: "past", pov: "first" },
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scope, "project_root");
    assert.equal(parsed.config.language, "english_uk");
    assert.equal(parsed.config.tense, "past");
    assert.equal(parsed.config.pov, "first");
    assert.equal(parsed.config.spelling, "uk");
  });
});

describe("get_prose_styleguide_config tool", () => {
  test("returns setup_required when no styleguide config exists", async () => {
    const rootConfigPath = path.join(writeSyncDir, "prose-styleguide.config.yaml");
    fs.rmSync(rootConfigPath, { force: true });

    const text = await callWriteTool("get_prose_styleguide_config");
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.styleguide.setup_required, true);
    assert.equal(parsed.styleguide.config_found, false);
    assert.equal(parsed.styleguide.resolved_config, null);
  });

  test("resolves root, universe, and project config precedence", async () => {
    const projectId = "aether/book-one";
    const universeDir = path.join(writeSyncDir, "universes", "aether");
    const projectDir = path.join(universeDir, "book-one");
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(writeSyncDir, "prose-styleguide.config.yaml"),
      "language: english_uk\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(universeDir, "prose-styleguide.config.yaml"),
      "dialogue_tags: expressive\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(projectDir, "prose-styleguide.config.yaml"),
      [
        "dialogue_tags: minimal",
        "sentence_fragments: intentional",
      ].join("\n"),
      "utf8"
    );

    const text = await callWriteTool("get_prose_styleguide_config", { project_id: projectId });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.styleguide.setup_required, false);
    assert.equal(parsed.styleguide.sources.length, 3);
    assert.equal(parsed.styleguide.resolved_config.language, "english_uk");
    assert.equal(parsed.styleguide.resolved_config.quotation_style, "single");
    assert.equal(parsed.styleguide.resolved_config.quotation_style_nested, "double");
    assert.equal(parsed.styleguide.resolved_config.dialogue_tags, "minimal");
    assert.equal(parsed.styleguide.resolved_config.sentence_fragments, "intentional");
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

describe("merge_scrivener_project_beta tool", () => {
  test("completes and returns merge payload with dry-run", async () => {
    const projectId = "direct-beta-preview";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(started.beta, undefined);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.beta, undefined);
    assert.equal(done.job.result.merge.project_id, projectId);
    assert.equal(done.job.result.merge.dry_run, true);
    assert.equal(done.job.result.merge.sidecar_files, 2);
    assert.equal(done.job.result.merge.updated, 2);
    assert.ok(done.job.result.merge.field_add_counts.synopsis >= 1);
    assert.ok(Array.isArray(done.job.result.merge.preview_changes));
  });

  test("returns structured fallback guidance on parser/path failure", async () => {
    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: "/tmp/does-not-exist-for-mcp-writing-tests.scriv",
      project_id: "direct-beta-preview",
      dry_run: true,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "failed");
    assert.equal(done.job.result.ok, false);
    const errorCode = done.job.result.error.code;
    assert.ok(
      errorCode === "SCRIVENER_DIRECT_BETA_FAILED" || errorCode === "ASYNC_JOB_FAILED",
      `Unexpected error code: ${errorCode}`
    );
    const fallback = done.job.result.error.details?.fallback
      ?? done.job.result.error.details?.cause?.details?.fallback;
    assert.ok(typeof fallback === "string" && fallback.includes("import_scrivener_sync"));
  });

  test("returns structured warning summary for skipped beta merge sidecars", async () => {
    const projectId = "direct-beta-warnings";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    fs.writeFileSync(
      path.join(scenesDir, "Loose Notes.meta.yaml"),
      "scene_id: sc-loose\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(scenesDir, "999 Missing Mapping [999].meta.yaml"),
      "scene_id: sc-999\n",
      "utf8"
    );

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.merge.warning_summary.missing_bracket_id.count, 1);
    assert.equal(done.job.result.merge.warning_summary.missing_uuid_mapping.count, 1);
    assert.ok(done.job.result.merge.warnings.some(w => w.code === "missing_bracket_id"));
    assert.ok(done.job.result.merge.warnings.some(w => w.code === "missing_uuid_mapping" && w.sync_number === "999"));
  });

  test("returns ambiguity warning taxonomy for conflicting sidecar mappings", async () => {
    const projectId = "direct-beta-ambiguity";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");
    const primarySidecarFilename = fs.readdirSync(scenesDir).find(name => /\[\d+\]\.meta\.yaml$/.test(name));
    assert.ok(primarySidecarFilename, "Expected imported sidecar with bracketed sync marker");
    const primarySidecarPath = path.join(scenesDir, primarySidecarFilename);
    const primarySidecar = yaml.load(fs.readFileSync(primarySidecarPath, "utf8"));
    fs.writeFileSync(
      primarySidecarPath,
      yaml.dump(
        {
          ...primarySidecar,
          chapter: 9,
          synopsis: "Conflicting sidecar synopsis",
          external_source: "manual",
        },
        { lineWidth: 120 }
      ),
      "utf8"
    );

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_identity_tie.count, 1);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_structure_mapping.count, 1);
    assert.equal(done.job.result.merge.warning_summary.ambiguous_metadata_mapping.count, 1);
  });

  test("scenes_dir override uses explicit path instead of project_id-derived path", async () => {
    const projectId = "solar/book-alpha";
    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const derivedScenesDir = path.join(writeSyncDir, "universes", "solar", "book-alpha", "scenes");
    assert.equal(fs.existsSync(derivedScenesDir), true);

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      scenes_dir: derivedScenesDir,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.scenes_dir, derivedScenesDir);
    assert.equal(done.job.result.merge.sidecar_files, 2);
    assert.equal(done.job.result.merge.updated, 2);
  });

  test("scenes_dir takes priority over project_id when both are supplied", async () => {
    const projectId = "solar/book-beta";
    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const actualScenesDir = path.join(writeSyncDir, "universes", "solar", "book-beta", "scenes");

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: "solar/nonexistent-project",
      scenes_dir: actualScenesDir,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.scenes_dir, actualScenesDir);
    assert.equal(done.job.result.merge.sidecar_files, 2);
  });

  test("idempotent: second merge run finds no updates", async () => {
    const projectId = "direct-beta-idempotent";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    // First merge with write
    const firstStartText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });
    const firstStarted = JSON.parse(firstStartText);
    const firstDone = await waitForAsyncJob(firstStarted.job.job_id);
    assert.equal(firstDone.ok, true);
    assert.equal(firstDone.job.result.merge.updated, 2);

    // Second merge with dry-run should find no changes
    const secondStartText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const secondStarted = JSON.parse(secondStartText);
    const secondDone = await waitForAsyncJob(secondStarted.job.job_id);

    assert.equal(secondDone.ok, true);
    assert.equal(secondDone.job.result.merge.updated, 0);
    assert.equal(secondDone.job.result.merge.unchanged, secondDone.job.result.merge.sidecar_files);
    assert.deepEqual(secondDone.job.result.merge.field_add_counts, {});
    assert.deepEqual(secondDone.job.result.merge.preview_changes, []);
  });

  test("organize_by_chapters: true relocates scenes into chapter folders", async () => {
    const projectId = "direct-beta-relocate";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
      organize_by_chapters: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.ok(done.job.result.merge.relocated >= 2);

    const relocatedScenePath = path.join(
      writeSyncDir,
      "projects",
      projectId,
      "scenes",
      "part-1",
      "chapter-1-arrival",
      "001 Scene Arrival [10].txt"
    );
    const relocatedMetaPath = relocatedScenePath.replace(/\.txt$/, ".meta.yaml");
    assert.equal(fs.existsSync(relocatedScenePath), true);
    assert.equal(fs.existsSync(relocatedMetaPath), true);

    const scenesText = await callWriteTool("find_scenes", { project_id: projectId });
    const scenes = JSON.parse(scenesText);
    assert.equal(scenes[0].chapter, 1);
    assert.equal(scenes[0].chapter_title, "Arrival");
  });

  test("organize_by_chapters: false keeps scenes in place", async () => {
    const projectId = "direct-beta-no-organize";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: false,
    });

    const startText = await callWriteTool("merge_scrivener_project_beta", {
      source_project_dir: scrivenerProjectDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
      organize_by_chapters: false,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.result.merge.relocated, 0);

    const originalScenePath = path.join(
      writeSyncDir,
      "projects",
      projectId,
      "scenes",
      "001 Scene Arrival [10].txt"
    );
    const originalMetaPath = originalScenePath.replace(/\.txt$/, ".meta.yaml");
    assert.equal(fs.existsSync(originalScenePath), true);
    assert.equal(fs.existsSync(originalMetaPath), true);

    const scenesText = await callWriteTool("find_scenes", { project_id: projectId });
    const scenes = JSON.parse(scenesText);
    assert.equal(scenes[0].chapter, 1);
  });
});


describe("async import/merge job tools", () => {
  test("import_scrivener_sync_async completes and returns import payload", async () => {
    const projectId = "async-import-preview";
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.import.project_id, projectId);
    assert.equal(done.job.result.import.created, 2);
  });

  test("cancel_async_job sets transitional 'cancelling' status and resolves to terminal state", async () => {
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "cancel-semantics-test",
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    const cancelText = await callWriteTool("cancel_async_job", {
      job_id: started.job.job_id,
    });
    const cancelResult = JSON.parse(cancelText);
    assert.equal(cancelResult.ok, true);

    if (cancelResult.cancelled === true) {
      // cancellation was accepted — status must be transitional, not yet finalised
      assert.equal(
        cancelResult.job.status,
        "cancelling",
        `cancel_async_job must return 'cancelling' (got '${cancelResult.job.status}'); ` +
          "setting 'cancelled' immediately is the pre-fix optimistic bug."
      );
    } else {
      // job already reached a terminal state before signal was delivered — acceptable race
      assert.ok(
        ["completed", "failed", "cancelled"].includes(cancelResult.job.status),
        `Expected terminal status, got '${cancelResult.job.status}'`
      );
    }

    // Regardless of race, polling must eventually reach a terminal state
    const done = await waitForAsyncJob(started.job.job_id);
    assert.ok(done.ok, "get_async_job_status must succeed");
    assert.ok(
      ["completed", "cancelled"].includes(done.job.status),
      `Expected 'completed' or 'cancelled', got '${done.job.status}'`
    );
  });

  test("cancel_async_job on already-completed job returns cancelled: false without mutation", async () => {
    const startText = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "cancel-after-done-test",
      dry_run: true,
      auto_sync: false,
    });
    const started = JSON.parse(startText);
    assert.equal(started.ok, true);

    // Wait for job to complete
    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.job.status, "completed");

    // Now cancel the completed job
    const cancelText = await callWriteTool("cancel_async_job", {
      job_id: started.job.job_id,
    });
    const cancelResult = JSON.parse(cancelText);
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.cancelled, false);
    assert.equal(cancelResult.job.status, "completed", "completed status must not be overwritten");
  });


  test("preflight returns file list without writing anything", async () => {
    const projectId = "preflight-test";
    const scenesDir = path.join(writeSyncDir, "projects", projectId, "scenes");

    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      preflight: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.preflight, true);
    assert.equal(typeof parsed.import.files_to_process, "number");
    assert.ok(Array.isArray(parsed.import.file_previews));
    assert.equal(fs.existsSync(scenesDir), false, "preflight must not write any files");
    assert.equal(parsed.next_step.includes("preflight"), true);
  });

  test("ignore_patterns excludes matching filenames from import", async () => {
    const projectId = "ignore-patterns-test";

    // Without ignore: 2 scenes created (Arrival [10] and Debate [13])
    const baseText = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId + "-base",
      dry_run: true,
    });
    const baseParsed = JSON.parse(baseText);
    const baseCreated = baseParsed.import.created;

    // With ignore pattern targeting "Arrival" filename
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: true,
      ignore_patterns: ["Arrival"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.import.ignored_files, 1);
    assert.equal(parsed.import.created, baseCreated - 1);
  });

  test("invalid ignore_patterns returns INVALID_IGNORE_PATTERN (sync)", async () => {
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: "invalid-ignore-sync",
      dry_run: true,
      ignore_patterns: ["[unterminated"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_IGNORE_PATTERN");
  });

  test("invalid ignore_patterns returns INVALID_IGNORE_PATTERN (async)", async () => {
    const text = await callWriteTool("import_scrivener_sync_async", {
      source_dir: scrivenerImportDir,
      project_id: "invalid-ignore-async",
      dry_run: true,
      ignore_patterns: ["[unterminated"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "INVALID_IGNORE_PATTERN");
  });
});

describe("enrich_scene_characters_batch tool", () => {
  test("requires confirm_replace when replace_mode=replace", async () => {
    const text = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      replace_mode: "replace",
      dry_run: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
  });

  test("runs async dry-run and returns batch result payload", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      dry_run: true,
      include_match_details: true,
    });
    const started = JSON.parse(startText);

    assert.equal(started.ok, true);
    assert.equal(started.async, true);
    assert.equal(typeof started.job.job_id, "string");

    const done = await waitForAsyncJob(started.job.job_id);
    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.project_id, "test-novel");
    assert.equal(typeof done.job.result.total_scenes, "number");
    assert.equal(typeof done.job.result.processed_scenes, "number");
    assert.ok(Array.isArray(done.job.result.results));
    assert.equal(typeof done.job.progress?.total_scenes, "number");
    assert.equal(typeof done.job.progress?.processed_scenes, "number");
    assert.equal(done.job.progress?.processed_scenes, done.job.result.processed_scenes);
  });

  test("returns completed async job with total_scenes=0 when filters match nothing", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      part: 99,
      dry_run: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.total_scenes, 0);
    assert.equal(done.job.result.processed_scenes, 0);
    assert.deepEqual(done.job.result.results, []);
  });

  test("returns completed zero-target job with explicit warning when project_id is unknown", async () => {
    await callWriteTool("sync");

    const startText = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "project-does-not-exist",
      dry_run: true,
    });
    const started = JSON.parse(startText);
    const done = await waitForAsyncJob(started.job.job_id);

    assert.equal(done.ok, true);
    assert.equal(done.job.status, "completed");
    assert.equal(done.job.result.ok, true);
    assert.equal(done.job.result.total_scenes, 0);
    assert.equal(done.job.result.processed_scenes, 0);
    assert.equal(typeof done.job.result.warning, "string");
    assert.ok(done.job.result.warning.includes("PROJECT_NOT_FOUND_WARNING"));
  });

  test("returns VALIDATION_ERROR when resolved scenes exceed max_scenes", async () => {
    await callWriteTool("sync");

    const text = await callWriteTool("enrich_scene_characters_batch", {
      project_id: "test-novel",
      part: 1,
      dry_run: true,
      max_scenes: 1,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION_ERROR");
    assert.equal(parsed.error.details.max_scenes, 1);
  });

  test("applies scene_ids allowlist before part/chapter/only_stale narrowing", async () => {
    await callWriteTool("sync");

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");

    try {
      fs.writeFileSync(scenePath, `${before}\n\nStale marker for filter precedence test.\n`, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        scene_ids: ["sc-002", "sc-003"],
        chapter: 1,
        only_stale: true,
        dry_run: true,
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.total_scenes, 1);
      assert.equal(done.job.result.results[0].scene_id, "sc-002");
    } finally {
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("dry_run=false updates sidecar links and scene_characters index", async () => {
    await callWriteTool("sync");

    const sceneMetaPath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.meta.yaml");
    const originalMeta = fs.readFileSync(sceneMetaPath, "utf8");

    try {
      // Remove Elena link from sidecar and re-sync to drop it from index.
      const modifiedMeta = originalMeta.replace(/characters:\n(?:\s*- .*\n)+/, "characters: []\n");
      fs.writeFileSync(sceneMetaPath, modifiedMeta, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        scene_ids: ["sc-003"],
        dry_run: false,
        replace_mode: "merge",
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.ok, true);
      assert.equal(done.job.result.scenes_changed, 1);
      assert.equal(done.job.result.links_added >= 1, true);

      // Ensure parent index is refreshed before asserting link visibility.
      await callWriteTool("sync");

      const afterText = await callWriteTool("find_scenes", {
        project_id: "test-novel",
        character: "elena",
        page_size: 10,
      });
      const after = JSON.parse(afterText);
      assert.ok(after.results.some(r => r.scene_id === "sc-003"));
    } finally {
      fs.writeFileSync(sceneMetaPath, originalMeta, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-003", project_id: "test-novel" });
    }
  });

  test("only_stale=true scopes processing to stale scenes", async () => {
    await callWriteTool("sync");

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");

    try {
      fs.writeFileSync(scenePath, `${before}\n\nStale marker for only_stale batch test.\n`, "utf8");
      await callWriteTool("sync");

      const startText = await callWriteTool("enrich_scene_characters_batch", {
        project_id: "test-novel",
        part: 1,
        chapter: 1,
        only_stale: true,
        dry_run: true,
      });
      const started = JSON.parse(startText);
      const done = await waitForAsyncJob(started.job.job_id);

      assert.equal(done.ok, true);
      assert.equal(done.job.status, "completed");
      assert.equal(done.job.result.total_scenes, 1);
      assert.equal(done.job.result.results[0].scene_id, "sc-002");
    } finally {
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("sync");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("returns READ_ONLY when write mode is requested on read-only runtime", async () => {
    const roPort = 3096;
    const roUrl = `http://localhost:${roPort}`;
    const roSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-readonly-"));
    copyDirSync(writeSyncDir, roSyncDir);
    fs.chmodSync(roSyncDir, 0o555);

    const roProc = spawnServer(roPort, roSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2" });
    let roClient;
    try {
      await waitForServer(roUrl);
      roClient = await connectClient(roUrl);
      const result = await roClient.callTool({
        name: "enrich_scene_characters_batch",
        arguments: {
          project_id: "test-novel",
          dry_run: false,
        },
      });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "READ_ONLY");
    } finally {
      try { await roClient?.close(); } catch {}
      if (roProc) roProc.kill();
      try { fs.chmodSync(roSyncDir, 0o755); } catch {}
      fs.rmSync(roSyncDir, { recursive: true, force: true });
    }
  });

  test("cancellation retains partial results for batch jobs when cancellation lands mid-run", async () => {
    const isolatedPort = 3197;
    const isolatedUrl = `http://localhost:${isolatedPort}`;
    const isolatedSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-cancel-"));
    const projectId = "cancel-batch-test";
    const projectRoot = path.join(isolatedSyncDir, "projects", projectId);
    const scenesDir = path.join(projectRoot, "scenes");
    const charsDir = path.join(projectRoot, "world", "characters");
    let isolatedProc;
    let isolatedClient;

    async function callIsolatedTool(name, args = {}) {
      const result = await isolatedClient.callTool({ name, arguments: args });
      return result.content[0].text;
    }

    fs.mkdirSync(scenesDir, { recursive: true });
    fs.mkdirSync(charsDir, { recursive: true });
    fs.writeFileSync(
      path.join(charsDir, "elena.md"),
      `---\ncharacter_id: elena\nname: Elena Vasquez\nrole: protagonist\n---\nCharacter notes.\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(charsDir, "elena.meta.yaml"),
      `character_id: elena\nname: Elena Vasquez\nrole: protagonist\n`,
      "utf8"
    );

    for (let index = 1; index <= 1000; index += 1) {
      const sceneId = `sc-${String(index).padStart(3, "0")}`;
      fs.writeFileSync(
        path.join(scenesDir, `${sceneId}.md`),
        `---\nscene_id: ${sceneId}\ntitle: ${sceneId}\npart: 1\nchapter: 1\npov: elena\n---\nElena Vasquez reviews scene ${index}.\n`,
        "utf8"
      );
      fs.writeFileSync(
        path.join(scenesDir, `${sceneId}.meta.yaml`),
        `scene_id: ${sceneId}\ntitle: ${sceneId}\npart: 1\nchapter: 1\ncharacters: []\n`,
        "utf8"
      );
    }

    try {
      isolatedProc = spawnServer(isolatedPort, isolatedSyncDir, {
        MCP_WRITING_SCENE_CHARACTER_BATCH_DELAY_MS: "2",
      });
      await waitForServer(isolatedUrl);
      isolatedClient = await connectClient(isolatedUrl);
      await callIsolatedTool("sync");

      const startText = await callIsolatedTool("enrich_scene_characters_batch", {
        project_id: projectId,
        dry_run: true,
        max_scenes: 2000,
      });
      const started = JSON.parse(startText);
      assert.equal(started.ok, true);

      let status;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const statusText = await callIsolatedTool("get_async_job_status", {
          job_id: started.job.job_id,
        });
        status = JSON.parse(statusText);
        if ((status.job?.progress?.processed_scenes ?? 0) > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      assert.ok(
        (status?.job?.progress?.processed_scenes ?? 0) > 0,
        "Cancellation test requires observed batch progress before cancel_async_job is called."
      );

      const cancelText = await callIsolatedTool("cancel_async_job", {
        job_id: started.job.job_id,
      });
      const cancelResult = JSON.parse(cancelText);
      assert.equal(cancelResult.ok, true);
      assert.equal(cancelResult.cancelled, true);

      let done;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const statusText = await callIsolatedTool("get_async_job_status", {
          job_id: started.job.job_id,
        });
        done = JSON.parse(statusText);
        if (done.job?.status === "cancelled") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      assert.equal(done.job?.status, "cancelled");
      assert.equal(done.job.result?.cancelled, true);
      assert.ok(Array.isArray(done.job.result?.results));
      assert.equal(done.job.result.results.length, done.job.result.processed_scenes);
      assert.ok(done.job.result.processed_scenes < done.job.result.total_scenes);
    } finally {
      try { await isolatedClient?.close(); } catch {}
      if (isolatedProc) {
        isolatedProc.kill();
        try { await waitForExit(isolatedProc); } catch {}
      }
      fs.rmSync(isolatedSyncDir, { recursive: true, force: true });
    }
  });
});

describe("sync warning_summary", () => {
  test("sync response includes warning_summary instead of raw warning list for import+sync", async () => {
    const projectId = "warning-summary-test";

    await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
    });

    // Run a standalone sync to get a structured result
    const text = await callWriteTool("import_scrivener_sync", {
      source_dir: scrivenerImportDir,
      project_id: projectId,
      dry_run: false,
      auto_sync: true,
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    if (parsed.sync !== null) {
      assert.ok(typeof parsed.sync.warning_summary === "object", "warning_summary should be an object");
      assert.equal("warnings" in parsed.sync, false, "raw warnings list should not appear in sync response");
    }
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
    assert.equal(parsed.ownership_guard_mode, "warn");
    assert.equal(typeof parsed.permission_diagnostics, "object");
    assert.ok(Array.isArray(parsed.runtime_warnings));
    assert.ok(Array.isArray(parsed.setup_recommendations));
  });

  test("falls back to warn and returns warning for invalid OWNERSHIP_GUARD_MODE", async () => {
    const invalidPort = 3097;
    const invalidUrl = `http://localhost:${invalidPort}`;
    const invalidProc = spawnServer(invalidPort, readSyncDir, { OWNERSHIP_GUARD_MODE: "banana" });
    let invalidClient;

    try {
      await waitForServer(invalidUrl);
      invalidClient = await connectClient(invalidUrl);
      const result = await invalidClient.callTool({ name: "get_runtime_config", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");

      assert.equal(parsed.ownership_guard_mode, "warn");
      assert.ok((parsed.runtime_warnings ?? []).some(w => w.includes("OWNERSHIP_GUARD_MODE_INVALID")));
    } finally {
      try { await invalidClient?.close(); } catch {}
      if (invalidProc) invalidProc.kill();
    }
  });

  test("normalizes trimmed/uppercased OWNERSHIP_GUARD_MODE values", async () => {
    const normalizedPort = 3095;
    const normalizedUrl = `http://localhost:${normalizedPort}`;
    const normalizedProc = spawnServer(normalizedPort, readSyncDir, {
      OWNERSHIP_GUARD_MODE: "  FAIL\n",
    });
    let normalizedClient;

    try {
      await waitForServer(normalizedUrl);
      normalizedClient = await connectClient(normalizedUrl);
      const result = await normalizedClient.callTool({ name: "get_runtime_config", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");

      assert.equal(parsed.ownership_guard_mode, "fail");
      assert.equal((parsed.runtime_warnings ?? []).some(w => w.includes("OWNERSHIP_GUARD_MODE_INVALID")), false);
    } finally {
      try { await normalizedClient?.close(); } catch {}
      if (normalizedProc) normalizedProc.kill();
    }
  });

  test("skips fail-mode ownership guard when runtime UID is root", async () => {
    const rootPort = 3096;
    const rootUrl = `http://localhost:${rootPort}`;
    const rootProc = spawnServer(rootPort, readSyncDir, {
      OWNERSHIP_GUARD_MODE: "fail",
      RUNTIME_UID_OVERRIDE: "0",
      ALLOW_RUNTIME_UID_OVERRIDE: "1",
    });
    let rootClient;

    try {
      await waitForServer(rootUrl);
      rootClient = await connectClient(rootUrl);
      const result = await rootClient.callTool({ name: "get_runtime_config", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");

      assert.equal(parsed.ownership_guard_mode, "fail");
      assert.equal(parsed.permission_diagnostics?.runtime_uid, 0);
      assert.ok((parsed.runtime_warnings ?? []).some(w => w.includes("OWNERSHIP_GUARD_SKIPPED_FOR_ROOT")));
    } finally {
      try { await rootClient?.close(); } catch {}
      if (rootProc) rootProc.kill();
    }
  });

  test("ignores RUNTIME_UID_OVERRIDE unless explicitly allowed", async () => {
    const overridePort = 3094;
    const overrideUrl = `http://localhost:${overridePort}`;
    const overrideProc = spawnServer(overridePort, readSyncDir, {
      RUNTIME_UID_OVERRIDE: "0",
    });
    let overrideClient;

    try {
      await waitForServer(overrideUrl);
      overrideClient = await connectClient(overrideUrl);
      const result = await overrideClient.callTool({ name: "get_runtime_config", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");

      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_requested, true);
      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_applied, false);
      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_ignored, true);
      assert.ok((parsed.runtime_warnings ?? []).some(w => w.includes("RUNTIME_UID_OVERRIDE_IGNORED")));
    } finally {
      try { await overrideClient?.close(); } catch {}
      if (overrideProc) overrideProc.kill();
    }
  });

  test("returns warning for invalid RUNTIME_UID_OVERRIDE when override is enabled", async () => {
    const invalidOverridePort = 3093;
    const invalidOverrideUrl = `http://localhost:${invalidOverridePort}`;
    const invalidOverrideProc = spawnServer(invalidOverridePort, readSyncDir, {
      RUNTIME_UID_OVERRIDE: "abc",
      ALLOW_RUNTIME_UID_OVERRIDE: "1",
    });
    let invalidOverrideClient;

    try {
      await waitForServer(invalidOverrideUrl);
      invalidOverrideClient = await connectClient(invalidOverrideUrl);
      const result = await invalidOverrideClient.callTool({ name: "get_runtime_config", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");

      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_requested, true);
      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_applied, false);
      assert.equal(parsed.permission_diagnostics?.runtime_uid_override_invalid, true);
      assert.ok((parsed.runtime_warnings ?? []).some(w => w.includes("RUNTIME_UID_OVERRIDE_INVALID")));
    } finally {
      try { await invalidOverrideClient?.close(); } catch {}
      if (invalidOverrideProc) invalidOverrideProc.kill();
    }
  });

  test("exits at startup when fail-mode ownership guard detects mismatched ownership", async () => {
    const failPort = 3092;
    const failProc = spawnServer(failPort, readSyncDir, {
      OWNERSHIP_GUARD_MODE: "fail",
      RUNTIME_UID_OVERRIDE: "99999",
      ALLOW_RUNTIME_UID_OVERRIDE: "1",
    });
    let stderr = "";
    failProc.stderr?.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });

    const exit = await waitForExit(failProc);
    assert.equal(exit.code, 1);
    assert.ok(stderr.includes("FATAL: OWNERSHIP_GUARD_MODE=fail"));
    assert.ok(stderr.includes("host directory mounted at"));
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

describe("preview_review_bundle tool", () => {
  test("returns dry-run plan for outline profile", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "outline_discussion",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile, "outline_discussion");
    assert.equal(parsed.summary.scene_count, 3);
    assert.equal(parsed.strictness_result.can_proceed, true);
    assert.ok(Array.isArray(parsed.planned_outputs));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".pdf")));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".manifest.json")));
  });

  test("applies scene_ids as intersection with other filters", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "outline_discussion",
      chapter: 1,
      scene_ids: ["sc-001", "sc-003"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.summary.scene_count, 1);
    assert.deepEqual(parsed.ordering.map(row => row.scene_id), ["sc-001"]);
    assert.deepEqual(parsed.summary.excluded_scene_ids, ["sc-003"]);
  });

  test("strictness fail reports blockers when stale metadata exists", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nStale marker line for review bundle strictness test.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "editor_detailed",
      strictness: "fail",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.strictness_result.can_proceed, false);
    assert.ok(parsed.strictness_result.blockers.some(blocker => blocker.code === "STALE_METADATA"));
  });

  test("beta profile preview includes planned notice + feedback outputs", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "beta_reader_personalized",
      recipient_name: "Jordan Example",
      format: "both",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile, "beta_reader_personalized");
    assert.equal(parsed.resolved_scope.options.recipient_name, "Jordan Example");
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".notice.md")));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".feedback-form.md")));
    assert.ok(
      parsed.planned_outputs.some(
        name =>
          name.endsWith(".md") &&
          !name.endsWith(".notice.md") &&
          !name.endsWith(".feedback-form.md")
      )
    );
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".manifest.json")));
  });
});

describe("create_review_bundle tool", () => {
  test("writes outline bundle markdown + manifest to output_dir", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-outline-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
        bundle_name: "editorial-outline",
        source_commit: "test-commit-hash",
        format: "markdown",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_markdown);
      assert.ok(parsed.output_paths?.manifest_json);
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));
      assert.ok(fs.existsSync(parsed.output_paths.manifest_json));

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("# Review Bundle: test-novel"));
      assert.ok(markdown.includes("## The Return"));
      assert.ok(!markdown.includes("She was at the bottom of the gangway"));

      const manifest = JSON.parse(fs.readFileSync(parsed.output_paths.manifest_json, "utf8"));
      assert.equal(manifest.profile, "outline_discussion");
      assert.equal(manifest.provenance.source_commit, "test-commit-hash");
      assert.equal(manifest.summary.scene_count, 3);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes editor bundle with prose and paragraph anchors", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-editor-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "editor_detailed",
        output_dir: outDir,
        include_paragraph_anchors: true,
        format: "markdown",
      });
      const parsed = JSON.parse(text);
      assert.equal(parsed.ok, true);

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("<!-- sc-001:p1 -->"));
      assert.ok(markdown.includes("She was at the bottom of the gangway"));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes beta bundle markdown + notice + feedback artifacts", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-beta-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        output_dir: outDir,
        recipient_name: "Jordan Example",
        format: "markdown",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_markdown);
      assert.ok(parsed.output_paths?.manifest_json);
      assert.ok(parsed.output_paths?.notice_md);
      assert.ok(parsed.output_paths?.feedback_form_md);
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));
      assert.ok(fs.existsSync(parsed.output_paths.manifest_json));
      assert.ok(fs.existsSync(parsed.output_paths.notice_md));
      assert.ok(fs.existsSync(parsed.output_paths.feedback_form_md));

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("- Profile: beta_reader_personalized"));
      assert.ok(markdown.includes("- Recipient: Jordan Example"));
      assert.ok(markdown.includes("She was at the bottom of the gangway"));

      const manifest = JSON.parse(fs.readFileSync(parsed.output_paths.manifest_json, "utf8"));

      const notice = fs.readFileSync(parsed.output_paths.notice_md, "utf8");
      assert.ok(notice.includes("Non-Distribution Notice"));
      assert.ok(notice.includes("Jordan Example"));

      const feedback = fs.readFileSync(parsed.output_paths.feedback_form_md, "utf8");
      assert.ok(feedback.includes("Beta Reader Feedback Form"));
      assert.ok(feedback.includes("Jordan Example"));
      assert.ok(feedback.includes(`- Date: ${manifest.generated_at.slice(0, 10)}`));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes outline bundle PDF by default", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-pdf-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_pdf, "bundle_pdf path should be present");
      assert.ok(!parsed.output_paths?.bundle_markdown, "bundle_markdown should not be present for format=pdf");
      assert.ok(fs.existsSync(parsed.output_paths.bundle_pdf), "PDF file should exist on disk");

      const pdfBytes = fs.readFileSync(parsed.output_paths.bundle_pdf);
      assert.ok(pdfBytes.slice(0, 4).toString() === "%PDF", "file should start with PDF magic bytes");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes both markdown and PDF when format=both", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-both-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
        format: "both",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_pdf, "bundle_pdf path should be present");
      assert.ok(parsed.output_paths?.bundle_markdown, "bundle_markdown path should be present");
      assert.ok(fs.existsSync(parsed.output_paths.bundle_pdf));
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));

      const pdfBytes = fs.readFileSync(parsed.output_paths.bundle_pdf);
      assert.ok(pdfBytes.slice(0, 4).toString() === "%PDF");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("returns STRICTNESS_BLOCKED when fail mode sees stale metadata", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nStale marker line for create bundle strictness test.\n`, "utf8");
    await callWriteTool("sync");

    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-blocked-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "editor_detailed",
        output_dir: outDir,
        strictness: "fail",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "STRICTNESS_BLOCKED");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("returns INVALID_OUTPUT_DIR when output_dir is outside WRITING_SYNC_DIR", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-bundle-outside-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "INVALID_OUTPUT_DIR");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("returns INVALID_OUTPUT_DIR when output_dir routes through a symlink outside WRITING_SYNC_DIR", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-bundle-symlink-outside-"));
    const symlinkDir = path.join(writeSyncDir, "exports-link");
    try {
      fs.symlinkSync(outsideDir, symlinkDir, "dir");

      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: path.join(symlinkDir, "nested-output"),
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "INVALID_OUTPUT_DIR");
    } finally {
      fs.rmSync(symlinkDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
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
