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

# Do not grep for fallback copy such as "AI Novel 启动失败" across the whole
# document: that text intentionally exists in the inline diagnostic source.
# The runtime instead exposes state on <html> only after React actually commits.
if grep -Eq '<html[^>]*data-ai-novel-fatal="true"' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: runtime marked a fatal startup error." >&2
  python3 - <<'PY' >&2 || true
from pathlib import Path
import re
html = Path('/tmp/ai-novel-mobile-smoke-dom.html').read_text(errors='replace')
m = re.search(r'<div id="root"[^>]*>([\s\S]*?)</div>\s*<script', html)
print((m.group(1) if m else html)[-5000:])
PY
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 33
fi

if ! grep -Eq '<html[^>]*data-ai-novel-mounted="react"' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: React never reported a committed UI." >&2
  tail -n 120 "$DOM_FILE" >&2 || true
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 32
fi

if grep -q 'class="app-startup-shell"' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: startup shell still exists after React mount." >&2
  tail -n 120 "$DOM_FILE" >&2 || true
  exit 35
fi

if ! grep -Eq 'DeepSeek|创作|作品|小说' "$DOM_FILE"; then
  echo "Mobile startup smoke test failed: no expected application UI text found." >&2
  tail -n 120 "$DOM_FILE" >&2 || true
  tail -n 80 "$CHROME_LOG" >&2 || true
  exit 34
fi

echo "Mobile startup smoke test passed: React committed and rendered application UI."
