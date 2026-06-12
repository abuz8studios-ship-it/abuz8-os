#!/usr/bin/env bash
# Rebuild ABUZ8 OS: pack src/ -> app.asar, swap into the install, relaunch.
# Usage:  bash scripts/rebuild.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="/c/Users/$USER/AppData/Local/Programs/ABUZ8 OS"
RES="$INSTALL/resources"

echo "Packing $REPO/src -> app.asar ..."
npx --yes @electron/asar pack "$REPO/src" "$REPO/app.asar"

if [ -f "$RES/app.asar" ]; then
  echo "Stopping running app ..."
  taskkill //IM "ABUZ8 OS.exe" //F 2>/dev/null || true
  sleep 2
  cp "$RES/app.asar" "$RES/app.asar.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
  cp "$REPO/app.asar" "$RES/app.asar"
  echo "Installed. Relaunching ..."
  (cd "$INSTALL" && cmd //c start "" "ABUZ8 OS.exe")
  echo "Done. Verify: curl http://127.0.0.1:8900/health"
else
  echo "No existing install. app.asar is at $REPO/app.asar - see BUILD.md."
fi
