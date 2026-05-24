import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildPostMutationBackupWarning,
  refreshProjectBackupAfterMutation,
} from "../../structure/project-backup-refresh.js";

describe("project backup post-mutation refresh", () => {
  test("returns operation history and backup refresh details from injected writers", () => {
    const syncDir = "/tmp/mcp-writing-sync";
    const result = refreshProjectBackupAfterMutation(null, {
      syncDir,
      projectId: "test-novel",
      applicationVersion: "9.9.9",
      operation: "create_chapter",
      actor: { type: "tool", id: "create_chapter" },
      affected: { chapters: ["ch-99-new-crossing"] },
      summary: "Created chapter.",
      buildBackup: (_db, options) => ({
        ok: true,
        manifest: {
          project_id: options.projectId,
        },
        snapshot: {
          project: {
            project_id: options.projectId,
          },
        },
      }),
      writeBackup: (_bundle, { outputDir }) => ({
        manifestPath: path.join(outputDir, "manifest.json"),
        snapshotPath: path.join(outputDir, "canonical.snapshot.json"),
        operationLogPath: path.join(outputDir, "operations.jsonl"),
        written: {
          manifest: true,
          canonical_snapshot: true,
          operations: false,
        },
      }),
      appendOperation: (record, { outputDir }) => {
        assert.equal(record.operation, "create_chapter");
        assert.equal(record.project_id, "test-novel");
        assert.equal(record.restore_authority, false);
        return {
          appended: true,
          operationLogPath: path.join(outputDir, "operations.jsonl"),
        };
      },
    });

    assert.deepEqual(result.backup_warnings, []);
    assert.equal(result.operation_history.appended, true);
    assert.equal(result.operation_history.relative_path, "project-backups/test-novel/operations.jsonl");
    assert.equal(result.backup_refresh.ok, true);
    assert.equal(result.backup_refresh.relative_output_dir, "project-backups/test-novel");
    assert.deepEqual(result.backup_refresh.written, {
      manifest: true,
      canonical_snapshot: true,
      operations: false,
    });
    assert.equal(result.backup_refresh.git_commit_created, false);
  });

  test("reports operation append failures without blocking snapshot refresh", () => {
    const result = refreshProjectBackupAfterMutation(null, {
      syncDir: "/tmp/mcp-writing-sync",
      projectId: "test-novel",
      operation: "rename_chapter",
      buildBackup: () => ({
        ok: true,
        manifest: {},
        snapshot: {},
      }),
      writeBackup: (_bundle, { outputDir }) => ({
        manifestPath: path.join(outputDir, "manifest.json"),
        snapshotPath: path.join(outputDir, "canonical.snapshot.json"),
        operationLogPath: path.join(outputDir, "operations.jsonl"),
        written: {
          manifest: false,
          canonical_snapshot: true,
          operations: false,
        },
      }),
      appendOperation: () => {
        throw new Error("append denied");
      },
    });

    assert.equal(result.operation_history, null);
    assert.equal(result.backup_refresh.ok, true);
    assert.equal(result.backup_warnings.length, 1);
    assert.equal(result.backup_warnings[0].code, "OPERATION_LOG_APPEND_FAILED");
    assert.equal(result.backup_warnings[0].details.phase, "operation_history");
  });

  test("rejects invalid project ids before deriving backup paths", () => {
    assert.throws(
      () => refreshProjectBackupAfterMutation(null, {
        syncDir: "/tmp/mcp-writing-sync",
        projectId: "../outside",
        operation: "create_chapter",
      }),
      /project_id must not contain/
    );
  });

  test("reports backup write failures without hiding operation history", () => {
    const result = refreshProjectBackupAfterMutation(null, {
      syncDir: "/tmp/mcp-writing-sync",
      projectId: "test-novel",
      operation: "reorder_chapter",
      buildBackup: () => ({
        ok: true,
        manifest: {},
        snapshot: {},
      }),
      writeBackup: () => {
        throw new Error("disk full");
      },
      appendOperation: (_record, { outputDir }) => ({
        appended: true,
        operationLogPath: path.join(outputDir, "operations.jsonl"),
      }),
    });

    assert.equal(result.operation_history.appended, true);
    assert.equal(result.backup_refresh, null);
    assert.equal(result.backup_warnings.length, 1);
    assert.equal(result.backup_warnings[0].code, "PROJECT_BACKUP_REFRESH_FAILED");
    assert.equal(result.backup_warnings[0].details.phase, "backup_refresh");
  });

  test("builds consistent warning envelopes", () => {
    const warning = buildPostMutationBackupWarning({
      projectId: "test-novel",
      operation: "create_chapter",
      phase: "backup_refresh",
      error: new Error("write failed"),
      details: {
        chapter_id: "ch-99-new-crossing",
      },
    });

    assert.equal(warning.code, "PROJECT_BACKUP_REFRESH_FAILED");
    assert.equal(warning.severity, "warning");
    assert.match(warning.message, /create_chapter/);
    assert.equal(warning.details.project_id, "test-novel");
    assert.equal(warning.details.chapter_id, "ch-99-new-crossing");
  });
});
