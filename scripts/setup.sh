#!/bin/bash
# Agent HUD — setup.
#
# Run this once:   bash scripts/setup.sh
#
# What it touches, in full, so nothing is a surprise:
#   1. Installs this project's own dependencies into ./node_modules and builds it.
#   2. Creates ~/.agent-hud/ to hold your settings and a private key it generates.
#   3. Adds hook entries to ~/.claude/settings.json so Claude Code sessions on
#      this Mac report their status. Existing settings are preserved — the file
#      is merged, never overwritten, and a timestamped backup is taken first.
#   4. Builds a plugin file on your Desktop for Cowork (only if a tunnel is set up).
#
# It does NOT send anything anywhere, and it does not touch your Claude account.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HUD_DIR="$HOME/.agent-hud"
CONFIG="$HUD_DIR/config.json"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '   %s\n' "$1"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$1"; }

say "Agent HUD setup"

# --- 1. dependencies and build ---------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  warn "Node isn't installed, and the HUD needs it to run."
  info "Install it with:  brew install node"
  info "Then run this script again."
  exit 1
fi

say "1/4  Building the app"
cd "$ROOT"
npm install --silent
npm run build --silent
info "Built."

# --- 2. config and key ------------------------------------------------------

say "2/4  Setting up your private settings folder"
mkdir -p "$HUD_DIR"
# The app generates the key itself on first run; do it now so the plugin
# below can embed the same value.
node -e "require('$ROOT/dist/config.js').loadConfig()" >/dev/null
chmod 700 "$HUD_DIR" 2>/dev/null || true
info "Settings live in $HUD_DIR (only you can read them)."

PORT=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().port)")
SECRET=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().ingestSecret)")
TUNNEL=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().tunnelHostname||'')")

# --- 3. local Claude Code hooks --------------------------------------------

say "3/4  Telling Claude Code on this Mac to report to the HUD"

mkdir -p "$HOME/.claude"
if [ -f "$CLAUDE_SETTINGS" ]; then
  BACKUP="$CLAUDE_SETTINGS.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$CLAUDE_SETTINGS" "$BACKUP"
  info "Backed up your existing settings to:"
  info "  $BACKUP"
else
  echo '{}' > "$CLAUDE_SETTINGS"
fi

HUD_PORT="$PORT" HUD_SECRET="$SECRET" python3 - "$CLAUDE_SETTINGS" <<'PY'
import json, os, sys

path = sys.argv[1]
port   = os.environ["HUD_PORT"]
secret = os.environ["HUD_SECRET"]
url    = f"http://127.0.0.1:{port}/ingest/local"

# The 14 lifecycle events the HUD consumes. Each one was captured live during
# Phase 0 except StopFailure and SessionStart — those are included defensively
# and cost nothing if they never fire.
EVENTS = [
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
    "PostToolUseFailure", "PermissionRequest", "Notification",
    "TaskCreated", "TaskCompleted", "SubagentStart", "SubagentStop",
    "Stop", "StopFailure", "SessionEnd",
]
MATCHED = {"PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"}

try:
    with open(path) as f:
        settings = json.load(f)
except Exception:
    settings = {}

hooks = settings.setdefault("hooks", {})

def is_ours(entry):
    for h in entry.get("hooks", []):
        if h.get("type") == "http" and "/ingest/local" in str(h.get("url", "")):
            return True
    return False

added = 0
for event in EVENTS:
    entries = [e for e in hooks.get(event, []) if not is_ours(e)]  # replace ours, keep theirs
    # A 3-second timeout means that if the HUD is closed, your Claude sessions
    # pause for at most 3 seconds per event and then carry on normally.
    # The secret goes in the file so you never handle it. Every write to the
    # HUD is authenticated, including this one - see src/ingest/server.ts.
    handler = {"type": "http", "url": url, "timeout": 3,
               "headers": {"X-Hud-Secret": secret}}
    entry = {"hooks": [handler]}
    if event in MATCHED:
        entry["matcher"] = "*"
    entries.append(entry)
    hooks[event] = entries
    added += 1

with open(path, "w") as f:
    json.dump(settings, f, indent=2)

print(f"   Registered {added} events. Your other settings were left alone.")
PY

# --- 4. the Cowork plugin ---------------------------------------------------

say "4/4  Cowork (your desktop and phone threads)"

if [ -z "$TUNNEL" ]; then
  info "Not set up yet — this needs one more step, and it needs you."
  info ""
  info "Your Claude/Cowork threads don't run on this Mac. They run in Anthropic's"
  info "cloud, even the ones you start on your laptop. For them to reach the HUD,"
  info "your Mac needs a web address. That's what the tunnel does."
  info ""
  info "When you're ready, run this in a normal Terminal window:"
  info "  bash scripts/setup-tailscale.sh      (no domain needed - recommended)"
  info "  bash scripts/setup-tunnel.sh         (if you have a domain on Cloudflare)"
else
  bash "$ROOT/scripts/make-plugin.sh"
fi

say "Done."
info "Start the HUD with:   npm start"
info ""
info "Right now it will show threads from Claude Code sessions on this Mac."
if [ -z "$TUNNEL" ]; then
  info "Cowork and phone threads will appear once you've given this Mac a web address."
fi
