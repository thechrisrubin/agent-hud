#!/bin/bash
# Plain-English health check for Agent HUD.
#   bash ~/.agent-hud/check.sh
#
# Answers three questions: is the app running, are this Mac's sessions
# reporting, are Cowork threads reporting — and says what to do if not.

PORT=43200
HEALTH=$(curl -s -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null)

echo ""
echo "  Agent HUD check — $(date '+%A %-d %b, %-I:%M%p' | tr '[:upper:]' '[:lower:]' | sed 's/^  */  /')"
echo "  ---------------------------------------------"

if [ -z "$HEALTH" ]; then
  echo ""
  echo "  The HUD app:          NOT RUNNING"
  echo ""
  echo "  What this means:"
  echo "    Nothing is being recorded right now."
  echo ""
  echo "  What to do:"
  echo "    Start it with this command:"
  echo "      bash ~/.agent-hud/launch-hud.sh"
  echo ""
  exit 0
fi

HEALTH="$HEALTH" python3 <<'PY'
import json, os, time, calendar, datetime

health = json.loads(os.environ["HEALTH"])

def parse(s):
    if not s: return None
    try: return calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception: return None

def ago(epoch):
    if epoch is None: return "never"
    secs = time.time() - epoch
    if secs < 90:            return "just now"
    if secs < 3600:          return "%d minutes ago" % (secs/60)
    if secs < 7200:          return "about an hour ago"
    if secs < 86400:         return "%d hours ago" % (secs/3600)
    when = datetime.datetime.fromtimestamp(epoch)
    if secs < 172800:        return "yesterday at " + when.strftime("%-I:%M%p").lower()
    return "%d days ago (%s)" % (secs/86400, when.strftime("%-d %b"))

# Newest event per source, read from the HUD's saved state.
newest = {"local": None, "cowork": None}
try:
    with open(os.path.expanduser("~/.agent-hud/state.json")) as f:
        data = json.load(f)
    threads = data.get("threads") or data
    if isinstance(threads, dict): threads = list(threads.values())
    for t in threads:
        if not isinstance(t, dict): continue
        stamp = parse(t.get("lastEventAt") or t.get("updatedAt"))
        if stamp is None: continue
        key = "cowork" if "cowork" in str(t.get("source", "")).lower() else "local"
        if newest[key] is None or stamp > newest[key]:
            newest[key] = stamp
except Exception:
    pass

STALE = 36 * 3600   # Cowork routines run daily, so a day-plus of silence is the signal.
local_ok  = newest["local"]  is not None and (time.time() - newest["local"])  < STALE
cowork_ok = newest["cowork"] is not None and (time.time() - newest["cowork"]) < STALE

print("")
print("  The HUD app:          Running")
print("  This Mac's sessions:  %s (last one %s)" % ("Reporting" if local_ok else "SILENT", ago(newest["local"])))
print("  Cowork threads:       %s (last one %s)" % ("Reporting" if cowork_ok else "SILENT", ago(newest["cowork"])))

if health.get("rejected"):
    print("")
    print("  Note: %d messages were turned away for having the wrong key." % health["rejected"])
    print("  That usually means the plugin was built with an older key.")

print("")
if local_ok and cowork_ok:
    print("  Everything looks healthy. Nothing to do.")
elif not local_ok and not cowork_ok:
    print("  Nothing is reaching the HUD at all.")
    print("")
    print("  What to do:")
    print("    Restart the app:  bash ~/.agent-hud/launch-hud.sh")
    print("    If that doesn't help, tell Claude Code what this check said.")
elif not cowork_ok:
    print("  Your own sessions are fine, but Cowork threads aren't arriving.")
    print("")
    print("  What this means:")
    print("    Threads you start in Cowork run on Anthropic's computers, not")
    print("    yours. They report back through a plugin. That plugin has come")
    print("    loose twice before.")
    print("")
    print("  What to do:")
    print("    1. Send one new Cowork thread, then run this check again.")
    print("    2. Still silent? Ask Claude Code to reinstall the Cowork plugin")
    print("       using the card route (it knows what that means).")
    print("    3. After reinstalling, WAIT OVERNIGHT before judging it. Last")
    print("       time the fix took 13 hours to start working.")
    print("    Do not use 'Upload plugin' in the Claude app. It does not work.")
else:
    print("  Cowork threads are arriving, but this Mac's own sessions are not.")
    print("")
    print("  What to do:")
    print("    Restart the app:  bash ~/.agent-hud/launch-hud.sh")
    print("    If that doesn't help, tell Claude Code what this check said.")
print("")
PY
