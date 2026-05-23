import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
const compose = fs.readFileSync(path.join(ROOT, "docker-compose.example.yml"), "utf8");
const guide = fs.readFileSync(path.join(ROOT, "docs", "guides", "docker.md"), "utf8");

const requiredDocSnippets = [
  "`WRITING_SYNC_DIR`",
  "`DB_PATH`",
  "`HTTP_PORT`",
  "`MCP_TRANSPORT`",
  "`OWNERSHIP_GUARD_MODE`",
  "`/sync`",
  "`/data`",
  "`/ssh`",
  "Upgrade Checklist",
  "Backup Checklist",
  "Rollback",
  "Supported Deployment Targets",
  "OpenClaw",
];

const requiredComposeSnippets = [
  "WRITING_SYNC_DIR: /sync",
  "DB_PATH: /data/writing.db",
  "HTTP_PORT: \"3000\"",
  "OWNERSHIP_GUARD_MODE:",
  "MCP_TRANSPORT: http",
  "${WRITING_SYNC_DIR_HOST:-./sync}:/sync",
  "${WRITING_DATA_DIR_HOST:-./data}:/data",
  "WRITING_SSH_DIR_HOST",
  "GIT_SSH_COMMAND",
];

const requiredDockerfileSnippets = [
  "ENV WRITING_SYNC_DIR=/sync",
  "ENV DB_PATH=/data/writing.db",
  "ENV HTTP_PORT=3000",
  "ENV MCP_TRANSPORT=http",
  "git openssh-client",
  "HEALTHCHECK",
  "/healthz",
];

const findings = [];

function requireSnippet(label, content, snippet) {
  if (!content.includes(snippet)) {
    findings.push(`${label} is missing ${JSON.stringify(snippet)}`);
  }
}

for (const snippet of requiredDocSnippets) {
  requireSnippet("docs/guides/docker.md", guide, snippet);
}

for (const snippet of requiredComposeSnippets) {
  requireSnippet("docker-compose.example.yml", compose, snippet);
}

for (const snippet of requiredDockerfileSnippets) {
  requireSnippet("Dockerfile", dockerfile, snippet);
}

if (findings.length > 0) {
  console.error("Docker docs drift check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Docker docs drift check passed.");
