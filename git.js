import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Check if a directory is itself the root of a git repository (not just inside one).
 * This prevents mcp-writing's own .git from being used for prose snapshots when
 * WRITING_SYNC_DIR is a subdirectory of the code repo.
 */
export function isGitRepository(dirPath) {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    return fs.realpathSync(gitRoot) === fs.realpathSync(dirPath);
  } catch {
    return false;
  }
}

/**
 * Initialize a git repository in a directory
 */
export function initGitRepository(dirPath) {
  try {
    execSync("git init", { cwd: dirPath, stdio: "pipe" });
    // Set a dummy user config for commits if not already set
    try {
      execSync("git config user.email", { cwd: dirPath, stdio: "pipe" });
    } catch {
      execSync("git config user.email writing-mcp@local", { cwd: dirPath, stdio: "pipe" });
      execSync("git config user.name writing-mcp", { cwd: dirPath, stdio: "pipe" });
    }
    return true;
  } catch (err) {
    throw new Error(`Failed to initialize git repository: ${err.message}`);
  }
}

/**
 * Check if git is available on PATH
 */
export function isGitAvailable() {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git commit for a scene file (pre-edit snapshot)
 * Returns { commit_hash: string, commit_message: string }
 */
export function createSnapshot(dirPath, filePath, sceneId, instruction) {
  try {
    const inputPaths = Array.isArray(filePath) ? filePath : [filePath];
    const relPaths = [...new Set(inputPaths
      .filter(Boolean)
      .map(p => path.relative(dirPath, p)))];
    if (!relPaths.length) {
      throw new Error("No file paths provided for snapshot");
    }
    const quotedPaths = relPaths.map(p => `"${String(p).replace(/"/g, '\\"')}"`).join(" ");
    // Use -A so removed/renamed paths are staged as part of relocation snapshots.
    execSync(`git add -A -- ${quotedPaths}`, { cwd: dirPath, stdio: "pipe" });

    const commitMessage = `pre-edit snapshot: ${sceneId} — ${instruction}`;
    // Use 2>&1 so git's stderr (where it prints "[branch hash] msg") is captured in stdout
    const output = execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}" 2>&1`, {
      cwd: dirPath,
      encoding: "utf8",
      stdio: "pipe",
    });

    // git outputs "[branch hash] message" to stderr; redirect 2>&1 captures it in stdout
    // Regex handles any branch name, with or without (root-commit)
    const match = output.match(/\[\S+(?:\s+\(root-commit\))?\s+([a-f0-9]+)\]/);
    const commitHash = match ? match[1] : null;

    return {
      commit_hash: commitHash,
      commit_message: commitMessage,
    };
  } catch (err) {
    // Check if nothing changed (no error, just no commit)
    if (err.message.includes("nothing to commit") || err.status === 1) {
      return {
        commit_hash: null,
        commit_message: null,
        reason: "no changes to commit",
      };
    }
    throw new Error(`Failed to create snapshot: ${err.message}`);
  }
}

/**
 * List git commits for a file, with timestamps and messages
 * Returns array of { commit_hash, timestamp, message }
 */
export function listSnapshots(dirPath, filePath) {
  try {
    const relPath = path.relative(dirPath, filePath);
    const output = execSync(
      `git log --pretty=format:"%h|%ai|%s" -- "${relPath}"`,
      {
        cwd: dirPath,
        stdio: "pipe",
        encoding: "utf8",
      }
    );

    if (!output) return [];

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, timestamp, ...messageParts] = line.split("|");
        return {
          commit_hash: hash.trim(),
          timestamp: timestamp.trim(),
          message: messageParts.join("|").trim(),
        };
      });
  } catch (err) {
    // If there are no commits yet, return empty array
    if (err.message.includes("your current branch") || err.status === 128) {
      return [];
    }
    throw new Error(`Failed to list snapshots: ${err.message}`);
  }
}

/**
 * Get prose content from a specific git commit
 * If commit is null, returns current working tree version
 */
export function getSceneProseAtCommit(dirPath, filePath, commitHash) {
  try {
    const relPath = path.relative(dirPath, filePath);

    if (!commitHash) {
      // Return current working tree version
      return fs.readFileSync(filePath, "utf8");
    }

    // Get version from git
    const content = execSync(`git show ${commitHash}:"${relPath}"`, {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    });

    return content;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`File not found in commit ${commitHash}`);
    }
    throw new Error(`Failed to retrieve scene prose: ${err.message}`);
  }
}

/**
 * Check if working tree is clean (no uncommitted changes)
 */
export function isWorkingTreeClean(dirPath) {
  try {
    const output = execSync("git status --porcelain", {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    });
    return output.trim() === "";
  } catch {
    return false;
  }
}

/**
 * Get the HEAD commit hash
 */
export function getHeadCommitHash(dirPath) {
  try {
    const hash = execSync("git rev-parse HEAD", {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    return hash;
  } catch {
    return null;
  }
}
