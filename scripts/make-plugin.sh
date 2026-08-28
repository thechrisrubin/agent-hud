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
OUT="$HOME/Desktop/agent-hud-live.zip"
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
  "name": "agent-hud-live",
  "description": "Reports thread status to your Agent HUD so you can see at a glance which threads need you and which are done. Clicking a tile opens that thread. Sends only status events and the thread name, never conversation content.",
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

# A shell hook that ships the thread's generated NAME, which the HTTP hooks
# cannot: the name lives in the session's transcript, and an http hook posts
# only the event payload. Inside Cowork that transcript is in Anthropic's
# container, unreachable from the Mac - so the reading has to happen there.
#
# It reads the hook payload from stdin, pulls the newest "ai-title" record out
# of the transcript, and posts it. Everything is guarded: no title, no
# transcript, no python, no network - it exits 0 and stays silent. A hook that
# fails loudly would interrupt CR's own session, which is a far worse outcome
# than a tile keeping its old name.
TITLE_SCRIPT = r"""
# Ships the thread's generated NAME, which the http hooks cannot: the name is
# written into the session transcript, and an http hook posts only the event
# payload. Inside Cowork that transcript is in Anthropic's container, so the
# reading has to happen there.
#
# Pure shell and curl, deliberately. An earlier version used python3, which
# this container is not known to have - and every failure path was silenced,
# so a missing interpreter looked identical to the hook never running. curl is
# confirmed present (it answered a reachability check from inside a session).
#
# Every step is guarded: no payload, no transcript, no title, no curl - it
# exits 0 silently. A hook that fails loudly would interrupt CR's own session,
# which is worse than a tile keeping an older name.
PAYLOAD=$(cat 2>/dev/null) || exit 0
[ -n "$PAYLOAD" ] || exit 0

TP=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
SID=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TP" ] || exit 0
[ -n "$SID" ] || exit 0
[ -f "$TP" ] || exit 0

# Last ai-title record wins - a thread can be renamed as it goes on.
TITLE=$(grep '"ai-title"' "$TP" 2>/dev/null | tail -1 \
        | sed -n 's/.*"aiTitle"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$TITLE" ] || exit 0
# Headers cannot carry control characters; keep it short and printable.
TITLE=$(printf '%s' "$TITLE" | tr -d '\000-\037\\"' | cut -c1-120)
[ -n "$TITLE" ] || exit 0

command -v curl >/dev/null 2>&1 || exit 0
if [ -n "$CLAUDE_CODE_REMOTE_SESSION_ID" ]; then
  curl -s -m 5 -X POST "__INGEST__" \
    -H 'content-type: application/json' \
    -H "X-Hud-Secret: __SECRET__" \
    -H "X-Claude-Title: $TITLE" \
    -H "X-Claude-Session: $CLAUDE_CODE_REMOTE_SESSION_ID" \
    -d "{\"hook_event_name\":\"ThreadTitle\",\"session_id\":\"$SID\"}" >/dev/null 2>&1 || true
else
  curl -s -m 5 -X POST "__INGEST__" \
    -H 'content-type: application/json' \
    -H "X-Hud-Secret: __SECRET__" \
    -H "X-Claude-Title: $TITLE" \
    -d "{\"hook_event_name\":\"ThreadTitle\",\"session_id\":\"$SID\"}" >/dev/null 2>&1 || true
fi
exit 0
""".replace("__INGEST__", url).replace("__SECRET__", secret)

# DISABLED. Attaching a command hook alongside the http hook on the same event
# stopped `Stop` from being delivered at all - reproduced locally: with the
# command hook present, UserPromptSubmit arrived and Stop did not. A thread
# that uses no tools emits only those two events, so such a thread vanished
# from the HUD entirely. Losing tiles is far worse than tiles with imperfect
# names, so the title hook stays off until it can be attached without
# suppressing anything.
ENABLE_TITLE_HOOK = False
if ENABLE_TITLE_HOOK:
    for event in ("UserPromptSubmit", "Stop"):
        hooks[event].append({"hooks": [{"type": "command", "command": TITLE_SCRIPT, "timeout": 8}]})

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
