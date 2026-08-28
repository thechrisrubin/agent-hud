#!/bin/bash
# Agent HUD — Phase 0, Q2/Q8 environment check (read-only).
# Reports: Claude desktop app version vs the two OTel thresholds,
# Claude Code CLI version vs the prompt_id threshold, machine facts.
# Touches nothing. Changes nothing.

echo "== Agent HUD environment check =="
echo

# --- Claude desktop app version ---
PLIST="/Applications/Claude.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  APPVER=$(defaults read "${PLIST%.plist}" CFBundleShortVersionString 2>/dev/null || \
           /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$PLIST" 2>/dev/null)
  echo "Claude desktop app version: ${APPVER:-could not read}"
  echo "  OTel monitoring needs        >= 1.1.4173"
  echo "  assistant_response event needs >= 1.17377"
else
  echo "Claude desktop app: NOT FOUND at /Applications/Claude.app"
fi
echo

# --- Claude Code CLI ---
if command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI: $(claude --version 2>/dev/null)"
  echo "  prompt_id in hook payloads needs >= 2.1.196"
else
  echo "Claude Code CLI: not installed (expected if you're reading this before onboarding)"
fi
echo

# --- Machine ---
echo "Machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), macOS $(sw_vers -productVersion 2>/dev/null)"
echo

# --- Tools the relay setup will want ---
for t in cloudflared node git gh; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "$t: installed ($(command -v $t))"
  else
    echo "$t: not installed"
  fi
done
echo
echo "== Done. Nothing was modified. =="
