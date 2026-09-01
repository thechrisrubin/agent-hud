#!/bin/bash
# Starts Agent HUD. Used by the login item (com.brandmultiplier.agent-hud)
# and safe to run by hand:   bash ~/.agent-hud/launch-hud.sh
#
# This copy lives outside the project on purpose, so the login item keeps
# working even if the project folder is renamed or temporarily missing.

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="/Users/chris.rubin/code/agent-hud"
LOG="$HOME/.agent-hud/launch.log"
PORT=43200

say() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"; }

# Already running? Don't start a second copy — they'd fight over the port.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  say "already running on port $PORT; nothing to do"
  exit 0
fi

# Wait for the project to be readable (up to 5 minutes after login).
for _ in $(seq 1 60); do
  [ -f "$ROOT/dist/main/main.js" ] && break
  sleep 5
done

if [ ! -f "$ROOT/dist/main/main.js" ]; then
  say "gave up: can't reach the project at $ROOT"
  exit 1
fi

if [ ! -x "$ROOT/node_modules/.bin/electron" ]; then
  say "gave up: Electron is missing. Run 'npm install' in the project folder."
  exit 1
fi

say "starting HUD"
cd "$ROOT" || exit 1
exec "$ROOT/node_modules/.bin/electron" "$ROOT"
