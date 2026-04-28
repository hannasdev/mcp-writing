import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3069, 3068);
let writeSyncDir, readSyncDir;

before(async () => {
  await ctx.setup();
  writeSyncDir = ctx.writeSyncDir;
  readSyncDir = ctx.readSyncDir;
});

after(async () => {
  await ctx.teardown();
});

const callTool = (n, a) => ctx.callTool(n, a);
const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
const waitForAsyncJob = (id, t) => ctx.waitForAsyncJob(id, t);
describe("commit_edit preflight diagnostics", () => {
  test("applies a revised scene file on commit", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Tighten opening paragraph",
      revised_prose: "Rewritten opening line.\nSecond line.",
    });
    const proposal = JSON.parse(proposalText);

    assert.equal(proposal.noop, false);

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-001",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    const after = fs.readFileSync(scenePath, "utf8");

    assert.equal(commitResult.ok, true);
    assert.equal(commitResult.noop, false);
    assert.match(commitResult.message, /Applied edit to scene 'sc-001'/);
    assert.notEqual(commitResult.snapshot_commit, null);
    assert.notEqual(after, before);
    assert.match(after, /Rewritten opening line\.\nSecond line\./);
  });

  test("returns noop when the proposal matches the current scene file", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");

    const seedProposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-002",
      instruction: "Normalize scene formatting",
      revised_prose: "Fresh prose for noop detection.",
    });
    const seedProposal = JSON.parse(seedProposalText);
    await callWriteTool("commit_edit", {
      scene_id: "sc-002",
      proposal_id: seedProposal.proposal_id,
    });

    const normalizedRaw = fs.readFileSync(scenePath, "utf8");
    const normalizedProse = matter(normalizedRaw).content.trim();

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-002",
      instruction: "Retry identical edit",
      revised_prose: normalizedProse,
    });
    const proposal = JSON.parse(proposalText);

    assert.equal(proposal.noop, true);
    assert.equal(proposal.diff_preview, "(no changes)");

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-002",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    const after = fs.readFileSync(scenePath, "utf8");

    assert.equal(commitResult.ok, true);
    assert.equal(commitResult.noop, true);
    assert.equal(commitResult.snapshot_commit, null);
    assert.match(commitResult.message, /Nothing was written\./);
    assert.equal(after, normalizedRaw);
  });

  test("returns STALE_PATH when indexed prose file is missing", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Tighten opening paragraph",
      revised_prose: "Revised prose for stale path test.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const originalContent = fs.readFileSync(scenePath, "utf8");
    try {
      fs.unlinkSync(scenePath);

      const commitText = await callWriteTool("commit_edit", {
        scene_id: "sc-001",
        proposal_id: proposal.proposal_id,
      });
      const commitResult = JSON.parse(commitText);

      assert.equal(commitResult.ok, false);
      assert.equal(commitResult.error.code, "STALE_PATH");
      assert.equal(commitResult.error.details?.prose_write_diagnostics?.exists, false);
    } finally {
      if (!fs.existsSync(scenePath)) {
        fs.writeFileSync(scenePath, originalContent, "utf8");
      }
    }
  });

  test("returns INVALID_PROSE_PATH when indexed prose path points to a directory", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-003",
      instruction: "Try writing to non-file path",
      revised_prose: "Revised prose for invalid path test.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const originalScenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.md");
    const replacementPath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003-original.md");
    try {
      fs.renameSync(originalScenePath, replacementPath);
      fs.mkdirSync(originalScenePath, { recursive: true });

      const commitText = await callWriteTool("commit_edit", {
        scene_id: "sc-003",
        proposal_id: proposal.proposal_id,
      });
      const commitResult = JSON.parse(commitText);

      assert.equal(commitResult.ok, false);
      assert.equal(commitResult.error.code, "INVALID_PROSE_PATH");
      assert.equal(commitResult.error.details?.prose_write_diagnostics?.is_file, false);
    } finally {
      if (fs.existsSync(originalScenePath) && fs.statSync(originalScenePath).isDirectory()) {
        fs.rmSync(originalScenePath, { recursive: true, force: true });
      }
      if (fs.existsSync(replacementPath) && !fs.existsSync(originalScenePath)) {
        fs.renameSync(replacementPath, originalScenePath);
      }
    }
  });
});
