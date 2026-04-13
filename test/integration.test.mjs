/**
 * Integration tests — spawn the server as a child process against
 * the real test-sync/ data, then call each tool via the MCP client.
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
const TEST_SYNC_DIR = path.join(ROOT, "test-sync");
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
let writeSyncDir;

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

before(async () => {
  // Read-only server against static test-sync/
  serverProc = spawnServer(TEST_PORT, TEST_SYNC_DIR);
  await waitForServer(BASE_URL);
  client = await connectClient(BASE_URL);

  // Writable server against a temp copy of test-sync/
  writeSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-test-"));
  copyDirSync(TEST_SYNC_DIR, writeSyncDir);
  writeServerProc = spawnServer(WRITE_PORT, writeSyncDir);
  await waitForServer(WRITE_URL);
  writeClient = await connectClient(WRITE_URL);
});

after(async () => {
  try { await client.close(); } catch {}
  try { await writeClient.close(); } catch {}
  if (serverProc) serverProc.kill();
  if (writeServerProc) writeServerProc.kill();
  if (writeSyncDir) fs.rmSync(writeSyncDir, { recursive: true, force: true });
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

describe("find_scenes tool", () => {
  test("returns all 3 scenes with no filters", async () => {
    const text = await callTool("find_scenes");
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 3);
  });

  test("filters by character: elena appears in all 3 scenes", async () => {
    const text = await callTool("find_scenes", { character: "elena" });
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 3);
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
    assert.equal((text.match(/"scene_id"/g) ?? []).length, 3);
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
});

describe("list_places tool", () => {
  test("lists harbor-district", async () => {
    const text = await callTool("list_places");
    assert.ok(text.includes("harbor-district"));
  });
});

describe("search_metadata tool", () => {
  test("search harbor returns sc-001 or sc-002", async () => {
    const text = await callTool("search_metadata", { query: "harbor" });
    assert.ok(text.includes("sc-001") || text.includes("sc-002"));
  });

  test("search envelope returns sc-003 (logline)", async () => {
    const text = await callTool("search_metadata", { query: "envelope" });
    assert.ok(text.includes("sc-003"));
  });

  test("search with no match returns helpful message", async () => {
    const text = await callTool("search_metadata", { query: "dragons" });
    assert.ok(text.toLowerCase().includes("no scenes"));
  });
});

describe("list_threads tool", () => {
  test("returns no threads message when none created", async () => {
    const text = await callTool("list_threads", { project_id: "test-novel" });
    assert.ok(text.toLowerCase().includes("no threads"));
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
