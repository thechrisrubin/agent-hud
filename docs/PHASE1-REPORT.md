# Phase 1 report — Agent HUD

**Status: built, tested, and running. The public ingest address is live. The only step outstanding is CR uploading the plugin and starting a Cowork thread. 2026-08-28.**

*Read the addendum at the foot of this file alongside the report — three things changed on the same day and it supersedes them in place.*

---

## WHAT SHIPPED

A working Electron HUD, four decoupled layers, 64 passing tests.

```
src/
  shared/types.ts          the contract every layer agrees on
  ingest/
    server.ts              HTTP listener, shared-secret auth
    hook-adapter.ts        THE only file that knows Anthropic's payload shapes
    routines.ts            discovers the 21 scheduled routines
  engine/
    state-engine.ts        deterministic state machine; no wall clock
    project.ts             engine state → what the screen shows
    persistence.ts         atomic snapshots
  main/main.ts             Electron shell, notifications, click-to-jump
  renderer/                the grid
scripts/
  setup.sh                 one command; merges into ~/.claude/settings.json safely
  setup-tunnel.sh          guided Cloudflare named tunnel
  make-plugin.sh           builds the signed Cowork plugin
```

Delivered against the brief:

- **State engine, spec'd and tested before any UI** (§4.3) — 64 tests covering every transition in the brief's table plus the three rules the Phase 0 captures forced.
- **Sticky `DONE`, ack-to-clear, re-activation, persistence** (§4.3) — all tested, including survival of a full restart.
- **Honest progress** (§4.4) — real `n of m` with the task's name when a task list exists; a step count when it doesn't; elapsed time as the last resort. No fabricated percentage anywhere.
- **Subagent nesting** (§5) — children render inside the parent tile rather than taking grid space.
- **Notifications** on entering `NEEDS_APPROVAL` / `NEEDS_INPUT` / `ERROR`; off for `DONE` by default.
- **Window persistence, always-on-top, quiet-thread toggle.**
- **Click-to-jump** — focuses Claude via `claude://` and copies the thread *title* (not the id — they are unrelated namespaces, Q5).
- **Plain-language failures with a specific next action** (§2.1). No stack trace can reach the UI.
- **README written for CR**, plus the updated Claude Code onboarding page.

## WHAT I VERIFIED

- **64/64 tests pass.** Includes replaying the real Phase 0 capture file (450 payloads) through the adapter and engine: all five genuine Cowork sessions end in sticky `DONE`, none unrecognised.
- **The app runs.** Launched, bound to port 43200, restored state from disk, and accepted live events from this very Claude Code session.
- **End-to-end over real HTTP**, verified from the persisted state file:

  | Fed in | Tile produced |
  |---|---|
  | prompt → `Stop` → `SessionEnd` | **DONE**, "Drafted 5 emails and saved them to Box." |
  | prompt → `PermissionRequest` | **NEEDS_APPROVAL** |
  | prompt → 5×`TaskCreated`, 2×`TaskCompleted`, `SubagentStart` | **WORKING**, "2 of 5 · proof points", one nested subagent |
  | prompt → `PostToolUseFailure` (`is_interrupt: false`) | **ERROR**, "That folder could not be found…" |
  | prompt → `PostToolUseFailure` (`is_interrupt: true`) | **IDLE** — correctly *not* red |

- **Authentication works against real requests**: loopback accepted without a secret; a forwarded request refused with 401; the same request with the correct secret accepted; wrong secrets of every length refused.
- **Resilience**: malformed JSON, unknown event types, missing `session_id`, and a downstream handler that throws all leave the listener serving.

## WHAT I COULD NOT VERIFY

- ~~**The tunnel path, end to end.**~~ **RESOLVED 2026-08-28 — see the addendum at the foot of this report.** The public address is live and verified.
- **The visual result.** I could not screenshot — Terminal lacks screen-recording permission on this Mac. The data pipeline is verified from the state file; the pixels have not been seen by anyone but CR.
- **`StopFailure` handling** — its payload was never captured, so its mapping to `ERROR` remains `// UNVERIFIED`.
- **Eight-hour soak / memory growth** (§9) — not run. Needs a day of real use.

## ASSUMPTIONS I MADE

