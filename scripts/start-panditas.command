#!/bin/bash
# Double-click to start Panditas Wallet for your family on the home network.
# No Mac rename needed — family connects via this Mac's LAN IP address.
# Keep this window open while the family is using the app.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🐷  Panditas Wallet — starting your family server"
echo

# 1) Database (Docker)
if ! docker info >/dev/null 2>&1; then
  echo "⚠️  Docker isn't running. Please open Docker Desktop, wait a few seconds,"
  echo "    then double-click this again."
  read -r -p "Press Enter to close…"
  exit 1
fi
echo "→ Starting the database…"
docker compose up -d db >/dev/null

# 2) Build the latest web app
echo "→ Building the web app…"
pnpm --filter @panditas/web build >/dev/null

# 3) Find this Mac's LAN IP (the address family will use)
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"
NAME="$(scutil --get LocalHostName 2>/dev/null || true)"

echo
echo "───────────────────────────────────────────────"
if [ -n "$IP" ]; then
  echo "  Family opens this on the same Wi-Fi:"
  echo
  echo "     http://${IP}"
  echo
  echo "  First time on each phone/tablet: after it loads, use the browser's"
  echo "  'Add to Home Screen' so they never have to type this again."
else
  echo "  ⚠️  Could not detect a LAN IP automatically."
  echo "     Check Wi-Fi is connected, then run: ipconfig getifaddr en0"
fi
[ -n "$NAME" ] && echo "  (iPhone/iPad can also try: http://${NAME}.local — Android usually can't.)"
echo "───────────────────────────────────────────────"
echo
echo "macOS may ask for your password (needed for port 80),"
echo "and to 'allow incoming connections' — click Allow."
echo

# 4) Serve on port 80 (so the address has no port number). caffeinate keeps
#    the Mac awake for as long as this stays running.
exec sudo env "PATH=$PATH" SERVE_WEB=true API_PORT=80 API_HOST=0.0.0.0 \
  caffeinate -s pnpm --filter @panditas/api serve
