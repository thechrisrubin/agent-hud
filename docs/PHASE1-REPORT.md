# Phase 1 report — Agent HUD

**Status: built, tested, and running. One acceptance criterion is not yet met and needs CR (the tunnel). 2026-08-28.**

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

- **The tunnel path, end to end.** `setup-tunnel.sh` is written but unrun — a named tunnel needs CR's Cloudflare account and a domain. Until then Cowork and phone threads cannot reach the HUD, and **the Phase 1 acceptance test cannot be completed.** The transport itself was proven in Phase 0 with a throwaway tunnel; what is unproven is this specific script.
- **The visual result.** I could not screenshot — Terminal lacks screen-recording permission on this Mac. The data pipeline is verified from the state file; the pixels have not been seen by anyone but CR.
- **`StopFailure` handling** — its payload was never captured, so its mapping to `ERROR` remains `// UNVERIFIED`.
- **Eight-hour soak / memory growth** (§9) — not run. Needs a day of real use.

## ASSUMPTIONS I MADE

1. **Cowork sessions can be identified by `cwd === '/home/claude'`.** True in all five captured sessions, but it is a convention, not a guarantee.
2. **`X-Forwarded-For` is trustworthy as a "not local" signal.** Anything arriving through cloudflared carries it, and a remote caller cannot remove it. A *local* process could forge it, but that only costs it the secret it would then need.
3. **Answering hooks with 200 immediately is correct** even when the event is later discarded. Hooks sit on the critical path of CR's own sessions; a slow endpoint would make Claude feel broken. Losing a tile is the cheaper failure.
4. **Prompt text may be held in memory and written to `~/.agent-hud/state.json`** to title tiles. It never leaves the machine. If CR wants titles off, that is a one-line change.

## WHAT BREAKS FIRST, AND WHY

1. **Routine filtering will leak.** This is the one place the build cannot honour a decision CR made. He asked for scheduled routines to be excluded; a scheduled run captured live is **payload-identical to an interactive thread** — same fields, same `cwd`. The filter catches routines whose `cwd` is local, or whose prompt names them, and nothing else. Some routine tiles will appear. The probe that established this fired a one-off scheduled task rather than one of his 21 real routines, so it is still possible real routines carry something distinguishing — worth thirty seconds of checking the first time one leaks through.
2. **The single-path risk, unchanged from Phase 0.** Hooks are the only ingest route and Q2 removed the fallback. If Anthropic stops executing plugin hooks in Cowork, every Cowork tile disappears at once. The HUD says so honestly rather than showing a calm empty grid, but it cannot work around it.
3. **The tunnel is the weakest operational link.** A quick tunnel dies on its own; a named tunnel depends on CR's Cloudflare account staying set up. If the address dies while the plugin is installed, every Cowork session pays a 5-second timeout per event — noticeable, and the reason `setup.sh` refuses to build a plugin without an address.
4. **Grid density at his real scale is untested.** He has 121 pinned threads. The grid has been tested with seven tiles.

## NEXT PHASE — GO / NO-GO

**Phase 1 is functionally complete but not accepted.** The brief's acceptance test — three Cowork threads, one from his phone, all appearing within five seconds — cannot run until the tunnel exists. Everything on the HUD side of that boundary is built and verified.

**To accept Phase 1, in order:**

1. `bash scripts/setup-tunnel.sh` — needs a domain on Cloudflare.
2. `bash scripts/make-plugin.sh` — builds the signed plugin.
3. Install it in the Claude app via **Upload plugin**.
4. Start three threads, one from the phone. Watch them appear, finish, go green, and clear when acknowledged.

**Then Phase 2** (all Claude adapters, full-day use as the only tracking surface) is a **GO** — with one addition the Phase 0 evidence justifies: an `ERROR`-only view of routines. CR gave up all visibility into whether his 21 routines ran, and losing a daily briefing silently is a real cost. Showing a routine tile *only when a run fails* restores the safety net without the flood he was right to refuse.
