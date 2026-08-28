#!/bin/bash
# Gives your Mac a permanent web address using Tailscale.
#
# Why you need this: your Cowork threads don't run on this Mac. They run in
# Anthropic's cloud — even the ones you start on your own laptop. We proved
# that in Phase 0. So they can't reach your machine unless it has an address
# on the public internet.
#
# Tailscale gives you one free, with no domain to buy and no DNS to change.
# Nothing about your company's existing domain is touched. Your Mac gets an
# address like  your-mac.tailXXXX.ts.net  and Tailscale passes traffic
# straight through to the HUD.
#
# Only the HUD's port is exposed, and requests without your private key are
# refused. No conversation content is stored anywhere but this Mac.
#
# RUN THIS IN A NORMAL TERMINAL WINDOW (Cmd-N), not through Claude Code —
# it opens your browser and waits for you.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$1"; }

say "Giving your Mac a web address (Tailscale)"

# --- find or install the tool ----------------------------------------------

find_ts() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale; return; fi
  if [ -x "$APP_CLI" ]; then echo "$APP_CLI"; return; fi
  echo ""
}

TS="$(find_ts)"

if [ -z "$TS" ]; then
  say "Step 1 of 4 — installing Tailscale"
  info "This installs the Tailscale app (about 50MB). It's a well-known tool"
  info "for connecting your own machines; it does not change your network"
  info "settings or affect anything your developer manages."
  info ""
  printf '   Install it now? [y/N] '
  read -r REPLY
  case "$REPLY" in
    [yY]*) ;;
    *) warn "Nothing installed. Run this again when you're ready."; exit 0 ;;
  esac
  brew install --cask tailscale-app
  TS="$(find_ts)"
  if [ -z "$TS" ]; then
    warn "Installed, but I can't find the Tailscale command."
    info "Open the Tailscale app once from your Applications folder, then run this again."
    exit 1
  fi
else
  info "Tailscale is already installed."
fi

# --- sign in ----------------------------------------------------------------

say "Step 2 of 4 — signing in"

if "$TS" status >/dev/null 2>&1; then
  info "Already signed in."
else
  info "Your browser will open. Sign in with Google, Microsoft, or email —"
  info "whichever you prefer. A personal account is fine and free."
  info ""
  info "Press Return when you're ready."
  read -r _
  "$TS" up || {
    warn "Sign-in didn't complete."
    info "Open the Tailscale app from Applications, sign in there, then run this again."
    exit 1
  }
fi

HOSTNAME="$("$TS" status --json 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || true)"

if [ -z "$HOSTNAME" ]; then
  warn "Signed in, but I couldn't read your Mac's address."
  info "Run this and send me the output:  $TS status"
  exit 1
fi

info "Your Mac's address: $HOSTNAME"

# --- open the door ----------------------------------------------------------

say "Step 3 of 4 — opening the HUD's address to the internet"

PORT="$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().port)")"

info "Exposing only the HUD, on port $PORT. Nothing else on this Mac is shared."
info ""

if "$TS" funnel --bg "$PORT"; then
  info "Done."
else
  warn "Tailscale needs you to switch this feature on for your account."
  info "It should have printed a link just above — open it, click to enable,"
  info "then run this script again. It takes one click."
  exit 1
fi

# --- remember it ------------------------------------------------------------

HOSTNAME="$HOSTNAME" node -e "
const c = require('$ROOT/dist/config.js');
const cfg = c.loadConfig();
cfg.tunnelHostname = process.env.HOSTNAME;
c.saveConfig(cfg);
"

say "Step 4 of 4 — checking it works from the outside"

sleep 3
if curl -fsS --max-time 25 "https://${HOSTNAME}/health" >/dev/null 2>&1; then
  info "Confirmed — your Mac is reachable at https://${HOSTNAME}"
else
  warn "The address isn't answering yet."
  info "This is usually just DNS catching up. Wait a minute and try:"
  info "  curl https://${HOSTNAME}/health"
  info "If it still fails, tell me and I'll take a look. Your address is saved either way."
fi

say "Next: build the plugin that tells Claude to use this address"
info "  bash scripts/make-plugin.sh"
info ""
info "Keep the Tailscale app running — it's what keeps the address alive."
info "It starts with your Mac by default."
