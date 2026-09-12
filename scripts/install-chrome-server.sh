#!/usr/bin/env bash
# Install Chrome + libs for Flow BiB / Puppeteer on Ubuntu.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y

# Runtime libs (try t64 names first on newer Ubuntu)
apt-get install -y \
  ca-certificates fonts-liberation wget xdg-utils \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 \
  libcups2t64 libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxkbcommon0 libxrandr2 2>/dev/null \
|| apt-get install -y \
  ca-certificates fonts-liberation wget xdg-utils \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 \
  libcups2 libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxkbcommon0 libxrandr2

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/flow-bib"

echo "[*] Installing Puppeteer-managed Chrome…"
npx puppeteer browsers install chrome || true

if [ ! -x /usr/bin/google-chrome-stable ] && [ ! -x /usr/bin/google-chrome ]; then
  echo "[*] Installing Google Chrome stable deb…"
  cd /tmp
  wget -q -O chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y ./chrome.deb || dpkg -i chrome.deb || true
  apt-get install -f -y
fi

CHROME="$(command -v google-chrome-stable || command -v google-chrome || true)"
if [ -n "$CHROME" ]; then
  grep -q '^PUPPETEER_EXECUTABLE_PATH=' "$ROOT/.env" 2>/dev/null \
    && sed -i "s|^PUPPETEER_EXECUTABLE_PATH=.*|PUPPETEER_EXECUTABLE_PATH=$CHROME|" "$ROOT/.env" \
    || echo "PUPPETEER_EXECUTABLE_PATH=$CHROME" >> "$ROOT/.env"
  echo "[✓] PUPPETEER_EXECUTABLE_PATH=$CHROME"
fi

echo "[✓] Chrome install finished. Restart BiB: pm2 restart flowbysk-bib --update-env"
find /root/.cache/puppeteer -type f -name chrome 2>/dev/null | head -5 || true
ls -la "$CHROME" 2>/dev/null || true