1. **Cowork sessions can be identified by `cwd === '/home/claude'`.** True in all five captured sessions, but it is a convention, not a guarantee.
2. ~~**`X-Forwarded-For` is trustworthy as a "not local" signal.**~~ **WITHDRAWN the same day.** The design no longer depends on it at all — every request needs the secret. See addendum §2 for why the original assumption was unsafe even though it turned out to hold.
3. **Answering hooks with 200 immediately is correct** even when the event is later discarded. Hooks sit on the critical path of CR's own sessions; a slow endpoint would make Claude feel broken. Losing a tile is the cheaper failure.
4. **Prompt text may be held in memory and written to `~/.agent-hud/state.json`** to title tiles. It never leaves the machine. If CR wants titles off, that is a one-line change.

## WHAT BREAKS FIRST, AND WHY

1. **Routine filtering will leak.** This is the one place the build cannot honour a decision CR made. He asked for scheduled routines to be excluded; a scheduled run captured live is **payload-identical to an interactive thread** — same fields, same `cwd`. The filter catches routines whose `cwd` is local, or whose prompt names them, and nothing else. Some routine tiles will appear. The probe that established this fired a one-off scheduled task rather than one of his 21 real routines, so it is still possible real routines carry something distinguishing — worth thirty seconds of checking the first time one leaks through.
2. **The single-path risk, unchanged from Phase 0.** Hooks are the only ingest route and Q2 removed the fallback. If Anthropic stops executing plugin hooks in Cowork, every Cowork tile disappears at once. The HUD says so honestly rather than showing a calm empty grid, but it cannot work around it.
3. **The address is the weakest operational link.** It stays alive only while the Tailscale app is running — it launches at login by default, but if CR ever quits it, every Cowork session pays a 5-second timeout per event and all Cowork tiles stop. That is noticeable rather than silent, and it is why `setup.sh` refuses to build a plugin without an address.
4. **Grid density at his real scale is untested.** He has 121 pinned threads. The grid has been tested with seven tiles.

## NEXT PHASE — GO / NO-GO

**Phase 1 is functionally complete but not accepted.** The brief's acceptance test — three Cowork threads, one from his phone, all appearing within five seconds — cannot run until the tunnel exists. Everything on the HUD side of that boundary is built and verified.

**To accept Phase 1** — steps 1 and 2 are now done (see addendum):

1. ~~Give the Mac a public address~~ — done, via Tailscale.
2. ~~`bash scripts/make-plugin.sh`~~ — done; `~/Desktop/agent-hud.zip` carries the live address and secret.
3. Install it in the Claude app via **Upload plugin**.
4. Start three threads, one from the phone. Watch them appear, finish, go green, and clear when acknowledged.

**Then Phase 2** (all Claude adapters, full-day use as the only tracking surface) is a **GO** — with one addition the Phase 0 evidence justifies: an `ERROR`-only view of routines. CR gave up all visibility into whether his 21 routines ran, and losing a daily briefing silently is a real cost. Showing a routine tile *only when a run fails* restores the safety net without the flood he was right to refuse.

---

# Addendum — the ingest address, and a security correction (2026-08-28, same day)

Three things changed after the report above was written. All three are live and verified.

## 1. The address exists: Tailscale, not Cloudflare

CR's company domain is on Cloudflare but managed by his developer, who was unavailable. Rather than block, the relay decision was re-opened — the brief (§4.2) had asked for exactly this comparison and explicitly delegated the choice.

**Tailscale Funnel wins on the deciding criterion the brief named: setup CR can complete without touching a config file.** It needs no domain, no DNS records, and nothing his developer owns. Cloudflare needs all three.

- Address: `your-mac.tailXXXX.ts.net`
- `scripts/setup-tailscale.sh` — installs, signs in, opens the port, and verifies from outside
- `scripts/setup-tunnel.sh` — kept, for whenever the Cloudflare domain becomes available

Verified live, from the public internet:

| Test | Result |
|---|---|
| `GET /health` over the public address | 200, counters matched loopback |
| `POST /ingest` with **no** secret | **401** — the endpoint is not publicly writable |
| `POST /ingest` with the secret | 200, and it became a real tile |

That third row is the whole architecture proven end to end: a request originating outside this Mac authenticated, was adapted, and rendered. It is the same path a Cowork session takes.

## 2. Authentication is now required on every request, including loopback

The original rule exempted loopback callers that carried no `X-Forwarded-For`. **That was a latent hole, and it nearly mattered.** A tunnel daemon runs *on* this Mac and proxies to loopback, so whether a remote request is distinguishable from a local one depends entirely on whether that specific tunnel sets a forwarding header. Cloudflare does — which is what the rule was written against. Tailscale had never been tested.

Had Tailscale not set the header, every request through CR's new public address would have been accepted **without the secret**, with no symptom he could have noticed.

