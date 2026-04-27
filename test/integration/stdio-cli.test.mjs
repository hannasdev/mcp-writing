import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTestSyncFixture } from "../helpers/fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("CLI wrapper serves MCP over stdio by default", async () => {
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-stdio-"));
  createTestSyncFixture(syncDir);

  const client = new Client({ name: "integration-stdio-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "bin", "mcp-writing.js")],
    cwd: ROOT,
    env: {
      ...process.env,
      WRITING_SYNC_DIR: syncDir,
      DB_PATH: ":memory:",
    },
    stderr: "pipe",
  });

  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "get_runtime_config", arguments: {} });
    const text = result.content?.[0]?.text ?? "";
    const payload = JSON.parse(text);

    assert.equal(payload.sync_dir, syncDir, `CLI wrapper should initialize successfully. stderr:\n${stderr}`);
    assert.equal(payload.db_path, ":memory:");
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(syncDir, { recursive: true, force: true });
  }
});
