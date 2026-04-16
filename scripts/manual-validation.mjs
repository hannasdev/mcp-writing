/**
 * MCP Manual Validation Script - Fixed Version
 */
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { URL as NodeURL } from "node:url";
import { execSync } from "node:child_process";
import fs from "node:fs";

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

function spawnServer(port, syncDir) {
  const proc = spawn(process.execPath, ["--experimental-sqlite", `${ROOT}/index.js`], {
    env: { ...process.env, WRITING_SYNC_DIR: syncDir, DB_PATH: ":memory:", HTTP_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

async function connectClient(url) {
  const c = new Client({ name: "manual-validation-client", version: "1.0.0" });
  const transport = new SSEClientTransport(new NodeURL(`${url}/sse`));
  await c.connect(transport);
  return c;
}

async function callTool(client, name, args = {}) {
  try {
    return await client.callTool({ name, arguments: args });
  } catch (e) {
    return { error: e.message };
  }
}

function parseResponse(result) {
  if (result.error) return { error: result.error };
  try {
    const text = result.content?.[0]?.text;
    if (!text) return { raw: result };
    // Try to parse as JSON
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  } catch {
    return { raw: result };
  }
}

// ======================== PHASE A ========================
async function runPhaseA() {
  console.log("\n========== PHASE A: Raw Export (./txt) ==========\n");
  const PORT = 3110;
  const BASE = `http://localhost:${PORT}`;
  
  const proc = spawnServer(PORT, `${ROOT}/txt`);
  const results = { errors: [] };
  
  try {
    await waitForServer(BASE);
    console.log("✓ Server started on port", PORT);
    
    const client = await connectClient(BASE);
    console.log("✓ MCP Client connected\n");
    
    // sync
    const syncRes = await callTool(client, "sync");
    const syncText = syncRes.content?.[0]?.text || JSON.stringify(syncRes);
    results.syncMessage = syncText;
    console.log("sync:", syncText.slice(0, 200));
    
    // find_scenes
    const scenesRes = await callTool(client, "find_scenes", {});
    const scenesData = parseResponse(scenesRes);
    results.sceneCount = scenesData.total_count ?? scenesData.results?.length ?? "N/A";
    console.log("find_scenes count:", results.sceneCount);
    
    // list_characters
    const charsRes = await callTool(client, "list_characters", {});
    const charsData = parseResponse(charsRes);
    results.characterCount = charsData.total_count ?? charsData.characters?.length ?? "N/A";
    console.log("list_characters count:", results.characterCount);
    
    // list_places
    const placesRes = await callTool(client, "list_places", {});
    const placesData = parseResponse(placesRes);
    results.placeCount = placesData.total_count ?? placesData.places?.length ?? "N/A";
    console.log("list_places count:", results.placeCount);
    
    // search_metadata
    const searchRes = await callTool(client, "search_metadata", { query: "airport" });
    const searchData = parseResponse(searchRes);
    results.airportSearchCount = searchData.total_count ?? searchData.results?.length ?? "N/A";
    console.log("search_metadata(airport) count:", results.airportSearchCount);
    
    await client.close();
    console.log("✓ Client closed");
  } catch (e) {
    results.errors.push(`Phase A error: ${e.message}`);
    console.error("Phase A error:", e.message);
  } finally {
    proc.kill();
    console.log("✓ Server killed");
  }
  
  return results;
}

// ======================== PHASE B ========================
async function runPhaseB() {
  console.log("\n========== PHASE B: Imported Format ==========\n");
  const PORT = 3111;
  const BASE = `http://localhost:${PORT}`;
  const IMPORT_DIR = "/tmp/mcp-writing-manual";
  
  const results = { errors: [], warnings: [] };
  
  // Cleanup
  try {
    fs.rmSync(IMPORT_DIR, { recursive: true, force: true });
    console.log("✓ Cleaned up", IMPORT_DIR);
  } catch {}
  
  // Import
  try {
    const importOutput = execSync(
      `node scripts/import.js ./txt ${IMPORT_DIR} --project scrivener-export`,
      { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log("✓ Import completed");
    results.importOutput = importOutput.slice(0, 500);
  } catch (e) {
    results.errors.push(`Import error: ${e.message}`);
    console.error("Import error:", e.message);
    return results;
  }
  
  // Lint
  try {
    const lintOutput = execSync(
      `node scripts/lint-metadata.mjs --sync-dir ${IMPORT_DIR}`,
      { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    results.lintOutput = lintOutput;
    console.log("✓ Lint completed");
    console.log("Lint output:\n", lintOutput.slice(0, 400));
  } catch (e) {
    results.lintOutput = e.stdout || e.stderr || e.message;
    results.warnings.push(`Lint warnings: ${results.lintOutput.slice(0, 500)}`);
    console.log("Lint output (non-zero):\n", results.lintOutput.slice(0, 400));
  }
  
  // Start server
  const proc = spawnServer(PORT, IMPORT_DIR);
  
  try {
    await waitForServer(BASE);
    console.log("✓ Server started on port", PORT);
    
    const client = await connectClient(BASE);
    console.log("✓ MCP Client connected\n");
    
    // sync
    const syncRes = await callTool(client, "sync");
    const syncText = syncRes.content?.[0]?.text || JSON.stringify(syncRes);
    results.syncMessage = syncText;
    console.log("sync:", syncText.slice(0, 200));
    
    // find_scenes with project filter
    const scenesRes = await callTool(client, "find_scenes", { 
      project_id: "scrivener-export", 
      page_size: 5, 
      page: 1 
    });
    const scenesData = parseResponse(scenesRes);
    results.sceneCount = scenesData.total_count ?? scenesData.results?.length ?? "N/A";
    results.firstSceneId = scenesData.results?.[0]?.scene_id || null;
    console.log("find_scenes count:", results.sceneCount);
    if (results.firstSceneId) console.log("First scene_id:", results.firstSceneId);
    
    // list_characters with project filter
    const charsRes = await callTool(client, "list_characters", { project_id: "scrivener-export" });
    const charsData = parseResponse(charsRes);
    results.characterCount = charsData.total_count ?? charsData.characters?.length ?? "N/A";
    console.log("list_characters count:", results.characterCount);
    
    // list_places with project filter
    const placesRes = await callTool(client, "list_places", { project_id: "scrivener-export" });
    const placesData = parseResponse(placesRes);
    results.placeCount = placesData.total_count ?? placesData.places?.length ?? "N/A";
    console.log("list_places count:", results.placeCount);
    
    // search_metadata
    const searchRes = await callTool(client, "search_metadata", { 
      query: "airport", 
      page_size: 5, 
      page: 1 
    });
    const searchData = parseResponse(searchRes);
    results.airportSearchCount = searchData.total_count ?? searchData.results?.length ?? "N/A";
    console.log("search_metadata(airport) count:", results.airportSearchCount);
    
    // get_scene_prose if we have a scene ID
    if (results.firstSceneId) {
      const proseRes = await callTool(client, "get_scene_prose", { scene_id: results.firstSceneId });
      const proseData = parseResponse(proseRes);
      results.proseExcerpt = proseData.prose?.slice(0, 200) || proseData.text?.slice(0, 200) || proseRes.content?.[0]?.text?.slice(0, 200) || "(no prose)";
      console.log("get_scene_prose excerpt:", results.proseExcerpt.slice(0, 150) + "...");
    } else {
      results.proseExcerpt = "(no scene_id available)";
    }
    
    await client.close();
    console.log("✓ Client closed");
  } catch (e) {
    results.errors.push(`Phase B error: ${e.message}`);
    console.error("Phase B error:", e.message);
  } finally {
    proc.kill();
    console.log("✓ Server killed");
  }
  
  return results;
}

// ======================== MAIN ========================
async function main() {
  console.log("Starting MCP Manual Validation...\n");
  
  const phaseA = await runPhaseA();
  const phaseB = await runPhaseB();
  
  console.log("\n========== FINAL SUMMARY ==========\n");
  
  console.log("PHASE A (Raw Export ./txt):");
  console.log("  Sync message:", phaseA.syncMessage?.slice(0, 150) || "N/A");
  console.log("  Scene count:", phaseA.sceneCount);
  console.log("  Character count:", phaseA.characterCount);
  console.log("  Place count:", phaseA.placeCount);
  console.log("  Airport search count:", phaseA.airportSearchCount);
  if (phaseA.errors.length) console.log("  Errors:", phaseA.errors);
  
  console.log("\nPHASE B (Imported /tmp/mcp-writing-manual):");
  console.log("  Sync message:", phaseB.syncMessage?.slice(0, 150) || "N/A");
  console.log("  Scene count:", phaseB.sceneCount);
  console.log("  Character count:", phaseB.characterCount);
  console.log("  Place count:", phaseB.placeCount);
  console.log("  Airport search count:", phaseB.airportSearchCount);
  console.log("  First scene_id:", phaseB.firstSceneId || "N/A");
  console.log("  Prose excerpt (200 chars):", phaseB.proseExcerpt?.slice(0, 200) || "N/A");
  if (phaseB.warnings.length) console.log("  Lint warnings:", phaseB.warnings.length > 0 ? "Yes (see above)" : "None");
  if (phaseB.errors.length) console.log("  Errors:", phaseB.errors);
  
  console.log("\n========== VALIDATION COMPLETE ==========\n");
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
