#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_FILE="$SCRIPT_DIR/browser-use-delete-chats.task"

if [ ! -f "$TASK_FILE" ]; then
  echo "Missing task file: $TASK_FILE"
  exit 1
fi

TASK="$(cat "$TASK_FILE")"
"$SCRIPT_DIR/bu-local-profile.sh" "$TASK"
