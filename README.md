# Agent HUD

A window that sits on your second monitor and answers one question in under two seconds:

**Which of my threads needs me right now, and which are done?**

It replaces scanning the Cowork sidebar. Only genuinely active threads appear. Finished ones go bright green and stay green until you clear them — which is what makes it self-cleaning, unlike 121 pinned threads that only ever accumulate.

---

## Starting it

```
npm start
```

Run that from this folder. The window remembers where you put it and what size you made it.

First time only, run this instead — it sets everything up:

```
bash scripts/setup.sh
```

---

## What the colours mean

| Colour | What it means | What to do |
|---|---|---|
| 🟠 **Orange, pulsing hard** | Waiting for you to approve something | Go approve it — the thread is frozen until you do |
| 🟡 **Amber, pulsing** | It asked you a question | Go answer it |
| 🟢 **Bright green** | Finished. Output is ready | Read it, then hit **Clear**, top-right of the tile |
| 🔵 **Blue** | Working normally | Nothing |
| 🔴 **Red** | Hit an error | The tile says what went wrong in plain words |
| ⚫️ **Grey, dimmed** | Idle, or gone quiet for 10+ minutes | Nothing. Hidden unless you click **Quiet threads** |

Green tiles never disappear on their own. That's deliberate: a finished thread you haven't looked at is exactly the thing you must not lose.

## Using it

- **Click a tile** — brings the Claude app to the front and copies the thread's name. Paste it into Claude's search to open that thread. *(Claude has no way to open a specific thread from outside the app — we tested six different methods during Phase 0. Copying the name is the closest thing that actually works.)*
- **Clear** — top-right corner of a finished tile, removes it. This is how the grid stays clean. It sits at the top edge on purpose, so it stays reachable when a weekend of finished threads fills the window. Errored tiles show **Dismiss** in the same spot.
- **Quiet threads** — shows the idle and stale ones you normally don't want to see.
- **On top** — keeps the window above everything else.

---

## When a tile looks wrong

**A thread is running but no tile appeared.**
Threads that were already open when you installed the plugin won't report — the plugin loads when a thread *starts*. Start a new thread and check again.

**Nothing appears at all, from anything.**
Look at the bottom of the window. It says in plain words what it's listening for and how many updates it has received. If it says something is wrong, it also says what to do.

**Tiles appear for Claude Code but not for Cowork or your phone.**
Your Cowork threads run in Anthropic's cloud, not on this Mac, so they need a web address to reach you. Run `bash scripts/setup-tunnel.sh`. Until then the HUD only sees terminal sessions on this machine.

**A tile went red but nothing was actually wrong.**
Tell me. Stopping a thread yourself should show grey, not red, and there's a specific test protecting that.

**A scheduled routine appeared even though routines are switched off.**
Expected, unfortunately. Routine threads look identical to normal threads in everything Claude sends us, so the filter is best-effort. Tell me which routine leaked through and I can make the filter recognise it.

**Everything is stuck / the window is blank.**
Quit and run `npm start` again. Your green tiles and pending clears survive restarts.

---

## If it breaks badly and you need an engineer

Send them this section.

- Source is in `src/`. Four layers, deliberately independent: `ingest/` (receives events), `engine/` (decides state), `main/` (Electron shell), `renderer/` (draws).
- `npm test` runs 64 tests. The state engine's rules are all covered, including the one that matters most: `DONE` is sticky and nothing may downgrade it.
- Logs: `~/.agent-hud/hud.log`. Settings and the ingest key: `~/.agent-hud/config.json`. Saved tiles: `~/.agent-hud/state.json`.
- Evidence behind every design decision is in `docs/PHASE0-FINDINGS.md` and `docs/PHASE0-PAYLOADS.md`. Those are captured from live sessions, not from documentation — where the docs and those files disagree, those files are right.

### Which signals are real, and what breaks if Anthropic changes something

**Everything the HUD shows is explicit**, not inferred. Every tile state comes from a named event Claude sends — `Stop` means done, `PermissionRequest` means it needs approval. Nothing is guessed at, and no percentage is ever shown that isn't backed by a real task count.

**There is exactly one way in, and no fallback.** Claude Code's hook system is the only path. The alternative (OpenTelemetry) requires organisation admin rights that this account doesn't have. So:

- If Anthropic stops running plugin hooks in Cowork sessions, **every Cowork tile stops appearing.** Terminal sessions would keep working.
- If Anthropic tightens what cloud sessions can reach on the internet, same outcome.
- If they rename or change a hook's fields, only `src/ingest/hook-adapter.ts` needs updating — that's the one file that knows what Anthropic's payloads look like, which is why it's isolated.

The HUD fails visibly in all these cases. The status bar tells you it has stopped receiving updates rather than showing an empty grid that looks like calm.

---

## What it doesn't do

By design, not by omission:

- It doesn't show conversation content. Reading happens in Claude.
- It doesn't track cost or usage.
- It doesn't let you reply or approve from inside the HUD. Claude offers no supported way for an outside program to send input into a running thread — we checked. A button that pretended to approve would be worse than no button.
- It doesn't show scheduled routines. You switched those off because 21 of them firing overnight would bury the tiles you actually need.
