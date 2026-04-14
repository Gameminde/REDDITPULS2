#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/redditpulse}"
APP_USER="${APP_USER:-redditpulse}"
WEB_SERVICE="${WEB_SERVICE:-redditpulse-web.service}"
SCRAPER_SERVICE="${SCRAPER_SERVICE:-redditpulse-scraper.service}"
SCRAPER_TIMER="${SCRAPER_TIMER:-redditpulse-scraper.timer}"
WORKER_SERVICE="${WORKER_SERVICE:-redditpulse-validation-worker.service}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx.service}"
VENV_PATH="${VENV_PATH:-$REPO_DIR/.venv}"
NEXT_DIR="${NEXT_DIR:-$REPO_DIR/app/.next}"
NGINX_PROXY_TARGET="${NGINX_PROXY_TARGET:-127.0.0.1:3000}"

failures=0

pass() {
  echo "[ok] $1"
}

fail() {
  echo "[fail] $1" >&2
  failures=$((failures + 1))
}

service_state() {
  systemctl show -p ActiveState --value "$1"
}

if [[ -x "$VENV_PATH/bin/python" ]]; then
  pass "Python virtualenv is present at $VENV_PATH"
else
  fail "Missing executable Python at $VENV_PATH/bin/python"
fi

if [[ -d "$NEXT_DIR" ]]; then
  pass "Next.js runtime directory exists at $NEXT_DIR"
else
  fail "Missing Next.js runtime directory at $NEXT_DIR"
fi

if sudo -u "$APP_USER" test -w "$NEXT_DIR"; then
  pass "App user $APP_USER can write to $NEXT_DIR"
else
  fail "App user $APP_USER cannot write to $NEXT_DIR"
fi

if systemctl is-active --quiet "$WEB_SERVICE"; then
  pass "$WEB_SERVICE is active"
else
  fail "$WEB_SERVICE is not active (state: $(service_state "$WEB_SERVICE"))"
fi

if systemctl is-active --quiet "$WORKER_SERVICE"; then
  pass "$WORKER_SERVICE is active"
else
  fail "$WORKER_SERVICE is not active (state: $(service_state "$WORKER_SERVICE"))"
fi

if systemctl is-active --quiet "$SCRAPER_TIMER"; then
  pass "$SCRAPER_TIMER is active"
else
  fail "$SCRAPER_TIMER is not active (state: $(service_state "$SCRAPER_TIMER"))"
fi

if systemctl is-failed --quiet "$SCRAPER_SERVICE"; then
  fail "$SCRAPER_SERVICE is failed"
else
  pass "$SCRAPER_SERVICE is not failed (state: $(service_state "$SCRAPER_SERVICE"))"
fi

if systemctl is-active --quiet "$NGINX_SERVICE"; then
  pass "$NGINX_SERVICE is active"
else
  fail "$NGINX_SERVICE is not active (state: $(service_state "$NGINX_SERVICE"))"
fi

if nginx -T 2>/dev/null | grep -Fq "proxy_pass http://$NGINX_PROXY_TARGET"; then
  pass "nginx config includes proxy_pass http://$NGINX_PROXY_TARGET"
else
  fail "nginx config does not include proxy_pass http://$NGINX_PROXY_TARGET"
fi

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Runtime verification failed with $failures issue(s)." >&2
  exit 1
fi

echo
echo "Runtime verification passed."
