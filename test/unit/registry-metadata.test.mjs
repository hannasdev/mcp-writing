import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const serverJson = JSON.parse(fs.readFileSync(path.join(ROOT, "server.json"), "utf8"));

test("registry metadata stays aligned with package metadata", () => {
  assert.equal(packageJson.mcpName, serverJson.name);
  assert.equal(serverJson.packages?.length, 1);
  assert.equal(serverJson.packages[0].registryType, "npm");
  assert.equal(serverJson.packages[0].identifier, packageJson.name);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(packageJson.bin?.["mcp-writing"], "./bin/mcp-writing.js");
  assert.equal(serverJson.packages[0].transport?.type, "stdio");
});
