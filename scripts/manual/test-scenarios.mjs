import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const BASE_URL = "http://localhost:3000";

async function connect() {
  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/sse`);
      if (!res.ok && res.status !== 404) continue; // Still waiting
      break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const client = new Client({ name: "test-scenarios", version: "1.0.0" });
  const transport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
  await client.connect(transport);
  return client;
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.content?.[0]?.text ?? "";
}

const results = [];

function log(scenario, status, details) {
  results.push({ scenario, status, details });
  console.log(`\n${scenario}: ${status}`);
  if (details) console.log(`  ${details}`);
}

async function runScenarios() {
  const client = await connect();

  try {
    // ========================================================================
    // 1. Baseline list without pagination args (find_scenes)
    // ========================================================================
    console.log("\n=== Scenario 1: Baseline find_scenes (no pagination) ===");
    try {
      const text = await callTool(client, "find_scenes", { project_id: "the-lamb" });
      const parsed = JSON.parse(text);
      const isArray = Array.isArray(parsed);
      const isEnvelope = !isArray && parsed.results && parsed.total_count !== undefined;
      
      if (isArray) {
        log("1a", "PASS", `Got array of ${parsed.length} scenes (backward compat)`);
      } else if (isEnvelope) {
        log("1b", "PASS", `Got envelope with results: ${parsed.results.length}, total_count: ${parsed.total_count}`);
      } else {
        log("1c", "FAIL", `Unknown shape: ${JSON.stringify(parsed).slice(0, 100)}`);
      }
    } catch (err) {
      log("1", "FAIL", err.message);
    }

    // ========================================================================
    // 2. Explicit pagination on find_scenes
    // ========================================================================
    console.log("\n=== Scenario 2: find_scenes with explicit pagination ===");
    try {
      const page1 = JSON.parse(await callTool(client, "find_scenes", { project_id: "the-lamb", page_size: 5, page: 1 }));
      const page2 = JSON.parse(await callTool(client, "find_scenes", { project_id: "the-lamb", page_size: 5, page: 2 }));
      
      const p1Ids = page1.results.map(s => s.scene_id);
      const p2Ids = page2.results.map(s => s.scene_id);
      const overlap = p1Ids.filter(id => p2Ids.includes(id));
      
      if (page1.total_count === page2.total_count && overlap.length === 0) {
        log("2", "PASS", `Page 1 (${p1Ids.length}), Page 2 (${p2Ids.length}), total_count: ${page1.total_count}, no overlap`);
      } else {
        log("2", "FAIL", `Overlap: ${overlap.length}, totals: ${page1.total_count} vs ${page2.total_count}`);
      }
    } catch (err) {
      log("2", "FAIL", err.message);
    }

    // ========================================================================
    // 3. Explicit pagination on get_arc
    // ========================================================================
    console.log("\n=== Scenario 3: get_arc with explicit pagination ===");
    try {
      const arc1 = JSON.parse(await callTool(client, "get_arc", { character_id: "char-mira-nystrom", page_size: 3, page: 1 }));
      const arc2 = JSON.parse(await callTool(client, "get_arc", { character_id: "char-mira-nystrom", page_size: 3, page: 2 }));
      
      const sumLen = arc1.results.length + arc2.results.length;
      const check = arc1.total_count >= sumLen && arc1.results[0].part === 1;
      
      if (check) {
        log("3", "PASS", `Page 1 (${arc1.results.length}), Page 2 (${arc2.results.length}), total: ${arc1.total_count}, ordered by part`);
      } else {
        log("3", "FAIL", `total_count: ${arc1.total_count}, page sum: ${sumLen}`);
      }
    } catch (err) {
      log("3", "FAIL", err.message);
    }

    // ========================================================================
    // 4. Explicit pagination on search_metadata
    // ========================================================================
    console.log("\n=== Scenario 4: search_metadata with pagination ===");
    try {
      const s1 = JSON.parse(await callTool(client, "search_metadata", { query: "scene", page_size: 2, page: 1 }));
      const s2 = JSON.parse(await callTool(client, "search_metadata", { query: "scene", page_size: 2, page: 2 }));
      
      if (s1.total_count > s1.results.length && s1.page === 1 && s2.page === 2) {
        log("4", "PASS", `Page 1 (${s1.results.length}), Page 2 (${s2.results.length}), total: ${s1.total_count}`);
      } else {
        log("4", "FAIL", `Page meta inconsistency: ${JSON.stringify({ p1: s1.page, p2: s2.page, total: s1.total_count })}`);
      }
    } catch (err) {
      log("4", "FAIL", err.message);
    }

    // ========================================================================
    // 5. list_threads empty project case
    // ========================================================================
    console.log("\n=== Scenario 5: list_threads on empty project ===");
    try {
      const text = await callTool(client, "list_threads", { project_id: "the-lamb" });
      const parsed = JSON.parse(text);
      
      if (parsed.project_id === "the-lamb" && parsed.total_count === 0 && Array.isArray(parsed.results)) {
        log("5", "PASS", `Structured JSON: project_id, results [], total_count: 0`);
      } else {
        log("5", "FAIL", `Missing fields or wrong structure: ${JSON.stringify(parsed).slice(0, 100)}`);
      }
    } catch (err) {
      log("5", "FAIL", err.message);
    }

    // ========================================================================
    // 6. list_threads non-empty project (if any exist)
    // ========================================================================
    console.log("\n=== Scenario 6: list_threads non-empty (test-novel) ===");
    try {
      const text = await callTool(client, "list_threads", { project_id: "test-novel" });
      const parsed = JSON.parse(text);
      
      const threadCount = parsed.results.length;
      const matchesTotal = threadCount === parsed.total_count;
      
      if (matchesTotal && parsed.project_id === "test-novel") {
        log("6", "PASS", `${threadCount} threads, total_count: ${parsed.total_count}`);
      } else {
        log("6", "FAIL", `results vs total mismatch: ${threadCount} vs ${parsed.total_count}`);
      }
    } catch (err) {
      log("6", "FAIL", err.message);
    }

    // ========================================================================
    // 7. get_thread_arc happy path (we may not have threads, check structure)
    // ========================================================================
    console.log("\n=== Scenario 7: get_thread_arc structure check ===");
    try {
      // Try to get any thread first
      const threadList = JSON.parse(await callTool(client, "list_threads", { project_id: "test-novel" }));
      if (threadList.results.length === 0) {
        log("7", "SKIP", "No threads in test-novel, skipping");
      } else {
        const threadId = threadList.results[0].thread_id;
        const arcText = await callTool(client, "get_thread_arc", { thread_id: threadId });
        const parsed = JSON.parse(arcText);
        
        if (parsed.thread && parsed.results && parsed.total_count !== undefined) {
          log("7", "PASS", `Envelope with thread name: "${parsed.thread.name}", results: ${parsed.results.length}`);
        } else {
          log("7", "FAIL", `Missing envelope fields: ${JSON.stringify(Object.keys(parsed))}`);
        }
      }
    } catch (err) {
      log("7", "FAIL", err.message);
    }

    // ========================================================================
    // 8. get_thread_arc unknown thread
    // ========================================================================
    console.log("\n=== Scenario 8: get_thread_arc with fake thread_id ===");
    try {
      const text = await callTool(client, "get_thread_arc", { thread_id: "fake-thread-999" });
      // Currently expects text error message
      if (text.toLowerCase().includes("not found")) {
        log("8", "PASS", `Error handling works: "${text.slice(0, 50)}..."`);
      } else {
        log("8", "WARN", `Unexpected response: "${text.slice(0, 80)}..."`);
      }
    } catch (err) {
      log("8", "FAIL", err.message);
    }

    // ========================================================================
    // 9. Warning behavior (scenes with stale metadata)
    // ========================================================================
    console.log("\n=== Scenario 9: Warning on stale metadata ===");
    try {
      const text = await callTool(client, "get_arc", { character_id: "char-mira-nystrom" });
      const parsed = JSON.parse(text);
      
      const hasStaleScenes = parsed.results.some(s => s.metadata_stale);
      const hasWarning = parsed.warning !== undefined;
      
      if (hasStaleScenes && hasWarning) {
        log("9", "PASS", `Stale scenes detected: ${hasStaleScenes}, warning included: "${parsed.warning.slice(0, 60)}..."`);
      } else if (!hasStaleScenes) {
        log("9", "SKIP", "No stale scenes in test data");
      } else {
        log("9", "FAIL", `Stale scenes found but no warning`);
      }
    } catch (err) {
      log("9", "FAIL", err.message);
    }

    // ========================================================================
    // 10. Page bounds behavior (page far beyond total_pages)
    // ========================================================================
    console.log("\n=== Scenario 10: Page bounds (page beyond range) ===");
    try {
      const resp = JSON.parse(await callTool(client, "find_scenes", { project_id: "the-lamb", page_size: 5, page: 9999 }));
      
      if (resp.page <= resp.total_pages && !isNaN(resp.page)) {
        log("10", "PASS", `Page normalized to ${resp.page} of ${resp.total_pages}`);
      } else {
        log("10", "FAIL", `Page not normalized: ${resp.page} > ${resp.total_pages}`);
      }
    } catch (err) {
      log("10", "FAIL", err.message);
    }

    // ========================================================================
    // 11. Cross-tool shape consistency
    // ========================================================================
    console.log("\n=== Scenario 11: Cross-tool shape consistency ===");
    try {
      const fs = JSON.parse(await callTool(client, "find_scenes", { project_id: "the-lamb", page_size: 1 }));
      const ga = JSON.parse(await callTool(client, "get_arc", { character_id: "char-mira-nystrom", page_size: 1 }));
      const sm = JSON.parse(await callTool(client, "search_metadata", { query: "scene", page_size: 1 }));
      const lt = JSON.parse(await callTool(client, "list_threads", { project_id: "the-lamb" }));

      const commonFields = ["results", "total_count"];
      const fsHas = commonFields.every(f => f in fs);
      const gaHas = commonFields.every(f => f in ga);
      const smHas = commonFields.every(f => f in sm);
      const ltHas = commonFields.every(f => f in lt);

      if (fsHas && gaHas && smHas && ltHas) {
        log("11", "PASS", `All tools have results + total_count envelope`);
      } else {
        log("11", "FAIL", `Missing fields: fs=${fsHas}, ga=${gaHas}, sm=${smHas}, lt=${ltHas}`);
      }
    } catch (err) {
      log("11", "FAIL", err.message);
    }

    // ========================================================================
    // 12. Client-mapping smoke test
    // ========================================================================
    console.log("\n=== Scenario 12: Client mapping smoke test ===");
    try {
      const smoke = {
        fs: JSON.parse(await callTool(client, "find_scenes", { project_id: "the-lamb" })),
        ga: JSON.parse(await callTool(client, "get_arc", { character_id: "char-mira-nystrom" })),
        sm: JSON.parse(await callTool(client, "search_metadata", { query: "scene" })),
        lt: JSON.parse(await callTool(client, "list_threads", { project_id: "the-lamb" })),
      };

      const allValid = Object.values(smoke).every(obj => obj !== null && typeof obj === "object");
      
      if (allValid) {
        log("12", "PASS", `All 4 tools parsed as valid JSON objects`);
      } else {
        log("12", "FAIL", `Some responses did not parse as JSON`);
      }
    } catch (err) {
      log("12", "FAIL", err.message);
    }

  } finally {
    await client.close();
  }

  // ============================================================================
  // Print summary table
  // ============================================================================
  console.log("\n\n" + "=".repeat(80));
  console.log("SUMMARY TABLE");
  console.log("=".repeat(80));
  console.log("\n");

  const passCount = results.filter(r => r.status === "PASS").length;
  const failCount = results.filter(r => r.status === "FAIL").length;
  const skipCount = results.filter(r => r.status === "SKIP").length;
  const warnCount = results.filter(r => r.status === "WARN").length;

  console.table(results);
  console.log(`\nPASS: ${passCount}, FAIL: ${failCount}, SKIP: ${skipCount}, WARN: ${warnCount}`);
}

runScenarios().catch(console.error);
