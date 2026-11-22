#!/usr/bin/env bash
# External liveness watcher for flowbysk-api.
# If /health fails 3 times in a row, pm2 restart flowbysk-api.
# Install (server):
#   chmod +x /opt/flowbysk/scripts/watch-api-health.sh
#   crontab -e  →  * * * * * /opt/flowbysk/scripts/watch-api-health.sh >> /var/log/flowbysk-api-watch.log 2>&1
set -euo pipefail

URL="${API_HEALTH_URL:-http://127.0.0.1:8000/health}"
STATE_DIR="${API_WATCH_STATE_DIR:-/tmp/flowbysk-api-watch}"
FAIL_FILE="$STATE_DIR/fails"
MAX_FAILS="${API_WATCH_MAX_FAILS:-3}"
PM2_APP="${API_PM2_NAME:-flowbysk-api}"

mkdir -p "$STATE_DIR"
fails=0
if [[ -f "$FAIL_FILE" ]]; then
  fails=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
fi
fails=${fails:-0}

if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
  echo 0 > "$FAIL_FILE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$FAIL_FILE"
echo "[$(date -Is)] health FAIL ($fails/$MAX_FAILS) $URL"

if [[ "$fails" -ge "$MAX_FAILS" ]]; then
  echo "[$(date -Is)] restarting $PM2_APP via pm2"
  pm2 restart "$PM2_APP" --update-env || true
  echo 0 > "$FAIL_FILE"
fi
