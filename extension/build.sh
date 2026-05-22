#!/bin/bash
# Build extension zips for Chrome and Firefox
# Usage:
#   ./build.sh          — build both
#   ./build.sh chrome   — Chrome only
#   ./build.sh firefox  — Firefox only

set -e
cd "$(dirname "$0")"

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
OUT_DIR="../dist"
mkdir -p "$OUT_DIR"

EXCLUDE=(
  "--exclude=*.sh"
  "--exclude=*.bak"
  "--exclude=manifest.firefox.json"
  "--exclude=.DS_Store"
  "--exclude=*.map"
)

build_chrome() {
  local OUT="$OUT_DIR/scienceecosystem-chrome-${VERSION}.zip"
  rm -f "$OUT"
  zip -r "$OUT" . "${EXCLUDE[@]}"
  echo "Chrome  → $OUT"
}

build_firefox() {
  local ORIG="manifest.json"
  local BACKUP="manifest.json.chrome.bak"
  local OUT="$OUT_DIR/scienceecosystem-firefox-${VERSION}.zip"

  cp "$ORIG" "$BACKUP"
  cp manifest.firefox.json "$ORIG"

  rm -f "$OUT"
  zip -r "$OUT" . "${EXCLUDE[@]}" --exclude="*.bak"

  cp "$BACKUP" "$ORIG"
  rm -f "$BACKUP"

  echo "Firefox → $OUT"
}

TARGET="${1:-both}"
case "$TARGET" in
  chrome)  build_chrome ;;
  firefox) build_firefox ;;
  *)       build_chrome; build_firefox ;;
esac

echo "Done. Files in $OUT_DIR/"
