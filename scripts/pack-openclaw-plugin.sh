#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/extensions/enterprise-control-plane"
OUT_DIR="$ROOT_DIR/dist"
OUT_FILE="$OUT_DIR/enterprise-control-plane-plugin.tgz"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "Plugin directory not found: $PLUGIN_DIR"
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

tar -czf "$OUT_FILE" -C "$ROOT_DIR/extensions" enterprise-control-plane

echo "Packed plugin: $OUT_FILE"
