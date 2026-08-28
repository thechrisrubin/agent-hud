# Claude Code in one page — for CR

Claude Code is a Claude that lives in your Terminal instead of an app window. In this project it's your site foreman: you tell it what phase to run, it does the work on your actual Mac, and it reports back. You direct; it builds. You will never read its code, and nothing here expects you to.

## Install (once, ~3 minutes)

1. Open **Terminal** (⌘-space, type "terminal", return).
2. Paste this and press return: `curl -fsSL https://claude.ai/install.sh | bash`
3. When it finishes, type `claude` and press return. It walks you through logging in with your existing Claude account. Done.

## Point it at this project

Put the `agent-hud` folder somewhere sensible (e.g. `~/Projects/agent-hud`). Then, in Terminal:

```
cd ~/Projects/agent-hud
claude
```

That's it — starting `claude` inside the folder is what "pointing it at the repo" means. It reads the project's own instructions automatically and knows what phase it's on.

## The five commands you actually need

| You type | What happens |
|---|---|
| `claude` | Starts a session in whatever folder you're in |
| `/status` | Shows what account/model it's running as |
| **Esc** | Interrupts whatever it's doing, immediately |
| `/clear` | Wipes the conversation and starts fresh (the project instructions survive) |
| `/exit` | Ends the session |

Everything else is plain English typed at the prompt.

## Handing it a task, and reading what comes back

Type what you want as if briefing Sapir: outcome, constraints, done-state. For this project, your first message is one line:

> Read CLAUDE.md and run the Phase 0 probe runbook. I'm here for the steps that need my hands.

It will narrate each step in a sentence, ask before installing anything, and stop at the checkpoints that need you (installing the probe plugin, starting a session from your phone). When it finishes, it writes its findings into `docs/PHASE0-FINDINGS.md` and gives you a five-sentence verdict. If it asks a question you don't understand, say so — "explain that like I don't code" works verbatim.

One habit worth keeping: when it claims something is done, ask "show me the evidence." This project's rules already force it to keep evidence files, so the answer should always be a file it can show you.

## Why bother, beyond this project

Local Claude Code sessions are the one session class where the HUD gets its richest signal (every event, instantly, on loopback) and the only class where true two-way control is even possible later. Every session you run through it makes your own dashboard better.
