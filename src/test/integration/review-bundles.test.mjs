import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestContext } from "../helpers/server.js";

const ctx = createTestContext(3071, 3070);
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
describe("preview_review_bundle tool", () => {
  test("returns dry-run plan for outline profile", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "outline_discussion",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile, "outline_discussion");
    assert.equal(parsed.summary.scene_count, 3);
    assert.equal(parsed.strictness_result.can_proceed, true);
    assert.ok(Array.isArray(parsed.planned_outputs));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".pdf")));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".manifest.json")));
  });

  test("applies scene_ids as intersection with other filters", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "outline_discussion",
      chapter: 1,
      scene_ids: ["sc-001", "sc-003"],
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.summary.scene_count, 1);
    assert.deepEqual(parsed.ordering.map(row => row.scene_id), ["sc-001"]);
    assert.deepEqual(parsed.summary.excluded_scene_ids, ["sc-003"]);
  });

  test("strictness fail reports blockers when stale metadata exists", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nStale marker line for review bundle strictness test.\n`, "utf8");
    await callWriteTool("sync");

    const text = await callWriteTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "editor_detailed",
      strictness: "fail",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.strictness_result.can_proceed, false);
    assert.ok(parsed.strictness_result.blockers.some(blocker => blocker.code === "STALE_METADATA"));
  });

  test("beta profile preview includes planned notice + feedback outputs", async () => {
    const text = await callTool("preview_review_bundle", {
      project_id: "test-novel",
      profile: "beta_reader_personalized",
      recipient_name: "Jordan Example",
      format: "both",
    });
    const parsed = JSON.parse(text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.profile, "beta_reader_personalized");
    assert.equal(parsed.resolved_scope.options.recipient_name, "Jordan Example");
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".notice.md")));
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".feedback-form.md")));
    assert.ok(
      parsed.planned_outputs.some(
        name =>
          name.endsWith(".md") &&
          !name.endsWith(".notice.md") &&
          !name.endsWith(".feedback-form.md")
      )
    );
    assert.ok(parsed.planned_outputs.some(name => name.endsWith(".manifest.json")));
  });
});

describe("create_review_bundle tool", () => {
  test("writes outline bundle markdown + manifest to output_dir", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-outline-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
        bundle_name: "editorial-outline",
        source_commit: "test-commit-hash",
        format: "markdown",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_markdown);
      assert.ok(parsed.output_paths?.manifest_json);
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));
      assert.ok(fs.existsSync(parsed.output_paths.manifest_json));

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("# Review Bundle: test-novel"));
      assert.ok(markdown.includes("## The Return"));
      assert.ok(!markdown.includes("She was at the bottom of the gangway"));

      const manifest = JSON.parse(fs.readFileSync(parsed.output_paths.manifest_json, "utf8"));
      assert.equal(manifest.profile, "outline_discussion");
      assert.equal(manifest.provenance.source_commit, "test-commit-hash");
      assert.equal(manifest.summary.scene_count, 3);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes editor bundle with prose and paragraph anchors", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-editor-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "editor_detailed",
        output_dir: outDir,
        include_paragraph_anchors: true,
        format: "markdown",
      });
      const parsed = JSON.parse(text);
      assert.equal(parsed.ok, true);

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("<!-- sc-001:p1 -->"));
      assert.ok(markdown.includes("She was at the bottom of the gangway"));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes beta bundle markdown + notice + feedback artifacts", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-beta-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        output_dir: outDir,
        recipient_name: "Jordan Example",
        format: "markdown",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_markdown);
      assert.ok(parsed.output_paths?.manifest_json);
      assert.ok(parsed.output_paths?.notice_md);
      assert.ok(parsed.output_paths?.feedback_form_md);
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));
      assert.ok(fs.existsSync(parsed.output_paths.manifest_json));
      assert.ok(fs.existsSync(parsed.output_paths.notice_md));
      assert.ok(fs.existsSync(parsed.output_paths.feedback_form_md));

      const markdown = fs.readFileSync(parsed.output_paths.bundle_markdown, "utf8");
      assert.ok(markdown.includes("- Profile: beta_reader_personalized"));
      assert.ok(markdown.includes("- Recipient: Jordan Example"));
      assert.ok(markdown.includes("She was at the bottom of the gangway"));

      const manifest = JSON.parse(fs.readFileSync(parsed.output_paths.manifest_json, "utf8"));

      const notice = fs.readFileSync(parsed.output_paths.notice_md, "utf8");
      assert.ok(notice.includes("Non-Distribution Notice"));
      assert.ok(notice.includes("Jordan Example"));

      const feedback = fs.readFileSync(parsed.output_paths.feedback_form_md, "utf8");
      assert.ok(feedback.includes("Beta Reader Feedback Form"));
      assert.ok(feedback.includes("Jordan Example"));
      assert.ok(feedback.includes(`- Date: ${manifest.generated_at.slice(0, 10)}`));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes outline bundle PDF by default", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-pdf-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_pdf, "bundle_pdf path should be present");
      assert.ok(!parsed.output_paths?.bundle_markdown, "bundle_markdown should not be present for format=pdf");
      assert.ok(fs.existsSync(parsed.output_paths.bundle_pdf), "PDF file should exist on disk");

      const pdfBytes = fs.readFileSync(parsed.output_paths.bundle_pdf);
      assert.ok(pdfBytes.slice(0, 4).toString() === "%PDF", "file should start with PDF magic bytes");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("writes both markdown and PDF when format=both", async () => {
    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-both-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
        format: "both",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, true);
      assert.ok(parsed.output_paths?.bundle_pdf, "bundle_pdf path should be present");
      assert.ok(parsed.output_paths?.bundle_markdown, "bundle_markdown path should be present");
      assert.ok(fs.existsSync(parsed.output_paths.bundle_pdf));
      assert.ok(fs.existsSync(parsed.output_paths.bundle_markdown));

      const pdfBytes = fs.readFileSync(parsed.output_paths.bundle_pdf);
      assert.ok(pdfBytes.slice(0, 4).toString() === "%PDF");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("returns STRICTNESS_BLOCKED when fail mode sees stale metadata", async () => {
    const scenePath = path.join(writeSyncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md");
    const before = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(scenePath, `${before}\n\nStale marker line for create bundle strictness test.\n`, "utf8");
    await callWriteTool("sync");

    const outDir = fs.mkdtempSync(path.join(writeSyncDir, "review-bundles-blocked-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "editor_detailed",
        output_dir: outDir,
        strictness: "fail",
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "STRICTNESS_BLOCKED");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.writeFileSync(scenePath, before, "utf8");
      await callWriteTool("enrich_scene", { scene_id: "sc-002", project_id: "test-novel" });
    }
  });

  test("returns INVALID_OUTPUT_DIR when output_dir is outside WRITING_SYNC_DIR", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-bundle-outside-"));
    try {
      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: outDir,
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "INVALID_OUTPUT_DIR");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("returns INVALID_OUTPUT_DIR when output_dir routes through a symlink outside WRITING_SYNC_DIR", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-bundle-symlink-outside-"));
    const symlinkDir = path.join(writeSyncDir, "exports-link");
    try {
      fs.symlinkSync(outsideDir, symlinkDir, "dir");

      const text = await callWriteTool("create_review_bundle", {
        project_id: "test-novel",
        profile: "outline_discussion",
        output_dir: path.join(symlinkDir, "nested-output"),
      });
      const parsed = JSON.parse(text);

      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "INVALID_OUTPUT_DIR");
    } finally {
      fs.rmSync(symlinkDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
