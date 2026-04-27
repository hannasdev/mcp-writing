import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const packageJsonPath = path.join(ROOT, "package.json");
const serverJsonPath = path.join(ROOT, "server.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, "utf8"));
const requestedVersion = process.argv[2]?.trim();
const nextVersion = requestedVersion || packageJson.version;

if (!nextVersion) {
  throw new Error("Unable to determine target version for server.json");
}

serverJson.version = nextVersion;
serverJson.packages = (serverJson.packages ?? []).map((pkg) => ({
  ...pkg,
  version: nextVersion,
}));

fs.writeFileSync(serverJsonPath, `${JSON.stringify(serverJson, null, 2)}\n`, "utf8");
