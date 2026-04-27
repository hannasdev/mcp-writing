/**
 * getRuntimeDiagnostics
 *
 * Inspects the startup environment and returns { warnings, recommendations }.
 * All inputs are passed explicitly so this module has no side effects and
 * is straightforward to test.
 *
 * @param {object} opts
 * @param {string}  opts.ownershipGuardModeRaw      Raw env value before normalisation
 * @param {string}  opts.ownershipGuardMode          Normalised value ("warn" | "fail")
 * @param {string}  opts.ownershipGuardModeRawDisplay JSON.stringify of the raw value
 * @param {boolean} opts.syncDirWritable
 * @param {string}  opts.syncDirAbs                 Resolved absolute path shown in messages
 * @param {object}  opts.syncOwnershipDiagnostics   Result of getSyncOwnershipDiagnostics()
 * @param {boolean} opts.gitAvailable
 * @param {boolean} opts.gitEnabled
 * @returns {{ warnings: string[], recommendations: string[] }}
 */
export function getRuntimeDiagnostics({
  ownershipGuardModeRaw,
  ownershipGuardMode,
  ownershipGuardModeRawDisplay,
  syncDirWritable,
  syncDirAbs,
  syncOwnershipDiagnostics,
  gitAvailable,
  gitEnabled,
}) {
  const warnings = [];
  const recommendations = [];

  if (ownershipGuardModeRaw !== ownershipGuardMode) {
    warnings.push(
      `OWNERSHIP_GUARD_MODE_INVALID: Unsupported OWNERSHIP_GUARD_MODE=${ownershipGuardModeRawDisplay}. Falling back to 'warn'.`
    );
    recommendations.push("Set OWNERSHIP_GUARD_MODE to either 'warn' or 'fail'.");
  }

  if (syncOwnershipDiagnostics.runtime_uid_override_ignored) {
    warnings.push("RUNTIME_UID_OVERRIDE_IGNORED: RUNTIME_UID_OVERRIDE is ignored unless NODE_ENV=test or ALLOW_RUNTIME_UID_OVERRIDE=1.");
    recommendations.push("Avoid RUNTIME_UID_OVERRIDE in production runtime environments.");
  }

  if (syncOwnershipDiagnostics.runtime_uid_override_invalid) {
    warnings.push("RUNTIME_UID_OVERRIDE_INVALID: RUNTIME_UID_OVERRIDE must be a non-negative integer when enabled.");
    recommendations.push("Set RUNTIME_UID_OVERRIDE to a non-negative integer, or unset it.");
  }

  if (!syncDirWritable) {
    warnings.push("SYNC_DIR_READ_ONLY: sync dir is read-only; metadata write-back and prose editing tools are unavailable.");
    recommendations.push("Mount WRITING_SYNC_DIR with write access (avoid read-only mounts like ':ro').");
    recommendations.push("If running in Docker/OpenClaw, verify volume ownership and permissions for the container user.");
  }

  if (syncOwnershipDiagnostics.supported && syncOwnershipDiagnostics.non_runtime_owned_paths > 0) {
    warnings.push(
      `OWNERSHIP_MISMATCH: ${syncOwnershipDiagnostics.non_runtime_owned_paths} sampled path(s) are not owned by runtime UID ${syncOwnershipDiagnostics.runtime_uid}.`
    );
    recommendations.push(
      `Repair ownership once on host: sudo chown -R "$(id -u):$(id -g)" "${syncDirAbs}"`
    );
    recommendations.push(
      "For Docker/OpenClaw, run container as host user (compose: user: \"${OPENCLAW_UID:-1000}:${OPENCLAW_GID:-1000}\")."
    );
  }

  if (ownershipGuardMode === "fail" && syncOwnershipDiagnostics.runtime_uid === 0) {
    warnings.push(
      "OWNERSHIP_GUARD_SKIPPED_FOR_ROOT: OWNERSHIP_GUARD_MODE=fail is skipped because runtime UID is 0 (root)."
    );
    recommendations.push("Prefer running as a non-root host-mapped UID/GID to make ownership guard checks meaningful.");
  }

  if (syncOwnershipDiagnostics.supported && syncOwnershipDiagnostics.root_owned_paths > 0) {
    warnings.push(
      `ROOT_OWNED_PATHS: ${syncOwnershipDiagnostics.root_owned_paths} sampled path(s) are owned by UID 0 (root).`
    );
  }

  if (!gitAvailable) {
    warnings.push("GIT_NOT_FOUND: git is not available on PATH; snapshot/edit tools are unavailable.");
    recommendations.push("Install git in the runtime image/environment.");
  }

  if (gitAvailable && syncDirWritable && !gitEnabled) {
    warnings.push("GIT_DISABLED: git is available but repository snapshot tools are not active.");
    recommendations.push("Ensure WRITING_SYNC_DIR points to a writable git repository root, or allow mcp-writing to initialize one.");
  }

  if (gitAvailable && !syncDirWritable) {
    recommendations.push("If git reports 'dubious ownership' for mounted repos, add: git config --system --add safe.directory /sync");
  }

  recommendations.push("If indexing finds many files without scene_id, run scripts/import.js first for Scrivener Draft exports, then run sync.");

  return { warnings, recommendations };
}
