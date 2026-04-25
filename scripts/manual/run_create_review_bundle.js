import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import process from "process";
import fs from "node:fs";

async function main() {
  const [projectId, profile, outputDir, ...flags] = process.argv.slice(2);
  if (!projectId || !profile || !outputDir) {
    console.error("Usage: WRITING_SYNC_DIR=/path/to/sync node scripts/manual/run_create_review_bundle.js <project_id> <profile> <output_dir> [--anchors] [--recipient <name>] [--bundle-name <name>] [--skip-preview] [--show-files]");
    process.exit(1);
  }

  if (!process.env.WRITING_SYNC_DIR) {
    console.error(
      "WRITING_SYNC_DIR is required. Set it to the root of your sync directory.\n" +
      "Usage: WRITING_SYNC_DIR=/path/to/sync node scripts/manual/run_create_review_bundle.js <project_id> <profile> <output_dir>"
    );
    process.exit(1);
  }

  const includeParagraphAnchors = flags.includes("--anchors");
  const skipPreview = flags.includes("--skip-preview");
  const showFiles = flags.includes("--show-files");
  const bundleNameIdx = flags.indexOf("--bundle-name");
  const bundleName = bundleNameIdx !== -1 ? flags[bundleNameIdx + 1] : undefined;
  const recipientIdx = flags.indexOf("--recipient");
  const recipientName = recipientIdx !== -1 ? flags[recipientIdx + 1] : undefined;

  const baseArguments = {
    project_id: projectId,
    profile,
    ...(includeParagraphAnchors ? { include_paragraph_anchors: true } : {}),
    ...(bundleName ? { bundle_name: bundleName } : {}),
    ...(recipientName ? { recipient_name: recipientName } : {}),
  };

  function printArtifactExcerpt(label, filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    const excerpt = content.split("\n").slice(0, 20).join("\n");
    console.log(`\n--- ${label}: ${filePath} ---`);
    console.log(excerpt);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", path.join(process.cwd(), "index.js")],
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
      WRITING_SYNC_DIR: process.env.WRITING_SYNC_DIR
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

    if (!skipPreview) {
      const previewResult = await client.callTool({
        name: "preview_review_bundle",
        arguments: baseArguments,
      });
      const previewText = previewResult.content?.[0]?.text ?? "";
      console.log("\n=== preview_review_bundle ===");
      console.log(previewText);
    }

    const result = await client.callTool({
      name: "create_review_bundle",
      arguments: {
        ...baseArguments,
        output_dir: outputDir,
      }
    });

    const resultText = result.content?.[0]?.text ?? "";
    console.log("\n=== create_review_bundle ===");
    console.log(resultText);

    if (showFiles) {
      const parsed = JSON.parse(resultText);
      if (parsed.ok && parsed.output_paths) {
        printArtifactExcerpt("Bundle Markdown", parsed.output_paths.bundle_markdown);
        printArtifactExcerpt("Manifest JSON", parsed.output_paths.manifest_json);
        printArtifactExcerpt("Notice Markdown", parsed.output_paths.notice_md);
        printArtifactExcerpt("Feedback Form Markdown", parsed.output_paths.feedback_form_md);
      }
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
}

main();
