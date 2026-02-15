#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PLUGIN_SMOKE_PORT:-3014}"
SOURCE_CONFIG="${PLUGIN_SMOKE_CONFIG_PATH:-$ROOT_DIR/config/default.json}"

python3 - <<PY
import json
from pathlib import Path
src = Path(r"$SOURCE_CONFIG")
cfg = json.loads(src.read_text())
cfg['server']['port'] = int(r"$PORT")
# Keep auth disabled for local smoke unless caller enables it explicitly in source config.
Path('/tmp/plugin-smoke-config.json').write_text(json.dumps(cfg))
PY

CONFIG_PATH=/tmp/plugin-smoke-config.json node "$ROOT_DIR/dist/index.js" >/tmp/plugin-smoke-server.log 2>&1 &
APP_PID=$!
cleanup() {
  kill "$APP_PID" >/dev/null 2>&1 || true
  wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT
sleep 1

npx tsx "$ROOT_DIR/scripts/plugin-hook-smoke.ts" --base-url "http://127.0.0.1:$PORT"