**Tested after the fact: Tailscale does set it** (the server saw `100.80.121.82`), so the original rule would in fact have held. The correction stands anyway, and the reasoning is worth recording: the old design was *correct by luck*, resting on an unverified property of a component chosen after the code was written. The new rule — no secret, no write — cannot be broken by swapping the thing in front of it.

`scripts/setup.sh` writes the secret into the local hooks it generates, so CR still never handles it. Phase 0's project-level probe hooks were retired: a committed file cannot carry a per-machine secret.

## 3. Local ingest verified end to end

`setup.sh` ran cleanly. It merged into `~/.claude/settings.json`, backed the file up first, and left CR's `statusLine`, `theme`, and notification settings untouched. A fresh `claude -p` session then authenticated and delivered five events.

## What is still outstanding

**Only the acceptance test itself.** The plugin is built (`~/Desktop/agent-hud.zip`) with the live address and secret embedded, and validated by `claude plugin validate`. What remains is CR uploading it and starting a Cowork thread.

Everything between that thread and a tile on screen has now been exercised with real traffic — the transport by the reachability probe, the adapter and engine by replaying all 450 captured Cowork payloads. The one thing never observed end to end is a genuine Cowork session reaching *this* address through *this* plugin. Phase 0 proved Cowork can reach an arbitrary tunnel hostname; this is the same mechanism pointed at a different host.

---

# Addendum 2 — Cowork verified end to end (2026-08-28)

**The core requirement of the whole build now works on real traffic.** A thread started in Cowork ran in Anthropic's cloud, delivered its hooks across the public internet to the Mac, authenticated, and rendered as a live tile.

```
title    : Run `echo hud-live` in bash, then tell me it worked.
source   : cowork-hook            cwd: /home/claude
state    : DONE                   steps: 1
final    : It worked — output was `hud-live`.
history  : WORKING(prompt_submitted) -> DONE(turn_finished)
```

Blue while working, bright green when finished, captioned with what it actually produced. Sticky.

## A wrong diagnosis, recorded because the reasoning is the useful part

When the first Cowork thread produced nothing, I concluded the likely cause was Anthropic's cloud egress refusing `.ts.net` — reasoning from the Phase 0 finding that cloud egress is allowlist-shaped, and from the fact that the only two things changed since the working Phase 0 configuration were the hostname and the added auth header.

**That was wrong, and the method that found it wrong is worth keeping.** Rather than act on the hypothesis, each changed variable was isolated:

- *Was it the header?* Tested locally with a plugin carrying the same header. 5 events accepted, 0 rejected — headers are sent and honoured. Ruled out, at no cost to CR.
- *Was it the address?* Tested by fetching the public URL from Anthropic's own network. It answered. Ruled out.

Both eliminated, the real cause surfaced from the data: the first thread delivered **exactly one event, `SessionEnd`** — the signature of a session whose plugin registered mid-flight. Nothing was broken. The thread simply predated the plugin.

The lesson for whoever maintains this: an ingest failure has three candidate layers (address, auth, hook execution) and each can be tested in isolation without the others. The counters distinguish them directly — `rejected > 0` means auth, `accepted == 0` with a reachable `/health` means hooks, and an unreachable `/health` means the address.

## Two title gaps found by real use, not by tests

Both produced tiles reading "Untitled thread", which reads like a bug rather than a fact.

1. **`agent_type` is usually empty.** 8 of the 9 subagent events captured in Phase 0 carried `''`, local sessions included — only a paired SubagentStart/Stop names the agent reliably. Subagents are now titled `subagent` from the parent relationship alone, which is always present.
2. **A Cowork thread joined mid-flight has no name anywhere.** Every Cowork session reports `cwd=/home/claude` and no other field carries a title. Local sessions fall back to their folder name; Cowork has no equivalent. Such tiles now read **"Claude thread"** and upgrade to the real title on the operator's next message in that thread.

Worth noting what this exposed about the design: automatic discovery works — CR's other Cowork threads began appearing on their own, with no registration, exactly as brief §8 requires. The gap was never discovery; it was that a discovered thread had nothing to call itself.

## Outstanding for formal acceptance

- **A thread started from CR's phone.** Untested. Same cloud class as the verified desktop case, so expected to behave identically — but the brief names it specifically, and it is the case that justified building a relay at all.
- **Acknowledging a tile, observed by CR.** Covered by tests and by the projection layer; not yet confirmed by the person it exists for.
- **The eight-hour soak** (§9) and **grid density at 100+ tiles**. Both need a real working day.
