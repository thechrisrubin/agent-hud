#!/bin/bash
# A temporary Cloudflare address for the HUD — the fallback, not the plan.
#
# Use this if your Cowork threads can't reach the Tailscale address. During
# Phase 0 we proved Cowork sessions CAN reach a Cloudflare quick-tunnel
# address, so this is the known-good route.
#
# What you give up: the address is random and changes every time this runs.
# Each change means rebuilding the plugin and re-uploading it to Claude. Fine
# for an afternoon, wrong as a permanent arrangement — for that you want your
# own domain on Cloudflare (scripts/setup-tunnel.sh), which needs your
# developer.
#
# RUN THIS IN A NORMAL TERMINAL WINDOW (Cmd-N). It has to keep running: close
# the window and the address dies.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/.agent-hud/quick-tunnel.log"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$1"; }

if ! command -v cloudflared >/dev/null 2>&1; then
  warn "Cloudflare's tunnel tool isn't installed."
  info "Install it with:  brew install cloudflared"
  exit 1
fi

PORT="$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().port)")"

say "Getting a temporary address from Cloudflare"
info "No account or sign-in needed for this one."

mkdir -p "$(dirname "$LOG")"
: > "$LOG"

cloudflared tunnel --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!
# If this script is interrupted before the address is saved, don't leave an
# orphan tunnel running and pointing at nothing.
trap 'kill $TUNNEL_PID 2>/dev/null || true' INT TERM

info "Waiting for the address…"
HOSTNAME=""
for _ in $(seq 1 40); do
  HOSTNAME="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)"
  [ -n "$HOSTNAME" ] && break
  sleep 1
done

if [ -z "$HOSTNAME" ]; then
  warn "Cloudflare didn't give us an address."
  kill $TUNNEL_PID 2>/dev/null || true
  info "Check your internet connection and try again."
  info "Details are in: $LOG"
  exit 1
fi

HOST="${HOSTNAME#https://}"
info "Address: $HOST"

say "Checking it works"
sleep 2
if curl -fsS --max-time 20 "https://${HOST}/health" >/dev/null 2>&1; then
  info "Confirmed — answering from the outside."
else
  warn "The address isn't answering yet. Carrying on; it often needs a moment."
fi

HOST="$HOST" node -e "
const c = require('$ROOT/dist/config.js');
const cfg = c.loadConfig();
cfg.tunnelHostname = process.env.HOST;
c.saveConfig(cfg);
"

say "Rebuilding the plugin for this address"
bash "$ROOT/scripts/make-plugin.sh"

trap - INT TERM

say "IMPORTANT — leave this window open"
info "The address only exists while this window is running."
info "Closing it stops your Cowork threads reaching the HUD."
info ""
info "Re-upload agent-hud.zip in the Claude app, then start a NEW thread."
info ""
info "Press Control-C here when you're finished for the day."

wait $TUNNEL_PID
