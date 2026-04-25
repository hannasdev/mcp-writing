#!/usr/bin/env node

/**
 * Profile review-bundle generation performance
 * Usage: node --experimental-sqlite scripts/profile-review-bundles.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb } from "../db.js";
import { syncAll } from "../sync.js";
import { isGitRepository, getHeadCommitHash } from "../git.js";
import {
  buildReviewBundlePlan,
  createReviewBundleArtifacts,
} from "../review-bundles.js";

const PROJECT_SYNC_DIR = process.env.WRITING_SYNC_DIR ?? process.argv[2] ?? null;
const DB_PATH = process.env.DB_PATH ?? (PROJECT_SYNC_DIR ? path.join(PROJECT_SYNC_DIR, ".mcp", "writing.db") : null);
const PROFILES = ["outline_discussion", "editor_detailed", "beta_reader_personalized"];

/**
 * @typedef {Object} ProfileResult
 * @property {string} scenario
 * @property {string} profile
 * @property {number} sceneCount
 * @property {number} wordCount
 * @property {number} durationMs
 * @property {number} [outputSize]
 */

/**
 * @param {string} syncDir
 * @param {string} projectId
 * @param {string} profile
 * @param {Record<string, any>} [filters={}]
 * @returns {Promise<ProfileResult|null>}
 */
async function profileScenario(
  syncDir,
  projectId,
  profile,
  filters = {}
) {
  console.log(
    `  Profiling ${profile} with ${JSON.stringify(filters || "full project")}...`
  );

  const db = await openDb(DB_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-"));

  try {
    // Time the planning phase
    const planStart = performance.now();
    let plan;
    try {
      plan = await buildReviewBundlePlan(db, {
        project_id: projectId,
        profile,
        ...filters,
      });
    } catch (err) {
      console.error(`  ✗ Planning failed: ${err.message}`);
      return null;
    }
    const planMs = performance.now() - planStart;

    // Time the artifact generation phase
    const createStart = performance.now();
    try {
      await createReviewBundleArtifacts(db, {
        plan,
        output_dir: tmpDir,
        syncDir,
        source_commit: await getHeadCommitHash(syncDir),
      });
    } catch (err) {
      console.error(`  ✗ Creation failed: ${err.message}`);
      return null;
    }
    const createMs = performance.now() - createStart;

    // Measure output size
    let outputSize = 0;
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      const filePath = path.join(tmpDir, file);
      const stat = fs.statSync(filePath);
      outputSize += stat.size;
    }

    const totalMs = planMs + createMs;
    const sceneCount = plan.ordering?.length ?? 0;
    const wordCount = plan.summary?.estimated_word_count ?? 0;

    console.log(
      `    ✓ ${sceneCount} scenes, ~${wordCount.toLocaleString()} words, ${outputSize.toLocaleString()} bytes`
    );
    console.log(`    Planning: ${planMs.toFixed(2)}ms, Creation: ${createMs.toFixed(2)}ms, Total: ${totalMs.toFixed(2)}ms`);

    return {
      scenario: `${projectId} ${JSON.stringify(filters || "full")}`,
      profile,
      sceneCount,
      wordCount,
      durationMs: totalMs,
      outputSize,
    };
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    db.close();
  }
}

async function main() {
  if (!PROJECT_SYNC_DIR) {
    console.error("✗ WRITING_SYNC_DIR env var or a path argument is required.");
    console.error("  Usage: WRITING_SYNC_DIR=/path/to/project node --experimental-sqlite scripts/profile-review-bundles.mjs");
    process.exit(1);
  }

  if (!fs.existsSync(PROJECT_SYNC_DIR)) {
    console.error(`✗ Project directory not found: ${PROJECT_SYNC_DIR}`);
    process.exit(1);
  }

  if (!isGitRepository(PROJECT_SYNC_DIR)) {
    console.error(`✗ Not a git repository: ${PROJECT_SYNC_DIR}`);
    process.exit(1);
  }

  console.log("🔍 Review Bundles Performance Profile");
  console.log(`   Sync Dir: ${PROJECT_SYNC_DIR}`);
  console.log(`   Starting: ${new Date().toISOString()}\n`);

  // Sync the database first
  console.log("📇 Syncing project database...");
  const syncDb = await openDb(DB_PATH);
  try {
    await syncAll(syncDb, PROJECT_SYNC_DIR);
  } finally {
    syncDb.close();
  }
  console.log("   ✓ Sync complete\n");

  const results = [];

  // Test scenarios for book-1-the-lamb (has 118 scenes)
  const projectId = "universe-1/book-1-the-lamb";

  console.log(`📖 Profiling ${projectId}:\n`);

  // Scenario 1: Full project with all profiles
  console.log("Scenario 1: Full project\n");
  for (const profile of PROFILES) {
    const result = await profileScenario(PROJECT_SYNC_DIR, projectId, profile);
    if (result) results.push(result);
  }

  // Scenario 2: Single chapter (if available)
  console.log("\nScenario 2: Single chapter (chapter 1)\n");
  for (const profile of PROFILES) {
    const result = await profileScenario(PROJECT_SYNC_DIR, projectId, profile, {
      chapter: 1,
    });
    if (result) results.push(result);
  }

  // Scenario 3: Subset by tag (if available)
  console.log("\nScenario 3: Subset by tag (first 10 scenes)\n");
  for (const profile of PROFILES) {
    const result = await profileScenario(PROJECT_SYNC_DIR, projectId, profile, {
      scene_ids: ["sc-001", "sc-002", "sc-003", "sc-004", "sc-005", "sc-006", "sc-007", "sc-008", "sc-009", "sc-010"],
    });
    if (result) results.push(result);
  }

  // Print summary
  console.log("\n\n📊 Performance Summary\n");
  console.log("Profile | Scenario | Scenes | Words | Output (KB) | Duration (ms)");
  console.log(
    "--------|----------|--------|-------|-------------|---------------"
  );

  for (const result of results) {
    if (!result) continue;
    const outputKb = (result.outputSize / 1024).toFixed(1);
    const scenarioShort = result.scenario.replace(/universe-1\//, "").substring(0, 30);
    console.log(
      `${result.profile.padEnd(15)} | ${scenarioShort.padEnd(30)} | ${String(result.sceneCount).padEnd(6)} | ${String(result.wordCount).padEnd(5)} | ${outputKb.padEnd(11)} | ${result.durationMs.toFixed(2)}`
    );
  }

  // Analysis
  console.log("\n📈 Analysis:\n");

  const fullProjectResults = results.filter(
    (r) => r.scenario.includes("full")
  );
  const editorResults = fullProjectResults.filter(
    (r) => r.profile === "editor_detailed"
  );

  if (editorResults.length > 0) {
    const editorMs = editorResults[0].durationMs;
    console.log(`• Full project (editor_detailed): ${editorMs.toFixed(2)}ms`);

    if (editorMs > 5000) {
      console.log(
        "  ⚠️  Generation takes > 5s. Async generation would be beneficial."
      );
    } else if (editorMs > 1000) {
      console.log(
        "  ⚠️  Generation takes 1-5s. Async could improve UX for slow networks."
      );
    } else {
      console.log("  ✓ Generation is fast (< 1s). Sync is sufficient for now.");
    }
  }

  console.log(
    "\n✓ Profile complete: " + new Date().toISOString()
  );
}

main().catch((err) => {
  console.error("✗ Profile failed:", err);
  process.exit(1);
});
