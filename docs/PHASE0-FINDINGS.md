# Phase 0 findings — Agent HUD

**Status: PHASE 0 COMPLETE (2026-08-28). All seven probes run on CR's Mac. 304 events captured across three transports and six Claude session classes. Every Section 6 question has a documented answer or a documented negative.**

Probe scoreboard:

| Probe | Question | Result |
|---|---|---|
| 0 — environment | Q2 versions, Q8 hardware | **Done.** Both OTel thresholds cleared; M4 Pro, macOS 26.4.1. |
| 1 — local hook payloads | Q1b | **Done.** 12/14 events captured. See [`PHASE0-PAYLOADS.md`](PHASE0-PAYLOADS.md). |
| 2 — tunnel | Q9 prerequisite | **Done.** Quick tunnel verified end to end. |
| 3 — plugin build + install | Q1 setup | **Done.** Validated, hooks proven to fire, installed into Cowork via "Upload plugin". |
| 4 — the Q1 verdict | Q1, Q6 | **Done. YES** — 5 Cowork sessions, 5 delivered. |
| 5 — plan tier | Q2 | **Done. NO** — no org admin access. Path B unavailable. |
| 6 — deep links | Q4 | ~~NO~~ → **WRONG, corrected in Phase 1. A deep link exists and works:** `claude://claude.ai/code/session_<id>`. |
| 7 — identity lineup | Q5 | ~~NO~~ → **partially wrong.** The namespaces are distinct, but the app's id is in the container's env and hooks can forward it. |

**Headline: Path A works everywhere and is the whole architecture. Path B is gone.**

**Four conclusions in this document were later overturned. Read the corrections before trusting any negative here.** Two were overturned by the live probes themselves (Q9, where Cowork sessions execute; Q5, thread identity). Two more — **Q4 and Q5 again** — were overturned during Phase 1, and those two matter most: both were *false negatives on the operator's primary use case*, click-to-jump. Each was produced by guessing at an interface instead of reading it, and each was written up with more confidence than its evidence supported. The corrections are inline, marked, with the original reasoning retained.

**One process note worth recording.** Starting the Cloudflare tunnel was refused by Claude Code's own safety classifier — publishing a local port to the internet is exactly what it exists to stop an agent doing unilaterally. CR had approved it; the classifier cannot know that. He started it himself with one line. Expect the same in Phase 1 when the named tunnel goes up, and design the installer so CR runs the network-exposing step knowingly rather than having an agent do it quietly. That is the right division of authority, not an obstacle to route around.

Two halves, both now complete. The desk half checked every Section 3 claim against live documentation and against direct inspection of a running cloud Cowork session (the session that built this repo — a genuine specimen of the exact session class the brief worries most about). The live half ran on CR's Mac on 2026-08-28 and replaced every `PENDING LIVE PROBE` block with captured evidence.

**How to read this document.** Each question carries its desk verdict first, then the live result. Where the two disagree, the desk reasoning is kept and marked superseded rather than deleted — twice, the way it went wrong is more instructive than the corrected answer, and a future reader deserves to see which kinds of documentary inference did not survive contact with a live probe.

---

## Q1 — Do plugin-carried hooks execute inside Cowork sessions?

**Desk verdict: substantially strengthened since the brief. Live probe still required for the final word.**

Verified against https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/plugins:

- Plugins carry hooks in `hooks/hooks.json` at plugin root — confirmed, with the exact config-location table listing "Plugin `hooks/hooks.json` — when plugin enabled."
- HTTP hook handlers are documented with `url`, `timeout`, `headers`, and `allowedEnvVars` fields.

Observed live, inside a cloud Cowork session on 2026-08-28 (not from docs — from the filesystem of the running container):

- **CR's installed account plugins are physically synced into cloud sessions.** `~/.claude/plugins/synced/<org>_<user>/` contained his sales, marketing, dropbox, and cowork-plugin-management plugins, full directory trees including `.claude-plugin/plugin.json` and `.mcp.json`. The sync mechanism carries whole plugin directories; a plugin containing `hooks/hooks.json` should arrive the same way.
- **The cloud session runs on the real Claude Code CLI, v2.1.250** (`which claude` → `/opt/node22/bin/claude`), which executes plugin hooks by design.
- **The cloud harness itself uses hooks**: `~/.claude/` contained active Stop and UserPromptSubmit hook scripts wired by the platform. The hook system is not stripped from cloud sessions.

What this does not yet prove: (a) that a *user-installed* plugin's hooks are registered by the Cowork harness (the synced plugins observed carry no hooks, so execution is unobserved), and (b) that an outbound POST from a cloud session reaches an arbitrary hostname — an in-session egress test from the cloud container was blocked by the session's own policy layer, which proves policy exists, not what it permits for harness-fired hooks. Hooks fire from the harness, not through the agent's tool-permission layer, so the block observed does not directly apply — but that distinction is exactly what Probe 4 tests.

**LIVE PROBE, PART ONE COMPLETE (Probe 3 steps 1–3, 2026-08-28). The mechanism is proven; only the Cowork harness and cloud egress remain open.**

The probe plugin was built, validated (`claude plugin validate` → "Validation passed"), and run via `claude --plugin-dir /tmp/agent-hud-probe` from `/tmp/hud-throwaway` — a directory with **no** `.claude/settings.json`, with the user-level `~/.claude/settings.json` confirmed to contain no hooks at all. Three POSTs arrived tagged `plugin-local` (`UserPromptSubmit`, `Stop`, `SessionEnd`), each carrying `cwd: /private/tmp/hud-throwaway`.

That isolates the variable properly: **the hooks fired because the plugin carried them, and for no other reason.** Plugin-carried HTTP hooks execute — verified, not inferred.

What that leaves genuinely open for Q1 is now two narrower questions, not one broad one:
- (a) does the **Cowork harness** register a user-installed plugin's `hooks/hooks.json` the way the CLI does?
- (b) does a harness-fired POST clear **cloud-session egress** to a tunnel hostname?

Both are Probe 4. The desk finding that CR's account plugins physically sync into cloud containers, combined with (a)'s mechanism now being proven in the same Claude Code runtime the cloud containers run, makes a yes on (a) the likelier outcome — but it stays unproven until the POST arrives.

---

## **Q1 VERDICT: YES. Plugin-carried hooks execute inside Cowork sessions and their POSTs reach the Mac.** (Probe 4, 2026-08-28)

**Install path (Probe 3 step 4):** the Claude desktop app offers **"Upload plugin"** and "Create a plugin" in its plugin settings. CR uploaded `agent-hud-probe.zip` (flat layout: `hooks/` and `.claude-plugin/` at archive root — accepted first try, the foldered variant was not needed) and the app reported it installed and ready. The plugin does **not** appear on local disk: `claude plugin list` still reports none installed and nothing named `agent-hud` exists under `~/.claude/` or the app's support directory. It is held account-side and delivered into sessions at runtime — consistent with the `remote_marketplace_migration_done_v1` flag in the app config and with the `plugins/synced/` directory previously observed inside a cloud container.

