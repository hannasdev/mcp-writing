import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createTestSyncFixture, copyDirSync } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export function spawnServer(port, syncDir, extraEnv = {}) {
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
  proc.on("error", (err) => {
    throw new Error(`Failed to start server: ${err.message}`);
  });
  return proc;
}

export async function waitForServer(url, retries = 20, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

export async function waitForExit(proc, timeoutMs = 5000) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Process did not exit in time")),
      timeoutMs
    );
    proc.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

export async function connectClient(url) {
  const c = new Client({ name: "integration-test-client", version: "1.0.0" });
  const transport = new SSEClientTransport(new URL(`${url}/sse`));
  await c.connect(transport);
  return c;
}

/**
 * Creates a self-contained server context for integration test files.
 * Each file gets its own read-only and writable server pair.
 *
 * Usage:
 *   const ctx = createTestContext(3079, 3078);
 *   before(() => ctx.setup());
 *   after(() => ctx.teardown());
 *   const callTool = (n, a) => ctx.callTool(n, a);
 */
export function createTestContext(readPort, writePort, extraEnv = {}) {
  let serverProc, writeServerProc, client, writeClient;
  let readSyncDir, writeSyncDir;

  const ctx = {
    get readSyncDir() { return readSyncDir; },
    get writeSyncDir() { return writeSyncDir; },
    get client() { return client; },
    get writeClient() { return writeClient; },

    async setup() {
      readSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-read-"));
      createTestSyncFixture(readSyncDir);
      serverProc = spawnServer(readPort, readSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2", ...extraEnv });
      await waitForServer(`http://localhost:${readPort}`);
      client = await connectClient(`http://localhost:${readPort}`);

      writeSyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-write-"));
      copyDirSync(readSyncDir, writeSyncDir);
      writeServerProc = spawnServer(writePort, writeSyncDir, { DEFAULT_METADATA_PAGE_SIZE: "2", ...extraEnv });
      await waitForServer(`http://localhost:${writePort}`);
      writeClient = await connectClient(`http://localhost:${writePort}`);
    },

    async teardown() {
      try { await client.close(); } catch {}
      try { await writeClient.close(); } catch {}
      if (serverProc) serverProc.kill();
      if (writeServerProc) writeServerProc.kill();
      if (readSyncDir) fs.rmSync(readSyncDir, { recursive: true, force: true });
      if (writeSyncDir) fs.rmSync(writeSyncDir, { recursive: true, force: true });
    },

    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return result.content?.[0]?.text ?? "";
    },

    async callWriteTool(name, args = {}) {
      const result = await writeClient.callTool({ name, arguments: args });
      return result.content?.[0]?.text ?? "";
    },

    async waitForAsyncJob(jobId, timeoutMs = 12000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const text = await ctx.callWriteTool("get_async_job_status", { job_id: jobId });
        const parsed = JSON.parse(text);
        const status = parsed.job?.status;
        if (status === "completed" || status === "failed" || status === "cancelled") return parsed;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Timed out waiting for async job ${jobId}`);
    },
  };

  return ctx;
}
