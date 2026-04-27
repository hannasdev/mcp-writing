#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "..", "index.js");
const nodeMajorVersion = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

if (!process.env.MCP_TRANSPORT) {
  process.env.MCP_TRANSPORT = "stdio";
}

if (nodeMajorVersion < 23) {
  const child = spawn(process.execPath, ["--experimental-sqlite", indexPath, ...process.argv.slice(2)], {
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    process.stderr.write(`[mcp-writing] FATAL: failed to launch stdio server: ${error.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
} else {
  await import(pathToFileURL(indexPath).href);
}
