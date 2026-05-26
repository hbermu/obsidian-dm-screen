#!/bin/sh
# Bootstraps pjeby/hot-reload into the dev vault if it isn't there yet.
# Hot-reload watches plugin folders and reloads the plugin when main.js changes,
# so editing TS → esbuild rebuild → plugin reload happens without restarting Obsidian.
set -eu

PLUGIN_DIR=".dev/vault/.obsidian/plugins/hot-reload"
RELEASE_URL="https://github.com/pjeby/hot-reload/releases/latest/download"

if [ -f "$PLUGIN_DIR/main.js" ] && [ -f "$PLUGIN_DIR/manifest.json" ]; then
  echo "[bootstrap-hot-reload] already installed, skipping"
  exit 0
fi

echo "[bootstrap-hot-reload] downloading pjeby/hot-reload..."
mkdir -p "$PLUGIN_DIR"

# wget is available in node:22-alpine via busybox; fall back to curl if not.
fetch() {
  url="$1"; out="$2"
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "$out" "$url"
  else
    curl -fsSL -o "$out" "$url"
  fi
}

fetch "$RELEASE_URL/main.js"       "$PLUGIN_DIR/main.js"
fetch "$RELEASE_URL/manifest.json" "$PLUGIN_DIR/manifest.json"

echo "[bootstrap-hot-reload] installed at $PLUGIN_DIR"
