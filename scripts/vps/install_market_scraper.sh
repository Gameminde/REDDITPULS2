#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/redditpulse}"
APP_USER="${APP_USER:-redditpulse}"
APP_GROUP="${APP_GROUP:-redditpulse}"
SERVICE_NAME="${SERVICE_NAME:-redditpulse-scraper}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Repo directory not found: $REPO_DIR" >&2
  echo "Clone the RedditPulse repo there first, then rerun this script." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python binary not found: $PYTHON_BIN" >&2
  exit 1
fi

if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  groupadd --system "$APP_GROUP"
fi

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$REPO_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p /etc/redditpulse /var/log/redditpulse
chmod 755 \
  "$REPO_DIR/scripts/vps/install_market_scraper.sh" \
  "$REPO_DIR/scripts/vps/run_market_scraper.sh" \
  "$REPO_DIR/scripts/vps/prepare_web_runtime.sh" \
  "$REPO_DIR/scripts/vps/verify_runtime.sh"

"$PYTHON_BIN" -m venv "$REPO_DIR/.venv"
mkdir -p "$REPO_DIR/.venv/nltk_data"
chown -R "$APP_USER:$APP_GROUP" "$REPO_DIR/.venv" /var/log/redditpulse
sudo -u "$APP_USER" "$REPO_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$APP_USER" "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/requirements-scraper.txt"
sudo -u "$APP_USER" env NLTK_DATA="$REPO_DIR/.venv/nltk_data" "$REPO_DIR/.venv/bin/python" -c "import nltk; nltk.download('vader_lexicon', quiet=True)"

if [[ ! -f /etc/redditpulse/scraper.env ]]; then
  install -m 640 "$REPO_DIR/scripts/vps/scraper.env.example" /etc/redditpulse/scraper.env
  chown root:"$APP_GROUP" /etc/redditpulse/scraper.env
fi

render_unit() {
  local src="$1"
  local dest="$2"
  python - "$src" "$dest" "$REPO_DIR" "$APP_USER" "$APP_GROUP" "$SERVICE_NAME" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
repo_dir, app_user, app_group, service_name = sys.argv[3:7]
text = src.read_text(encoding="utf-8")
text = text.replace("{{REPO_DIR}}", repo_dir)
text = text.replace("{{APP_USER}}", app_user)
text = text.replace("{{APP_GROUP}}", app_group)
text = text.replace("{{SERVICE_NAME}}", service_name)
dest.write_text(text, encoding="utf-8")
PY
}

render_unit "$REPO_DIR/scripts/vps/redditpulse-scraper.service" "/etc/systemd/system/$SERVICE_NAME.service"
render_unit "$REPO_DIR/scripts/vps/redditpulse-scraper.timer" "/etc/systemd/system/$SERVICE_NAME.timer"
chmod 644 "/etc/systemd/system/$SERVICE_NAME.service" "/etc/systemd/system/$SERVICE_NAME.timer"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME.timer"

echo
echo "VPS scraper worker installed."
echo "Next steps:"
echo "  1. Edit /etc/redditpulse/scraper.env"
echo "  2. Test manually: systemctl start $SERVICE_NAME.service"
echo "  3. Inspect logs: journalctl -u $SERVICE_NAME.service -n 200 --no-pager"
echo "  4. After app builds, run: bash $REPO_DIR/scripts/vps/prepare_web_runtime.sh $REPO_DIR"
echo "  5. Verify runtime: bash $REPO_DIR/scripts/vps/verify_runtime.sh $REPO_DIR"
echo "  6. Repo ownership stays with the deploy user; only .venv, app/.next, and logs are runtime-owned"
