# Where things stand — 2026-08-31

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

## RESOLVED 2026-08-31 — install the plugin via `create-cowork-plugin`, not "Upload plugin"

Cowork ingest is working again. A thread using no tools — the exact case that had been silent for three days — arrived, went `WORKING → DONE`, and was clickable.

**The working install route:**

1. In a Cowork thread, ask the `cowork-plugin-management` plugin's **`create-cowork-plugin`** skill to build the plugin, giving it the exact `hooks/hooks.json` (generate with `bash scripts/make-plugin.sh`, then read the file out of the zip).
2. It returns a `.plugin` card. Click **Save plugin** on the card.
3. Start a new Cowork thread.

**The broken route: the desktop app's "Upload plugin".** Four uploads across an evening never delivered the plugin to a Cowork container. The synced manifest never listed it and `find ~/.claude/plugins -name hooks.json` inside a session returned nothing.

A Cowork session inspecting its own state judged these two routes to be "the same install path". They are not: after the card install, `agent-hud-live` appears in `~/.claude/plugins/synced/` alongside the four marketplace plugins, where four uploads had failed to put it.

**Unexplained, and worth remembering:** the uploaded plugin *did* work on 2026-08-28 for about fifteen minutes — five Cowork sessions fired its hooks. So the upload path is not simply non-functional; it is unreliable. Prefer the card route.

Kept below for the record: what the failure looked like and what was ruled out.

## The failure, 2026-08-28 to 2026-08-31 (resolved, see above)

**New Cowork threads were not reaching the HUD.** Started at roughly 20:00 UTC, after four plugin installs in an hour.

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

**Narrowed further, same day.** Plugin sync itself is healthy: four marketplace plugins (`cowork-plugin-management`, `dropbox`, `marketing`, `sales`) arrive intact. The uploaded plugin is simply not among them.

`manifest.json` in that directory lists only those four, each with `"marketplaceName": "knowledge-work-plugins"`. Its `lastUpdated` is **2026-08-28T06:35Z** — roughly twelve hours *before* the plugin was first uploaded — and it has not refreshed since. The synced catalog has never contained any version of it.

**The contradiction, stated honestly:** on 2026-08-28 the plugin demonstrably ran inside five Cowork sessions, carrying a header substituted from `${CLAUDE_CODE_REMOTE_SESSION_ID}` — impossible unless it was present in the session. So uploaded plugins reached containers by some path other than this catalog, and that path has stopped. That path is not observable from this machine.

Full write-up for Anthropic, with evidence and a reproduction: [`SUPPORT-REPORT.md`](SUPPORT-REPORT.md).

**Do not keep reinstalling.** Four reinstalls in one evening produced no change, and the diagnostic above explains why. This is a support question for Anthropic, not a build problem.

## If it breaks again, in order

0. **Reinstall via the `create-cowork-plugin` card route above.** That is what fixed it. Do not use "Upload plugin".
1. **Check whether plugin sync has recovered** — ask a Cowork session to run `find ~/.claude/plugins -name hooks.json`. If it finds one, the plugin is being delivered again and threads should flow.
2. **If it is still empty, do not reinstall.** That was tried four times to no effect, and the session's own filesystem shows why. Raise it with Anthropic support: a personal plugin, uploaded via the desktop app, shows as installed and enabled but is not delivered to Cowork sessions.
3. **Check the address only if the above recovers and threads still do not arrive.** The hostname is baked into the plugin at build time; confirm with `tailscale funnel status` and rebuild if it differs.

**Waiting did not help.** The "it will probably settle" prediction was wrong: three days passed with no change.

## A wrong conclusion, corrected 2026-08-31

This document previously stated that attaching a `command` hook to an event that already has an http hook **suppresses `Stop`**, and the title feature was disabled because of it.

**That was false, and the cause was a bug in the test, not the plugin.** The test listener truncated request bodies at 400 bytes. A `Stop` payload is larger than that (it carries `last_assistant_message`, `background_tasks`, `session_crons`), so it failed to parse and was counted as a missing event.

Re-run with truncation removed, three variants were compared:

| Variant | UserPromptSubmit | Stop | SessionEnd | ThreadTitle |
|---|---|---|---|---|
| http hooks only | yes | yes | yes | — |
| command hook as a separate entry | yes | yes | yes | yes |
| command hook inside the same entry | yes | yes | yes | yes |

**The command hook suppresses nothing.** Either attachment style works. The title feature is re-enabled (`ENABLE_TITLE_HOOK = True`).

The real cause of the outage was always plugin delivery — the upload path failing — which is resolved above.

**Lesson:** an instrument that quietly discards data will manufacture a plausible bug. The truncation was added for readable logs and cost a working feature plus an evening.

## Thread naming — the open item

CR's requirement: tiles should show the name the Claude app's sidebar shows, not the text of a prompt.

- **Local sessions: solved.** Claude Code writes an `ai-title` record into each transcript; the HUD reads it directly.
- **Cowork sessions: not achievable by this route. Settled 2026-08-31 with a direct measurement.**

Inside a live Cowork session, with the correct plugin installed:

```
grep -o '"type": *"command"' …/agent-hud-live/hooks/hooks.json | wc -l   →  2
grep -c '"ai-title"' ~/.claude/projects/*/*.jsonl                        →  0
```

The plugin and its title hook are present and correct. **Cowork transcripts contain no `ai-title` records whatsoever.** The generated name is produced server-side by claude.ai and rendered in the sidebar; it is never written into the container. The hook was reading a file that never contains the answer.

This invalidates the assumption the whole approach rested on — that Cowork transcripts resemble local ones. Local Claude Code writes `ai-title`; the Cowork runtime does not.

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
