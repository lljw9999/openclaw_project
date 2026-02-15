#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_CONFIG="${PORTKEY_CONFIG_PATH:-$ROOT_DIR/config/portkey.opus.json}"
PORT="${PORTKEY_SMOKE_PORT:-3013}"

if [[ -z "${PREMIUM_LLM_API_KEY:-}" ]]; then
  echo "PREMIUM_LLM_API_KEY is required."
  echo "Example: PREMIUM_LLM_API_KEY='***' npm run smoke:portkey"
  exit 1
fi

python3 - <<PY
import json
from pathlib import Path
src = Path(r"$RUNTIME_CONFIG")
cfg = json.loads(src.read_text())
cfg['server']['port'] = int(r"$PORT")
Path('/tmp/portkey-smoke-config.json').write_text(json.dumps(cfg))
PY

CONFIG_PATH=/tmp/portkey-smoke-config.json node "$ROOT_DIR/dist/index.js" >/tmp/portkey-smoke-server.log 2>&1 &
APP_PID=$!
cleanup() {
  kill "$APP_PID" >/dev/null 2>&1 || true
  wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 1

curl -s "http://127.0.0.1:$PORT/health" >/tmp/portkey-smoke-health.json
curl -s -D /tmp/portkey-smoke-headers.txt -H 'content-type: application/json' \
  "http://127.0.0.1:$PORT/v1/chat/completions" \
  -d '{
    "messages": [
      {"role":"system","content":"You are a concise assistant."},
      {"role":"user","content":"Provide two bullets about secure agent routing architecture."}
    ],
    "MAX_TOKENS": 120
  }' >/tmp/portkey-smoke-body.json

python3 - <<'PY'
import json
from pathlib import Path
health = Path('/tmp/portkey-smoke-health.json').read_text().strip()
headers = Path('/tmp/portkey-smoke-headers.txt').read_text(errors='ignore').splitlines()
body = json.loads(Path('/tmp/portkey-smoke-body.json').read_text())
print('health:', health)
if headers:
  print('status:', headers[0])
status_line = headers[0] if headers else ''
for line in headers:
  l = line.lower()
  if l.startswith('x-route-tier:') or l.startswith('x-route-model:'):
    print(line)
choices = body.get('choices') or []
if choices:
  text = choices[0].get('message', {}).get('content', '')
  print('assistant_preview:', text.replace('\n', ' ')[:220])
else:
  print('assistant_preview: <no choices>')
print('model_returned:', body.get('model'))

if ' 200 ' not in status_line:
  print('error_body:', body)
  raise SystemExit(1)
PY
