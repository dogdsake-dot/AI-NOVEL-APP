#!/usr/bin/env bash
set -euo pipefail

if [ "${VITE_MOBILE_BUILD:-}" != "true" ]; then
  exit 0
fi

CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME" ]; then
  echo "Mobile startup smoke test requires Chrome/Chromium." >&2
  exit 31
fi

PORT=4179
DOM_FILE="/tmp/ai-novel-mobile-smoke-dom.html"
CHROME_LOG="/tmp/ai-novel-mobile-smoke-chrome.log"
SERVER_LOG="/tmp/ai-novel-mobile-smoke-server.log"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory dist >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
sleep 1

"$CHROME" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --virtual-time-budget=10000 \
  --dump-dom "http://127.0.0.1:${PORT}/" \
  >"$DOM_FILE" 2>"$CHROME_LOG"

if grep -q 'data-testid="app-startup-shell"' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: startup shell never yielded to React." >&2
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 32
fi

if grep -q 'AI Novel 启动失败' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: fatal startup fallback was rendered." >&2
  grep -A8 -B3 'AI Novel 启动失败' "$DOM_FILE" >&2 || true
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 33
fi

if ! grep -Eq 'DeepSeek|创作|作品|小说' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: no expected application UI text found." >&2
  tail -n 120 "$DOM_FILE" >&2 || true
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 34
fi

echo "Mobile startup smoke test passed: React replaced the startup shell and rendered application UI."
