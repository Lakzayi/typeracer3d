#!/usr/bin/env bash
# TypeRacer 3D — double-click-friendly launcher (bash)
# Works from Git Bash, WSL, or any *nix shell.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed. Get it from https://nodejs.org"
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "🏁 Starting TypeRacer 3D…"
# open the browser after a short delay (server needs a moment)
( sleep 1.5; start "" "http://localhost:8787" 2>/dev/null || xdg-open "http://localhost:8787" 2>/dev/null || open "http://localhost:8787" 2>/dev/null ) &
node server.js
