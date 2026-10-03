#!/bin/bash
# XCF-GG 04 — installa doc-ocr sul Mac Mini: compila ocr-pdf (Apple Vision),
# copia il worker, config (URL + chiave pubblica dal worker CW), job launchd
# ogni 5 minuti. Usa il token del worker Mac Mini gia' nel Portachiavi.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$SRC/../.." && pwd)"
HOME_DIR="$HOME/Library/Application Support/Brigade/doc-ocr"
APP="$HOME_DIR/app"
NODE="$(command -v node)"
LABEL="com.brigade.doc-ocr"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/Brigade"
mkdir -p "$APP/bin" "$APP/src" "$LOGS"; chmod 700 "$HOME_DIR"
cp "$SRC/src/index.js" "$APP/src/index.js"
cp "$REPO/js/vendor-parsers/ocr-layout.js" "$APP/src/ocr-layout.js"
swiftc -O "$SRC/src/ocr-pdf.swift" -o "$APP/bin/ocr-pdf"
if [ ! -f "$HOME_DIR/config.json" ]; then
  cp "$HOME/Library/Application Support/Brigade/cw-order-sender/config.json" "$HOME_DIR/config.json"; chmod 600 "$HOME_DIR/config.json"
fi
cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/src/index.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/doc-ocr.log</string>
  <key>StandardErrorPath</key><string>$LOGS/doc-ocr.err</string>
</dict>
</plist>
XML
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installato: $APP (job $LABEL ogni 5 minuti)"
