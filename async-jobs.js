import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ASYNC_PROGRESS_PREFIX } from "./async-progress.js";
import { checkpointJobCreate, checkpointJobFinish, pruneJobCheckpoints } from "./db.js";

export function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function createAsyncJobManager({ db, asyncJobs, ttlMs, runnerDir }) {
  function pruneAsyncJobs() {
    const now = Date.now();
    let anyPruned = false;
    for (const [id, job] of asyncJobs.entries()) {
      if (!job.finishedAt) continue;
      if (now - Date.parse(job.finishedAt) > ttlMs) {
        try {
          if (job.tmpDir && fs.existsSync(job.tmpDir)) {
            fs.rmSync(job.tmpDir, { recursive: true, force: true });
          } else {
            if (job.requestPath && fs.existsSync(job.requestPath)) fs.unlinkSync(job.requestPath);
            if (job.resultPath && fs.existsSync(job.resultPath)) fs.unlinkSync(job.resultPath);
          }
        } catch {
          // best effort cleanup
        }
        asyncJobs.delete(id);
        anyPruned = true;
      }
    }
    if (anyPruned) {
      try { pruneJobCheckpoints(db, ttlMs); } catch { /* best effort */ }
    }
  }

  function toPublicJob(job, includeResult = true) {
    return {
      job_id: job.id,
      kind: job.kind,
      status: job.status,
      created_at: job.createdAt,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      pid: job.pid,
      error: job.error,
      ...(job.progress ? { progress: job.progress } : {}),
      ...(includeResult ? { result: job.result } : {}),
    };
  }

  function startAsyncJob({ kind, requestPayload, onComplete }) {
    pruneAsyncJobs();

    const id = randomUUID();
    const tmpPrefix = path.join(os.tmpdir(), "mcp-writing-job-");
    const tmpDir = fs.mkdtempSync(tmpPrefix);
    const requestPath = path.join(tmpDir, `${id}.request.json`);
    const resultPath = path.join(tmpDir, `${id}.result.json`);

    fs.writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");

    const runnerPath = path.join(runnerDir, "scripts", "async-job-runner.mjs");
    const child = spawn(
      process.execPath,
      ["--experimental-sqlite", runnerPath, requestPath, resultPath],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const job = {
      id,
      kind,
      status: "running",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      pid: child.pid,
      tmpDir,
      requestPath,
      resultPath,
      result: null,
      progress: null,
      error: null,
      onComplete,
      child,
    };
    asyncJobs.set(id, job);
    try {
      checkpointJobCreate(db, job);
    } catch (err) {
      process.stderr.write(`[mcp-writing] WARNING: failed to checkpoint job ${id}: ${err.message}\n`);
    }

    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(ASYNC_PROGRESS_PREFIX)) continue;
        const payload = trimmed.slice(ASYNC_PROGRESS_PREFIX.length);
        try {
          const progress = JSON.parse(payload);
          if (progress && typeof progress === "object") {
            const nextProgress = {
              total_scenes: Number(progress.total_scenes ?? 0),
              processed_scenes: Number(progress.processed_scenes ?? 0),
              scenes_changed: Number(progress.scenes_changed ?? 0),
              failed_scenes: Number(progress.failed_scenes ?? 0),
            };
            job.progress = nextProgress;
          }
        } catch {
          // Ignore malformed progress lines; they are best-effort telemetry.
        }
      }
    });
    child.stderr.on("data", () => {
      // avoid crashing on stderr backpressure for noisy runs
    });

    child.on("error", (error) => {
      if (job.status === "cancelling") {
        job.status = "cancelled";
        job.error = error.message;
        job.finishedAt = new Date().toISOString();
        try { checkpointJobFinish(db, job); } catch { /* best effort */ }
        pruneAsyncJobs();
        return;
      }
      job.status = "failed";
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      try { checkpointJobFinish(db, job); } catch { /* best effort */ }
      pruneAsyncJobs();
    });

    child.on("exit", (code, signal) => {
      const payload = readJsonIfExists(resultPath);
      const successful = payload?.ok === true;
      const cancelledBySignal = signal === "SIGTERM" || signal === "SIGKILL";
      const cancelledByPayload = payload?.cancelled === true;

      job.finishedAt = new Date().toISOString();
      job.result = payload;

      const hasProgressFields = payload && (
        payload.total_scenes !== undefined
        || payload.processed_scenes !== undefined
        || payload.scenes_changed !== undefined
        || payload.failed_scenes !== undefined
      );

      if (payload && payload.ok === true && hasProgressFields) {
        job.progress = {
          total_scenes: Number(payload.total_scenes ?? job.progress?.total_scenes ?? 0),
          processed_scenes: Number(payload.processed_scenes ?? job.progress?.processed_scenes ?? 0),
          scenes_changed: Number(payload.scenes_changed ?? job.progress?.scenes_changed ?? 0),
          failed_scenes: Number(payload.failed_scenes ?? job.progress?.failed_scenes ?? 0),
        };
      }

      if (job.status === "cancelling") {
        if (cancelledByPayload) {
          job.status = "cancelled";
          job.error = "Async job cancelled after returning partial results.";
        } else if (successful && !cancelledBySignal) {
          // Race: cancellation was requested as work completed successfully.
          job.status = "completed";
        } else {
          job.status = "cancelled";
          job.error = cancelledBySignal
            ? `Async job cancelled by signal ${signal}.`
            : payload?.error?.message ?? payload?.error ?? "Async job cancelled.";
          try { checkpointJobFinish(db, job); } catch { /* best effort */ }
          pruneAsyncJobs();
          return;
        }
      } else {
        job.status = successful ? "completed" : "failed";
        if (!successful) {
          job.error = payload?.error?.message
            ?? payload?.error
            ?? (signal
              ? `Async job exited due to signal ${signal}.`
              : `Async job exited with code ${code}.`);
        }
      }

      if (job.status === "completed" && typeof job.onComplete === "function") {
        try {
          job.onComplete(job);
        } catch (error) {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
        }
      }
      try { checkpointJobFinish(db, job); } catch { /* best effort */ }
      pruneAsyncJobs();
    });

    return job;
  }

  return { pruneAsyncJobs, toPublicJob, startAsyncJob };
}
