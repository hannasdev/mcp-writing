import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3069, 3068);
const requiredCtx = createTestContext(3089, 3088, {
  PROSE_STYLEGUIDE_ENFORCEMENT_MODE: "required",
});
let writeSyncDir;
let requiredWriteSyncDir;
const callWriteTool = (n, a) => ctx.callWriteTool(n, a);
const callRequiredWriteTool = (n, a) => requiredCtx.callWriteTool(n, a);
const toSceneRows = (parsed) => (Array.isArray(parsed) ? parsed : parsed.results);

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

before(async () => {
  try {
    await requiredCtx.setup();
    requiredWriteSyncDir = requiredCtx.writeSyncDir;
  } finally {
    if (!requiredWriteSyncDir) {
      await requiredCtx.teardown();
    }
  }
});

after(async () => {
  await requiredCtx.teardown();
});

describe("commit_edit behavior", { concurrency: 1 }, () => {
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
    assert.equal(typeof proposal.next_step, "string");
    assert.ok(proposal.next_step.includes("commit_edit"));

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
    assert.equal(typeof commitResult.next_step, "string");
    assert.ok(commitResult.next_step.includes("get_scene_prose"));
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
    assert.equal(typeof proposal.next_step, "string");
    assert.ok(proposal.next_step.includes("no action"));

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
    assert.equal(typeof commitResult.next_step, "string");
    assert.ok(commitResult.next_step.includes("propose_edit"));
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
    const beforeRows = toSceneRows(JSON.parse(beforeText));
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
    const afterRows = toSceneRows(JSON.parse(afterText));
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

  test("propose_edit returns CONFLICT for ambiguous scene_id without project_id", async () => {
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-edit", "scenes", "shared.md");
    const betaScenePath = path.join(writeSyncDir, "projects", "beta-edit", "scenes", "shared.md");
    fs.mkdirSync(path.dirname(alphaScenePath), { recursive: true });
    fs.mkdirSync(path.dirname(betaScenePath), { recursive: true });
    fs.writeFileSync(alphaScenePath, "---\nscene_id: sc-edit-shared-001\ntitle: Alpha Shared\n---\nAlpha edit prose.");
    fs.writeFileSync(betaScenePath, "---\nscene_id: sc-edit-shared-001\ntitle: Beta Shared\n---\nBeta edit prose.");

    await callWriteTool("sync");

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-edit-shared-001",
      instruction: "Tighten opening line",
      revised_prose: "Rewritten shared prose.",
    });
    const proposal = JSON.parse(proposalText);
    assert.equal(proposal.ok, false);
    assert.equal(proposal.error.code, "CONFLICT");
    assert.ok(Array.isArray(proposal.error.details.project_ids));
    assert.ok(proposal.error.details.project_ids.includes("alpha-edit"));
    assert.ok(proposal.error.details.project_ids.includes("beta-edit"));
  });

  test("propose_edit + commit_edit works with explicit project_id disambiguation", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-edit-shared-001",
      project_id: "beta-edit",
      instruction: "Tighten opening line",
      revised_prose: "Beta rewritten prose line.",
    });
    const proposal = JSON.parse(proposalText);
    assert.equal(proposal.noop, false);
    assert.equal(proposal.project_id, "beta-edit");

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-edit-shared-001",
      project_id: "beta-edit",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    assert.equal(commitResult.ok, true);
    assert.equal(commitResult.project_id, "beta-edit");
    assert.equal(typeof commitResult.next_step, "string");
    assert.ok(commitResult.next_step.includes("get_scene_prose"));

    const betaScenePath = path.join(writeSyncDir, "projects", "beta-edit", "scenes", "shared.md");
    const alphaScenePath = path.join(writeSyncDir, "projects", "alpha-edit", "scenes", "shared.md");
    const betaAfter = fs.readFileSync(betaScenePath, "utf8");
    const alphaAfter = fs.readFileSync(alphaScenePath, "utf8");

    assert.ok(betaAfter.includes("Beta rewritten prose line."));
    assert.ok(alphaAfter.includes("Alpha edit prose."));
  });

  test("commit_edit returns CONFLICT for ambiguous scene_id when project_id is omitted", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-edit-shared-001",
      project_id: "alpha-edit",
      instruction: "Adjust line",
      revised_prose: "Alpha rewritten prose line without explicit project on commit.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-edit-shared-001",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    assert.equal(commitResult.ok, false);
    assert.equal(commitResult.error.code, "CONFLICT");
    assert.ok(Array.isArray(commitResult.error.details.project_ids));
    assert.ok(commitResult.error.details.project_ids.includes("alpha-edit"));
    assert.ok(commitResult.error.details.project_ids.includes("beta-edit"));
    assert.equal(commitResult.error.details.proposal_project_id, "alpha-edit");
  });

  test("commit_edit rejects mismatched project_id for proposal", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-edit-shared-001",
      project_id: "alpha-edit",
      instruction: "Adjust line",
      revised_prose: "Alpha rewritten prose line.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-edit-shared-001",
      project_id: "beta-edit",
      proposal_id: proposal.proposal_id,
    });
    const commitResult = JSON.parse(commitText);
    assert.equal(commitResult.ok, false);
    assert.equal(commitResult.error.code, "INVALID_EDIT");
    assert.match(commitResult.error.message, /for project 'alpha-edit'/);
  });

  test("discard_edit returns next_step guidance", async () => {
    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-003",
      instruction: "Draft and discard test",
      revised_prose: "Discarded rewrite candidate.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const discardText = await callWriteTool("discard_edit", { proposal_id: proposal.proposal_id });
    const discarded = JSON.parse(discardText);
    assert.equal(discarded.ok, true);
    assert.equal(typeof discarded.next_step, "string");
    assert.ok(discarded.next_step.includes("propose_edit"));
  });

  test("list_snapshots returns CONFLICT for ambiguous scene_id without project_id", async () => {
    const text = await callWriteTool("list_snapshots", { scene_id: "sc-edit-shared-001" });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "CONFLICT");
    assert.ok(parsed.error.details.project_ids.includes("alpha-edit"));
    assert.ok(parsed.error.details.project_ids.includes("beta-edit"));
  });

  test("list_snapshots scopes history with explicit project_id", async () => {
    const text = await callWriteTool("list_snapshots", {
      scene_id: "sc-edit-shared-001",
      project_id: "beta-edit",
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.project_id, "beta-edit");
    assert.ok(Array.isArray(parsed.snapshots));
    assert.ok(parsed.snapshots.length >= 1);
  });
});

