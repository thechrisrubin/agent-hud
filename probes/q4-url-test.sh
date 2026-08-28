#!/bin/bash
# Agent HUD — Phase 0, Q4 (active part).
# Opens each candidate Claude URL and records what measurably happened:
# which app was frontmost before and after, and whether `open` reported an error.
#
# This DOES open URLs — that is the point. It does not test claude-cli://,
# which is documented to launch a brand-new terminal session; that one is
# deliberately left for a separate, announced run so nothing surprises CR.
#
# Usage: bash probes/q4-url-test.sh <a-real-cowork-session-id>

SID="${1:-00000000-0000-0000-0000-000000000000}"
OUT="$(dirname "$0")/captured/q4-url-results.txt"
mkdir -p "$(dirname "$OUT")"

front() { lsappinfo front 2>/dev/null | sed 's/.*"\(.*\)".*/\1/'; }
name_of() { lsappinfo info -only name "$1" 2>/dev/null | sed 's/.*"name"="\(.*\)".*/\1/'; }

CANDIDATES=(
  "claude://"
  "claude://open"
  "claude://session/$SID"
  "claude://open?session=$SID"
  "claude://chat/$SID"
  "claude://cowork/$SID"
)

{
  echo "== Q4 active URL test =="
  echo "run at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "session id under test: $SID"
  echo
} | tee "$OUT"

for url in "${CANDIDATES[@]}"; do
  before_id=$(front); before=$(name_of "$before_id")
  err=$(open "$url" 2>&1); rc=$?
  sleep 2
  after_id=$(front); after=$(name_of "$after_id")

  {
    echo "URL      : $url"
    echo "  exit   : $rc"
    [ -n "$err" ] && echo "  stderr : $err"
    echo "  front  : ${before:-?}  ->  ${after:-?}"
    if [ "$before_id" != "$after_id" ]; then
      echo "  RESULT : focus changed (something handled it)"
    elif [ $rc -ne 0 ]; then
      echo "  RESULT : rejected by Launch Services"
    else
      echo "  RESULT : accepted, no observable focus change"
    fi
    echo
  } | tee -a "$OUT"
done

echo "Written to $OUT"
