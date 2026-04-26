import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { importScrivenerSync, validateProjectId, validateUniverseId } from "../../importer.js";
import {
  IMPORTER_AUTHORITATIVE_FIELDS, loadScrivenerProjectData,
  mergeScrivenerProjectMetadata, mergeSidecarData,
} from "../../scrivener-direct.js";
import { openDb } from "../../db.js";

describe("importScrivenerSync", () => {
  function createScrivenerDraftFixture() {
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-import-"));
    fs.mkdirSync(path.join(scrivDir, "Draft"), { recursive: true });
    fs.writeFileSync(
      path.join(scrivDir, "Draft", "001 Scene The Arrival [1].txt"),
      "Elena steps out into the rain.",
      "utf8"
    );
    return scrivDir;
  }

  test("writes into existing universe project scenes path when WRITING_SYNC_DIR points there", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedSyncDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb", "scenes");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedSyncDir,
      projectId: "universe-1/book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "universe-1/book-1-the-lamb");
    assert.equal(result.scenesDir, scopedSyncDir);
    assert.ok(fs.existsSync(path.join(scopedSyncDir, "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested universes/<id>/<project>/scenes path is created inside scenes/
    assert.equal(
      fs.existsSync(path.join(scopedSyncDir, "universes", "universe-1", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("infers scoped project_id from WRITING_SYNC_DIR when omitted", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedProjectDir,
      dryRun: true,
    });

    assert.equal(result.projectId, "universe-1/book-1-the-lamb");
    assert.equal(result.scenesDir, path.join(scopedProjectDir, "scenes"));

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("fails when provided project_id conflicts with scoped WRITING_SYNC_DIR", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "universes", "universe-1", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    assert.throws(
      () => importScrivenerSync({
        scrivenerDir: scrivDir,
        mcpSyncDir: scopedProjectDir,
        projectId: "universe-1/other-book",
        dryRun: true,
      }),
      /does not match WRITING_SYNC_DIR scope/
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("writes into existing project root path when WRITING_SYNC_DIR points to projects/<project>", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedProjectDir = path.join(syncRoot, "projects", "book-1-the-lamb");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedProjectDir,
      projectId: "book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "book-1-the-lamb");
    assert.equal(result.scenesDir, path.join(scopedProjectDir, "scenes"));
    assert.ok(fs.existsSync(path.join(scopedProjectDir, "scenes", "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested projects/<project>/scenes path is created inside scoped project path.
    assert.equal(
      fs.existsSync(path.join(scopedProjectDir, "projects", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });

  test("writes into existing project scenes path when WRITING_SYNC_DIR points to projects/<project>/scenes", () => {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-root-"));
    const scopedScenesDir = path.join(syncRoot, "projects", "book-1-the-lamb", "scenes");
    const scrivDir = createScrivenerDraftFixture();

    const result = importScrivenerSync({
      scrivenerDir: scrivDir,
      mcpSyncDir: scopedScenesDir,
      projectId: "book-1-the-lamb",
      dryRun: false,
    });

    assert.equal(result.projectId, "book-1-the-lamb");
    assert.equal(result.scenesDir, scopedScenesDir);
    assert.ok(fs.existsSync(path.join(scopedScenesDir, "001 Scene The Arrival [1].meta.yaml")));

    // Regression guard: ensure no nested projects/<project>/scenes path is created inside scoped scenes path.
    assert.equal(
      fs.existsSync(path.join(scopedScenesDir, "projects", "book-1-the-lamb", "scenes")),
      false
    );

    fs.rmSync(syncRoot, { recursive: true, force: true });
    fs.rmSync(scrivDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// scripts/import.js
// ---------------------------------------------------------------------------
describe("Scrivener importer", () => {
  function makeScrivenerExport() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrivener-export-"));
    fs.mkdirSync(path.join(dir, "Draft"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Notes"), { recursive: true });
    return dir;
  }

  function writeDraftFile(dir, filename, content = "Scene prose.") {
    fs.writeFileSync(path.join(dir, "Draft", filename), content);
  }

  function runImporter(scrivenerDir, targetDir) {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "import.js"), scrivenerDir, targetDir, "--project", "test-import"],
      { encoding: "utf8" }
    );

    if (result.status !== 0) {
      throw new Error(`Importer failed: ${result.stderr || result.stdout}`);
    }

    return result.stdout;
  }

  test("writes stable external identity fields for imported scenes", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    writeDraftFile(scrivenerDir, "011 Scene Sebastian [10].txt", "Sebastian scene prose.");
    runImporter(scrivenerDir, targetDir);

    const sidecarPath = path.join(
      targetDir,
      "projects",
      "test-import",
      "scenes",
      "011 Scene Sebastian [10].meta.yaml"
    );
    const meta = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

    assert.equal(meta.scene_id, "sc-010-sebastian");
    assert.equal(meta.external_source, "scrivener");
    assert.equal(meta.external_id, "10");
    assert.equal(meta.timeline_position, 11);

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test("re-import after Scrivener reorder preserves scene identity and editorial metadata", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    writeDraftFile(scrivenerDir, "011 Scene Sebastian [10].txt", "First export prose.");
    runImporter(scrivenerDir, targetDir);

    const scenesDir = path.join(targetDir, "projects", "test-import", "scenes");
    const originalSidecar = path.join(scenesDir, "011 Scene Sebastian [10].meta.yaml");
    const originalMeta = yaml.load(fs.readFileSync(originalSidecar, "utf8"));
    originalMeta.synopsis = "Keep this editorial synopsis.";
    fs.writeFileSync(originalSidecar, yaml.dump(originalMeta, { lineWidth: 120 }), "utf8");

    fs.rmSync(path.join(scrivenerDir, "Draft", "011 Scene Sebastian [10].txt"));
    writeDraftFile(scrivenerDir, "015 Scene Sebastian [10].txt", "Reordered export prose.");

    runImporter(scrivenerDir, targetDir);

    const sceneFiles = fs.readdirSync(scenesDir).sort();
    assert.deepEqual(sceneFiles, ["015 Scene Sebastian [10].meta.yaml", "015 Scene Sebastian [10].txt"]);

    const reconciledMeta = yaml.load(
      fs.readFileSync(path.join(scenesDir, "015 Scene Sebastian [10].meta.yaml"), "utf8")
    );
    assert.equal(reconciledMeta.scene_id, "sc-010-sebastian");
    assert.equal(reconciledMeta.external_source, "scrivener");
    assert.equal(reconciledMeta.external_id, "10");
    assert.equal(reconciledMeta.timeline_position, 15);
    assert.equal(reconciledMeta.synopsis, "Keep this editorial synopsis.");

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test("ignores Scrivener Notes by default", () => {
    const scrivenerDir = makeScrivenerExport();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-import-"));

    fs.writeFileSync(path.join(scrivenerDir, "Notes", "001 Characters [1].txt"), "");
    fs.writeFileSync(path.join(scrivenerDir, "Notes", "002 Mira Nystrom [2].txt"), "Mira note content.");

    const output = runImporter(scrivenerDir, targetDir);
    const worldDir = path.join(targetDir, "projects", "test-import", "world");

    assert.ok(!fs.existsSync(worldDir));
    assert.ok(output.includes("Non-draft content: manual"));

    fs.rmSync(scrivenerDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// scripts/merge-scrivx.js and scrivener-direct.js
// ---------------------------------------------------------------------------
describe("Scrivener direct metadata merge", () => {
  function createScrivenerProjectFixture(options = {}) {
    const {
      extraMetaDataItems = "",
      synopsisText = "Elena returns to the harbor.",
      includeSynopsis = true,
      chapterTitle = "Arrival",
    } = options;
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrivener-project-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-1">1</SyncItem>
  </ExternalSyncMap>
  <Keywords>
    <Keyword ID="kw-character"><Title>Elena Voss</Title></Keyword>
    <Keyword ID="kw-version"><Title>v1.2</Title></Keyword>
  </Keywords>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-1">
              <Title>${chapterTitle}</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-1">
                  <Keywords>
                    <KeywordID>kw-character</KeywordID>
                    <KeywordID>kw-version</KeywordID>
                  </Keywords>
                  <MetaData>
                    <MetaDataItem><FieldID>savethecat!</FieldID><Value>Setup</Value></MetaDataItem>
                    <MetaDataItem><FieldID>causality</FieldID><Value>2</Value></MetaDataItem>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>3</Value></MetaDataItem>
                    <MetaDataItem><FieldID>change</FieldID><Value>Escalates conflict</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:character</FieldID><Value>Yes</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:mood</FieldID><Value>Yes</Value></MetaDataItem>
                    ${extraMetaDataItems}
                  </MetaData>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

    fs.writeFileSync(scrivxPath, xml, "utf8");
    fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-1"), { recursive: true });
    if (includeSynopsis) {
      fs.writeFileSync(
        path.join(scrivDir, "Files", "Data", "UUID-1", "synopsis.txt"),
        synopsisText,
        "utf8"
      );
    }

    return scrivDir;
  }

  function createSyncSidecarFixture(projectId = "test-import", extraSidecars = [], includeProse = false) {
    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-merge-sync-"));
    const scenesDir = path.join(syncRoot, "projects", projectId, "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "001 Scene Arrival [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-001-arrival", logline: "Preserve this existing value." }),
      "utf8"
    );
    // Only create matching prose file if explicitly requested (for relocation tests)
    if (includeProse) {
      fs.writeFileSync(
        path.join(scenesDir, "001 Scene Arrival [1].md"),
        "Elena arrives at the station and scans for familiar faces.\n",
        "utf8"
      );
    }

    for (const extraSidecar of extraSidecars) {
      fs.writeFileSync(path.join(scenesDir, extraSidecar.name), yaml.dump(extraSidecar.data), "utf8");
    }

    return { syncRoot, scenesDir };
  }

  test("mergeSidecarData only adds missing fields", () => {
    const existing = { scene_id: "sc-001", title: "Keep title" };
    const mergeData = { title: "New title", chapter: 2, characters: ["Elena"] };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["chapter", "characters"]);
    assert.equal(result.merged.title, "Keep title");
    assert.equal(result.merged.chapter, 2);
  });

  test("mergeSidecarData blocks importer-authoritative fields and reports them", () => {
    const existing = {};
    const mergeData = {
      scene_id: "sc-should-not-write",
      external_source: "scrivener",
      external_id: "42",
      title: "Should not write",
      timeline_position: 5,
      chapter: 2,
    };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["chapter"]);
    assert.deepEqual(result.blockedKeys.sort(), ["external_id", "external_source", "scene_id", "timeline_position", "title"]);
    assert.equal("scene_id" in result.merged, false);
    assert.equal("external_source" in result.merged, false);
    assert.equal("external_id" in result.merged, false);
    assert.equal("title" in result.merged, false);
    assert.equal("timeline_position" in result.merged, false);
    assert.equal(result.merged.chapter, 2);
  });

  test("mergeSidecarData returns empty blockedKeys when no authoritative fields attempted", () => {
    const existing = { chapter: 1 };
    const mergeData = { synopsis: "A new synopsis", tags: ["action"] };

    const result = mergeSidecarData(existing, mergeData);

    assert.deepEqual(result.blockedKeys, []);
    assert.equal(result.changed, true);
    assert.deepEqual(result.newKeys, ["synopsis", "tags"]);
  });

  test("mergeSidecarData no-op when all fields already present and none blocked", () => {
    const existing = { chapter: 1, synopsis: "Keep this" };
    const mergeData = { chapter: 99, synopsis: "New synopsis" };

    const result = mergeSidecarData(existing, mergeData);

    assert.equal(result.changed, false);
    assert.deepEqual(result.newKeys, []);
    assert.deepEqual(result.blockedKeys, []);
    assert.equal(result.merged.chapter, 1);
    assert.equal(result.merged.synopsis, "Keep this");
  });

  test("IMPORTER_AUTHORITATIVE_FIELDS contains expected identity fields", () => {
    for (const field of ["scene_id", "external_source", "external_id", "title", "timeline_position"]) {
      assert.ok(IMPORTER_AUTHORITATIVE_FIELDS.includes(field), `Expected ${field} to be authoritative`);
    }
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("chapter"), "chapter should not be authoritative");
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("synopsis"), "synopsis should not be authoritative");
    assert.ok(!IMPORTER_AUTHORITATIVE_FIELDS.includes("save_the_cat_beat"), "save_the_cat_beat should not be authoritative");
    assert.ok(Object.isFrozen(IMPORTER_AUTHORITATIVE_FIELDS), "authoritative field list should be immutable");
  });

  test("walkYamls skips projects/ and universes/ mirror subdirectories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "walkyamls-mirror-"));
    try {
      // Real sidecar in scenes/
      fs.writeFileSync(path.join(root, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");

      // Mirror subdirectories that should be skipped
      const projectsMirror = path.join(root, "projects", "my-novel", "scenes");
      const universesMirror = path.join(root, "universes", "aether", "book-one", "scenes");
      fs.mkdirSync(projectsMirror, { recursive: true });
      fs.mkdirSync(universesMirror, { recursive: true });
      fs.writeFileSync(path.join(projectsMirror, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");
      fs.writeFileSync(path.join(universesMirror, "no-bracket.meta.yaml"), "scene_id: sc-001\n", "utf8");

      // mergeScrivenerProjectMetadata reports sidecarFiles: the count of files walkYamls found.
      // If mirror dirs leaked through, sidecarFiles would be 3 instead of 1.
      const scrivDir = createScrivenerProjectFixture();
      try {
        const result = mergeScrivenerProjectMetadata({
          scrivPath: scrivDir,
          mcpSyncDir: root,
          projectId: "my-novel",
          scenesDir: root,
          dryRun: true,
        });

        // Only the single real sidecar should be seen (no bracket → skippedNoBracketId=1).
        // If mirror dirs leaked through, sidecarFiles would be 3 instead of 1.
        assert.equal(result.sidecarFiles, 1, "Mirror subdirectory sidecars must not be visited by walkYamls");
        assert.equal(result.skippedNoBracketId, 1, "The one sidecar with no bracket ID should be reported");
      } finally {
        fs.rmSync(scrivDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadScrivenerProjectData parses sync map and metadata", () => {
    const scrivDir = createScrivenerProjectFixture();
    try {
      const data = loadScrivenerProjectData(scrivDir);
      assert.equal(data.syncNumToUUID["1"], "UUID-1");
      assert.equal(data.keywordMap["kw-character"], "Elena Voss");
      assert.equal(data.metaByUUID["UUID-1"].synopsis, "Elena returns to the harbor.");
      assert.deepEqual(data.metaByUUID["UUID-1"].tags, ["Elena Voss", "v1.2"]);
      assert.equal(data.chapterByUUID["UUID-1"], 1);
      assert.equal(data.partByUUID["UUID-1"], 1);
      assert.equal(data.chapterTitleByUUID["UUID-1"], "Arrival");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata relocates scene files into named chapter folders", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture("test-import", [], true);

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: true,
      });

      const targetDir = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival");
      const relocatedSidecar = path.join(targetDir, "001 Scene Arrival [1].meta.yaml");
      const relocatedProse = path.join(targetDir, "001 Scene Arrival [1].md");
      const sidecar = yaml.load(fs.readFileSync(relocatedSidecar, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 1);
      assert.equal(fs.existsSync(relocatedSidecar), true);
      assert.equal(fs.existsSync(relocatedProse), true);
      assert.equal(fs.existsSync(path.join(scenesDir, "001 Scene Arrival [1].meta.yaml")), false);
      assert.equal(fs.existsSync(path.join(scenesDir, "001 Scene Arrival [1].md")), false);
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Harbor Arrival");
      assert.deepEqual(sidecar.tags, ["Elena Voss", "v1.2"]);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata with organize_by_chapters: false keeps scenes in place and only updates sidecar metadata", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const prosePath = path.join(scenesDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(prosePath, "Scene prose.\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: false,
      });

      const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const relocatedSidecar = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival", "001 Scene Arrival [1].meta.yaml");
      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 0, "No files should be relocated when organize_by_chapters is false");
      assert.equal(fs.existsSync(sidecarPath), true, "Sidecar should remain in original location");
      assert.equal(fs.existsSync(prosePath), true, "Prose should remain in original location");
      assert.equal(fs.existsSync(relocatedSidecar), false, "No relocated sidecar should exist");
      assert.equal(sidecar.chapter, 1, "Chapter metadata should still be added to sidecar");
      assert.equal(sidecar.chapter_title, "Harbor Arrival", "Chapter title should still be added to sidecar");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata with organize_by_chapters: false does not flatten nested scene paths", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();

    const nestedDir = path.join(scenesDir, "legacy", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });

    const originalSidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
    const nestedSidecarPath = path.join(nestedDir, "001 Scene Arrival [1].meta.yaml");
    fs.renameSync(originalSidecarPath, nestedSidecarPath);

    const nestedProsePath = path.join(nestedDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(nestedProsePath, "Scene prose.\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: false,
      });

      const sidecar = yaml.load(fs.readFileSync(nestedSidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.equal(result.relocated, 0, "No relocation should occur when organize_by_chapters is false");
      assert.equal(fs.existsSync(nestedSidecarPath), true, "Nested sidecar should remain in place");
      assert.equal(fs.existsSync(nestedProsePath), true, "Nested prose should remain in place");
      assert.equal(fs.existsSync(path.join(scenesDir, "001 Scene Arrival [1].meta.yaml")), false, "Sidecar should not be flattened back to scenes root");
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Harbor Arrival");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata keeps sidecar in place when relocation destination exists", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const prosePath = path.join(scenesDir, "001 Scene Arrival [1].txt");
    fs.writeFileSync(prosePath, "Scene prose.\n", "utf8");

    const targetDir = path.join(scenesDir, "part-1", "chapter-1-harbor-arrival");
    fs.mkdirSync(targetDir, { recursive: true });
    const targetSidecarPath = path.join(targetDir, "001 Scene Arrival [1].meta.yaml");
    fs.writeFileSync(targetSidecarPath, yaml.dump({ scene_id: "sc-existing-target", title: "Existing" }), "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: true,
      });

      const originalSidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const originalSidecar = yaml.load(fs.readFileSync(originalSidecarPath, "utf8"));
      const targetSidecar = yaml.load(fs.readFileSync(targetSidecarPath, "utf8"));

      assert.ok(result.updated >= 1, "At least one sidecar should be updated");
      assert.equal(result.relocated, 0, "Sidecar should not relocate when destination exists");
      assert.equal(fs.existsSync(originalSidecarPath), true, "Original sidecar should be kept in place");
      assert.equal(fs.existsSync(prosePath), true, "Original prose should be kept in place");
      assert.equal(result.warningSummary.relocate_sidecar_destination_exists.count, 1);
      const relocateExample = result.warningSummary.relocate_sidecar_destination_exists.examples[0];
      assert.equal(relocateExample.from_path, originalSidecarPath);
      assert.equal(relocateExample.to_path, targetSidecarPath);
      assert.equal(originalSidecar.chapter, 1);
      assert.equal(originalSidecar.chapter_title, "Harbor Arrival");
      assert.equal(targetSidecar.scene_id, "sc-existing-target", "Existing destination sidecar must not be overwritten");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata dry run reports updates without writing", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();

    try {
      const logs = [];
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
        logger: line => logs.push(line),
      });

      const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
      const sidecar = yaml.load(fs.readFileSync(sidecarPath, "utf8"));

      assert.equal(result.updated, 1);
      assert.ok(logs.some(line => line.includes("DRY   001 Scene Arrival [1].meta.yaml")));
      assert.equal(sidecar.chapter, undefined);
      assert.equal(sidecar.synopsis, undefined);
      assert.equal(sidecar.logline, "Preserve this existing value.");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata returns structured warnings for skipped and normalized inputs", () => {
    const scrivDir = createScrivenerProjectFixture({
      extraMetaDataItems: [
        "<MetaDataItem><FieldID>mood-color</FieldID><Value>Blue</Value></MetaDataItem>",
        "<MetaDataItem><FieldID>stakes</FieldID><Value>high</Value></MetaDataItem>",
      ].join(""),
      includeSynopsis: false,
    });
    const { syncRoot } = createSyncSidecarFixture("test-import", [
      { name: "002 Missing Mapping [99].meta.yaml", data: { scene_id: "sc-099" } },
      { name: "Loose Scene.meta.yaml", data: { scene_id: "sc-loose" } },
    ]);

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.missing_uuid_mapping.count, 1);
      assert.equal(result.warningSummary.missing_bracket_id.count, 1);
      assert.equal(result.warningSummary.ignored_custom_field.count, 1);
      assert.equal(result.warningSummary.invalid_custom_field_value.count, 1);
      assert.ok(result.warnings.some(w => w.code === "ignored_custom_field" && w.field_id === "mood-color"));
      assert.ok(result.warnings.some(w => w.code === "invalid_custom_field_value" && w.field_id === "stakes"));
      assert.ok(!("missing_synopsis" in result.warningSummary));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata emits deterministic ambiguity warning codes", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const sidecarPath = path.join(scenesDir, "001 Scene Arrival [1].meta.yaml");
    const existing = yaml.load(fs.readFileSync(sidecarPath, "utf8"));
    fs.writeFileSync(
      sidecarPath,
      yaml.dump(
        {
          ...existing,
          chapter: 9,
          synopsis: "Conflicting synopsis from sidecar.",
          external_source: "manual",
        },
        { lineWidth: 120 }
      ),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.ambiguous_identity_tie.count, 1);
      assert.equal(result.warningSummary.ambiguous_structure_mapping.count, 1);
      assert.equal(result.warningSummary.ambiguous_metadata_mapping.count, 1);

      const identityWarning = result.warnings.find(w => w.code === "ambiguous_identity_tie");
      assert.equal(identityWarning.reason, "external_source_conflict");
      assert.equal(identityWarning.external_source, "manual");

      const structureWarning = result.warnings.find(w => w.code === "ambiguous_structure_mapping");
      assert.equal(structureWarning.field, "chapter");
      assert.equal(structureWarning.existing_value, 9);
      assert.equal(structureWarning.scrivener_value, 1);

      const metadataWarning = result.warnings.find(w => w.code === "ambiguous_metadata_mapping");
      assert.equal(metadataWarning.field, "synopsis");
      assert.equal(metadataWarning.existing_value, "Conflicting synopsis from sidecar.");
      assert.equal(metadataWarning.scrivener_value, "Elena returns to the harbor.");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata caps returned warnings but keeps full summary counts", () => {
    const scrivDir = createScrivenerProjectFixture();
    const extraSidecars = Array.from({ length: 30 }, (_, index) => ({
      name: `${String(index + 2).padStart(3, "0")} Missing Mapping [${index + 100}].meta.yaml`,
      data: { scene_id: `sc-${index + 100}` },
    }));
    const { syncRoot } = createSyncSidecarFixture("test-import", extraSidecars);

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.warningSummary.missing_uuid_mapping.count, 30);
      assert.equal(result.warnings.length, 25);
      assert.equal(result.warningsTruncated, true);
      assert.ok(result.warnings.every(w => w.code === "missing_uuid_mapping"));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata skips nested projects/universes mirror directories", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture();
    const mirrorProjectsDir = path.join(scenesDir, "projects", "mirror", "scenes");
    const mirrorUniversesDir = path.join(scenesDir, "universes", "mirror", "book", "scenes");
    fs.mkdirSync(mirrorProjectsDir, { recursive: true });
    fs.mkdirSync(mirrorUniversesDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorProjectsDir, "Loose Mirror.meta.yaml"), "scene_id: sc-mirror-1\n", "utf8");
    fs.writeFileSync(path.join(mirrorUniversesDir, "999 Mirror Missing [999].meta.yaml"), "scene_id: sc-mirror-2\n", "utf8");

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: true,
      });

      assert.equal(result.updated, 1);
      assert.ok(!("missing_bracket_id" in result.warningSummary));
      assert.ok(!("missing_uuid_mapping" in result.warningSummary));
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata rejects invalid project_id shape", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot } = createSyncSidecarFixture();

    try {
      assert.throws(
        () => mergeScrivenerProjectMetadata({
          scrivPath: scrivDir,
          mcpSyncDir: syncRoot,
          projectId: "universe/a/b",
          dryRun: true,
        }),
        /Invalid project_id/
      );
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Compatibility matrix fixture tests (B, C, D)
  // -------------------------------------------------------------------------

  test("fixture B: project with no synopsis, no keywords, and no custom fields parses and merges without crash", () => {
    // Fixture B tests that absent optional metadata files (synopsis.txt absent,
    // empty keyword list, no MetaData elements) do not cause parser or merge errors.
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-b-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");
    fs.writeFileSync(
      scrivxPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-B1">1</SyncItem>
  </ExternalSyncMap>
  <Keywords/>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-b1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-b1">
              <Title>Chapter One</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-B1">
                  <Title>Sparse Scene</Title>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
      "utf8"
    );
    // Intentionally no Files/Data/UUID-B1/synopsis.txt — tests graceful absence handling.

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-b-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-b", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "001 Sparse Scene [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-b-001", logline: "Preserved logline fixture B." }),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-b",
        dryRun: true,
      });

      // Parse and merge must succeed (no throws)
      assert.equal(typeof result, "object");

      // Binder structure (part > chapter > text) provides chapter/part info;
      // the scene is updated with those structural fields.
      assert.equal(result.updated, 1);
      assert.equal(result.unchanged, 0);

      // No synopsis/tags/custom-field warnings expected
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(result.warningSummary, {});

      // Structural metadata should be added
      assert.ok(result.fieldAddCounts.chapter >= 1, "chapter should be added");
      assert.ok(result.fieldAddCounts.chapter_title >= 1, "chapter_title should be added");

      // Existing sidecar fields preserved
      const sidecar = yaml.load(
        fs.readFileSync(path.join(scenesDir, "001 Sparse Scene [1].meta.yaml"), "utf8")
      );
      assert.equal(sidecar.scene_id, "sc-b-001");
      assert.equal(sidecar.logline, "Preserved logline fixture B.");

      // No tags, synopsis, or custom fields written (they were absent in the project)
      assert.equal("tags" in sidecar, false);
      assert.equal("synopsis" in sidecar, false);
      assert.equal("save_the_cat_beat" in sidecar, false);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("fixture C: custom-metadata-heavy project maps all known fields and warns on unknown fields", () => {
    // Fixture C tests a project that uses all known custom metadata fields plus
    // unknown fields that should be reported as ignored_custom_field warnings.
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-c-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");
    fs.writeFileSync(
      scrivxPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-C1">1</SyncItem>
    <SyncItem ID="UUID-C2">2</SyncItem>
  </ExternalSyncMap>
  <Keywords>
    <Keyword ID="kw-c1"><Title>Protagonist</Title></Keyword>
    <Keyword ID="kw-c2"><Title>Conflict</Title></Keyword>
    <Keyword ID="kw-c3"><Title>v2.0</Title></Keyword>
  </Keywords>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-c1">
          <Title>Act One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-c1">
              <Title>The Inciting Incident</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-C1">
                  <Keywords>
                    <KeywordID>kw-c1</KeywordID>
                    <KeywordID>kw-c2</KeywordID>
                    <KeywordID>kw-c3</KeywordID>
                  </Keywords>
                  <MetaData>
                    <MetaDataItem><FieldID>savethecat!</FieldID><Value>Catalyst</Value></MetaDataItem>
                    <MetaDataItem><FieldID>causality</FieldID><Value>4</Value></MetaDataItem>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>5</Value></MetaDataItem>
                    <MetaDataItem><FieldID>change</FieldID><Value>Crosses the threshold</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:character</FieldID><Value>Yes</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:mood</FieldID><Value>Yes</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:theme</FieldID><Value>Yes</Value></MetaDataItem>
                    <MetaDataItem><FieldID>custom:research-note</FieldID><Value>Check historical dates</Value></MetaDataItem>
                    <MetaDataItem><FieldID>custom:editor-flag</FieldID><Value>Needs revision</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
                <BinderItem Type="Text" UUID="UUID-C2">
                  <MetaData>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>2</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
      "utf8"
    );
    fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-C1"), { recursive: true });
    fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-C2"), { recursive: true });
    fs.writeFileSync(
      path.join(scrivDir, "Files", "Data", "UUID-C1", "synopsis.txt"),
      "The protagonist steps into the unknown.",
      "utf8"
    );
    fs.writeFileSync(
      path.join(scrivDir, "Files", "Data", "UUID-C2", "synopsis.txt"),
      "A quieter scene to contrast the catalyst.",
      "utf8"
    );

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-c-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-c", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "001 Heavy Scene [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-c-001", logline: "Preserved logline C1." }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(scenesDir, "002 Light Scene [2].meta.yaml"),
      yaml.dump({ scene_id: "sc-c-002", logline: "Preserved logline C2." }),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-c",
        dryRun: false,
      });

      assert.equal(result.updated, 2);
      assert.equal(result.unchanged, 0);

      // Unknown custom fields should produce ignored_custom_field warnings
      assert.ok(result.warningSummary.ignored_custom_field, "expected ignored_custom_field in warningSummary");
      assert.equal(result.warningSummary.ignored_custom_field.count, 2);
      assert.ok(
        result.warnings.some(w => w.code === "ignored_custom_field" && w.field_id === "custom:research-note"),
        "expected warning for custom:research-note"
      );
      assert.ok(
        result.warnings.some(w => w.code === "ignored_custom_field" && w.field_id === "custom:editor-flag"),
        "expected warning for custom:editor-flag"
      );

      // All known fields should be written to scene C1's sidecar
      const sidecar1 = yaml.load(
        fs.readFileSync(path.join(scenesDir, "001 Heavy Scene [1].meta.yaml"), "utf8")
      );
      assert.equal(sidecar1.scene_id, "sc-c-001");
      assert.equal(sidecar1.logline, "Preserved logline C1.");
      assert.equal(sidecar1.save_the_cat_beat, "Catalyst");
      assert.equal(sidecar1.causality, 4);
      assert.equal(sidecar1.stakes, 5);
      assert.equal(sidecar1.scene_change, "Crosses the threshold");
      assert.deepEqual(sidecar1.scene_functions, ["character", "mood", "theme"]);
      assert.equal(sidecar1.synopsis, "The protagonist steps into the unknown.");
      assert.deepEqual(sidecar1.tags.sort(), ["Conflict", "Protagonist", "v2.0"]);
      assert.equal(sidecar1.chapter, 1);
      assert.equal(sidecar1.part, 1);

      // Unknown fields must not appear in the sidecar
      assert.equal("custom:research-note" in sidecar1, false);
      assert.equal("custom:editor-flag" in sidecar1, false);

      // Scene C2 gets stakes from custom metadata and structural info
      const sidecar2 = yaml.load(
        fs.readFileSync(path.join(scenesDir, "002 Light Scene [2].meta.yaml"), "utf8")
      );
      assert.equal(sidecar2.scene_id, "sc-c-002");
      assert.equal(sidecar2.logline, "Preserved logline C2.");
      assert.equal(sidecar2.stakes, 2);
      assert.equal(sidecar2.synopsis, "A quieter scene to contrast the catalyst.");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("fixture D: reordered binder hierarchy assigns chapter numbers by binder position, not sync number order", () => {
    // Fixture D tests that chapter assignment is derived from binder traversal order,
    // not from the sync number embedded in the filename. A scene with a lower sync
    // number that appears in a later chapter must receive the higher chapter number.
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-d-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");
    fs.writeFileSync(
      scrivxPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-D1">1</SyncItem>
    <SyncItem ID="UUID-D2">2</SyncItem>
  </ExternalSyncMap>
  <Keywords/>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-d1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-d1">
              <Title>First Chapter</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-D2">
                  <Title>Scene Beta</Title>
                </BinderItem>
              </Children>
            </BinderItem>
            <BinderItem Type="Folder" UUID="chapter-d2">
              <Title>Second Chapter</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-D1">
                  <Title>Scene Alpha</Title>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
      "utf8"
    );
    // No synopsis files — testing structure-only merge

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-fixture-d-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-d", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    // Scene Alpha has the lower sync number [1] but lives in Chapter 2 in the binder
    fs.writeFileSync(
      path.join(scenesDir, "001 Scene Alpha [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-d-alpha" }),
      "utf8"
    );
    // Scene Beta has the higher sync number [2] but lives in Chapter 1 in the binder
    fs.writeFileSync(
      path.join(scenesDir, "002 Scene Beta [2].meta.yaml"),
      yaml.dump({ scene_id: "sc-d-beta" }),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-d",
        dryRun: false,
      });

      assert.equal(result.updated, 2);
      assert.deepEqual(result.warnings, []);

      // Alpha [sync=1] is in Second Chapter (chapter 2) — binder position wins
      const sidecarAlpha = yaml.load(
        fs.readFileSync(path.join(scenesDir, "001 Scene Alpha [1].meta.yaml"), "utf8")
      );
      assert.equal(sidecarAlpha.chapter, 2, "Scene Alpha (sync 1) should be in chapter 2 per binder position");
      assert.equal(sidecarAlpha.chapter_title, "Second Chapter");
      assert.equal(sidecarAlpha.part, 1);

      // Beta [sync=2] is in First Chapter (chapter 1) — binder position wins
      const sidecarBeta = yaml.load(
        fs.readFileSync(path.join(scenesDir, "002 Scene Beta [2].meta.yaml"), "utf8")
      );
      assert.equal(sidecarBeta.chapter, 1, "Scene Beta (sync 2) should be in chapter 1 per binder position");
      assert.equal(sidecarBeta.chapter_title, "First Chapter");
      assert.equal(sidecarBeta.part, 1);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Phase E: Data Safety Hardening Tests
  // -------------------------------------------------------------------------

  test("mergeScrivenerProjectMetadata emits sidecar_missing_prose warning when prose cannot be found during relocation", () => {
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-orphan-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");
    fs.writeFileSync(
      scrivxPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-E1">1</SyncItem>
  </ExternalSyncMap>
  <Keywords/>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-e1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-e1">
              <Title>Chapter One</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-E1">
                  <Title>Scene One</Title>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
      "utf8"
    );
    // No Files/Data directory or synopsis — prose is missing

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-orphan-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-e", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    // Sidecar exists but no matching prose file; set part/chapter to different values
    // so the merge will try to relocate it
    fs.writeFileSync(
      path.join(scenesDir, "001 Scene One [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-e-001", part: 99, chapter: 99 }),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-e",
        dryRun: true,
        organizeByChapters: true,
      });

      // Merge should issue sidecar_missing_prose warning
      assert.ok(
        result.warningSummary.sidecar_missing_prose,
        "Expected sidecar_missing_prose warning in summary"
      );
      assert.equal(result.warningSummary.sidecar_missing_prose.count, 1);
      assert.ok(
        result.warnings.some(w => w.code === "sidecar_missing_prose"),
        "Expected sidecar_missing_prose in warnings list"
      );
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("mergeScrivenerProjectMetadata emits sidecar_missing_prose warning once in non-dry-run mode", () => {
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-orphan-live-"));
    const scrivxPath = path.join(scrivDir, "Novel.scrivx");
    fs.writeFileSync(
      scrivxPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-E2">1</SyncItem>
  </ExternalSyncMap>
  <Keywords/>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-e2">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-e2">
              <Title>Chapter One</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-E2">
                  <Title>Scene One</Title>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
      "utf8"
    );

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-orphan-live-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-e-live", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenesDir, "001 Scene One [1].meta.yaml"),
      yaml.dump({ scene_id: "sc-e-002", part: 99, chapter: 99 }),
      "utf8"
    );

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-e-live",
        dryRun: false,
        organizeByChapters: true,
      });

      assert.ok(result.warningSummary.sidecar_missing_prose);
      assert.equal(result.warningSummary.sidecar_missing_prose.count, 1);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("relocation snapshots stage deletion of original sidecar path", () => {
    const scrivDir = createScrivenerProjectFixture({ chapterTitle: "Harbor Arrival" });
    const { syncRoot } = createSyncSidecarFixture("test-import", [], true);

    try {
      execSync("git init", { cwd: syncRoot, stdio: "pipe" });
      execSync("git config user.email writing-mcp@local", { cwd: syncRoot, stdio: "pipe" });
      execSync("git config user.name writing-mcp", { cwd: syncRoot, stdio: "pipe" });
      execSync("git add -A", { cwd: syncRoot, stdio: "pipe" });
      execSync("git commit -m \"seed\"", { cwd: syncRoot, stdio: "pipe" });

      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "test-import",
        dryRun: false,
        organizeByChapters: true,
      });

      assert.equal(result.relocated, 1);
      const porcelain = execSync("git status --porcelain", { cwd: syncRoot, encoding: "utf8" }).trim();
      assert.equal(porcelain, "", "Expected clean git working tree after relocation snapshot");
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("XML size check warns for .scrivx files larger than 50MB and continues", () => {
    const scrivDir = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-huge-"));
    const scrivxPath = path.join(scrivDir, "Huge.scrivx");
    
    // Ensure Data directory exists for validation to proceed further
    fs.mkdirSync(path.join(scrivDir, "Files", "Data"), { recursive: true });

    // Create a valid .scrivx XML header followed by a huge comment to exceed 50MB
    const validHeader = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap/>
  <Keywords/>
  <Binder/>
<!-- `;
    const trailer = " -->\n</ScrivenerProject>";

    fs.writeFileSync(scrivxPath, validHeader, "utf8");
    const fd = fs.openSync(scrivxPath, "a");
    try {
      const chunk = Buffer.alloc(1024 * 1024, "x");
      for (let i = 0; i < 52; i++) {
        fs.writeSync(fd, chunk);
      }
      fs.writeSync(fd, trailer);
    } finally {
      fs.closeSync(fd);
    }

    const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriv-huge-sync-"));
    const scenesDir = path.join(syncRoot, "projects", "fixture-huge", "scenes");
    fs.mkdirSync(scenesDir, { recursive: true });

    try {
      const result = mergeScrivenerProjectMetadata({
        scrivPath: scrivDir,
        mcpSyncDir: syncRoot,
        projectId: "fixture-huge",
        dryRun: true,
      });

      assert.ok(
        result.warningSummary.large_scrivx_file,
        "Expected large_scrivx_file warning in summary"
      );
      assert.equal(result.warningSummary.large_scrivx_file.count, 1);
      assert.ok(
        result.warnings.some(w => w.code === "large_scrivx_file"),
        "Expected large_scrivx_file warning in warnings list"
      );
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });

  test("scripts/merge-scrivx.js remains runnable and writes merged metadata", () => {
    const scrivDir = createScrivenerProjectFixture();
    const { syncRoot, scenesDir } = createSyncSidecarFixture("test-import", [], true);

    try {
      const result = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "scripts", "merge-scrivx.js"), scrivDir, syncRoot, "--project", "test-import", "--organize-by-chapters"],
        { encoding: "utf8" }
      );

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const sidecar = yaml.load(
        fs.readFileSync(path.join(scenesDir, "part-1", "chapter-1-arrival", "001 Scene Arrival [1].meta.yaml"), "utf8")
      );

      assert.equal(sidecar.scene_id, "sc-001-arrival");
      assert.equal(sidecar.logline, "Preserve this existing value.");
      assert.equal(sidecar.part, 1);
      assert.equal(sidecar.chapter, 1);
      assert.equal(sidecar.chapter_title, "Arrival");
      assert.equal(sidecar.synopsis, "Elena returns to the harbor.");
      assert.deepEqual(sidecar.tags, ["Elena Voss", "v1.2"]);
      assert.equal(sidecar.save_the_cat_beat, "Setup");
      assert.equal(sidecar.causality, 2);
      assert.equal(sidecar.stakes, 3);
      assert.equal(sidecar.scene_change, "Escalates conflict");
      assert.deepEqual(sidecar.scene_functions, ["character", "mood"]);
    } finally {
      fs.rmSync(scrivDir, { recursive: true, force: true });
      fs.rmSync(syncRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// scripts/new-world-entity.js
// ---------------------------------------------------------------------------
describe("validateProjectId", () => {
  test("accepts a simple project slug", () => {
    assert.deepEqual(validateProjectId("the-lamb"), { ok: true });
  });

  test("accepts a universe/project slug", () => {
    assert.deepEqual(validateProjectId("universe-1/book-1-the-lamb"), { ok: true });
  });

  test("rejects an absolute path", () => {
    const result = validateProjectId("/etc/passwd");
    assert.equal(result.ok, false);
  });

  test("rejects more than two segments", () => {
    const result = validateProjectId("a/b/c");
    assert.equal(result.ok, false);
  });

  test("rejects uppercase letters", () => {
    const result = validateProjectId("The-Lamb");
    assert.equal(result.ok, false);
  });

  test("rejects an empty string", () => {
    const result = validateProjectId("");
    assert.equal(result.ok, false);
  });

  test("rejects dot segments", () => {
    assert.equal(validateProjectId("../etc").ok, false);
    assert.equal(validateProjectId(".").ok, false);
  });
});

describe("validateUniverseId", () => {
  test("accepts a valid slug", () => {
    assert.deepEqual(validateUniverseId("universe-1"), { ok: true });
  });

  test("accepts a single character", () => {
    assert.deepEqual(validateUniverseId("a"), { ok: true });
  });

  test("rejects an empty string with a clear reason", () => {
    const result = validateUniverseId("");
    assert.equal(result.ok, false);
    assert.ok(result.reason.length > 0);
  });

  test("rejects whitespace-only string", () => {
    assert.equal(validateUniverseId("   ").ok, false);
  });

  test("rejects underscores", () => {
    assert.equal(validateUniverseId("__invalid__").ok, false);
  });

  test("rejects uppercase letters", () => {
    assert.equal(validateUniverseId("Universe-1").ok, false);
  });

  test("rejects leading hyphen", () => {
    assert.equal(validateUniverseId("-universe").ok, false);
  });

  test("rejects trailing hyphen", () => {
    assert.equal(validateUniverseId("universe-").ok, false);
  });

  test("rejects slashes", () => {
    assert.equal(validateUniverseId("universe/1").ok, false);
  });
});
