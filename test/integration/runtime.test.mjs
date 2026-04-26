import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnServer, waitForServer, waitForExit, connectClient } from "../helpers/server.js";
import { writeFileSyncWithDirs } from "../helpers/fixtures.js";
import { createTestContext } from "../helpers/server.js";

const READ_PORT = 3067;
const WRITE_PORT = 3066;
const ctx = createTestContext(READ_PORT, WRITE_PORT);
let writeSyncDir, readSyncDir;
const TEST_PORT = READ_PORT;

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
describe("get_runtime_config tool", () => {
  test("returns active runtime paths and capability flags", async () => {
    const text = await callTool("get_runtime_config");
    const parsed = JSON.parse(text);

    assert.equal(typeof parsed.server_version, "string");
    assert.ok(parsed.server_version.length > 0);

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
describe("describe_workflows tool", () => {
  test("returns ok with context, workflows, and notes", async () => {
    const text = await callWriteTool("describe_workflows");
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.ok(typeof parsed.context === "object");
    assert.ok(typeof parsed.context.scene_count === "number");
    assert.ok(typeof parsed.context.sync_dir === "string");
    assert.ok(typeof parsed.context.git_available === "boolean");
    assert.ok(typeof parsed.context.pending_proposals === "number");
    assert.ok(typeof parsed.context.styleguide_exists === "object");
    assert.ok(typeof parsed.context.styleguide_exists.sync_root === "boolean");
    assert.ok(typeof parsed.context.styleguide_exists.project_root === "boolean");
    assert.ok(Array.isArray(parsed.workflows));
    assert.ok(parsed.workflows.length > 0);
    assert.ok(Array.isArray(parsed.notes));
    assert.ok(parsed.notes.length > 0);
  });

  test("includes all expected workflow ids", async () => {
    const text = await callWriteTool("describe_workflows");
    const parsed = JSON.parse(text);
    const ids = parsed.workflows.map(w => w.id);

    const expected = [
      "first_time_setup",
      "styleguide_setup_new",
      "styleguide_drift_check",
      "manuscript_exploration",
      "prose_editing",
      "character_management",
      "place_management",
      "review_bundle",
      "async_job_tracking",
    ];
    for (const id of expected) {
      assert.ok(ids.includes(id), `Missing workflow: ${id}`);
    }
  });

  test("context.scene_count matches indexed scenes", async () => {
    const syncText = await callWriteTool("sync");
    assert.match(syncText, /scenes indexed/);

    const workflowText = await callWriteTool("describe_workflows");
    const parsed = JSON.parse(workflowText);

    // page_size forces total_count to always appear in the response regardless of result set size
    const scenesText = await callWriteTool("find_scenes", { page_size: 1, page: 1 });
    const scenes = JSON.parse(scenesText);

    assert.equal(parsed.context.scene_count, scenes.total_count);
  });

  test("project_id is null when SYNC_DIR points at a project root with scenes/ layout", async () => {
    const flatPort = 3091;
    const flatUrl = `http://localhost:${flatPort}`;
    const flatSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-flat-"));
    writeFileSyncWithDirs(
      path.join(flatSyncDir, "scenes", "chapter-1", "sc-001.md"),
      `---\nscene_id: sc-001\ntitle: Test Scene\n---\nProse here.\n`
    );
    const flatProc = spawnServer(flatPort, flatSyncDir);
    let flatClient;
    try {
      await waitForServer(flatUrl);
      flatClient = await connectClient(flatUrl);
      const result = await flatClient.callTool({ name: "describe_workflows", arguments: {} });
      const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");
      assert.equal(parsed.context.project_id, null, "structural dir name must not leak as project_id");
    } finally {
      try { await flatClient?.close(); } catch {}
      if (flatProc) flatProc.kill();
      fs.rmSync(flatSyncDir, { recursive: true, force: true });
    }
  });

  test("each workflow has id, label, use_when, and non-empty steps", async () => {
    const text = await callWriteTool("describe_workflows");
    const parsed = JSON.parse(text);

    for (const workflow of parsed.workflows) {
      assert.ok(typeof workflow.id === "string" && workflow.id.length > 0, `workflow missing id`);
      assert.ok(typeof workflow.label === "string" && workflow.label.length > 0, `${workflow.id} missing label`);
      assert.ok(typeof workflow.use_when === "string" && workflow.use_when.length > 0, `${workflow.id} missing use_when`);
      assert.ok(Array.isArray(workflow.steps) && workflow.steps.length > 0, `${workflow.id} missing steps`);
      for (const step of workflow.steps) {
        assert.ok(typeof step.tool === "string" && step.tool.length > 0, `${workflow.id} step missing tool`);
        assert.ok(typeof step.note === "string" && step.note.length > 0, `${workflow.id} step missing note`);
      }
    }
  });
});
