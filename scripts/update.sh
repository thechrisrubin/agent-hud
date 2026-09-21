#!/bin/bash
# Updates Agent HUD to the latest code and restarts it.
#
#   bash ~/.agent-hud/update.sh
#
# Everything CR used to do by hand — switch to main, pull, rebuild, copy the
# helper scripts, stop the old app, start the new one, confirm it came back.
# One command, because he does not write code and should not have to
# remember a six-line sequence or what a branch is.
#
# Deliberate ordering: the build runs BEFORE the running app is touched. A
# failed build therefore leaves the working HUD exactly as it was, rather
# than taking it down and leaving nothing in its place.

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="/Users/chris.rubin/code/agent-hud"
HUD_DIR="$HOME/.agent-hud"
PORT=43200

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; printf '   %s\n' "${2:-}"; exit 1; }

[ -d "$ROOT/.git" ] || fail "Can't find the project." "Expected it at: $ROOT"
cd "$ROOT" || exit 1

# --- 1. get on main ---------------------------------------------------------

say "Step 1 of 4 — getting the latest code"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$BRANCH" != "main" ]; then
  info "You were on '$BRANCH'. Switching to the main line of the code."
  git checkout main >/dev/null 2>&1 \
    || fail "Couldn't switch to main." "Send this whole message to Claude Code."
fi

if ! git pull --ff-only origin main 2>&1 | sed 's/^/   /'; then
  fail "Couldn't download the latest code." \
       "Usually the internet. Try again in a minute."
fi

# --- 2. build ---------------------------------------------------------------

say "Step 2 of 4 — rebuilding the app"
info "This takes a few seconds."

if ! npm run build >/tmp/agent-hud-build.log 2>&1; then
  printf '\n'
  tail -20 /tmp/agent-hud-build.log | sed 's/^/   /'
  fail "The rebuild failed, so nothing was changed." \
       "Your HUD is still running the old version. Send the lines above to Claude Code."
fi
info "Built."

# --- 3. install the helper scripts ------------------------------------------

mkdir -p "$HUD_DIR"
for f in check.sh launch-hud.sh update.sh; do
  [ -f "$ROOT/scripts/$f" ] && cp "$ROOT/scripts/$f" "$HUD_DIR/$f"
done

# --- 4. restart -------------------------------------------------------------

say "Step 3 of 4 — restarting the HUD"

# Ask the old copy to quit, then wait for it to let go of the port. Without
# the wait, the launcher below sees the port still busy and quietly does
# nothing — which looked, last time, exactly like a broken update.
PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)"
if [ -n "$PIDS" ]; then
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null
  for _ in $(seq 1 20); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.5
  done
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null
    sleep 1
  fi
  info "Stopped the old copy."
fi

nohup bash "$HUD_DIR/launch-hud.sh" >/dev/null 2>&1 &
disown 2>/dev/null

for _ in $(seq 1 20); do
  curl -s -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done

# --- 5. confirm -------------------------------------------------------------

say "Step 4 of 4 — checking it came back"

if ! curl -s -m 5 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  fail "The HUD didn't come back up." \
       "Try:  bash ~/.agent-hud/launch-hud.sh   — and tell Claude Code if that fails too."
fi

bash "$HUD_DIR/check.sh"

printf '   Running version: %s\n\n' "$(git log --oneline -1)"
