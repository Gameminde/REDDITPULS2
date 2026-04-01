#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
VENV_PATH="${VENV_PATH:-$REPO_ROOT/.venv}"
LOCK_FILE="${SCRAPER_LOCK_FILE:-/tmp/redditpulse-market-scraper.lock}"
LOG_DIR="${SCRAPER_LOG_DIR:-/var/log/redditpulse}"
ENV_FILE="${SCRAPER_ENV_FILE:-/etc/redditpulse/scraper.env}"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ ! -x "$VENV_PATH/bin/python" ]]; then
  echo "Missing Python virtualenv at $VENV_PATH" >&2
  exit 1
fi

SCRAPER_ARGS=(--mode=full --source=vps_timer)
if [[ -n "${SCRAPER_SOURCES:-}" ]]; then
  read -r -a SOURCE_ARRAY <<< "${SCRAPER_SOURCES//,/ }"
  if [[ "${#SOURCE_ARRAY[@]}" -gt 0 ]]; then
    SCRAPER_ARGS+=(--sources "${SOURCE_ARRAY[@]}")
  fi
fi

cd "$REPO_ROOT"

{
  flock -n 9 || {
    echo "[$(date -u +%FT%TZ)] skipped: scraper already running"
    exit 0
  }

  echo "[$(date -u +%FT%TZ)] starting scraper run (${SCRAPER_ARGS[*]})"
  "$VENV_PATH/bin/python" scraper_job.py "${SCRAPER_ARGS[@]}"
  echo "[$(date -u +%FT%TZ)] scraper run finished"
} 9>"$LOCK_FILE" >> "$LOG_DIR/market-scraper.log" 2>&1
