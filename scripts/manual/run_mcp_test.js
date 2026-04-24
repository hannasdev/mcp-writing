import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import process from "process";

function usage() {
  console.log("Usage: node scripts/manual/run_mcp_test.js <source_project_dir> [project_id] [sync_dir]");
  console.log("Example: node scripts/manual/run_mcp_test.js ~/Novel.scriv demo-project ~/sync-root");
}

async function runCase(env, args) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", path.join(process.cwd(), "index.js")],
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
      ...env,
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
    
    // Start the async merge job
    const startResult = await client.callTool({
      name: "merge_scrivener_project_beta",
      arguments: args
    });

    if (startResult.isError) {
      console.log(`error: ${startResult.content[0].text}`);
      return;
    }

    const startData = JSON.parse(startResult.content[0].text);
    if (!startData.ok) {
      console.log(`error: ${startData.error?.code || 'unknown'}`);
      return;
    }

    const jobId = startData.job.job_id;
    console.log(`Job started: ${jobId}`);

    // Poll for completion (with timeout)
    let settled = false;
    let attempts = 0;
    const maxAttempts = 120; // 120 * 500ms = 60 seconds

    while (!settled && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const statusResult = await client.callTool({
        name: "get_async_job_status",
        arguments: { job_id: jobId, include_result: true }
      });

      const statusData = JSON.parse(statusResult.content[0].text);

      if (!statusData.ok) {
        console.log(`error.code/message: ${statusData.error?.code || "unknown"}`);
        settled = true;
      }

      const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
      if (!settled && terminalStatuses.has(statusData.job?.status)) {
        settled = true;
      }

      if (statusData.job?.status === "completed") {
        const result = statusData.job.result;

        if (!result.ok) {
          console.log(`error.code/message: ${result.error?.code}`);
        } else {
          const merge = result.merge || {};
          console.log("ok");
          if (merge.sidecar_files) console.log(`sidecar_files: ${merge.sidecar_files}`);
          if (merge.updated) console.log(`updated: ${merge.updated}`);
        }
      }

      if (statusData.job?.status === "failed" || statusData.job?.status === "cancelled") {
        const details = statusData.job?.result?.error?.code || statusData.job?.status;
        console.log(`error.code/message: ${details}`);
      }
      
      attempts++;
    }

    if (!settled) {
      console.log("error: job timeout");
    }
  } catch (e) {
    console.log(`error.code/message: ${e.message}`);
  }
}

async function main() {
  const [sourceProjectDir, projectId = "demo-project", syncDir = process.env.WRITING_SYNC_DIR || "./sync"] = process.argv.slice(2);
  if (!sourceProjectDir) {
    usage();
    process.exit(1);
  }

  await runCase({ WRITING_SYNC_DIR: syncDir }, {
    source_project_dir: sourceProjectDir,
    project_id: projectId,
    dry_run: true,
  });
  
  process.exit(0);
}

main();
