import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const BASE_URL = "http://localhost:3000";

const client = new Client({ name: "test-client", version: "1.0.0" });
const transport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
await client.connect(transport);

let passed = 0;
let failed = 0;

async function test(label, toolName, args, check) {
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = result.content?.[0]?.text ?? "";
    const ok = check(text);
    if (ok) {
      console.log(`  ✓  ${label}`);
      passed++;
    } else {
      console.log(`  ✗  ${label}`);
      console.log(`     Output: ${text.slice(0, 200)}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗  ${label} — ERROR: ${err.message}`);
    failed++;
  }
}

console.log("\n── sync ──────────────────────────────────────────────────────");
await test(
  "sync returns indexed count",
  "sync", {},
  t => t.includes("3 scenes indexed")
);

console.log("\n── find_scenes ───────────────────────────────────────────────");
await test(
  "find all scenes returns 3",
  "find_scenes", {},
  t => (t.match(/"scene_id"/g) ?? []).length === 3
);

await test(
  "filter by character elena returns 3 scenes",
  "find_scenes", { character: "elena" },
  t => (t.match(/"scene_id"/g) ?? []).length === 3
);

await test(
  "filter by character marcus returns 2 scenes (sc-001, sc-002)",
  "find_scenes", { character: "marcus" },
  t => (t.match(/"scene_id"/g) ?? []).length === 2
);

await test(
  "filter by beat 'Catalyst' returns sc-003",
  "find_scenes", { beat: "Catalyst" },
  t => t.includes("sc-003") && !(t.includes("sc-001")) && !(t.includes("sc-002"))
);

await test(
  "filter by chapter 1 returns 2 scenes",
  "find_scenes", { chapter: 1 },
  t => (t.match(/"scene_id"/g) ?? []).length === 2
);

await test(
  "filter by tag 'harbor' returns scenes 001 and 002",
  "find_scenes", { tag: "harbor" },
  t => t.includes("sc-001") && t.includes("sc-002") && !t.includes("sc-003")
);

console.log("\n── get_scene_prose ───────────────────────────────────────────");
await test(
  "returns prose for sc-001",
  "get_scene_prose", { scene_id: "sc-001" },
  t => t.includes("gangway") && t.includes("Marcus")
);

await test(
  "returns prose for sc-003",
  "get_scene_prose", { scene_id: "sc-003" },
  t => t.includes("father") && t.includes("envelope")
);

await test(
  "returns error for unknown scene",
  "get_scene_prose", { scene_id: "sc-999" },
  t => t.includes("not found")
);

console.log("\n── get_chapter_prose ─────────────────────────────────────────");
await test(
  "returns both scenes from part 1 chapter 1",
  "get_chapter_prose", { project_id: "test-novel", part: 1, chapter: 1 },
  t => t.includes("gangway") && t.includes("bait shed")
);

console.log("\n── get_arc ───────────────────────────────────────────────────");
await test(
  "elena arc returns 3 scenes in order",
  "get_arc", { character_id: "elena" },
  t => {
    const ids = [...t.matchAll(/"scene_id": "([^"]+)"/g)].map(m => m[1]);
    return ids.length === 3 && ids[0] === "sc-001" && ids[2] === "sc-003";
  }
);

await test(
  "marcus arc returns only 2 scenes",
  "get_arc", { character_id: "marcus" },
  t => (t.match(/"scene_id"/g) ?? []).length === 2
);

console.log("\n── list_characters ───────────────────────────────────────────");
await test(
  "lists elena and marcus",
  "list_characters", {},
  t => t.includes("elena") && t.includes("marcus")
);

console.log("\n── get_character_sheet ───────────────────────────────────────");
await test(
  "elena sheet includes traits and notes",
  "get_character_sheet", { character_id: "elena" },
  t => t.includes("driven") && t.includes("self-sabotaging") && t.includes("walls")
);

await test(
  "marcus sheet includes arc_summary",
  "get_character_sheet", { character_id: "marcus" },
  t => t.includes("loyalty") && t.includes("patient")
);

console.log("\n── list_places ───────────────────────────────────────────────");
await test(
  "lists harbor-district",
  "list_places", {},
  t => t.includes("harbor-district")
);

console.log("\n── search_metadata ───────────────────────────────────────────");
await test(
  "search 'harbor' returns relevant scenes",
  "search_metadata", { query: "harbor" },
  t => t.includes("sc-001") || t.includes("sc-002")
);

await test(
  "search 'envelope' returns sc-003 (word in logline)",
  "search_metadata", { query: "envelope" },
  t => t.includes("sc-003")
);

await test(
  "search with no match returns helpful message",
  "search_metadata", { query: "dragons" },
  t => t.toLowerCase().includes("no scenes")
);

console.log("\n── list_threads ──────────────────────────────────────────────");
await test(
  "returns empty / no threads message (none created yet)",
  "list_threads", { project_id: "projects/test-novel" },
  t => t.toLowerCase().includes("no threads")
);

console.log("\n──────────────────────────────────────────────────────────────");
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

await client.close();
process.exit(failed > 0 ? 1 : 0);
