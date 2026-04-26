import { z } from "zod";
import fs from "node:fs";
import matter from "gray-matter";
import yaml from "js-yaml";
import { createSnapshot, listSnapshots } from "../git.js";
import { getFileWriteDiagnostics, readMeta, indexSceneFile } from "../sync.js";

export function registerEditingTools(s, {
  db,
  SYNC_DIR,
  GIT_ENABLED,
  errorResponse,
  jsonResponse,
  pendingProposals,
  generateProposalId,
}) {
  // ---- propose_edit --------------------------------------------------------
  s.tool(
    "propose_edit",
    "Generate a proposed revision for a scene. Returns a proposal_id and a diff preview. Nothing is written yet — you must call commit_edit to apply the change. This tool requires git to be available.",
    {
      scene_id: z.string().describe("The scene_id to revise (e.g. 'sc-011-sebastian')."),
      instruction: z.string().describe("A brief instruction for the edit (e.g. 'Tighten the opening paragraph'). Used in the git commit message."),
      revised_prose: z.string().describe("The complete revised prose text for the scene."),
    },
    async ({ scene_id, instruction, revised_prose }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — prose editing is not supported. Ensure git is installed and the sync directory is writable.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found. Hint: call find_scenes to get valid scene IDs.`);
      }

      try {
        const raw = fs.readFileSync(scene.file_path, "utf8");
        const { data: metadata, content: currentProse } = matter(raw);

        const currentLines = currentProse.trim().split("\n");
        const revisedLines = revised_prose.trim().split("\n");
        const diffLines = [];
        const maxLines = Math.max(currentLines.length, revisedLines.length);

        for (let i = 0; i < Math.min(3, maxLines); i++) {
          const curr = currentLines[i] || "(removed)";
          const rev = revisedLines[i] || "(removed)";
          if (curr !== rev) {
            diffLines.push(`- ${curr.substring(0, 80)}`);
            diffLines.push(`+ ${rev.substring(0, 80)}`);
          }
        }
        if (maxLines > 3) {
          diffLines.push(`... (${maxLines - 3} more lines)`);
        }

        const proposalId = generateProposalId();
        pendingProposals.set(proposalId, {
          scene_id,
          scene_file_path: scene.file_path,
          instruction,
          revised_prose,
          original_prose: currentProse,
          metadata,
          created_at: new Date().toISOString(),
        });

        return jsonResponse({
          proposal_id: proposalId,
          scene_id,
          instruction,
          diff_preview: diffLines.join("\n"),
          note: "Review the diff above. Call commit_edit with this proposal_id to apply the change.",
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file for scene '${scene_id}' not found at indexed path.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to read scene file: ${err.message}`);
      }
    }
  );

  // ---- commit_edit ---------------------------------------------------------
  s.tool(
    "commit_edit",
    "Apply a proposed edit and commit it to git. First creates a pre-edit snapshot, then writes the revised prose and metadata back to disk. The scene metadata stale flag is cleared.",
    {
      scene_id: z.string().describe("The scene_id being revised."),
      proposal_id: z.string().describe("The proposal_id returned by propose_edit."),
    },
    async ({ scene_id, proposal_id }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — prose editing is not supported.");
      }

      const proposal = pendingProposals.get(proposal_id);
      if (!proposal) {
        return errorResponse("PROPOSAL_NOT_FOUND", `Proposal '${proposal_id}' not found or has expired. Hint: call propose_edit again to create a fresh proposal_id.`);
      }

      if (proposal.scene_id !== scene_id) {
        return errorResponse("INVALID_EDIT", `Proposal '${proposal_id}' is for scene '${proposal.scene_id}', not '${scene_id}'.`);
      }

      try {
        const proseWriteDiagnostics = getFileWriteDiagnostics(proposal.scene_file_path);
        if (proseWriteDiagnostics.stat_error_code === "EACCES" || proseWriteDiagnostics.stat_error_code === "EPERM") {
          return errorResponse(
            "PROSE_FILE_NOT_WRITABLE",
            "Scene prose file cannot be accessed by the current runtime user.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        if (proseWriteDiagnostics.stat_error_code && proseWriteDiagnostics.stat_error_code !== "ENOENT" && proseWriteDiagnostics.stat_error_code !== "ENOTDIR") {
          return errorResponse(
            "IO_ERROR",
            "Failed to inspect scene prose path before writing.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        if (!proseWriteDiagnostics.exists) {
          return errorResponse("STALE_PATH", "Prose file not found at indexed path.", {
            indexed_path: proposal.scene_file_path,
            prose_write_diagnostics: proseWriteDiagnostics,
          });
        }

        if (!proseWriteDiagnostics.is_file) {
          return errorResponse("INVALID_PROSE_PATH", "Indexed prose path is not a regular file.", {
            indexed_path: proposal.scene_file_path,
            prose_write_diagnostics: proseWriteDiagnostics,
          });
        }

        if (!proseWriteDiagnostics.writable) {
          return errorResponse(
            "PROSE_FILE_NOT_WRITABLE",
            "Scene prose file is not writable by the current runtime user.",
            {
              indexed_path: proposal.scene_file_path,
              prose_write_diagnostics: proseWriteDiagnostics,
            }
          );
        }

        const hasFrontmatter = proposal.metadata && Object.keys(proposal.metadata).length > 0;
        const content = hasFrontmatter
          ? `---\n${yaml.dump(proposal.metadata)}---\n\n${proposal.revised_prose}\n`
          : `${proposal.revised_prose}\n`;

        const snapshot = createSnapshot(SYNC_DIR, proposal.scene_file_path, scene_id, proposal.instruction);

        fs.writeFileSync(proposal.scene_file_path, content, "utf8");

        const { meta: canonicalMeta } = readMeta(proposal.scene_file_path, SYNC_DIR, { writable: false });
        const { content: newProse } = matter(content);
        indexSceneFile(db, SYNC_DIR, proposal.scene_file_path, canonicalMeta, newProse);

        pendingProposals.delete(proposal_id);

        return jsonResponse({
          ok: true,
          scene_id,
          proposal_id,
          snapshot_commit: snapshot.commit_hash,
          message: `Committed edit for scene '${scene_id}'${snapshot.commit_hash ? ` (snapshot: ${snapshot.commit_hash.substring(0, 7)})` : " (no changes to snapshot)"}`,
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file not found at indexed path.`, { indexed_path: proposal.scene_file_path });
        }
        return errorResponse("IO_ERROR", `Failed to commit edit: ${err.message}`);
      }
    }
  );

  // ---- discard_edit --------------------------------------------------------
  s.tool(
    "discard_edit",
    "Discard a pending proposal without applying it. The proposal is deleted and the prose remains unchanged.",
    {
      proposal_id: z.string().describe("The proposal_id to discard (from propose_edit)."),
    },
    async ({ proposal_id }) => {
      const proposal = pendingProposals.get(proposal_id);
      if (!proposal) {
        return errorResponse("PROPOSAL_NOT_FOUND", `Proposal '${proposal_id}' not found or has already been discarded.`);
      }

      pendingProposals.delete(proposal_id);
      return jsonResponse({
        ok: true,
        proposal_id,
        message: `Discarded proposal '${proposal_id}' for scene '${proposal.scene_id}'.`,
      });
    }
  );

  // ---- snapshot_scene -------------------------------------------------------
  s.tool(
    "snapshot_scene",
    "Manually create a git commit (snapshot) for the current state of a scene. Use this to mark important editing checkpoints outside of the propose/commit workflow.",
    {
      scene_id: z.string().describe("The scene_id to snapshot."),
      project_id: z.string().describe("Project the scene belongs to."),
      reason: z.string().describe("A brief reason for the snapshot (e.g. 'Character arc milestone reached')."),
    },
    async ({ scene_id, project_id, reason }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — snapshots cannot be created.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ? AND project_id = ?`)
        .get(scene_id, project_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found in project '${project_id}'.`);
      }

      try {
        const snapshot = createSnapshot(SYNC_DIR, scene.file_path, scene_id, reason);
        if (!snapshot.commit_hash) {
          return jsonResponse({
            ok: true,
            scene_id,
            reason,
            message: "No changes to snapshot.",
          });
        }

        return jsonResponse({
          ok: true,
          scene_id,
          reason,
          commit_hash: snapshot.commit_hash,
          message: `Created snapshot for scene '${scene_id}': ${reason}`,
        });
      } catch (err) {
        if (err.code === "ENOENT") {
          return errorResponse("STALE_PATH", `Prose file not found at indexed path.`, { indexed_path: scene.file_path });
        }
        return errorResponse("IO_ERROR", `Failed to create snapshot: ${err.message}`);
      }
    }
  );

  // ---- list_snapshots -------------------------------------------------------
  s.tool(
    "list_snapshots",
    "List git commit history for a scene, with timestamps and commit messages. Use this to find commit hashes for get_scene_prose historical retrieval.",
    {
      scene_id: z.string().describe("The scene_id to list snapshots for."),
    },
    async ({ scene_id }) => {
      if (!GIT_ENABLED) {
        return errorResponse("GIT_UNAVAILABLE", "Git is not available — snapshots cannot be retrieved.");
      }

      const scene = db.prepare(`SELECT file_path FROM scenes WHERE scene_id = ?`).get(scene_id);
      if (!scene) {
        return errorResponse("NOT_FOUND", `Scene '${scene_id}' not found.`);
      }

      try {
        const snapshots = listSnapshots(SYNC_DIR, scene.file_path);
        if (!snapshots || snapshots.length === 0) {
          return errorResponse("NO_RESULTS", `No snapshots found for scene '${scene_id}'. Try editing and committing the scene first.`);
        }

        return jsonResponse({
          scene_id,
          snapshots: snapshots.map(s => ({
            commit_hash: s.commit_hash,
            short_hash: s.commit_hash.substring(0, 7),
            timestamp: s.timestamp,
            message: s.message,
          })),
          note: "Use the commit_hash values with get_scene_prose(scene_id, commit) to retrieve a past version.",
        });
      } catch (err) {
        return errorResponse("IO_ERROR", `Failed to list snapshots: ${err.message}`);
      }
    }
  );
}
