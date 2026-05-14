import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { buildReviewBundlePlan, renderReviewBundleMarkdown, renderReviewBundlePdf, renderReviewBundlePdfWithMetadata, ReviewBundlePlanError, buildPageFingerprintToken, buildFingerprintSeed, buildFingerprintSeedHash, extractSceneDateline } from "../../review-bundles/review-bundles.js";
import { insertTestScene, setupReviewBundleTestDb } from "../helpers/db.js";
import { decodePdfHexText, extractPdfFlateText } from "../helpers/pdf.js";

describe("buildReviewBundlePlan", () => {
  test("orders scenes deterministically with timeline and scene_id fallback", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-002",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 400,
      });
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: null,
        wordCount: 500,
      });
      insertTestScene(db, {
        sceneId: "sc-003",
        part: 1,
        chapter: 2,
        timelinePosition: 1,
        wordCount: 300,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
      });

      assert.equal(plan.ok, true);
      assert.deepEqual(
        plan.ordering.map(row => row.scene_id),
        ["sc-002", "sc-001", "sc-003"]
      );
      assert.equal(plan.summary.estimated_word_count, 1200);
      assert.ok(plan.warning_summary.missing_ordering_fields);
    } finally {
      db.close();
    }
  });

  test("applies scene_ids as intersection with chapter filter", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 300,
      });
      insertTestScene(db, {
        sceneId: "sc-003",
        part: 1,
        chapter: 2,
        timelinePosition: 1,
        wordCount: 350,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        chapter: 1,
        scene_ids: ["sc-001", "sc-003"],
      });

      assert.deepEqual(plan.ordering.map(row => row.scene_id), ["sc-001"]);
      assert.deepEqual(plan.summary.excluded_scene_ids, ["sc-003"]);
      assert.ok(plan.warning_summary.requested_scene_ids_filtered_out);
    } finally {
      db.close();
    }
  });

  test("supports multi-chapter filtering via chapters array", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-101",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 220,
      });
      insertTestScene(db, {
        sceneId: "sc-102",
        part: 1,
        chapter: 2,
        timelinePosition: 1,
        wordCount: 240,
      });
      insertTestScene(db, {
        sceneId: "sc-103",
        part: 1,
        chapter: 3,
        timelinePosition: 1,
        wordCount: 260,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        chapters: [1, 3],
      });

      assert.deepEqual(plan.ordering.map(row => row.scene_id), ["sc-101", "sc-103"]);
      assert.deepEqual(plan.resolved_scope.filters.chapters, [1, 3]);
    } finally {
      db.close();
    }
  });

  test("normalizes chapters filter into sorted unique values", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-201",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
      });
      insertTestScene(db, {
        sceneId: "sc-202",
        part: 1,
        chapter: 3,
        timelinePosition: 1,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        chapters: [3, 1, 3],
      });

      assert.deepEqual(plan.resolved_scope.filters.chapters, [1, 3]);
      assert.deepEqual(plan.ordering.map(row => row.scene_id), ["sc-201", "sc-202"]);
    } finally {
      db.close();
    }
  });

  test("rejects using chapter and chapters together", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-104",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
      });
      assert.throws(
        () => buildReviewBundlePlan(db, {
          project_id: "test-novel",
          profile: "outline_discussion",
          chapter: 1,
          chapters: [1, 2],
        }),
        error => error instanceof ReviewBundlePlanError && error.code === "INVALID_CHAPTER_FILTER"
      );
    } finally {
      db.close();
    }
  });

  test("rejects scene_ids lists larger than the SQLite-safe planner limit", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 300,
      });

      const sceneIds = Array.from({ length: 901 }, (_, index) => `sc-${String(index + 1).padStart(4, "0")}`);

      assert.throws(
        () =>
          buildReviewBundlePlan(db, {
            project_id: "test-novel",
            profile: "outline_discussion",
            scene_ids: sceneIds,
          }),
        error =>
          error instanceof ReviewBundlePlanError &&
          error.code === "SCENE_IDS_TOO_LARGE" &&
          error.details?.max_scene_ids === 900
      );
    } finally {
      db.close();
    }
  });

  test("rejects chapters lists larger than the SQLite-safe planner limit", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
      });
      const chapters = Array.from({ length: 901 }, (_, index) => index + 1);
      assert.throws(
        () =>
          buildReviewBundlePlan(db, {
            project_id: "test-novel",
            profile: "outline_discussion",
            chapters,
          }),
        error =>
          error instanceof ReviewBundlePlanError &&
          error.code === "CHAPTERS_FILTER_TOO_LARGE" &&
          error.details?.max_chapters === 900
      );
    } finally {
      db.close();
    }
  });

  test("strictness fail blocks when stale scenes are included", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-001",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        metadataStale: 1,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
        strictness: "fail",
      });

      assert.equal(plan.strictness_result.can_proceed, false);
      assert.equal(plan.strictness_result.blockers[0].code, "STALE_METADATA");
      assert.ok(plan.warning_summary.metadata_stale);
    } finally {
      db.close();
    }
  });

  test("beta profile plans companion notice and feedback outputs", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-010",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Alex Reader",
        format: "both",
      });

      assert.equal(plan.ok, true);
      assert.equal(plan.resolved_scope.options.recipient_name, "Alex Reader");
      assert.ok(
        plan.planned_outputs.some(
          name =>
            name.endsWith(".md") &&
            !name.endsWith(".notice.md") &&
            !name.endsWith(".feedback-form.md")
        )
      );
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".pdf")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".notice.md")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".feedback-form.md")));
      assert.ok(plan.planned_outputs.some(name => name.endsWith(".manifest.json")));
    } finally {
      db.close();
    }
  });

  test("beta profile normalizes recipient_name in resolved options", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-011",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "  Jordan\n\tExample  ",
      });

      assert.equal(plan.resolved_scope.options.recipient_name, "Jordan Example");
    } finally {
      db.close();
    }
  });

  test("beta profile enables accountability option by default", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-012",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
      });

      assert.equal(plan.resolved_scope.options.beta_accountability, true);
    } finally {
      db.close();
    }
  });

  test("beta profile allows accountability option to be disabled", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-013",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
        beta_accountability: false,
      });

      assert.equal(plan.resolved_scope.options.beta_accountability, false);
    } finally {
      db.close();
    }
  });

  test("beta profile resolved options force metadata toggles off", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-014",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
        include_scene_ids: true,
        include_metadata_sidebar: true,
        include_paragraph_anchors: true,
      });

      assert.equal(plan.resolved_scope.options.include_scene_ids, false);
      assert.equal(plan.resolved_scope.options.include_metadata_sidebar, false);
      assert.equal(plan.resolved_scope.options.include_paragraph_anchors, false);
    } finally {
      db.close();
    }
  });

  test("outline profile defaults scene IDs off and allows explicit override", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-015",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const outlineDefault = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
      });
      assert.equal(outlineDefault.resolved_scope.options.include_scene_ids, false);

      const outlineExplicit = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        include_scene_ids: true,
      });
      assert.equal(outlineExplicit.resolved_scope.options.include_scene_ids, true);

      const editorDefault = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });
      assert.equal(editorDefault.resolved_scope.options.include_scene_ids, true);
    } finally {
      db.close();
    }
  });

  test("planner ignores blank cover metadata values", () => {
    const db = setupReviewBundleTestDb();
    try {
      insertTestScene(db, {
        sceneId: "sc-016",
        part: 1,
        chapter: 1,
        timelinePosition: 1,
        wordCount: 250,
      });

      const blankValues = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        bundle_title: "   ",
        author_name: "   ",
      });
      assert.equal(Object.hasOwn(blankValues.resolved_scope.options, "bundle_title"), false);
      assert.equal(Object.hasOwn(blankValues.resolved_scope.options, "author_name"), false);

      const explicitValues = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        bundle_title: "  The Lamb  ",
        author_name: "  Hanna  ",
      });
      assert.equal(explicitValues.resolved_scope.options.bundle_title, "The Lamb");
      assert.equal(explicitValues.resolved_scope.options.author_name, "Hanna");
    } finally {
      db.close();
    }
  });

  test("renderReviewBundleMarkdown escapes outline loglines with markdown metacharacters", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-outline-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    fs.writeFileSync(scenePath, "Plain prose body.\n", "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          logline, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Markdown Test",
        1,
        1,
        1,
        10,
        "A *bold* [link] `code` logline",
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
      });
      const markdown = renderReviewBundleMarkdown(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });

      assert.ok(markdown.includes("A \\*bold\\* \\[link\\] \\`code\\` logline"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown normalizes hard-wrapped prose lines into paragraph flow", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-hard-wrap-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    fs.writeFileSync(
      scenePath,
      [
        "Sebastian walks into the kitchen in the early morning, humming a tune, with Mneme flying in",
        "behind him and landing on the kitchen counter.",
        "",
        "Edda glances up as he approaches, sipping her morning coffee and scrolling through the news on",
        "her tablet.",
      ].join("\n"),
      "utf8"
    );

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Hard Wrap Test",
        1,
        1,
        1,
        10,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });
      const markdown = renderReviewBundleMarkdown(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });

      assert.ok(markdown.includes("with Mneme flying in behind him and landing on the kitchen counter."));
      assert.ok(markdown.includes("through the news on her tablet."));
      assert.ok(!markdown.includes("with Mneme flying in\nbehind him"));
      assert.ok(!markdown.includes("news on\nher tablet"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown suppresses epigraph scene title in beta profile", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-beta-epigraph-"));
    const scenePath = path.join(tempDir, "sc-epigraph-015.md");
    fs.writeFileSync(
      scenePath,
      [
        '"Some people leave behind ideas. Others leave behind a mess. Sebastian does both."',
        "- Edda Hoffman",
      ].join("\n"),
      "utf8"
    );

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, chapter_title, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-epigraph-015",
        "test-novel",
        "Epigraph Chapter 15",
        1,
        15,
        "Semantic Drift",
        1,
        32,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
      });
      const markdown = renderReviewBundleMarkdown(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });

      assert.ok(markdown.includes("## Semantic Drift"));
      assert.ok(!markdown.includes("## Epigraph Chapter 15"));
      assert.ok(markdown.includes("Some people leave behind ideas."));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown suppresses epigraph title when tag casing/spacing varies", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-beta-epigraph-tag-normalized-"));
    const scenePath = path.join(tempDir, "sc-epigraph-tagged-015.md");
    fs.writeFileSync(
      scenePath,
      [
        '"Some people leave behind ideas. Others leave behind a mess. Sebastian does both."',
        "- Edda Hoffman",
      ].join("\n"),
      "utf8"
    );

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, chapter_title, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-epigraph-tagged-015",
        "test-novel",
        "Quoted opener",
        1,
        15,
        "Semantic Drift",
        1,
        32,
        scenePath,
        "deadbeef",
        0,
        now
      );
      db.prepare(`INSERT INTO scene_tags (scene_id, project_id, tag) VALUES (?, ?, ?)`)
        .run("sc-epigraph-tagged-015", "test-novel", "  EPIGRAPH  ");

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
      });
      const markdown = renderReviewBundleMarkdown(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });

      assert.ok(markdown.includes("## Semantic Drift"));
      assert.ok(!markdown.includes("## Quoted opener"));
      assert.ok(markdown.includes("Some people leave behind ideas."));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundlePdf suppresses epigraph scene title in beta profile", async () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-beta-epigraph-pdf-"));
    const scenePath = path.join(tempDir, "sc-epigraph-015.md");
    fs.writeFileSync(
      scenePath,
      [
        '"Some people leave behind ideas. Others leave behind a mess. Sebastian does both."',
        "- Edda Hoffman",
      ].join("\n"),
      "utf8"
    );

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, chapter_title, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-epigraph-015",
        "test-novel",
        "Epigraph Chapter 15",
        1,
        15,
        "Semantic Drift",
        1,
        32,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
      });
      const pdfBytes = await renderReviewBundlePdf(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });
      const inflatedStreamsText = extractPdfFlateText(pdfBytes);
      const decodedPdfText = decodePdfHexText(inflatedStreamsText);

      assert.match(decodedPdfText, /Semantic Drift/);
      assert.doesNotMatch(decodedPdfText, /Epigraph Chapter 15/);
      assert.match(decodedPdfText, /Some people leave behind ideas\./);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundlePdf applies outline cover/header/chapter and epigraph rendering", async () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-outline-pdf-"));
    const chapterScenePath = path.join(tempDir, "sc-outline-001.md");
    const epigraphScenePath = path.join(tempDir, "sc-outline-002.md");
    fs.writeFileSync(chapterScenePath, "Regular scene prose.\n", "utf8");
    fs.writeFileSync(epigraphScenePath, "An epigraph line appears here.\n", "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          logline, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-outline-001",
        "test-novel",
        "A Father's Embrace",
        1,
        7,
        1,
        120,
        "A key reconciliation scene.",
        chapterScenePath,
        "deadbeef",
        0,
        now
      );
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          logline, file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-outline-002",
        "test-novel",
        "Epigraph Chapter 7",
        1,
        7,
        2,
        20,
        "Should be suppressed for epigraph scenes.",
        epigraphScenePath,
        "deadbeef",
        0,
        now
      );
      db.prepare(`INSERT INTO scene_tags (scene_id, project_id, tag) VALUES (?, ?, ?)`).run(
        "sc-outline-002",
        "test-novel",
        "epigraph"
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "outline_discussion",
        bundle_title: "The Lamb",
        author_name: "Hanna",
      });
      const pdfBytes = await renderReviewBundlePdf(db, plan, {
        generatedAt: "2026-01-01T00:00:00.000Z",
        syncDir: fs.realpathSync.native(tempDir),
      });
      const inflatedStreamsText = extractPdfFlateText(pdfBytes);
      const decodedPdfText = decodePdfHexText(inflatedStreamsText);

      assert.match(decodedPdfText, /The Lamb/);
      assert.match(decodedPdfText, /Outline Overview/);
      assert.match(decodedPdfText, /Chapter 7/);
      assert.match(decodedPdfText, /A Father's Embrace/);
      assert.match(decodedPdfText, /A key reconciliation scene\./);
      assert.match(decodedPdfText, /An epigraph line appears here\./);
      assert.doesNotMatch(decodedPdfText, /Should be suppressed for epigraph scenes\./);
      assert.doesNotMatch(decodedPdfText, /Epigraph Chapter 7/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws when planned scene rows are missing", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-missing-rows-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    fs.writeFileSync(scenePath, "Plain prose body.\n", "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Missing Row Test",
        1,
        1,
        1,
        10,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      db.prepare(`DELETE FROM scenes WHERE scene_id = ? AND project_id = ?`).run("sc-001", "test-novel");

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "MISSING_SCENE_ROWS"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws when scene prose cannot be read", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-prose-read-"));
    // Use the real path to avoid macOS /tmp → /private/tmp symlink discrepancy.
    const realTempDir = fs.realpathSync.native(tempDir);
    const prevSyncDir = process.env.WRITING_SYNC_DIR;
    process.env.WRITING_SYNC_DIR = realTempDir;
    // Deliberately do NOT create the file — readProse should throw SCENE_PROSE_READ_FAILED.
    const scenePath = path.join(realTempDir, "sc-001.md");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sc-001", "test-novel", "Prose Read Test", 1, 1, 1, 10, scenePath, "deadbeef", 0, now);

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "SCENE_PROSE_READ_FAILED"
      );
    } finally {
      if (prevSyncDir === undefined) {
        delete process.env.WRITING_SYNC_DIR;
      } else {
        process.env.WRITING_SYNC_DIR = prevSyncDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("renderReviewBundleMarkdown throws SCENE_PROSE_READ_FAILED when file_path is null", () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-null-path-"));
    const realTempDir = fs.realpathSync.native(tempDir);
    const prevSyncDir = process.env.WRITING_SYNC_DIR;
    process.env.WRITING_SYNC_DIR = realTempDir;

    try {
      const now = new Date().toISOString();
      // Use a path outside syncDir — resolveSceneFilePath returns null,
      // which should trigger SCENE_PROSE_READ_FAILED rather than silent empty prose.
      const outsidePath = "/nonexistent-outside-sync/scene.md";
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("sc-001", "test-novel", "Null Path Scene", 1, 1, 1, 10, outsidePath, null, 0, now);

      const plan = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "editor_detailed",
      });

      assert.throws(
        () => renderReviewBundleMarkdown(db, plan, { generatedAt: "2026-01-01T00:00:00.000Z" }),
        error => error instanceof ReviewBundlePlanError && error.code === "SCENE_PROSE_READ_FAILED"
      );
    } finally {
      if (prevSyncDir === undefined) {
        delete process.env.WRITING_SYNC_DIR;
      } else {
        process.env.WRITING_SYNC_DIR = prevSyncDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });
});