**Result: five Cowork sessions, five for five.** Every one delivered a full event stream to the tunnel; 32 Cowork-class events in total, no drops.

| session_id | origin IP | started by | events delivered |
|---|---|---|---|
| `4603d1d5` | 136.111.196.80 | desktop app | UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd |
| `1b89aa55` | 146.148.98.137 | desktop app | the same, minus SessionEnd |
| `8138eb3a` | 34.135.11.159 | phone | UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd |
| `ae54c9cf` | 34.136.84.82 | desktop app (created the schedule) | the above **plus `PermissionRequest`** |
| `2fbd1490` | 35.253.239.132 | **the scheduler itself, unattended** | UserPromptSubmit, PreToolUse, PostToolUse, Stop |

Five sessions produced five distinct egress IPs.

Payload shape is **identical to the local class** — same envelope (`session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`), same per-event fields. One adapter serves both classes; the `cowork-hook-plugin` and `claude-code-local` adapters differ only in transport, not in parsing. That is a real simplification against the brief's plan.

`PermissionRequest` fired from a cloud session, so **`NEEDS_APPROVAL` is a live state for Cowork threads**, not local-only as the headless-mode caveat in [`PHASE0-PAYLOADS.md`](PHASE0-PAYLOADS.md) might suggest.

### The finding that contradicts the brief: there is one Cowork class, not two

Section 2 and Q9 both assume desktop-started Cowork runs in a sandboxed VM **on the Mac**, with cloud/mobile as a separate class. The evidence says otherwise. **All five sessions — including the three CR started from the desktop app on his Mac — executed in Anthropic's cloud.** Every payload reported `cwd=/home/claude`, and every session arrived from a different Anthropic egress address. Not one carried CR's home IP (redacted), which the setup test had already established as the signature of traffic originating on the Mac.

The local gVisor machinery is real and still on disk (`coworkNetworkMode: gvisor`, `claude-code-vm/2.1.246`), so it presumably serves some other mode — but it is not where ordinary Cowork threads run.

Four consequences:

1. **Q9 collapses, and Q6 collapses with it.** One execution environment, one ingest path, one adapter. The two-class relay design is unnecessary.
2. **The tunnel is mandatory, with no cheap local shortcut.** The hoped-for "desktop sessions post to loopback" optimisation does not exist, because no Cowork session is ever on this machine. Only genuine local Claude Code sessions can use loopback.
3. **IP allowlisting is not a viable security model.** Five sessions produced five unrelated addresses across at least two providers. Phase 1 must authenticate on a shared secret carried in the hook's `headers` field.
4. **The ingest endpoint is currently public and unauthenticated.** Acceptable for a throwaway probe; unacceptable for anything that stays up. Anyone who guessed the hostname could POST junk events. Phase 1 closes this on day one — it is not a later hardening task.

### What this does not prove

That plugin hooks fire from **every** Cowork entry point. Five sessions is enough to establish the mechanism works and not enough to establish it never silently fails. The state engine must therefore treat missing events as normal (the `STALE` rule already does) rather than assuming a thread with no events has stopped.

## Q1b — Real payload shapes

**Desk verdict: the brief's caution is now resolved in the docs' favor — but capture-first still stands.**

