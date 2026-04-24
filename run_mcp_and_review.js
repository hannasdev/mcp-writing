import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function callCreateBundle(client, args) {
  const result = await client.callTool({
    name: "create_review_bundle",
    arguments: args,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const [projectId = "the-lamb", outputDir = "/Users/hanna/Code/writing/exports"] = process.argv.slice(2);
  const writingSyncDir = process.env.WRITING_SYNC_DIR || path.dirname(path.resolve(outputDir));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", path.join(process.cwd(), "index.js")],
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
      WRITING_SYNC_DIR: writingSyncDir,
    },
  });

  const client = new Client(
    { name: "manual-review-runner", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    console.log("Calling create_review_bundle (outline_discussion)...");
    await callCreateBundle(client, {
      project_id: projectId,
      profile: "outline_discussion",
      output_dir: outputDir,
      bundle_name: "real-outline",
    });

    console.log("Calling create_review_bundle (editor_detailed)...");
    await callCreateBundle(client, {
      project_id: projectId,
      profile: "editor_detailed",
      include_paragraph_anchors: true,
      output_dir: outputDir,
      bundle_name: "real-editor",
    });
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

main();
