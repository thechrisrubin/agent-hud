#!/bin/bash
# Plain-English health check for Agent HUD.
#   bash ~/.agent-hud/check.sh
#
# Answers three questions: is the app running, are this Mac's sessions
# reporting, are Cowork threads reporting — and says what to do if not.
#
# Silence is ambiguous, so this check never reports it on its own. It also
# looks at the wiring — the hook entries in ~/.claude/settings.json — so it can
# tell "nothing has run" apart from "things ran and could not report". Those
# two look identical from the outside and need opposite responses.

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

def newer(a, b):
    if a is None: return b
    if b is None: return a
    return max(a, b)

# Newest event per source, from two records that fail differently.
#
# The HUD's own counters are authoritative but reset when the app restarts.
# The saved tiles survive restarts but can be cleared by hand. Taking the
# later of the two means neither failure mode can manufacture a false silence.
newest = {"local": None, "cowork": None}

by_source = health.get("bySource") or {}
for name, rec in by_source.items():
    if not isinstance(rec, dict): continue
    key = "cowork" if "cowork" in name.lower() else "local"
    newest[key] = newer(newest[key], parse(rec.get("lastEventAt")))

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
        newest[key] = newer(newest[key], stamp)
except Exception:
    pass

# --- the wiring on this Mac -------------------------------------------------
#
# Local sessions report because scripts/setup.sh put hook entries in
# ~/.claude/settings.json, each carrying the HUD's key. That file is written by
# other things too — a Claude Code update, another tool, a hand edit — so the
# entries can go missing without anyone noticing. Read them back and say so.

def read_json(path):
    with open(os.path.expanduser(path)) as f:
        return json.load(f)

wiring = "unknown"   # unknown | missing | wrong_key | wrong_port | ok
hooked_events = 0
try:
    cfg = read_json("~/.agent-hud/config.json")
    settings = read_json("~/.claude/settings.json")
    want_secret = cfg.get("ingestSecret") or ""
    want_port = str(cfg.get("port") or 43200)

    keys, ports = set(), set()
    for entries in (settings.get("hooks") or {}).values():
        for entry in entries or []:
            for h in (entry or {}).get("hooks", []) or []:
                url = str(h.get("url", ""))
                if h.get("type") != "http" or "/ingest/local" not in url:
                    continue
                hooked_events += 1
                keys.add((h.get("headers") or {}).get("X-Hud-Secret", ""))
                ports.add(url.rsplit(":", 1)[-1].split("/")[0])

    if hooked_events == 0:              wiring = "missing"
    elif want_secret and keys != {want_secret}: wiring = "wrong_key"
    elif ports and ports != {want_port}:        wiring = "wrong_port"
    else:                                       wiring = "ok"
except Exception:
    wiring = "unknown"

STALE = 36 * 3600   # Cowork routines run daily, so a day-plus of silence is the signal.
local_recent  = newest["local"]  is not None and (time.time() - newest["local"])  < STALE
cowork_ok     = newest["cowork"] is not None and (time.time() - newest["cowork"]) < STALE

if local_recent:            local_status = "Reporting"
elif wiring == "ok":        local_status = "Wired up, nothing has run"
elif wiring == "unknown":   local_status = "SILENT — can't read the wiring"
else:                       local_status = "NOT REPORTING — the wiring is broken"

print("")
print("  The HUD app:          Running")
print("  This Mac's sessions:  %s (last one %s)" % (local_status, ago(newest["local"])))
print("  Cowork threads:       %s (last one %s)" % ("Reporting" if cowork_ok else "SILENT", ago(newest["cowork"])))

if health.get("rejected"):
    print("")
    print("  Note: %d messages were turned away for having the wrong key." % health["rejected"])
    print("  That usually means the plugin was built with an older key.")

def local_advice():
    if wiring == "ok":
        print("  The wiring is intact: %d hook events still point at the HUD with" % hooked_events)
        print("  the right key. Nothing has run to report, which is the whole story.")
        print("")
        print("  What to do:")
        print("    Nothing — unless you know you ran a terminal session in that time.")
        print("    If you did, it was started before the wiring was last written;")
        print("    hooks load when a session starts. Open a new one and check again.")
    elif wiring == "missing":
        print("  Claude Code on this Mac has stopped reporting to the HUD.")
        print("  The hook entries are gone from ~/.claude/settings.json — something")
        print("  rewrote that file.")
        print("")
        print("  What to do:")
        print("    Put them back:  cd ~/code/agent-hud && bash scripts/setup.sh")
        print("    Your other Claude settings are preserved and backed up first.")
    elif wiring == "wrong_key":
        print("  Your sessions are reporting to the HUD with an out-of-date key,")
        print("  so everything they send is being turned away at the door.")
        print("")
        print("  What to do:")
        print("    Re-issue it:  cd ~/code/agent-hud && bash scripts/setup.sh")
    elif wiring == "wrong_port":
        print("  Your sessions are reporting to a different port than the HUD is")
        print("  listening on, so nothing arrives.")
        print("")
        print("  What to do:")
        print("    Re-point them:  cd ~/code/agent-hud && bash scripts/setup.sh")
    else:
        print("  The wiring couldn't be read, so this is a genuine unknown rather")
        print("  than a diagnosis.")
        print("")
        print("  What to do:")
        print("    Tell Claude Code what this check said.")

def cowork_advice():
    print("  Threads you start in Cowork run on Anthropic's computers, not")
    print("  yours. They report back through a plugin. That plugin has come")
    print("  loose twice before.")
    print("")
    print("  What to do:")
    print("    1. Send one new Cowork thread, then run this check again.")
    print("    2. Still silent? Ask Claude Code to reinstall the Cowork plugin")
    print("       using the card route (it knows what that means).")
    print("    3. After reinstalling, WAIT OVERNIGHT before judging it. Last")
    print("       time the fix took 13 hours to start working.")
    print("    Do not use 'Upload plugin' in the Claude app. It does not work.")

print("")
if local_recent and cowork_ok:
    print("  Everything looks healthy. Nothing to do.")
elif not local_recent and not cowork_ok:
    if wiring == "ok":
        print("  Nothing has reached the HUD from either side for a day or more.")
        print("")
        print("  What to do:")
        print("    Restart the app:  bash ~/.agent-hud/launch-hud.sh")
        print("    Then send one Cowork thread and start one terminal session.")
        print("    If both stay silent, tell Claude Code what this check said.")
    else:
        local_advice()
        print("")
        print("  Cowork threads are silent too.")
        print("")
        cowork_advice()
elif not cowork_ok:
    print("  Your own sessions are fine, but Cowork threads aren't arriving.")
    print("")
    print("  What this means:")
    cowork_advice()
else:
    if wiring == "ok":
        print("  Nothing has run on this Mac to report. The wiring is fine.")
    else:
        print("  Cowork threads are arriving. This Mac's own sessions are not.")
    print("")
    print("  What this means:")
    local_advice()
print("")
PY
