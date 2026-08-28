# Agent HUD — instructions for Claude Code on the operator's Mac

You are building a production tool for one operator, CR. He does not write code and never will. Read `docs/BUILD-BRIEF.md` in full before doing anything — it is the contract. `docs/PHASE0-FINDINGS.md` is the current state of knowledge; the desk-verified half is done, the live half is yours.

## Current phase

**Phase 0, live probes.** Follow `probes/RUNBOOK.md` step by step. Do not write implementation code (state engine, HUD, adapters) until the runbook's wrap-up is complete and CR has said GO on the architecture.

## Standing rules (from the brief — non-negotiable)

1. Verify before you build. No invented endpoints. Anything unverified gets an `// UNVERIFIED` marker and a written note.
2. Every phase report ends with an ASSUMPTIONS block, in the Section 10 format of the brief.
3. Degrade, never break: any adapter can be unavailable; the HUD must say so honestly.
4. Never surface a stack trace to CR. Plain language, specific next action.
5. When two designs are viable, pick the one that survives a vendor changing internals next Tuesday.
6. `DONE` is sticky. If you ever touch the state engine, that rule outranks everything else in the spec.

## How to talk to CR

One sentence before each action, in plain words. Ask before installing anything. Batch questions rather than dripping them. When a probe needs his hands (install a plugin, start a session from his phone), give exact tap-by-tap instructions and wait. He thinks in systems — give him verdicts and consequences, not process narration.

## Housekeeping

- This repo's `.claude/settings.json` registers HTTP hooks that POST your own session events to `127.0.0.1:43200` — that is intentional (it's Probe 1). If the capture server isn't running, the hooks time out in 3 seconds and cost nothing.
- Evidence goes in `probes/captured/`. Findings go in `docs/PHASE0-FINDINGS.md`. Never delete files without CR's explicit confirmation.
- First session task, if not yet done: authenticate `gh`, create the private GitHub repo `agent-hud`, push this tree, and confirm to CR. Then start the runbook.
