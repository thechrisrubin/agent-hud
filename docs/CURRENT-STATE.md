# Where things stand — 2026-08-28, end of session

**Read this first.** It is the fastest way to know what works, what is broken, and what to try next.

---

## Working

| | |
|---|---|
| The HUD app | Running. `npm start` from the repo root. |
| Local Claude Code sessions | Reporting normally, with the app's generated names. |
| Tiles already on the grid | Intact, including click-through where the thread has an app id. |
| Click-to-jump | Works: `claude://claude.ai/cowork/<cse_id>` opens the exact thread. |
| Ingest address | `https://your-mac.tailXXXX.ts.net` — Tailscale Funnel, verified publicly reachable. |
| Tests | 73 passing (`npm test`). |

## Broken

**New Cowork threads are not reaching the HUD.** Started at roughly 20:00 UTC, after four plugin installs in an hour.

What was ruled out, with evidence:

- **Not the address.** Fetched successfully from Anthropic's own network at 20:35 UTC.
- **Not the plugin file.** The shipped zip is 14 events, http-only, one entry each, structurally identical to the version that worked.
- **Not a stale broken version.** Under the broken 1.3.0, tool events still arrived; a tool-using thread now produces nothing either.
- **Not auth.** Zero rejections. Nothing is arriving to reject.
- **Not the HUD.** 110 events accepted from local sessions in the same period.

**CAUSE FOUND (2026-08-31).** The plugin is not being delivered to Cowork sessions at all. A session was asked to inspect its own filesystem and reported:

```
~/.claude/plugins/   →  one subfolder, `synced`, and nothing else
find ~/.claude/plugins -name hooks.json  →  no results
```

No plugin with a hooks config exists in the session. Nothing in this repo can fix that: the plugin file is valid, the address is reachable, and the app reports it installed and enabled. Delivery is failing upstream.

For contrast, Phase 0 observed that same directory containing CR's synced account plugins (sales, marketing, dropbox), each a full directory tree. That is what a healthy state looks like.

**Do not keep reinstalling.** Four reinstalls in one evening produced no change, and the diagnostic above explains why. This is a support question for Anthropic, not a build problem.

## What to try, in order

1. **Check whether plugin sync has recovered** — ask a Cowork session to run `find ~/.claude/plugins -name hooks.json`. If it finds one, the plugin is being delivered again and threads should flow.
2. **If it is still empty, do not reinstall.** That was tried four times to no effect, and the session's own filesystem shows why. Raise it with Anthropic support: a personal plugin, uploaded via the desktop app, shows as installed and enabled but is not delivered to Cowork sessions.
3. **Check the address only if the above recovers and threads still do not arrive.** The hostname is baked into the plugin at build time; confirm with `tailscale funnel status` and rebuild if it differs.

**Waiting did not help.** The "it will probably settle" prediction was wrong: three days passed with no change.

## What is NOT worth trying again without new information

**Attaching a `command` hook to an event that already has an http hook.** It suppressed `Stop` entirely — reproduced locally: with the command hook present, `UserPromptSubmit` arrived and `Stop` did not. A thread using no tools emits only those two events, so such threads vanished from the HUD completely.

The title-reading script itself is correct and works — it is retained but disabled behind `ENABLE_TITLE_HOOK = False` in `scripts/make-plugin.sh`. The problem was never the script; it was where it was attached.

## Thread naming — the open item

CR's requirement: tiles should show the name the Claude app's sidebar shows, not the text of a prompt.

- **Local sessions: solved.** Claude Code writes an `ai-title` record into each transcript; the HUD reads it directly.
- **Cowork sessions: unsolved.** The transcript lives inside Anthropic's container. The shell hook written to read it there works correctly but cannot be attached without breaking other hooks.

Remaining options, in order of preference:

1. **Find a safe way to attach the title hook** — a different event, a different structure. Untested, and it needs a way to experiment that does not risk CR's working setup.
2. **Generate a name locally** from the first prompt. No credentials, works today, never exactly matches the sidebar.
3. **Ask claude.ai for the real title** using CR's session. Exact names, but brief §8 names this an anti-goal — fragile, breaks without notice, and the HUD would hold his credentials. **This is CR's decision, not the build team's**, and the recommendation is against it for a cosmetic gain.

---

## Two findings worth keeping

**Claude Code blocks HTTP hooks to private or link-local addresses.** Verbatim: `HTTP hook blocked: … resolves to 100.80.121.82 (private/link-local address). Loopback (127.0.0.1, ::1) is allowed for local dev.` Tailscale addresses are in a private range, so *on this Mac* the tunnel hostname is refused; from Anthropic's cloud it resolves publicly and is allowed. Local sessions must use loopback, which they do.

**`allowedEnvVars` substitutes into headers, not into the URL.** Verified live. That is what carries `CLAUDE_CODE_REMOTE_SESSION_ID` out of a Cowork session and makes click-through possible.

---

## A note on method, for whoever picks this up

Four conclusions in `PHASE0-FINDINGS.md` were later overturned, two of them false negatives on the operator's primary use case. All four came from the same habit: **treating an unsuccessful search as proof of absence, and writing it up with more confidence than the evidence carried.**

Tonight added the mirror-image error: **treating partial verification as confirmation.** The title hook was reported working because it fired — without checking whether the existing hooks still did. Click-through was recorded as verified because CR said it worked — without asking where he landed.

Both directions have the same fix, and it is cheap: state what was actually checked, and ask the one more question that distinguishes "it did something" from "it did the right thing."