describe("styleguide enforcement behavior", { concurrency: 1 }, () => {
  test("includes styleguide metadata and violations in propose_edit response", async () => {
    const setupText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_uk",
      overwrite: true,
      overrides: {
        quotation_style: "single",
      },
    });
    const setupParsed = JSON.parse(setupText);
    assert.equal(setupParsed.ok, true);

    const skillText = await callWriteTool("setup_prose_styleguide_skill", { overwrite: true });
    const skillParsed = JSON.parse(skillText);
    assert.equal(skillParsed.ok, true);

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Styleguide metadata coverage",
      revised_prose: '"I am here now," she says.',
    });
    const proposal = JSON.parse(proposalText);

    assert.equal(typeof proposal.styleguide, "object");
    assert.equal(proposal.styleguide.styleguide_applied, true);
    assert.equal(proposal.styleguide.enforcement_mode, "warn");
    assert.equal(typeof proposal.styleguide.fingerprint, "string");
    assert.ok(Array.isArray(proposal.styleguide.violations));
    assert.ok(proposal.styleguide.violations.some((entry) => entry.field === "quotation_style"));
  });

  test("blocks commit_edit when styleguide changes after propose_edit", async () => {
    const setupText = await callWriteTool("setup_prose_styleguide_config", {
      scope: "sync_root",
      language: "english_uk",
      overwrite: true,
      overrides: {
        quotation_style: "single",
      },
    });
    assert.equal(JSON.parse(setupText).ok, true);

    const skillText = await callWriteTool("setup_prose_styleguide_skill", { overwrite: true });
    assert.equal(JSON.parse(skillText).ok, true);

    const proposalText = await callWriteTool("propose_edit", {
      scene_id: "sc-002",
      instruction: "Prepare proposal before styleguide change",
      revised_prose: "'I was there,' she said.",
    });
    const proposal = JSON.parse(proposalText);
    assert.ok(proposal.proposal_id);

    const updateText = await callWriteTool("update_prose_styleguide_config", {
      scope: "sync_root",
      updates: {
        quotation_style: "double",
      },
    });
    const updateParsed = JSON.parse(updateText);
    assert.equal(updateParsed.ok, true);

    const commitText = await callWriteTool("commit_edit", {
      scene_id: "sc-002",
      proposal_id: proposal.proposal_id,
    });
    const commitParsed = JSON.parse(commitText);
    assert.equal(commitParsed.ok, false);
    assert.equal(commitParsed.error.code, "STYLEGUIDE_CHANGED_SINCE_PROPOSAL");
  });

  test("required mode blocks propose_edit when no styleguide config exists", async () => {
    const configPath = path.join(requiredWriteSyncDir, "prose-styleguide.config.yaml");
    fs.rmSync(configPath, { force: true });

    const proposalText = await callRequiredWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Required mode should block",
      revised_prose: "No config should block this.",
    });
    const proposal = JSON.parse(proposalText);
    assert.equal(proposal.ok, false);
    assert.equal(proposal.error.code, "STYLEGUIDE_CONFIG_REQUIRED");
  });

  test("required mode allows bypass with explicit reason", async () => {
    const proposalText = await callRequiredWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Bypass required mode",
      revised_prose: "Bypass this styleguide check.",
      bypass_styleguide: true,
      bypass_reason: "Intentional one-off exception for draft exploration",
    });
    const proposal = JSON.parse(proposalText);

    assert.equal(typeof proposal.proposal_id, "string");
    assert.equal(proposal.styleguide.bypass_used, true);
    assert.equal(proposal.styleguide.styleguide_applied, false);
  });

  test("requires bypass_reason when bypass_styleguide is true", async () => {
    const proposalText = await callRequiredWriteTool("propose_edit", {
      scene_id: "sc-001",
      instruction: "Missing bypass reason",
      revised_prose: "Bypass should fail without reason.",
      bypass_styleguide: true,
    });
    const proposal = JSON.parse(proposalText);

    assert.equal(proposal.ok, false);
    assert.equal(proposal.error.code, "STYLEGUIDE_BYPASS_REASON_REQUIRED");
  });
});
