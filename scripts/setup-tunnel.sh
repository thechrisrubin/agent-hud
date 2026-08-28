#!/bin/bash
# Gives your Mac a permanent web address so your Claude threads can reach it.
#
# Why this is needed at all: your Cowork threads don't run on this Mac. They
# run in Anthropic's cloud — even the ones you start on your laptop. We proved
# that during Phase 0. So they can't reach your machine directly; it needs an
# address on the public internet.
#
# A Cloudflare Tunnel gives you one without renting a server. Cloudflare passes
# the traffic straight through to your Mac. No conversation content is stored
# anywhere but here, and requests without your private key are refused.
#
# One part of this needs you: signing in to Cloudflare in your browser.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUNNEL_NAME="agent-hud"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$1"; }

say "Giving your Mac a web address"

if ! command -v cloudflared >/dev/null 2>&1; then
  warn "Cloudflare's tunnel tool isn't installed."
  info "Install it with:  brew install cloudflared"
  info "Then run this script again."
  exit 1
fi

PORT=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().port)")

# --- sign in ----------------------------------------------------------------

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  say "Step 1 of 3 — sign in to Cloudflare"
  info "Your browser will open. Sign in (or create a free account), then pick"
  info "your domain. If you don't have a domain, see the note at the end."
  info ""
  info "Press Return when you're ready."
  read -r _
  cloudflared tunnel login
else
  info "Already signed in to Cloudflare."
fi

# --- create the tunnel ------------------------------------------------------

say "Step 2 of 3 — creating the tunnel"

if cloudflared tunnel list 2>/dev/null | grep -q " ${TUNNEL_NAME} "; then
  info "A tunnel named '$TUNNEL_NAME' already exists. Reusing it."
else
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}' | head -1)
if [ -z "$TUNNEL_ID" ]; then
  warn "Couldn't find the tunnel after creating it."
  info "Run 'cloudflared tunnel list' and send the output to your engineer."
  exit 1
fi

say "Step 3 of 3 — choosing your address"
info "Type the address you want, for example:  hud.yourdomain.com"
info "It must be on a domain you've added to Cloudflare."
printf '   Address: '
read -r HOSTNAME

if [ -z "$HOSTNAME" ]; then
  warn "No address given. Nothing was changed. Run this again when you're ready."
  exit 1
fi

cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

CFG_DIR="$HOME/.cloudflared"
mkdir -p "$CFG_DIR"
cat > "$CFG_DIR/config.yml" <<YML
tunnel: ${TUNNEL_ID}
credentials-file: ${CFG_DIR}/${TUNNEL_ID}.json

ingress:
  - hostname: ${HOSTNAME}
    service: http://127.0.0.1:${PORT}
  - service: http_status:404
YML

HOSTNAME="$HOSTNAME" node -e "
const c = require('$ROOT/dist/config.js');
const cfg = c.loadConfig();
cfg.tunnelHostname = process.env.HOSTNAME;
c.saveConfig(cfg);
"

say "Starting the tunnel so it runs from now on"
cloudflared service install 2>/dev/null \
  && info "Installed as a background service — it starts with your Mac." \
  || info "Run it yourself when you need it with:  cloudflared tunnel run $TUNNEL_NAME"

say "Address ready: https://${HOSTNAME}"
info ""
info "Now build the plugin that tells Claude to use it:"
info "  bash scripts/make-plugin.sh"
info ""
info "No domain on Cloudflare? You need one for a permanent address — they're"
info "a few dollars a year. Tell me and I'll walk you through it."
