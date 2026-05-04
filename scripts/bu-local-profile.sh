#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "Usage: $0 \"<task>\""
  echo "Example: $0 \"Open http://localhost:5173 and fill the test form\""
  exit 1
fi

if [ -f "$PWD/.env.local" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$PWD/.env.local"
  set +a
fi
if [ -f "$PWD/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$PWD/.env"
  set +a
fi

# Required/local profile defaults
: "${BROWSER_USE_USER_DATA_DIR:=$HOME/Library/Application\ Support/Google/Chrome}"
: "${BROWSER_USE_PROFILE_DIRECTORY:=Default}"
: "${BROWSER_USE_CHATGPT_PROFILE_DIRECTORY:=}"
: "${BROWSER_USE_PREFER_LIVE_PROFILE_FOR_CHATGPT:=0}"
: "${BROWSER_USE_PROVIDER:=openrouter}"
: "${BROWSER_USE_LLM:=openai/gpt-5-mini}"

: "${TIMEOUT_BrowserStartEvent:=240}"
: "${TIMEOUT_BrowserLaunchEvent:=240}"
: "${BROWSER_USE_SOCKET_TIMEOUT:=1800}"
: "${BROWSER_USE_DISABLE_EXTENSIONS:=1}"
: "${BROWSER_USE_SKIP_PROFILE_COPY:=0}"

AVAILABLE_GB=$(df -Pk "$HOME" | awk 'NR==2 {print int($4/1024/1024)}')
if [[ "$AVAILABLE_GB" -lt 3 ]]; then
  echo "Need at least 3 GB free in home. Available: ${AVAILABLE_GB} GB"
  echo "Free more disk space before running local profile mode."
  exit 1
fi

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" && -z "${BROWSER_USE_API_KEY:-}" ]]; then
  echo "Set OPENROUTER_API_KEY or OPENAI_API_KEY (for LLM inference), or BROWSER_USE_API_KEY."
  exit 1
fi

if [[ -n "${BROWSER_USE_CHATGPT_PROFILE_DIRECTORY}" ]]; then
  BROWSER_USE_PROFILE_DIRECTORY="${BROWSER_USE_CHATGPT_PROFILE_DIRECTORY}"
fi

if [[ "$BROWSER_USE_PREFER_LIVE_PROFILE_FOR_CHATGPT" == "1" ]]; then
  BROWSER_USE_SKIP_PROFILE_COPY=1
fi

pkill -f "browser_use\.skill_cli\.server" >/dev/null 2>&1 || true
pkill -f "--remote-debugging-port" >/dev/null 2>&1 || true
pkill -f "--headless" >/dev/null 2>&1 || true

export BROWSER_USE_USER_DATA_DIR BROWSER_USE_PROFILE_DIRECTORY
export TIMEOUT_BrowserStartEvent TIMEOUT_BrowserLaunchEvent BROWSER_USE_SOCKET_TIMEOUT
export BROWSER_USE_DISABLE_EXTENSIONS BROWSER_USE_SKIP_PROFILE_COPY

CLI_BIN="/Users/$USER/.bun/install/global/node_modules/browser-use/dist/cli.js"
if [[ ! -x "$CLI_BIN" ]]; then
  if command -v browser-use >/dev/null 2>&1; then
    CLI_BIN="$(command -v browser-use)"
  else
    echo "browser-use CLI not found. Install: bun add -g browser-use"
    exit 1
  fi
fi

ARGS=(
  "run"
  "$TASK"
)
if [[ -n "${BROWSER_USE_PROVIDER}" ]]; then
  ARGS+=(--provider "$BROWSER_USE_PROVIDER")
fi
ARGS+=(
  --model "$BROWSER_USE_LLM"
  "--user-data-dir" "$BROWSER_USE_USER_DATA_DIR"
  "--profile-directory" "$BROWSER_USE_PROFILE_DIRECTORY"
)

if [[ "$BROWSER_USE_SKIP_PROFILE_COPY" != "0" ]]; then
  echo "BROWSER_USE_SKIP_PROFILE_COPY=$BROWSER_USE_SKIP_PROFILE_COPY"
  echo "  (Using live profile mode. This is less safe than copied-profile mode.)"
fi

echo "Running browser-use local profile:"
echo "  user-data-dir: $BROWSER_USE_USER_DATA_DIR"
echo "  profile-directory: $BROWSER_USE_PROFILE_DIRECTORY"
echo "  model: $BROWSER_USE_LLM"
if [[ -n "${BROWSER_USE_PROVIDER}" ]]; then
  echo "  provider: $BROWSER_USE_PROVIDER"
fi

echo ""

echo "Starting..."
node "$CLI_BIN" "${ARGS[@]}"
