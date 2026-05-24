import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendProjectBackupOperationRecord,
  buildProjectBackupOperationRecord,
  ensureProjectBackupOperationLog,
  renderProjectBackupOperationRecord,
} from "../../structure/project-backup-operations.js";

describe("project backup operation history", () => {
  test("builds a minimal advisory operation envelope", () => {
    const record = buildProjectBackupOperationRecord({
      operation: "create_chapter",
      projectId: "test-novel",
      timestamp: "2026-05-24T10:00:00.000Z",
      applicationVersion: "9.9.9",
      actor: {
        type: "tool",
        id: "create_chapter",
      },
      affected: {
        chapters: ["ch-99-new-crossing"],
      },
      summary: "Created chapter.",
      before: null,
      after: {
        chapter: {
          chapter_id: "ch-99-new-crossing",
          title: "New Crossing",
        },
      },
    });

    assert.equal(record.artifact_kind, "project_backup_operation");
    assert.equal(record.schema_version, 1);
    assert.equal(record.backup_schema_version, 1);
    assert.equal(record.operation, "create_chapter");
    assert.equal(record.project_id, "test-novel");
    assert.equal(record.actor.id, "create_chapter");
    assert.deepEqual(record.affected.chapters, ["ch-99-new-crossing"]);
    assert.equal(record.advisory, true);
    assert.equal(record.restore_authority, false);
    assert.equal(record.compatibility.application_version, "9.9.9");
    assert.equal(typeof record.compatibility.current_sqlite_schema_version, "number");
  });

  test("renders stable single-line JSONL records", () => {
    const record = buildProjectBackupOperationRecord({
      operation: "create_chapter",
      projectId: "test-novel",
      timestamp: "2026-05-24T10:00:00.000Z",
      actor: { id: "create_chapter", type: "tool" },
      affected: { chapters: ["ch-99-new-crossing"] },
      applicationVersion: "9.9.9",
    });

    const rendered = renderProjectBackupOperationRecord(record);
    assert.match(rendered, /^\{.*\}\n$/);
    assert.equal(rendered.split("\n").length, 2);
    assert.equal(JSON.parse(rendered).operation, "create_chapter");
    assert.equal(rendered, renderProjectBackupOperationRecord(record));
  });

  test("creates an empty log once and appends records without rewriting history", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writing-operations-"));
    try {
      const firstEnsure = ensureProjectBackupOperationLog({ outputDir });
      assert.equal(firstEnsure.written, true);
      assert.equal(fs.readFileSync(firstEnsure.operationLogPath, "utf8"), "");

      const secondEnsure = ensureProjectBackupOperationLog({ outputDir });
      assert.equal(secondEnsure.written, false);

      const firstRecord = buildProjectBackupOperationRecord({
        operation: "create_chapter",
        projectId: "test-novel",
        timestamp: "2026-05-24T10:00:00.000Z",
        actor: { id: "create_chapter", type: "tool" },
        affected: { chapters: ["ch-01-first"] },
      });
      const secondRecord = buildProjectBackupOperationRecord({
        operation: "create_chapter",
        projectId: "test-novel",
        timestamp: "2026-05-24T11:00:00.000Z",
        actor: { id: "create_chapter", type: "tool" },
        affected: { chapters: ["ch-02-second"] },
      });

      appendProjectBackupOperationRecord(firstRecord, { outputDir });
      appendProjectBackupOperationRecord(secondRecord, { outputDir });

      const lines = fs.readFileSync(firstEnsure.operationLogPath, "utf8").trimEnd().split("\n");
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).affected.chapters[0], "ch-01-first");
      assert.equal(JSON.parse(lines[1]).affected.chapters[0], "ch-02-second");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
