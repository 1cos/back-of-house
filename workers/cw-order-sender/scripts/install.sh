#!/bin/bash
# XCF-CW — installa cw-order-sender sul Mac Mini.
# - copia il worker in ~/Library/Application Support/Brigade/cw-order-sender/app
# - config.json: URL Supabase + chiave pubblica anon (presa dal config del worker BEK)
# - token del worker: creato UNA volta nel Portachiavi (servizio brigade-cw-worker);
#   lo script stampa SOLO il suo sha256, da registrare in po_settings.cw_worker_token_sha256
# - cw-login.command per l'accesso di Max a Chef's Warehouse
# - job launchd ogni 30 s: senza ordini in coda non apre Chrome
# Idempotente: si puo' rilanciare per aggiornare il codice (il token resta).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$HOME/Library/Application Support/Brigade/cw-order-sender"
APP="$HOME_DIR/app"
NODE="$(command -v node)"
LABEL="com.brigade.cw-order-sender"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/Brigade"
BEK_CFG="$HOME/Library/Application Support/Brigade/bek-entree-sync/config.json"

mkdir -p "$APP" "$LOGS"; chmod 700 "$HOME_DIR"
rsync -a --delete --exclude node_modules --exclude test "$SRC/" "$APP/"
( cd "$APP" && npm install --omit=dev --no-audit --no-fund >/dev/null )

if [ ! -f "$HOME_DIR/config.json" ]; then
  "$NODE" -e '
    const fs = require("fs"); const [src, dst] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(src, "utf8"));
    fs.writeFileSync(dst, JSON.stringify({ supabaseUrl: c.supabaseUrl, supabaseKey: c.supabaseKey, workerId: require("os").hostname() }, null, 2), { mode: 0o600 });
  ' "$BEK_CFG" "$HOME_DIR/config.json"
fi

if ! security find-generic-password -s brigade-cw-worker -a worker >/dev/null 2>&1; then
  T="$(openssl rand -hex 32)"
  security add-generic-password -s brigade-cw-worker -a worker -T "$NODE" -T /usr/bin/security -w "$T"
  unset T
  echo "token del worker creato nel Portachiavi"
fi
HASH="$(security find-generic-password -s brigade-cw-worker -a worker -w | tr -d '\n' | shasum -a 256 | cut -d' ' -f1)"
echo "sha256 del token (da registrare in po_settings.cw_worker_token_sha256): $HASH"

cat > "$HOME_DIR/cw-login.command" <<CMD
#!/bin/bash
cd "$APP" && "$NODE" src/index.js --login
CMD
chmod 700 "$HOME_DIR/cw-login.command"

if [ "${1:-}" != "--no-launchd" ]; then
cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$APP/src/index.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/cw-order-sender.log</string>
  <key>StandardErrorPath</key><string>$LOGS/cw-order-sender.err</string>
</dict>
</plist>
XML
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "job: $LABEL ogni 30 s"
fi
echo "installato: $APP"
echo "login CW: $HOME_DIR/cw-login.command"
