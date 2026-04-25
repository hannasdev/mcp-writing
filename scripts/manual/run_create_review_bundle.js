import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import process from "process";

async function main() {
  const [projectId, profile, outputDir, ...flags] = process.argv.slice(2);
  if (!projectId || !profile || !outputDir) {
    console.log("Usage: node scripts/manual/run_create_review_bundle.js <project_id> <profile> <output_dir> [--anchors] [--bundle-name <name>]");
    process.exit(1);
  }

  const includeParagraphAnchors = flags.includes("--anchors");
  const bundleNameIdx = flags.indexOf("--bundle-name");
  const bundleName = bundleNameIdx !== -1 ? flags[bundleNameIdx + 1] : undefined;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", path.join(process.cwd(), "index.js")],
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
      WRITING_SYNC_DIR: process.env.WRITING_SYNC_DIR || path.dirname(path.resolve(outputDir))
    }
  });

  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "create_review_bundle",
      arguments: {
        project_id: projectId,
        profile: profile,
        output_dir: outputDir,
        ...(includeParagraphAnchors ? { include_paragraph_anchors: true } : {}),
        ...(bundleName ? { bundle_name: bundleName } : {})
      }
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
}

main();
