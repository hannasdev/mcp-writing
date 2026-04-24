import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import process from "process";

async function runCase(env, args) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(process.cwd(), "index.js")],
    env: { ...process.env, ...env }
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
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 120 * 500ms = 60 seconds

    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const statusResult = await client.callTool({
        name: "get_async_job_status",
        arguments: { job_id: jobId, include_result: true }
      });

      const statusData = JSON.parse(statusResult.content[0].text);
      
      if (statusData.ok && statusData.job.status === "completed") {
        completed = true;
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
      
      attempts++;
    }

    if (!completed) {
      console.log("error: job timeout");
    }
  } catch (e) {
    console.log(`error.code/message: ${e.message}`);
  }
}

async function main() {
  console.log("Case A:");
  await runCase({ WRITING_SYNC_DIR: '/Users/hanna/Code/writing' }, {
    source_project_dir: '/Users/hanna/Documents/writing/mira nystrom/Sebastian the Vampire.scriv',
    project_id: 'book-1-the-lamb',
    dry_run: true
  });

  console.log("\nCase B:");
  await runCase({ WRITING_SYNC_DIR: '/tmp/mcp-writing-PCUj6B' }, {
    source_project_dir: '/Users/hanna/Documents/writing/mira nystrom/Sebastian the Vampire.scriv',
    project_id: 'demo-mira',
    dry_run: true
  });
  
  process.exit(0);
}

main();
