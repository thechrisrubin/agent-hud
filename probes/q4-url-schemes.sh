#!/bin/bash
# Agent HUD — Phase 0, Q4 (read-only part).
# Lists every URL scheme registered by Claude-related apps on this Mac.
# This does NOT open anything; it only reads the Launch Services registry.
# If a scheme beyond claude-cli:// exists (e.g. claude://), the runbook's
# next step tests what it actually does — with you watching.

LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

echo "== URL schemes registered by Claude apps =="
if [ -x "$LSREG" ]; then
  "$LSREG" -dump URLSchemeBinding 2>/dev/null | grep -i claude
  echo
  echo "(Each line maps a scheme to the app that handles it.)"
else
  echo "lsregister not found at the expected path; trying the generic dump (slower)…"
  /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -dump 2>/dev/null | grep -B2 -A2 -i "claude" | grep -i "scheme\|claude" | head -40
fi
echo
echo "== Done. Nothing was opened or modified. =="
