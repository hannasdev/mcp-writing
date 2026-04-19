#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"
OPENCLAW_UID_VALUE="$(id -u)"
OPENCLAW_GID_VALUE="$(id -g)"
OPENCLAW_WORKSPACE_DIR_VALUE="${OPENCLAW_WORKSPACE_DIR:-$(pwd)}"
OPENCLAW_SSH_DIR_VALUE="${OPENCLAW_SSH_DIR:-$HOME/.ssh}"

TMP_FILE="$(mktemp)"
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
  printf "OPENCLAW_UID=%s\n" "$OPENCLAW_UID_VALUE"
  printf "OPENCLAW_GID=%s\n" "$OPENCLAW_GID_VALUE"
  printf "OPENCLAW_WORKSPACE_DIR=%s\n" "$OPENCLAW_WORKSPACE_DIR_VALUE"
  printf "OPENCLAW_SSH_DIR=%s\n" "$OPENCLAW_SSH_DIR_VALUE"
  printf "OWNERSHIP_GUARD_MODE=%s\n" "warn"
} > "$ENV_FILE"

printf "Wrote %s with OPENCLAW runtime variables.\n" "$ENV_FILE"
printf "UID:GID=%s:%s\n" "$OPENCLAW_UID_VALUE" "$OPENCLAW_GID_VALUE"
printf "WORKSPACE=%s\n" "$OPENCLAW_WORKSPACE_DIR_VALUE"
printf "SSH_DIR=%s\n" "$OPENCLAW_SSH_DIR_VALUE"
