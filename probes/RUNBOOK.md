# Phase 0 probe runbook

**Audience: the Claude Code session running on the operator's Mac.** The operator (CR) does not write code; he is your checkpoint clicker and phone-holder. Narrate each step in one plain sentence before you run it. Never show him a stack trace — if something fails, say what failed in plain words and what you're trying next.

Every probe writes its evidence into `probes/captured/` and its conclusion into `docs/PHASE0-FINDINGS.md` (replace the `PENDING LIVE PROBE` blocks; leave the desk-verified sections alone unless a live result contradicts them — if it does, say so loudly in the findings doc, don't silently edit).

Rules inherited from the build brief: no invented endpoints, evidence for every claim, negatives are valid findings, end with an ASSUMPTIONS block.

---

## Probe 0 — Environment (2 min, no interaction)

Run `bash probes/q2-env-check.sh`. Record the output verbatim in the findings doc. Compare versions against the thresholds it prints.

## Probe 1 — Local hook payloads (Q1b, ~10 min)

The repo's `.claude/settings.json` already registers HTTP hooks pointing at `http://127.0.0.1:43200/ingest/local` for every event the HUD consumes.

1. Start the capture server in the background: `node probes/capture-server.mjs` (leave it running for ALL probes).
2. This very session's events are already being captured — do a few deliberate things to fire each event type: run a Bash command (PreToolUse/PostToolUse), run a command that fails (PostToolUseFailure), create a task list (TaskCreated/TaskCompleted), spawn a subagent (SubagentStart/Stop), finish a turn (Stop), and ask CR one question so a Notification fires.
3. Read `probes/captured/events.ndjson`. For each event type, record in the findings doc: the exact field list that arrived, whether `session_id`, `prompt_id`, `transcript_path`, `permission_mode`, `cwd` were present, and one sample payload (redact prompt text to its first 40 characters).

**Pass:** every event type in `q1-plugin/hooks/hooks.json` has at least one captured payload from the local class.

## Probe 2 — Tunnel (Q9 prerequisite, ~10 min)

1. If `cloudflared` is missing, install it (`brew install cloudflared`; if no Homebrew, download the official binary from Cloudflare's release page — ask CR before installing anything, one sentence: "I need Cloudflare's tunnel tool to test whether cloud sessions can reach your Mac. OK to install?").
2. Start a quick tunnel: `cloudflared tunnel --url http://127.0.0.1:43200`. Capture the `https://<random>.trycloudflare.com` hostname it prints.
3. Verify from outside your own loopback: fetch `https://<hostname>/health` and confirm the event count matches. Record the hostname and result.

A quick tunnel is throwaway — fine for the probe. Phase 1 replaces it with a named tunnel on CR's own Cloudflare account so the hostname is stable.

## Probe 3 — Plugin build + install (Q1 setup, ~10 min)

1. Copy `probes/q1-plugin/` to a scratch dir; replace every `__INGEST_URL__` in `hooks/hooks.json` with `https://<tunnel-hostname>/ingest/PLACEHOLDER` — but set the label per class later; for the install use `/ingest/cowork` (the envelope's forwarded-for header separates desktop from cloud).
2. Run `claude plugin validate <scratch-dir>` and fix anything it flags.
3. Sanity-test locally first: `claude --plugin-dir <scratch-dir>` in a throwaway directory, send one prompt, confirm POSTs arrive tagged `cowork` via the tunnel URL (this proves the plugin + tunnel path end to end before Cowork enters the picture).
4. Zip the plugin directory as `agent-hud-probe.plugin` and hand it to CR with these exact instructions: install it as a plugin on your Claude account (desktop app → plugin/skill settings). If the desktop app offers no way to install a personal plugin into Cowork, THAT IS A FINDING — record how far he got and what the UI offered. Do not improvise workarounds; report.

## Probe 4 — The Q1 verdict (~15 min, CR's hands)

With the plugin installed and the tunnel up:

1. **Desktop class:** CR starts a fresh Cowork session on the Mac and sends one prompt ("run `echo hud-probe-desktop` in bash and stop").
2. **Cloud class:** CR starts a session from his phone and sends one prompt ("run `echo hud-probe-cloud` in bash and stop").
3. **Scheduled class (Q6):** CR creates a one-off scheduled task firing 2–3 minutes out (any trivial prompt). Wait for it.
4. Watch the capture server log. For each of the three, record: did ANY POST arrive; which events; from what remote address (tunnel vs loopback); full payload field lists.

**Interpretation table for the findings doc:**
- All three arrive → Path A is the primary architecture for every Claude class. Phase 1 GO as designed.
- Desktop arrives, cloud doesn't → cloud sessions can't reach the tunnel (egress allowlist) or don't execute plugin hooks. Distinguish if possible: if `SessionStart` never fires even locally inside the session, hooks aren't executing; if CR asks the cloud session itself to `curl` the tunnel's /health and that's also blocked, it's egress. Record which. Fallback: OTel (needs Q2 positive) or relay-polling design — flag to CR immediately, per the brief.
- Nothing arrives anywhere → the Cowork harness doesn't execute plugin hooks at all. Path A dies for Cowork; local Claude Code keeps hooks via settings.json. Report before any Phase 1 work.

## Probe 5 — Q2, plan tier and OTel access (~10 min)

Best-effort, least-invasive order:
1. Look for plan/org identifiers in local desktop-app data (`~/Library/Application Support/Claude*` — read-only greps for `organization`, `plan`, `tier`, `raven`, `admin`). Record what's found, redacting tokens.
2. If inconclusive, have CR open `https://claude.ai/admin-settings` in his browser and say what he sees — specifically whether a **Cowork** section with OTLP fields exists. One click, yes/no. (The brief says don't make him research; a guided single click during the probe session is the cheapest honest answer.)
3. Record: Team/Enterprise yes/no, admin yes/no, OTLP settings reachable yes/no. If no → write in the findings doc, in bold, that Path B is unavailable and the hook plugin plus local adapters carry the product.

## Probe 6 — Q4, deep links (~5 min)

1. Run `bash probes/q4-url-schemes.sh`; record every Claude-related scheme.
2. For each scheme beyond `claude-cli://`, test with CR watching: `open "<scheme>://"` and variants with a real session ID from Probe 1's captures (e.g. `claude://session/<id>`, `claude://open?session=<id>`). Record exactly what each does — including "nothing."
3. Confirm `claude-cli://open?cwd=...` behavior matches docs. Expected verdict: no existing-thread deep link; the HUD's click-to-jump falls back to focus-app-plus-clipboard as already specced.

## Probe 7 — Q5, identity lineup (~5 min)

Compare: `session_id` from a captured desktop-Cowork hook payload vs what the Cowork sidebar shows for that thread (CR reads the thread title; if the app exposes any ID in UI or logs, note it). Answer: can the HUD label a tile so CR recognizes it? Record how title should be derived (likely first `UserPromptSubmit` prompt text).

---

## Wrap-up

1. Update `docs/PHASE0-FINDINGS.md`: every `PENDING LIVE PROBE` block replaced with evidence; the Section-10 report block at the bottom completed; GO / NO-GO stated.
2. Uninstall nothing without asking — CR decides whether the probe plugin stays installed (if Q1 passed, it becomes the seed of the real adapter and staying installed is useful).
3. Kill the tunnel and capture server.
4. Tell CR, in five sentences or fewer, the verdict: which architecture won, what surprised you, and what Phase 1 builds first.