describe("review-bundle fingerprint helpers", () => {
  test("buildPageFingerprintToken is deterministic per page and unique across pages", () => {
    const seed = buildFingerprintSeed(
      {
        profile: "beta_reader_personalized",
        resolved_scope: { project_id: "test-novel", filters: {} },
        ordering: [{ scene_id: "sc-001" }],
      },
      "2026-01-01T00:00:00.000Z",
      "Jordan Example"
    );
    const seedHash = buildFingerprintSeedHash(seed);
    const token1a = buildPageFingerprintToken({ seedHash, pageNumber: 1 });
    const token1b = buildPageFingerprintToken({ seedHash, pageNumber: 1 });
    const token2 = buildPageFingerprintToken({ seedHash, pageNumber: 2 });

    assert.equal(token1a, token1b);
    assert.notEqual(token1a, token2);
  });

  test("renderReviewBundlePdfWithMetadata is reproducible for fixed inputs and varies by recipient", async () => {
    const db = setupReviewBundleTestDb();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-fingerprint-repro-"));
    const scenePath = path.join(tempDir, "sc-001.md");
    const longProse = Array.from(
      { length: 140 },
      (_, index) => `Paragraph ${index + 1}: The rain kept falling over the harbor while the ferry horn echoed.`
    ).join("\n\n");
    fs.writeFileSync(scenePath, longProse, "utf8");

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO scenes (
          scene_id, project_id, title, part, chapter, timeline_position, word_count,
          file_path, prose_checksum, metadata_stale, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sc-001",
        "test-novel",
        "Fingerprint Repro Test",
        1,
        1,
        1,
        3000,
        scenePath,
        "deadbeef",
        0,
        now
      );

      const generatedAt = "2026-01-01T00:00:00.000Z";
      const syncDir = fs.realpathSync.native(tempDir);
      const planA = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Jordan Example",
      });

      const a1 = await renderReviewBundlePdfWithMetadata(db, planA, { generatedAt, syncDir });
      const a2 = await renderReviewBundlePdfWithMetadata(db, planA, { generatedAt, syncDir });

      assert.ok(Array.isArray(a1.fingerprint?.page_tokens));
      assert.ok(a1.fingerprint.page_tokens.length >= 1);
      assert.deepEqual(a1.fingerprint.page_tokens, a2.fingerprint.page_tokens);

      const planB = buildReviewBundlePlan(db, {
        project_id: "test-novel",
        profile: "beta_reader_personalized",
        recipient_name: "Taylor Example",
      });
      const b1 = await renderReviewBundlePdfWithMetadata(db, planB, { generatedAt, syncDir });
      assert.notDeepEqual(a1.fingerprint.page_tokens, b1.fingerprint.page_tokens);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      db.close();
    }
  });
});

describe("review-bundle dateline helpers", () => {
  test("extractSceneDateline recognizes place-time lines with punctuation", () => {
    const prose = [
      "St. Louis – 6:30 a.m.",
      "The envelope had been slipped under the door.",
    ].join("\n");
    const extracted = extractSceneDateline(prose);
    assert.equal(extracted.dateline, "St. Louis – 6:30 a.m.");
    assert.equal(extracted.body, "The envelope had been slipped under the door.");
  });

  test("extractSceneDateline ignores normal sentence openings", () => {
    const prose = [
      "The envelope had been slipped under the door.",
      "She kept staring at it.",
    ].join("\n");
    const extracted = extractSceneDateline(prose);
    assert.equal(extracted.dateline, null);
    assert.equal(extracted.body, prose);
  });
});

// ---------------------------------------------------------------------------
// walkFiles
// ---------------------------------------------------------------------------
