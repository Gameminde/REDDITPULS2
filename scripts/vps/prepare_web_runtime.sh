#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/redditpulse}"
APP_USER="${APP_USER:-redditpulse}"
APP_GROUP="${APP_GROUP:-redditpulse}"
NEXT_DIR="${NEXT_DIR:-$REPO_DIR/app/.next}"

if [[ ! -d "$REPO_DIR/app" ]]; then
  echo "Next.js app directory not found at $REPO_DIR/app" >&2
  exit 1
fi

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  echo "App user not found: $APP_USER" >&2
  exit 1
fi

if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  echo "App group not found: $APP_GROUP" >&2
  exit 1
fi

if [[ ! -d "$NEXT_DIR" ]]; then
  echo "Next build output not found at $NEXT_DIR" >&2
  echo "Run npm run build in $REPO_DIR/app before preparing the runtime." >&2
  exit 1
fi

chown -R "$APP_USER:$APP_GROUP" "$NEXT_DIR"
find "$NEXT_DIR" -type d -exec chmod 755 {} +
find "$NEXT_DIR" -type f -exec chmod 644 {} +

echo "Prepared Next.js runtime path: $NEXT_DIR"
echo "Runtime ownership: $APP_USER:$APP_GROUP"
echo "Repo ownership contract unchanged: only app/.next is runtime-owned for the web service."