The hooks reference (https://code.claude.com/docs/en/hooks) now documents the common payload fields explicitly: `session_id`, `prompt_id` (requires Claude Code ≥ 2.1.196; **documented as matching the OTel `prompt.id` attribute** — this is the cross-path correlation key Q5 needed), `transcript_path` (with a warning that it lags the in-memory conversation; `last_assistant_message` on Stop/SubagentStop is the supported way to read final text), `cwd`, `permission_mode` (not on all events), `effort`, `hook_event_name`, plus `agent_id`/`agent_type` inside subagents (that's subagent nesting solved at the payload level). All 14 events the HUD consumes exist in the current 31-event list, including `PostToolUseFailure`, `TaskCreated`/`TaskCompleted`, and `PermissionRequest`.

Per the brief's rule, adapters get built against captured payloads anyway.

**LIVE PROBE COMPLETE (Probe 1, 2026-08-28, CR's Mac, CLI 2.1.250). Full evidence: [`PHASE0-PAYLOADS.md`](PHASE0-PAYLOADS.md). Raw: `probes/captured/events.ndjson` (90 events).**

12 of the 14 consumed events captured. **`session_id`, `prompt_id`, `transcript_path`, and `cwd` arrived on every single event** — the brief's three "verify-first" fields are all real and all universal. `permission_mode` is real but *not* universal (absent on `Notification`, `SessionEnd`, `SubagentStart`, `TaskCreated`, `TaskCompleted`).

Four findings that change the build, in descending order of consequence:

1. **`SessionStart` never fired** — zero times across six headless sessions, while `UserPromptSubmit`/`Stop`/`SessionEnd` fired every time. **Tiles must be created lazily on the first event bearing an unseen `session_id`, never on `SessionStart`.** Any design that waits for a session-open event silently loses whole sessions. (Interactive-class behaviour still untested — but the lazy rule makes the answer not matter, which is why it's the right rule under brief Rule 6.)
2. **`Notification` carries `notification_type`** (observed: `"permission_prompt"`). `NEEDS_INPUT` vs `NEEDS_APPROVAL` is therefore an explicit field read, not an inference. The brief treated this as a hard distinction to make; it isn't.
3. **`PostToolUseFailure` carries `is_interrupt`.** CR pressing escape produces a tool failure that is not an error. Without this field the HUD would paint red tiles every time he stops something himself.
4. **`SubagentStart`/`SubagentStop` carry the parent `session_id` plus `agent_id`/`agent_type`.** Subagent nesting needs no inference: `threadId = agent_id`, `parentThreadId = session_id`.

Also confirmed live: `TaskCreated`/`TaskCompleted` carry `task_id`/`task_subject`, giving an honest labelled `n of m` (Section 4.4 preference 1); `Stop`/`SubagentStop` carry `last_assistant_message` (tile caption without transcript parsing) plus `background_tasks` and `session_crons` rosters.

Not captured, and honestly flagged: **`StopFailure`** — could not be forced synthetically; its payload shape is `// UNVERIFIED` and the adapter treats it defensively. **`SessionStart`** as above.

One caution recorded for the state engine: a blocked tool emits `PreToolUse` with **no matching `PostToolUse`**, so tool calls do not reliably pair. Pair on `tool_use_id` and time out unpaired opens rather than holding a thread in `WORKING` forever.

**Probe 4 added the Cowork class, and it changed nothing in the table above** — same envelope, same per-event fields, same semantics. Cowork contributed seven event types (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStop`, `SessionEnd`), all matching the local shapes exactly. `SessionStart` did not fire there either, which corroborates the lazy-tile-creation rule rather than undermining it.

## Q2 — Plan tier, admin rights, OTLP reachability

**Desk verdict: requirements confirmed; CR's status unknown, as expected.**

From https://claude.com/docs/cowork/monitoring, verified verbatim: "Monitoring is available for Team and Enterprise plans. OTel monitoring requires Claude desktop app version 1.1.4173 or later," and the `assistant_response` event "requires Claude desktop app version 1.17377 or later." Configured at Admin settings → Cowork (OTLP endpoint, `http/json` or `http/protobuf`, headers). Settings load at session start. Content redacted unless `otlpContentCapture` enabled. The egress note is confirmed too: the exporter runs inside the Cowork VM and **Cowork auto-adds the collector hostname to the session's egress allowlist** — which means a stable tunnel hostname qualifies as a collector, and, importantly, that cloud-session egress is allowlist-shaped (relevant to Q1's risk analysis).

**LIVE PROBE, VERSION HALF COMPLETE (Probe 0, 2026-08-28). Both thresholds cleared with room to spare.**

```
Claude desktop app : 1.37937.3     (needs ≥ 1.1.4173 for OTel; ≥ 1.17377 for assistant_response) — PASSES BOTH
Claude Code CLI    : 2.1.250       (needs ≥ 2.1.196 for prompt_id) — PASSES, and prompt_id was observed live
Machine            : Apple M4 Pro, macOS 26.4.1
Cowork VM runtime  : Claude Code 2.1.246 (~/Library/Application Support/Claude/claude-code-vm/)
```

So the version risk the brief flagged — an OTel design silently degrading on an older build — **does not apply to this machine.** If Path B is available at all, `assistant_response` is available with it.

The plan-tier half is genuinely unresolved and needs one click from CR. Local inspection found the account identifier (`ownerAccountId` in `cowork-enabled-cli-ops.json`) but **no plan, tier, or role field is stored on disk** — the desktop app resolves entitlements server-side, so there is nothing locally to read. Grepping further would be guessing at private storage, not evidence. Probe 5 step 2 (one guided click at `claude.ai/admin-settings`) is the cheapest honest answer and is on CR's task list.

**LIVE PROBE COMPLETE (Probe 5 step 2, 2026-08-28). The answer is no.**

CR opened `claude.ai/admin-settings` and the page returned: **"You don't have access to organization settings."**

Admin rights: **no.** OTLP endpoint configuration: **unreachable.** Whether the underlying plan is Team/Enterprise is now moot — the setting lives behind organization admin, and CR is not an admin of his organization. Nothing about that is fixable from this side; it would require someone else granting him an org role.

> ## **PATH B IS UNAVAILABLE. The hook plugin plus the local adapters carry the entire product.**
>
> This is the outcome the brief told us to report immediately, and it removes the designed fallback. Three consequences, in order of how much they change the plan:
>
> 1. **Probe 4 is no longer one probe among several — it is the architecture.** The brief's plan for "hooks fail for cloud sessions" was OTel. That door is closed. If plugin hooks do not fire from cloud sessions, there is no second ingest path for cloud/mobile threads, and CR's day-one requirement that phone-started sessions appear cannot be met by any mechanism verified in Phase 0.
> 2. **The `assistant_response` version threshold no longer matters.** Probe 0 confirmed the app clears it, but with no OTLP endpoint to export to, it is irrelevant. Recorded so a future reader doesn't re-litigate a solved-but-moot question.
> 3. **The adapter-precedence rule (hooks > OTel > DOM) loses its middle term** for Claude surfaces. Precedence still matters for Phase 3's DOM adapter, but no Claude tile will ever be OTel-sourced, so the "lower-confidence OTel tile" UI treatment specified in Sections 4.3 and 5 should not be built. That is a small scope reduction and the only good news in this finding.

One thing worth flagging honestly rather than burying: the relay design was justified partly by one tunnel hostname serving both hook POSTs and the OTLP endpoint. Half that justification is gone. The tunnel is still required — the gVisor desktop sandbox and Anthropic's cloud both need a public hostname to reach this Mac — but it now serves exactly one purpose, and should be judged on that alone.

## Q3 — External input into a running Cowork thread

**Desk verdict: no documented mechanism for third-party processes — with one real, observed lead the brief didn't know about.**

No public API injects a message into a running Cowork thread; nothing in the hooks, plugins, or monitoring docs offers it. The negative stands for Phase 1–3 planning.

The lead: cloud Cowork sessions carry a first-party "Claude Code Remote" MCP server whose scheduled-task tools were observed live in this session. Two of its behaviors matter: a scheduled trigger can be **bound to a persistent session** and deliver a message into that ongoing conversation (`send_later` does exactly this for the session's own future), and `fire_trigger` accepts arbitrary text appended as an extra user turn into a firing. This is session-side tooling, not an external API — the HUD process on the Mac has no direct handle to it — but it means the platform primitive for "deliver a message into an existing cloud session" exists. Phase 4, if CR ever asks for it, starts here rather than from zero. UNVERIFIED beyond what was observed in-session; treat as a research pointer, not a capability.

## Q4 — Deep link to an existing thread

> # ⚠️ THIS ANSWER WAS WRONG. CORRECTED 2026-08-28 (Phase 1).
>
> **A deep link to an existing thread DOES exist, and it works.**
>
> ```
> claude://claude.ai/code/session_<id>      opens a Cowork thread
> claude://claude.ai/chat/<uuid>            opens a conversation
> claude://claude.ai/project/<uuid>         opens a project
> ```
>
> Confirmed live: opening the first form with a real id brought the Claude app
> forward showing that exact thread. Click-to-jump — described in the brief as
> "the whole MVP requirement" — is delivered, not degraded.
>
> **How the original answer went wrong, because the method matters more than
> the outcome.** Probe 6 fired six `claude://` variants, got nothing from any of
> them, and recorded a documented negative. Every one of the six was malformed:
> they omitted the `claude.ai` host segment the route requires. Six failures of
> the same syntax error were read as evidence of absence.
>
> The evidence was on disk the whole time. `/Applications/Claude.app` is an
> Electron app; its deep-link route table is readable in the bundle. Reading it
> took one command and produced the complete list of ~20 routes — including
> `OpenConversation: 'chat'` and `Code: 'code'` — where guessing had produced
> six wrong URLs and a false conclusion.
>
> **The rule this should have followed:** when probing a local application for a
> capability, read what it accepts before guessing at what it accepts. A
> negative from guesswork is not a negative; it is an absence of evidence, and
> the brief's own Rule 1 ("verify before you build") was not met by six guesses.
>
> The operator had stated that click-through was his main reason for wanting the
> product. A wrong negative on that specific question was the most costly error
> available in this project, and it survived a whole phase because the finding
> was written with more confidence than its evidence supported.

**Desk verdict: negative, confirmed.** https://code.claude.com/docs/en/deep-links documents `claude-cli://open` as "the only path the handler accepts," with `q`, `cwd`, `repo` params, launching a *new* terminal session; the handler registers at `~/Applications/Claude Code URL Handler.app`. Nothing opens an existing conversation by ID. The click-to-jump fallback (focus app + clipboard + honest UI copy) is the plan of record.

**LIVE PROBE, ENUMERATION COMPLETE (Probe 6 step 1, 2026-08-28). One undocumented scheme found — worth testing, not worth hoping for.**

`lsregister` and both app `Info.plist` files agree:

```
claude:      → Claude.app                      (CFBundleURLName "Claude")   ← undocumented
claude-cli:  → Claude Code URL Handler.app     (documented; new sessions only)
msauth.com.anthropic.claudefordesktop(.helper) → Microsoft auth, irrelevant
```

So a **`claude://` scheme registered directly to the Claude desktop app does exist**, and it is not the documented `claude-cli://` handler. The docs describe only the latter. Whether `claude://` accepts anything resembling a conversation ID is unknown — a registered scheme usually means at minimum "focus the app", which alone would improve click-to-jump over the clipboard fallback.

This does not change the plan of record: the desk verdict (no documented existing-thread deep link) stands, and the Section 5 fallback stays specced. It is upside to test, and the test needs CR watching a screen — it is on his task list.

**LIVE PROBE COMPLETE (Probe 6 steps 2–3, 2026-08-28). Negative confirmed, with one usable consolation prize.**

Six variants fired against a real captured Cowork `session_id` (`4603d1d5-…`), each measured by frontmost-application before and after. Full log: `probes/captured/q4-url-results.txt`, reproducible via `bash probes/q4-url-test.sh <session-id>`.

| URL | exit | measured effect |
|---|---|---|
| `claude://` | 0 | **focus moved Terminal → Claude** |
| `claude://open` | 0 | accepted, no observable change |
| `claude://session/<id>` | 0 | accepted, no observable change |
| `claude://open?session=<id>` | 0 | accepted, no observable change |
| `claude://chat/<id>` | 0 | accepted, no observable change |
| `claude://cowork/<id>` | 0 | accepted, no observable change |

An exit code of 0 is **not** evidence of success here — macOS `open` returns 0 for any registered scheme regardless of whether the app does anything with the path, so all five "accepted" rows are indistinguishable from silently discarded. CR watched the screen and confirmed the app **came to the front and stayed on whatever thread was already open**. No variant navigated.

**Verdict: no deep link opens an existing thread.** The desk conclusion holds; the undocumented `claude://` scheme does not extend it.

**The consolation prize is worth having, though.** `claude://` is a reliable, officially-registered way to focus the Claude desktop app — better than AppleScript activation or shelling out to `open -a`, because it is the app's own declared entry point and will not break if the app bundle is renamed or relocated. Click-to-jump therefore ships as: **fire `claude://` to focus the app, copy the thread identifier to the clipboard, and tell the user plainly in the tile that direct navigation isn't available.** That is exactly the Section 5 fallback, now with a slightly better focus mechanism than it assumed.

`claude-cli://open?cwd=…` was deliberately **not** fired: it is documented to launch a new terminal session, which would have spawned a stray Claude Code process mid-probe. Its behaviour is documented and not architecture-shaping — it is only relevant to local Claude Code tiles, where Phase 2 can test it in isolation.

## Q5 — Thread identity across sources

> ### PARTIALLY SUPERSEDED — 2026-08-28 (Phase 1)
>
> The conclusion below ("no mapping is obtainable") is **wrong**, though for a
> subtler reason than Q4.
>
> The hunt asked: can the HUD obtain the `cse_` id? It searched the payloads,
> the transcript paths, and the container's filesystem, and found nothing —
> all correct. What it never checked was the container's **environment**, where
> the id sits in plain view:
>
> ```
> CLAUDE_CODE_REMOTE_SESSION_ID = cse_01NKo9Gg3jGjRFMMJHh9kNWX
> ```
>
> And Claude Code hooks support `allowedEnvVars`, which substitutes an
> environment variable into a hook's **headers** (verified live — substitution
> works in headers, not in the URL). So every Cowork event can carry its own
> app-level id, and the HUD learns the mapping for free.
>
> The in-session probe that "exhausted" this searched files and greps but was
> told to look for credentials-adjacent things carefully, and `env` was checked
> only for variable *names* matching `conv|uuid|thread|chat` — which
> `CLAUDE_CODE_REMOTE_SESSION_ID` does not match. The answer was one grep
> pattern away and was declared exhausted instead.
>
> What remains true below: the three identifier namespaces are genuinely
> distinct, and no arithmetic converts one into another. The mapping is
> *transported*, not computed.

**Desk verdict: better than hoped.** `prompt_id` in hook payloads is documented as matching OTel's `prompt.id`; both paths carry a session identifier (`session_id` / `session.id`). Observed live: the cloud session's `session_id` is the same UUID used in its uploads path and transcript filename — one identifier threads through the whole platform. Tile identity = `session_id`; tile title derives from the first `UserPromptSubmit` prompt (truncated), since no API exposes the sidebar's display name.

**LIVE FINDING (2026-08-28): the sidebar's own identity scheme, read off disk.** `~/Library/Application Support/Claude/claude_desktop_config.json` → `preferences.epitaxyPrefs.dframe-local-slice.pinnedOrder` is CR's literal pin list. It uses four namespaces:

```
cowork:local_<uuid>     121 entries   ← Cowork threads (the "local_" prefix marks the desktop-VM class)
cowork-artifact:<uuid>   11 entries
cowork-space:<uuid>       3 entries   ← also mirrored in starred-cowork-spaces
                        ───
                        135 pinned entries total
```

Two things follow.

**First, Q5 gets a concrete test rather than a vague one.** The sidebar identifies a Cowork thread as `local_<uuid>`. The open question is now precisely whether that `<uuid>` is the same value the hook payload reports as `session_id`. Probe 4 answers it by comparison: start one desktop Cowork session, capture its hook `session_id`, and check whether a new `cowork:local_<same-uuid>` appears here. If they match, tile identity is settled end to end and the HUD can even read this file to know which threads CR considers important. If they don't, the HUD needs a translation layer and that is a Phase 1 design item, not a detail.

**Second — and this is the number that justifies the product — 135 pinned entries.** The brief says "pins accumulate, unpinning is one-at-a-time, signal-to-noise has collapsed." That is measured, not asserted: 121 pinned threads is far past what any sidebar can usefully show. It also sets the HUD's real performance target. The grid must stay glanceable when the underlying set is this large, which is exactly what the `IDLE`/`STALE` hiding rule and ack-to-clear are for. A design validated against five tiles would be validated against the wrong problem.

## **Q5 VERDICT: the IDs do NOT line up. The HUD cannot address a thread the way the app does.** (Probe 7, 2026-08-28)

The desk verdict ("better than hoped — one identifier threads through the whole platform") is **wrong for Cowork**, and this is the second desk conclusion the live probes overturned.

Three identifier namespaces are now confirmed to coexist:

| Where it appears | Example | Format |
|---|---|---|
| Hook payload `session_id` (what the HUD receives) | `4603d1d5-aa0e-53dc-8213-7679f4d76203` | UUID **v5** |
| The app's own share/session ID (what CR can copy) | `cse_01XFyUernb947Y334p44L3FH` | `cse_` + 24-char base32 (ULID-shaped) |
| Sidebar pin entries on disk | `cowork:local_d42e6871-ed24-43b2-…` | UUID **v4** |

Evidence for the negative, three independent ways:

1. **No derivation.** The hook IDs are UUID v5, which is deterministic — derived by hashing a namespace plus a name. If the hook ID were computed from the `cse_` ID, it would be reproducible. Tested 40 combinations (5 standard namespaces × 8 plausible name forms, including the bare ID, prefixed, lowercased, and full claude.ai URLs): **zero matches.** Not proof of no relationship, but it rules out the obvious one.
2. **No co-occurrence.** The `cse_` ID appears in **no** Cowork hook payload. (An initial grep showed four hits; all four were this very Claude Code session capturing its own tool calls as I searched for the string — a self-referential false positive, not evidence.)
3. **No local mapping.** The `cse_` ID appears nowhere in the desktop app's on-disk data, and the app had not flushed the new pin to disk when checked, so the sidebar's own store could not corroborate either.

Additionally, the pinned-thread UUIDs are **v4** while hook session IDs are **v5** — a third format, suggesting the sidebar's client-side thread ID is yet another namespace rather than either of the other two.

### What this changes, and it is not cosmetic

**Tile titles are unaffected** — derive from the first `UserPromptSubmit` `prompt`, truncated, exactly as planned; and for scheduled runs prefer the routine slug from `~/Documents/Claude/Scheduled/`. Both are available in the payload and neither depends on matching the app's ID.

**Click-to-jump's fallback needs redesigning.** Section 5 specifies: focus the app, and copy *the thread identifier* to the clipboard. That instruction assumed the identifier would mean something to the app. It does not — pasting `4603d1d5-…` into Cowork's search finds nothing, because the app has never heard of that ID. Shipping it as specced would produce a control that *looks* helpful and reliably wastes CR's time, which Section 5's own "never ship an approve button that doesn't approve" principle forbids.

**Recommended replacement, for CR's approval:** clicking a tile fires `claude://` to focus the app and copies **the thread's title text** (the first prompt) to the clipboard, so CR can paste it straight into the app's search and land on the thread. That uses the one identifier both sides genuinely share — the words CR himself typed. Slightly less elegant than an ID lookup, considerably more likely to actually work.

### The mapping hunt was run, and it is exhausted (2026-08-28, at CR's instruction)

Three avenues, all closed:

**1. Is the mapping computable?** No. The `cse_` ID is Anthropic's standard opaque resource format — `<prefix>_01` plus 22 base62 characters. The captured events contain two other IDs of exactly that shape (`toolu_01…`, and `trig_01NvKSToaQKkn5crEoRyVms4` from the scheduled-trigger creation, which arrived *inside a real Cowork payload*). Opaque server-assigned IDs are random; hook `session_id`s are UUID **v5**, which is a deterministic hash. Two different generation schemes mean no arithmetic converts one to the other. 40 v5-derivation attempts (5 standard namespaces × 8 name forms) produced zero matches.

**2. Is it in the payloads or paths?** No. Cowork's `transcript_path` is `/root/.claude/projects/-home-claude/<session_id>.jsonl` — it just repeats the UUID. `agent_transcript_path` nests the same UUID. No `cse_` string appears in any of the 450 captured events.

**3. Does the container know its own conversation ID?** **No — and this is the decisive finding.** CR ran an introspection prompt inside a live Cowork session. Results:

- `/root/.claude/sessions/466.json` contains `{"pid":466,"sessionId":"d97e38f0-edae-5836-80ff-2a5fd4e4b87a","cwd":"/home/…"}` — the container's own identifier is a **UUID v5**, matching the hook `session_id` scheme exactly.
- **Nothing readable in the sandbox contains a `cse_` string.** The session's own conclusion: the `cse_` ID is minted **server-side by claude.ai at share time** and lives in the web conversation's URL. It was never written to the container's filesystem, so no amount of grepping will surface it.

That last point carries an extra implication worth stating: if `cse_` is minted at *share* time, it may be a share-link artifact rather than the thread's durable identity — in which case it was never the right join key even if we could have obtained it.

**VERDICT: no mapping is obtainable. Click-to-jump ships as `claude://` to focus the app plus the thread's title on the clipboard.** This is now an evidence-backed design decision rather than a concession, and Phase 1 should not re-open it without new information from Anthropic.

**A side finding worth carrying into any future in-session work:** Cowork's own permission classifier blocked three of the six introspection commands, reading directory sweeps near key material as credential harvesting — correctly, since `/root/.claude/sessions/` also holds a `.key` file. Anything that needs a Cowork session to inspect itself must state its intent plainly and target specific files; broad `env`/`grep` sweeps will be refused. Budget for that in Phase 4 rather than discovering it live.

## Q6 — Scheduled tasks: same events as interactive threads?

**Desk verdict: strong yes, pending the same probe as Q1.** Observed live: scheduled tasks ("Routines") fire as **fresh cloud sessions in the same environment class as interactive cloud sessions** — same container image, same synced plugins, same Claude Code runtime. There is no separate "scheduled task runtime" to worry about; Q6 collapses into Q1's cloud-class answer. If the probe plugin's hooks fire from a phone-started session, they fire from a scheduled run.

**LIVE FINDING (2026-08-28): CR runs 21 scheduled routines, and they are on disk with readable names.** `~/Documents/Claude/Scheduled/` contains 21 folders, each holding a `SKILL.md` — routines are implemented as skills. Names are human-readable slugs (`daily-briefing`, `weekly-meeting-analysis`, …), and `preferences.coworkScheduledTasksEnabled` is `true`.

Two consequences. **The brief's insistence that scheduled tasks are first-class is an understatement** — at 21 recurring jobs they are a large share of what the HUD must show, and a tile design tested only against interactive threads would be tested against the minority case. **And tile titles for this class are already solved**: the folder slug is a better title than anything derivable from a first prompt, because it is the name CR himself chose. Prefer it over the `UserPromptSubmit` fallback whenever a session's `cwd` resolves under `~/Documents/Claude/Scheduled/<slug>`.

**Strengthened by Probe 1: a second, independent route to scheduled-task visibility now exists.**

Every captured `Stop` and `SubagentStop` payload carries a **`session_crons`** array — a per-session roster of that session's scheduled jobs — alongside `background_tasks`. Both were empty in these captures (CR has no crons scheduled locally right now), so the element shape is `// UNVERIFIED`, but the field is real and arrives free on every turn end.

Confirmed on disk as well: the desktop app keeps `…/claude-code-sessions/<account-id>/<session-id>/scheduled-tasks.json`, structured as `{ scheduledTasks: [], recordedSkips: {}, … }`. Currently empty, same caveat.

This matters for risk, not for the primary design: Q6 was fully dependent on Q1's cloud answer. It now has a fallback. If the probe plugin's hooks turn out not to fire from scheduled runs, the HUD can still learn that scheduled jobs exist from `session_crons` on any ordinary `Stop`, and from the on-disk roster. Weaker than an event stream, but it is the difference between a degraded tile and no tile.

**LIVE PROBE COMPLETE (Probe 4 step 3, 2026-08-28). Confirmed: scheduled runs emit the identical event stream.**

CR asked a Cowork session to schedule a one-off task two minutes out. Two distinct sessions resulted, and the distinction matters:

- **`ae54c9cf`** — the session that *created* the schedule. Notable for firing a **`PermissionRequest`** (creating a scheduled task required approval), which incidentally proves `NEEDS_APPROVAL` is a live state for Cowork threads and not a local-only signal.
- **`2fbd1490`** — the scheduled run itself, firing on its own at 03:11:18Z from a **fresh session with a new `session_id` and a new egress IP** (35.253.239.132). It delivered `UserPromptSubmit` → `PreToolUse` → `PostToolUse` → `Stop`, with `tool_input: {"command": "echo hud-probe-scheduled"}` and `last_assistant_message` confirming the output.

**A scheduled run is indistinguishable from an interactive thread at the payload level.** No special handling, no separate adapter, no edge case — exactly as the desk verdict predicted. Q6 is answered yes, and CR's 21 routines will appear as ordinary tiles.

Two practical notes for Phase 1:

- **A scheduled run is a brand-new thread each time it fires**, not a recurring update to one long-lived tile. Twenty-one daily routines therefore produce twenty-one *new* tiles per cycle, each going `DONE` and sticking until acknowledged. With `DONE` sticky by spec, an overnight batch means a wall of green tiles waiting every morning. That is correct behaviour under the rules as written and it is also the single most likely way the grid becomes unusable in practice. **Flagging it as a Phase 1 design question for CR** — grouping routines under one collapsed tile per routine name is the obvious answer, but it touches the sticky-`DONE` rule, and that rule outranks everything, so it is not a decision to make quietly.
- `session_crons` was empty (`[]`) even in the session that had just created a scheduled task, so it does **not** appear to be a live roster of pending schedules in the way the field name suggests. The element shape remains `// UNVERIFIED` and the fallback route described below is weaker than it first looked. Do not build on it without testing it properly.

## Q7 — ChatGPT / Perplexity DOM selectors

Deferred to Phase 3 by design; nothing architecture-shaping depends on it. The adapter interface isolates it. Current-selector research happens when Phase 3 starts, since selectors rot in weeks — doing it now would produce stale findings by then.

## Q8 — Tauri vs Electron (macOS, Apple Silicon)

**Recommendation: Electron.** The deciding argument is process count, not framework fashion. The HUD is three things: an ingest HTTP listener, the state engine, and a rendered grid. In Electron all three live in one packaged app with one runtime (Node in the main process runs ingest + state engine; the renderer draws tiles) — one thing to install, one thing to restart, one thing to explain to a non-engineer when it misbehaves. Tauri would split the build across Rust and JS and either move the state engine into Rust (two languages in a repo maintained by AI agents for a non-coder — more surface for silent breakage) or require a sidecar Node process (two processes to babysit). Electron's always-on-top, frameless-window, tray, and Notification APIs are the most battle-tested in existence; 2026 comparisons consistently give Tauri the footprint win (bundles ~10x smaller, RAM a fraction of Electron's ~150–300MB) and Electron the maturity/simplicity win ([PkgPulse 2026 comparison](https://www.pkgpulse.com/guides/electron-vs-tauri-2026), [BuildMVPFast 2026](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026), [OpenReplay](https://blog.openreplay.com/comparing-electron-tauri-desktop-applications/)). A permanent second-monitor HUD spending ~200MB on a 16GB+ Mac already running the (Electron-based) Claude desktop app is an acceptable cost; an extra language and process boundary is not. Survives-next-Tuesday test: vendor internals we depend on (hooks, OTel) are identical either way; the framework choice touches only our own code. Revisit only if measured RAM or the 8-hour soak (Definition of Done) fails.

## Q9 — Where each session class executes, and what it can reach

> ### ⚠️ THE LIVE PROBE CONTRADICTS THE DESK VERDICT BELOW. Read this first.
>
> The desk analysis concluded there were two execution environments — desktop Cowork in a local VM, cloud/mobile in Anthropic's cloud — and the whole two-class relay design followed from it. **Probe 4 showed that is wrong.** All five Cowork sessions ran in Anthropic's cloud, including three started from the desktop app on the Mac itself (`cwd=/home/claude`, five distinct Anthropic egress IPs, none of them CR's home address). See the Q1 verdict above for the evidence table.
>
> **Corrected answer to Q9: there is one Cowork execution environment — Anthropic's cloud — and it can reach an arbitrary public hostname.** Cloud egress does not block harness-fired hook POSTs. Assumption (2) in the desk report ("the agent-level network block observed in-cloud does not bind harness-fired hooks") is now **confirmed true**.
>
> The desk reasoning below is retained deliberately, not deleted: it was sound given the documentation, and the way it failed is instructive. The OTel doc's phrase "the exporter runs inside the Cowork VM" was read as evidence about where *sessions* run. It is evidence about where the *exporter* runs, and the local gVisor machinery on disk made the wrong reading look corroborated. This is exactly the failure mode the brief's "verify before you build" rule exists to catch, and it is why Probe 4 tested each class separately instead of trusting the inference.

Desktop-started Cowork **(SUPERSEDED — see the correction above)**: a sandboxed VM on the Mac (per the OTel doc's "exporter runs inside the Cowork VM" and the auto-allowlist language — the VM cannot see host loopback; a public hostname is required even sitting two inches from the HUD process).
Cloud/mobile-started: Anthropic-hosted ephemeral container (observed directly — this session). Network egress exists but is policy-shaped; an in-session agent-level probe was blocked by a permission classifier, while platform-level telemetry (OTel) gets hostnames auto-allowlisted. Whether a harness-fired hook POST to a tunnel hostname passes cloud egress is THE open question, and it is precisely Probe 4.

**The desktop sandbox is named, live (2026-08-28):** `config.json` → `"coworkNetworkMode": "gvisor"`. Desktop Cowork sessions run under gVisor, a kernel-level syscall sandbox with its own network stack — which independently confirms the brief's assumption that the desktop VM cannot see host loopback, and that a public hostname is required even though the session is running two inches from the HUD process. Also present: `lastSeenRequireCoworkFullVmSandbox`, and `remote_marketplace_migration_done_v1: true` — the latter matters for Probe 3, because it means plugins are distributed to this machine from an account-level remote marketplace rather than purely from local disk.

**Tunnel verified (Probe 2, 2026-08-28).** `cloudflared` 2026.8.2 quick tunnel; `GET https://<host>.trycloudflare.com/health` returned the identical event count as loopback, and a subsequent plugin-fired POST arrived through it carrying `x-forwarded-for` with the Mac's public IP. So the envelope's forwarded-IP field does work as the class discriminator the capture server was designed around: a POST originating in Anthropic's cloud will carry a different origin IP than one from this Mac. Reachability and class-separation are both proven ahead of Probe 4.

**Live corroboration on CR's Mac (2026-08-28):** the desktop app ships its own Claude Code runtime for the VM at `~/Library/Application Support/Claude/claude-code-vm/2.1.246`, distinct from the host CLI at 2.1.250 and from the 2.1.250 observed inside a cloud container. Three separate Claude Code installs, one per session class — which confirms the classes really are distinct execution environments and must be probed separately, exactly as the brief insisted. It also means a version-dependent behaviour can differ between CR's terminal and his Cowork sessions; the adapter must not assume the host CLI's version applies to the VM.

Design consequence, already reflected in the architecture: one public tunnel hostname serves every class — desktop VM, cloud, and (if Q2 passes) the OTLP endpoint. Local Claude Code is the only class that posts to loopback directly.

---

## Recommended architecture — CONFIRMED BY PROBE 4

```
ALL Cowork sessions — desktop-started, phone-started, and scheduled routines
(one class, all executing in Anthropic's cloud, cwd=/home/claude)
        │  plugin hooks, HTTP POST, authenticated by shared secret in headers
        ▼
https://hud.<CR's-domain>   ← Cloudflare named tunnel on CR's own account
        │  (connector runs on the Mac; no third-party server; nothing stored off-machine)
        ▼
127.0.0.1:43200 ingest listener ◄── local Claude Code hooks (loopback, no tunnel)
        ▼
state engine (deterministic, unit-tested, snapshot-persisted, DONE is sticky)
        ▼
Electron HUD window (grid, sticky DONE, ack-to-clear)
```

Changes from the pre-probe version, all evidence-driven:

- **"desktop VM + cloud + scheduled" collapses to one class.** There is no local-VM session class to design for.
- **The OTel branch is deleted, not deferred.** Q2 came back negative; there is nothing to build.
- **Authentication moves from "later" to day one.** Five sessions produced five unrelated egress IPs, so the endpoint cannot be protected by origin. It must be a shared secret in the hook's `headers` field.

Relay reasoning, the paragraph CR can actually read: your Mac runs a small Cloudflare connector that gives it a permanent private web address. Your Claude sessions — the ones on your laptop, the ones you start from your phone, and your 21 scheduled routines — all run in Anthropic's cloud, and they send a small status ping to that address whenever something happens. Cloudflare passes those pings straight through to your Mac. Nothing is stored anywhere but your machine, there is no server to rent or maintain, and it is free on an account you already have. The pings carry a secret key so nobody else can send fake ones.

Adapter precedence is now simply **hooks > DOM**, with no middle term for Claude surfaces. The "lower-confidence OTel tile" treatment specified in Sections 4.3 and 5 **should not be built** — no Claude tile will ever be OTel-sourced. The confidence indicator survives only for Phase 3's browser adapter.

---

## Operator decisions (2026-08-28, CR)

### 1. Scheduled routines are OUT OF SCOPE for the HUD, for now

**CR's call, made after seeing the "morning wall of green" problem.** His 21 scheduled routines will **not** appear as tiles. The HUD shows interactive threads only.

This is a deliberate departure from the brief, and it should be visible rather than buried:

- Section 2 states "Scheduled tasks and routines are first-class… Do not treat them as an edge case." Section 7's **Phase 2 acceptance criteria** require "Scheduled tasks and routines appearing as tiles — this is a requirement, not a nice-to-have." **That acceptance criterion is now void.** Phase 2 cannot be judged against it, and nobody should later "fix" the HUD by adding routine tiles without CR re-deciding.
- It is a sound call on the evidence. Routines are the class that would have flooded the grid — 21 jobs, each firing as a brand-new thread, each going sticky-`DONE`. The brief's core promise is a self-cleaning surface that answers "what needs me right now" in under two seconds; an overnight batch of unacknowledged green tiles defeats exactly that. Cutting the noisiest class protects the product's one job.
- **What CR gives up:** no visibility into whether a routine ran, stalled, or failed. If a daily briefing silently stops firing, the HUD will not tell him. That is the real cost, and it is worth revisiting once the grid has proven itself — an `ERROR`-only view of routines (show a routine tile *only* when a run fails) would restore the safety net without the flood. **Recommended as a Phase 2 conversation, not a Phase 1 build.**

Implementation note so this doesn't leak in by accident: routine sessions are identifiable by `cwd` resolving under `~/Documents/Claude/Scheduled/<slug>`, and by arriving unattended with no prior `UserPromptSubmit` from CR. Filter at the adapter boundary, not in the UI, so no routine event ever reaches the state engine.

### 2. Hunt for an ID mapping before settling for search-by-title — DONE, came back negative

CR chose to spend the time rather than accept the fallback on inference. The hunt ran to exhaustion across three avenues and closed the question: no mapping exists that the HUD can obtain. Full evidence in the Q5 section above.

Worth recording that the time was well spent even though the answer was no. Before the hunt, "copy the title instead of the ID" was a guess dressed as a decision. After it, it is the only available design, and Phase 1 can implement it without a lingering suspicion that something better was missed.

### 3. Click-to-jump behaviour: focus the app, copy the title

Follows from decision 2. Clicking a tile fires `claude://` (the app's own registered scheme, verified to focus it) and puts the thread's title text on the clipboard so CR can paste it into the app's search. **The tile must say plainly that direct navigation isn't available** — per Section 5, a control that silently does nothing is worse than no control.

---

## Probe kit state after Phase 0 (read this before re-running anything)

- **The probe plugin was removed from Cowork at CR's instruction.** It pointed at a throwaway quick-tunnel hostname; left installed, every Cowork session would have fired 14 hook calls at a dead address with a 5-second timeout each. **Any future probe plugin must be uninstalled the moment its endpoint dies** — this is the one piece of the kit that degrades CR's daily experience if forgotten.
- **The quick tunnel and capture server were shut down.** Nothing from this probe run is left listening.
- **`cloudflared` 2026.8.2 remains installed** (via Homebrew, with CR's approval) and Phase 1 needs it.
- **Artifacts left in place:** `probes/captured/events.ndjson` (304 events — the evidence base), `probes/captured/q4-url-results.txt`, `/tmp/agent-hud-probe/` and `/tmp/agent-hud-marketplace/` (scratch, disposable), and `agent-hud-probe.zip` + `agent-hud-probe-foldered.zip` on CR's Desktop (safe to delete).
- **GitHub backup repo (`CLAUDE.md` first-session task): PARTIALLY DONE, then parked.** `gh` 2.98.0 is installed; the repo is initialised on `main` with a `.gitignore` (which explicitly un-ignores `probes/captured/**` so no future rule can swallow the evidence base) and one commit, `8000a5a`, 18 files. **The push did not happen — CR is locked out of his GitHub account.** Not a technical blocker on our side and nothing depends on it: local git already provides version history, and the tree lives in Box, so it is backed up. To finish once he regains access, from a real Terminal window (not Claude Code's `!` prefix, which cannot supply the interactive TTY `gh auth login` needs — this wasted two attempts): `gh auth login --web --git-protocol https`, then `gh repo create agent-hud --private --source . --remote origin --push`.
- **The repo must stay private.** A scan of all 450 captured events found no credentials, no tokens, and no other client work — the captured prompts are almost entirely synthetic probe strings. But CR's full filesystem path appears ~620 times and encodes his employer, department, and internal programme names; the docs also name his installed plugins, his usage fingerprint, and the HUD's planned authentication design for an endpoint intended to face the internet. Treat "make this public" as a decision requiring a scrub, not a toggle.
- **Reproducing the capture analysis** needs no live sessions: `node probes/summarize-captures.mjs --all` regenerates the full payload breakdown from the committed evidence file.

---

## Report (Section 10 format)

**WHAT SHIPPED** — Phase 0, complete. The probe kit (capture server, probe plugin, local marketplace, environment/URL-scheme scripts, a capture summarizer, an active deep-link tester), 304 captured events in `probes/captured/events.ndjson`, the payload/adapter contract in [`PHASE0-PAYLOADS.md`](PHASE0-PAYLOADS.md), and this findings document with every Section 6 question answered. No implementation code — correctly, since the brief forbids it before sign-off.

**WHAT I VERIFIED** (live capture on CR's Mac, 2026-08-28, unless noted)

- **Q1 — YES.** Plugin-carried hooks execute inside Cowork and their POSTs reach the Mac. Five Cowork sessions, five complete event streams. Install path is the desktop app's **"Upload plugin"**; the plugin is held account-side, not on local disk.
- **Q1b — 12 of 14 events captured with full field lists.** `session_id`, `prompt_id`, `transcript_path`, `cwd` on every event. Plus four things the brief did not know existed: `notification_type` (splits `NEEDS_INPUT` from `NEEDS_APPROVAL` explicitly), `is_interrupt` (prevents false `ERROR` tiles), `agent_id`/`agent_type` (subagent nesting with no inference), and `task_id`/`task_subject` (honest labelled progress).
- **Q2 — NO.** `claude.ai/admin-settings` returns "You don't have access to organization settings." Path B unavailable. Desktop app 1.37937.3 clears both OTel version thresholds, which is now moot.
- **Q3 — negative, unchanged** (desk). No supported external input path into a running Cowork thread.
- **Q4 — NO.** Six `claude://` variants tested against a real session ID; none navigated. `claude://` does reliably focus the app.
- **Q5 — NO.** Three unrelated ID namespaces: hook `session_id` (UUID v5), the app's shareable `cse_…` ID, and sidebar pins (UUID v4). 40 v5-derivation combinations tested, zero matches.
- **Q6 — YES.** A scheduled run fires as a fresh cloud session emitting an event stream identical to an interactive thread.
- **Q8 — Electron** (desk reasoning stands; nothing in the live probes bears on it).
- **Q9 — CORRECTED.** All Cowork sessions execute in **Anthropic's cloud**, including desktop-started ones (`cwd=/home/claude`, five distinct Anthropic egress IPs, none from CR's Mac). Cloud egress passes harness-fired POSTs to an arbitrary tunnel hostname.
- **Scale, measured:** 135 pinned sidebar entries (121 threads) and 21 scheduled routines. The brief's premise is quantified, and so is the HUD's real performance target.

**WHAT I COULD NOT VERIFY**

- **`StopFailure` payload shape** — could not be forced synthetically. Marked `// UNVERIFIED`; the adapter must handle it defensively.
- **`SessionStart`** — never fired in six headless sessions; interactive-class behaviour untested. Mitigated by design: tiles are created on the first event of *any* kind, so the answer cannot matter.
- **Whether the `cse_` ID and the hook `session_id` belong to the same thread with certainty** — inferred from CR's description, not proven. Phase 1 should spend thirty minutes closing this before settling for search-by-title.
- **`session_crons` element shape** — the field is real but was empty even in a session that had just created a scheduled task, so it is not the live roster its name suggests.
- **That plugin hooks fire from *every* Cowork entry point** — five sessions prove the mechanism, not universality.
- **Agent SDK `streamInput()`/`interrupt()`** — Phase 4 only, deliberately untouched.

**ASSUMPTIONS I MADE**

1. **The `cse_` ID CR shared is the pinned probe thread's.** If wrong, Q5's negative is wrong, and Q5 is the finding most likely to be overturned. It is cheap to re-test.
2. **A quick tunnel is representative of a named tunnel** for reachability. Standard Cloudflare behaviour, but Phase 1 re-verifies on the real hostname rather than assuming.
3. **Five sessions generalise to CR's ordinary usage.** All five were deliberately trivial ("echo and stop"). Long, tool-heavy, multi-hour threads are the actual target and were not exercised.
4. **UUID v5 session IDs are stable across reconnects.** Deterministic derivation suggests it; nothing here proves it. If false, tiles could duplicate when a thread resumes.

**WHAT BREAKS FIRST, AND WHY**

1. **The single-path risk, which is the real headline.** Path A now carries 100% of Claude coverage with no designed fallback — Q2 removed it. If Anthropic changes plugin-hook execution or tightens cloud egress, the HUD goes dark for every Cowork thread at once, and there is no second signal to degrade to. Everything else on this list is smaller than this.
2. **The morning-wall-of-green problem.** 21 routines × sticky `DONE` = 21 new tiles every cycle, each waiting to be acknowledged. That is the spec working as written, and it is the most likely way the grid becomes unusable in daily practice. It needs a decision from CR before Phase 1 builds the grid, because grouping touches the sticky-`DONE` rule and that rule outranks everything.
3. **Unauthenticated ingest.** Currently public. Must close on Phase 1 day one; IP allowlisting is not available.
4. **Click-to-jump degrading to search-by-title**, because no shared identifier exists.

**NEXT PHASE — GO / NO-GO**

**GO for Phase 1.** Every Section 6 question is answered with live evidence, and both decisions the GO was conditional on have been made by CR (see Operator decisions above): scheduled routines are out of scope, and click-to-jump ships as focus-plus-copy-title after the mapping hunt came back negative.

The architecture is simpler than the brief anticipated — one Cowork class, one ingest path, one adapter shape serving both transports — and the payload data is richer than assumed, removing several inference rules the brief expected to need. It is also more fragile than the brief anticipated, because Q2 removed the fallback path. Those two facts should be held together: the thing to build is small, and the thing to monitor is that it keeps working.

**Phase 1 builds, in order:**

1. **Named Cloudflare tunnel with shared-secret authentication.** CR runs the network-exposing step himself; the installer must make that one command with a plain explanation. The endpoint rejects unauthenticated POSTs from the first commit — not as later hardening.
2. **The hook adapter.** One implementation. Cowork and local Claude Code differ only in transport and labelling; `cwd` is the class discriminator (`/home/claude` = Cowork). Filter routine sessions out at this boundary so no routine event reaches the state engine.
3. **The state engine, with unit tests before any UI.** Every transition in the derived-state table in [`PHASE0-PAYLOADS.md`](PHASE0-PAYLOADS.md), plus the three rules the captures forced: lazy tile creation on any first event, `is_interrupt === true` → `IDLE` not `ERROR`, and `SessionEnd` never downgrading a sticky `DONE`.
4. **The Electron grid.** Built against a realistic thread count, not five tiles — CR's real working set runs to over a hundred.

**Revised Phase 1 acceptance criterion.** The brief's original test ("three Cowork threads, at least one from his phone, all appear within five seconds with correct states") stands and is now known to be achievable — all five probe sessions delivered complete streams. Add one criterion the probes showed matters: **a thread CR interrupts must not show as `ERROR`.** That is the failure most likely to erode his trust in the colours, and it is the one the payload data specifically lets us get right.
