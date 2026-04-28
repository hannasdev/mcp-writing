import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3069, 3068);
let writeSyncDir;
const callWriteTool = (n, a) => ctx.callWriteTool(n, a);

before(async () => {
  try {
    await ctx.setup();
    writeSyncDir = ctx.writeSyncDir;
  } finally {
    if (!writeSyncDir) {
      await ctx.teardown();
    }
  }
});

after(async () => {
  await ctx.teardown();
});

describe("commit_edit behavior", () => {
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
    assert.ok(
      commitResult.snapshot_commit === null || typeof commitResult.snapshot_commit === "string",
      "snapshot_commit should be either null or a commit hash string",
    );
    if (typeof commitResult.snapshot_commit === "string") {
      assert.notEqual(commitResult.snapshot_commit, "");
    }
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

  test("treats trailing CRLF in revised prose as noop", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");

    const seedProposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-002",
      instruction: "Seed prose for CRLF noop coverage",
      revised_prose: "CRLF newline normalization coverage.",
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
      instruction: "Retry identical edit with trailing CRLF",
      revised_prose: `${normalizedProse}\r\n`,
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

  test("reindexes scene metadata on noop commit when prose changed out-of-band", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");

    const seedProposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Normalize scene formatting",
      revised_prose: "Seed prose for noop reindex coverage.",
    });
    const seedProposal = JSON.parse(seedProposalText);
    await callWriteTool("commit_edit", {
      scene_id: "sc-001",
      proposal_id: seedProposal.proposal_id,
    });

    const normalizedRaw = fs.readFileSync(scenePath, "utf8");
    const frontmatterPrefix = normalizedRaw.match(/^---\n[\s\S]*?---\n\n/u)?.[0];
    assert.ok(frontmatterPrefix, "expected canonical frontmatter prefix");

    const outOfBandProse = "One two three four five six seven eight nine ten.";
    fs.writeFileSync(scenePath, `${frontmatterPrefix}${outOfBandProse}\n`, "utf8");

    const beforeText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      part: 1,
      chapter: 1,
    });
    const beforeRows = JSON.parse(beforeText);
    const beforeScene = beforeRows.find((row) => row.scene_id === "sc-001");
    assert.ok(beforeScene);
    assert.notEqual(beforeScene.word_count, 10);

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Retry identical edit after external change",
      revised_prose: outOfBandProse,
    });
    const proposal = JSON.parse(proposalText);
    assert.equal(proposal.noop, true);

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-001",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    assert.equal(commitResult.ok, true);
    assert.equal(commitResult.noop, true);

    const afterText = await callWriteTool("find_scenes", {
      project_id: "test-novel",
      part: 1,
      chapter: 1,
    });
    const afterRows = JSON.parse(afterText);
    const afterScene = afterRows.find((row) => row.scene_id === "sc-001");
    assert.ok(afterScene);
    assert.equal(afterScene.word_count, 10);
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
