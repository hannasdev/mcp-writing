#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"
OPENCLAW_UID_VALUE="$(id -u)"
OPENCLAW_GID_VALUE="$(id -g)"
OPENCLAW_WORKSPACE_DIR_VALUE="${OPENCLAW_WORKSPACE_DIR:-$(pwd)}"
OPENCLAW_SSH_DIR_VALUE="${OPENCLAW_SSH_DIR:-${HOME:-$(pwd)}/.ssh}"
OWNERSHIP_GUARD_MODE_VALUE="${2:-${OWNERSHIP_GUARD_MODE:-}}"

quote_env_value() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/["\\]/\\&/g')"
}

if [ -z "$OWNERSHIP_GUARD_MODE_VALUE" ] && [ -f "$ENV_FILE" ]; then
  EXISTING_GUARD_MODE="$(grep -E '^OWNERSHIP_GUARD_MODE=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  OWNERSHIP_GUARD_MODE_VALUE="$EXISTING_GUARD_MODE"
fi

if [ -z "$OWNERSHIP_GUARD_MODE_VALUE" ]; then
  OWNERSHIP_GUARD_MODE_VALUE="warn"
fi

NORMALIZED_GUARD_MODE="$(printf '%s' "$OWNERSHIP_GUARD_MODE_VALUE" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [ "$NORMALIZED_GUARD_MODE" != "warn" ] && [ "$NORMALIZED_GUARD_MODE" != "fail" ]; then
  printf 'Warning: unsupported OWNERSHIP_GUARD_MODE=%s, defaulting to "warn".\n' "$OWNERSHIP_GUARD_MODE_VALUE" >&2
  OWNERSHIP_GUARD_MODE_VALUE="warn"
else
  OWNERSHIP_GUARD_MODE_VALUE="$NORMALIZED_GUARD_MODE"
fi

if TMP_FILE="$(mktemp -t openclaw-env.XXXXXX 2>/dev/null)"; then
  :
else
  TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/openclaw-env.XXXXXX")"
fi
trap 'rm -f "$TMP_FILE"' EXIT

if [ -f "$ENV_FILE" ]; then
  awk '
    !/^OPENCLAW_UID=/ &&
    !/^OPENCLAW_GID=/ &&
    !/^OPENCLAW_WORKSPACE_DIR=/ &&
    !/^OPENCLAW_SSH_DIR=/ &&
    !/^OWNERSHIP_GUARD_MODE=/
  ' "$ENV_FILE" > "$TMP_FILE"
fi

{
  cat "$TMP_FILE"
  if [ -s "$TMP_FILE" ]; then
    printf "\n"
  fi
  printf "OPENCLAW_UID=%s\n" "$OPENCLAW_UID_VALUE"
  printf "OPENCLAW_GID=%s\n" "$OPENCLAW_GID_VALUE"
  printf "OPENCLAW_WORKSPACE_DIR=%s\n" "$(quote_env_value "$OPENCLAW_WORKSPACE_DIR_VALUE")"
  printf "OPENCLAW_SSH_DIR=%s\n" "$(quote_env_value "$OPENCLAW_SSH_DIR_VALUE")"
  printf "OWNERSHIP_GUARD_MODE=%s\n" "$OWNERSHIP_GUARD_MODE_VALUE"
} > "$ENV_FILE"

printf "Wrote %s with OPENCLAW runtime variables.\n" "$ENV_FILE"
printf "UID:GID=%s:%s\n" "$OPENCLAW_UID_VALUE" "$OPENCLAW_GID_VALUE"
printf "WORKSPACE=%s\n" "$OPENCLAW_WORKSPACE_DIR_VALUE"
printf "SSH_DIR=%s\n" "$OPENCLAW_SSH_DIR_VALUE"
