import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { URL as NodeURL } from "node:url";

const ROOT = process.cwd();

async function waitForServer(url, retries = 30, delayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Server did not become ready`);
}

const PORT = 3112;
const BASE = `http://localhost:${PORT}`;
const IMPORT_DIR = "/tmp/mcp-writing-manual";

const proc = spawn(process.execPath, ["--experimental-sqlite", `${ROOT}/index.js`], {
  env: { ...process.env, WRITING_SYNC_DIR: IMPORT_DIR, DB_PATH: ":memory:", HTTP_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(BASE);
  const client = new Client({ name: "debug-client", version: "1.0.0" });
  const transport = new SSEClientTransport(new NodeURL(`${BASE}/sse`));
  await client.connect(transport);
  
  await client.callTool({ name: "sync", arguments: {} });
  
  const scenes = await client.callTool({ name: "find_scenes", arguments: { project_id: "scrivener-export", page_size: 3, page: 1 } });
  console.log("=== find_scenes raw response ===");
  console.log(JSON.stringify(scenes, null, 2));
  
  await client.close();
} finally {
  proc.kill();
}
