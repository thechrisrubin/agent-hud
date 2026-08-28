# Agent HUD

A heads-up display for your second monitor: one tile per active AI thread, one unmissable color per status, and a bright-green DONE that stays lit until you clear it. It exists to answer one question in under two seconds — which threads need me, and which are finished.

**Where the project stands:** Phase 0. The research half is done (see `docs/PHASE0-FINDINGS.md`); the live half runs on your Mac and takes about an hour with Claude Code driving. No dashboard exists yet, on purpose — the build brief forbids writing product code before the probes prove which signal paths actually work.

## What's in this folder

| Path | What it is |
|---|---|
| `docs/BUILD-BRIEF.md` | The contract. Everything gets built against this. |
| `docs/PHASE0-FINDINGS.md` | What's verified, what isn't, and the recommended architecture. Read the top and the final report block; skim the middle. |
| `docs/CLAUDE-CODE-ONBOARDING.md` | One page: install Claude Code, point it here, the five commands you need. **Start here.** |
| `probes/` | The Phase 0 test kit — a capture server, a tiny probe plugin, two read-only check scripts, and the runbook Claude Code follows. |
| `CLAUDE.md` | Standing orders for the Claude Code session on your Mac. You don't need to read it, but it's short and you can. |

## How to start it

Follow `docs/CLAUDE-CODE-ONBOARDING.md` (3-minute install), then in Terminal:

```
cd ~/Projects/agent-hud
claude
```

and type: **Read CLAUDE.md and run the Phase 0 probe runbook.**

It handles the rest, pausing wherever it needs your hands — installing the probe plugin, starting one session from your phone, one click in your admin settings. Expect roughly an hour, most of it watching.

## What to do when something looks wrong

- **A probe fails or stalls:** tell the Claude Code session "explain what failed like I don't code, and what you're trying next." Its own rules require a plain-language answer.
- **It asks to install something:** it should only ever ask for `cloudflared` (Cloudflare's tunnel tool) or standard developer basics. Anything else, ask it why first.
- **It breaks badly:** copy the last screen of Terminal output and the file `docs/PHASE0-FINDINGS.md` — that pair is everything an engineer (or a fresh Claude session) needs to diagnose it.

## What this is not

Not a conversation viewer, not an analytics dashboard, not a SaaS product, and never a fabricated progress bar. The brief's anti-goals section is binding.
