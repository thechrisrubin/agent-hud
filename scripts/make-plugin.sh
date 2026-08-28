#!/bin/bash
# Builds the Cowork plugin that makes your Claude threads report to the HUD.
#
# The plugin is 14 small hook definitions and nothing else. It runs no code,
# reads no files, and stores nothing. Each hook posts a short status line —
# which event happened, in which session — to your Mac's web address, signed
# with the private key in ~/.agent-hud so nobody else can post fake ones.
#
# Conversation content is never sent. Prompt text is used only for the tile
# title and stays on your machine.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HOME/Desktop/agent-hud.zip"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

TUNNEL=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().tunnelHostname||'')")
SECRET=$(node -e "console.log(require('$ROOT/dist/config.js').loadConfig().ingestSecret)")

if [ -z "$TUNNEL" ]; then
  echo "   No web address is set up yet. Run:  bash scripts/setup-tunnel.sh" >&2
  exit 1
fi

mkdir -p "$BUILD/.claude-plugin" "$BUILD/hooks"

cat > "$BUILD/.claude-plugin/plugin.json" <<JSON
{
  "name": "agent-hud",
  "description": "Reports thread status to your Agent HUD so you can see at a glance which threads need you and which are done. Sends only status events, never conversation content.",
  "version": "1.0.0",
  "author": { "name": "Agent HUD" }
}
JSON

INGEST="https://${TUNNEL}/ingest/cowork"

TUNNEL_URL="$INGEST" SECRET="$SECRET" python3 - "$BUILD/hooks/hooks.json" <<'PY'
import json, os, sys

url    = os.environ["TUNNEL_URL"]
secret = os.environ["SECRET"]

EVENTS = [
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
    "PostToolUseFailure", "PermissionRequest", "Notification",
    "TaskCreated", "TaskCompleted", "SubagentStart", "SubagentStop",
    "Stop", "StopFailure", "SessionEnd",
]
MATCHED = {"PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"}

hooks = {}
for event in EVENTS:
    # 5 seconds, not 3: these fire from Anthropic's cloud and cross the public
    # internet to reach the Mac, so they need more headroom than loopback.
    handler = {
        "type": "http",
        "url": url,
        "timeout": 5,
        "headers": {
            "X-Hud-Secret": secret,
            # The Claude app's own id for this conversation. `allowedEnvVars`
            # substitutes it here - verified live: substitution works in
            # headers, NOT in the url. This is what lets clicking a tile open
            # the actual thread instead of just focusing the app.
            "X-Claude-Session": "${CLAUDE_CODE_REMOTE_SESSION_ID}",
        },
        "allowedEnvVars": ["CLAUDE_CODE_REMOTE_SESSION_ID"],
    }
    entry = {"hooks": [handler]}
    if event in MATCHED:
        entry["matcher"] = "*"
    hooks[event] = [entry]

with open(sys.argv[1], "w") as f:
    json.dump({"hooks": hooks}, f, indent=2)
PY

if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$BUILD" >/dev/null 2>&1 \
    && echo "   Plugin checks out." \
    || echo "   Warning: the plugin didn't validate. Install it anyway and tell me what Claude says."
fi

rm -f "$OUT"
(cd "$BUILD" && zip -qr "$OUT" . -x '.DS_Store')

echo "   Built: $OUT"
echo ""
echo "   To install it:"
echo "     1. Open the Claude desktop app"
echo "     2. Go to plugin settings and choose 'Upload plugin'"
echo "     3. Pick agent-hud.zip from your Desktop"
echo ""
echo "   Threads already open won't report — the plugin loads when a thread starts,"
echo "   so start a new one to see it work."
