# BUILD BRIEF v2 — "Agent HUD": a real-time heads-up display for active AI threads

**Deliver this whole document as the opening prompt to the agent team. Do not summarize it.**

> **Revision note (v2, 2026-08-28).** Every technical claim in Section 3 of v1 was checked against live official documentation before this revision. Most held. What changed: (a) three hook payload fields v1 asserted are not in the docs and are now marked verify-first; (b) the OTel version requirement was wrong for one event type; (c) a real deep-link scheme exists but does less than hoped — Q4 is narrowed accordingly; (d) the operator answered four scoping questions, which settles the OS, puts cloud/mobile sessions in scope from day one (making the relay a Phase 1 deliverable), confirms Phase 3, and leaves plan tier for Phase 0 to determine; (e) three spec gaps in the state machine are now resolved with flagged defaults. Verification sources are cited inline.

---

## 0. Read this first: how you are to work

You are a team of agents building a production tool that one person will use every working day. Rules:

1. **Verify before you build.** Section 6 lists open questions. Resolve every one of them against live documentation or a live probe *before* writing implementation code. If a capability you assumed doesn't exist, say so and re-plan. Do not fabricate an API surface.
2. **No invented endpoints.** Every integration must trace to either (a) a cited official doc, or (b) an observed live response you captured yourself. Anything else is a stub with a `// UNVERIFIED` marker and a written note.
3. **Ship in phases.** Each phase in Section 7 has acceptance criteria. Phase N+1 does not start until Phase N passes its criteria on the operator's actual machine with his actual sessions.
4. **Degrade, never break.** Any adapter can be unavailable. The HUD must run correctly with zero adapters connected and show that state honestly rather than showing a false-empty dashboard.
5. **Assumptions get flagged, not buried.** End every phase report with an ASSUMPTIONS block.
6. When two designs are viable, choose the one that survives a vendor changing their internals next Tuesday.

---

## 1. Mission

Build a desktop heads-up display that shows, at a glance, the live status of every **active** AI thread and agent the operator has running — primarily in the Claude desktop app (Cowork), and across ChatGPT and Perplexity, both of which he uses daily — as a grid of tiles, one per thread, each with a progress readout and an unmissable status color.

It lives permanently on a second monitor. It replaces scanning a sidebar. Its job is to answer one question in under two seconds: **which of my threads needs me right now, and which are done?**

---

## 2. Operating context

- Single operator, single machine: **a Mac with Apple Silicon. Confirmed — do not re-ask.** Q8 is now only the framework decision (Tauri vs Electron).
- The operator runs many concurrent Claude threads: Cowork sessions, project-folder threads, scheduled tasks, and subagents.
- **Cloud and mobile sessions are in scope from day one — confirmed by the operator.** He starts sessions from his phone, and sessions keep running in Anthropic's cloud after he closes the laptop. No process on his Mac can observe those directly, so the ingest relay (Section 4.2) is a **Phase 1 deliverable, not a later optimization.** A HUD that only sees what's running on the Mac fails his actual usage.
- His current workaround is pinning threads in the Cowork sidebar. Pins accumulate, unpinning is one-at-a-time, and pinned threads are mixed with project folders and scheduled tasks. Signal-to-noise has collapsed. **The dashboard's core value is that it is self-cleaning: only genuinely active threads appear, and finished ones clear themselves once acknowledged.**
- **Scheduled tasks and routines are first-class.** He runs recurring jobs that fire on their own schedule; those must appear on the dashboard exactly like interactive threads. Do not treat them as an edge case.
- He does **not** run threads in claude.ai in a browser tab. Deprioritize that surface. (Cloud-hosted sessions started from mobile or the desktop app are a different thing and are in scope, per above.)
- He uses **ChatGPT and Perplexity daily**. Phase 3 stands as written.

### 2.1 Hard constraint: the operator does not write code

He is a founder, not an engineer, and has no intention of becoming one. Design and document accordingly:

- **He will never read, review, or debug your source.** Correctness is entirely your responsibility. There is no second pair of technical eyes on this.
- **Setup must be one command or one script**, with a written plain-language explanation of what it does and what it touches. Anything requiring him to hand-edit a config file, manage credentials by hand, or reason about ports is a design failure — make the installer do it.
- **Every failure must explain itself in plain language inside the HUD**, with a specific next action. Never surface a stack trace as the user-facing error.
- **Write the README for him, not for a developer.** What it does, how to start it, what to do when a tile looks wrong, and what to tell an engineer if it breaks badly.

### 2.2 Claude Code as the build vehicle

The operator is open to running this as his first hands-on Claude Code CLI project — as a way to learn the tool, not to learn programming. Treat that as an explicit secondary objective.

- **Include a Claude Code onboarding track** alongside Phase 0: install, first run, how to point it at this repo, the five commands he actually needs, and how to hand you a task and read what came back. Under one page.
- Frame it correctly for him: in this project Claude Code is an **orchestration surface**, not a code editor. He directs, you build.
- There is a genuine payoff beyond learning: local Claude Code sessions produce the richest, most reliable status signal of any surface in this build, and they are the only class where true bidirectional input is achievable. **Him running Claude Code sessions makes his own dashboard better.** Say so.
- Do not gate any phase on him learning it. If he stops using the CLI, the product must still work end to end.

---

## 3. Ground truth about what is and isn't possible

**This section exists to stop you from designing against an API that doesn't exist. Every claim below was re-verified against live documentation on 2026-08-28. Read it before you plan.**

### What does NOT exist
- There is **no public API** to list conversations in the Claude desktop app or on claude.ai, and none to read a thread's live status. Do not design around one.
- There is **no public API** for ChatGPT or Perplexity conversation state. Neither exposes thread status to third parties.
- There is **no documented mechanism** for an external process to inject a message into a running Cowork thread.
- There is **no deep link that opens an existing thread.** A documented scheme exists — `claude-cli://open` (https://code.claude.com/docs/en/deep-links) — but it *launches a new* Claude Code terminal session with a pre-filled prompt and working directory (`q`, `cwd`, `repo` params). Nothing documented opens an existing Cowork conversation by ID. Q4 probes for undocumented behavior; plan for the fallback.
- Claude Code transcript files (`~/.claude/projects/<project-slug>/<session-id>.jsonl`) exist on disk (verified), but Anthropic's docs state the entry format is internal and changes between versions, and that scripts parsing them directly will break on any release; they point to `/export` and the script interfaces instead. **Treat transcripts as a last-resort fallback, never as the primary source.** (https://code.claude.com/docs/en/sessions)

### What DOES exist — the three real ingest paths

**Path A — Hooks (primary; richest and most real-time). VERIFIED with one caveat.**
Claude Code's hook system fires on named lifecycle events — 31 of them as of this writing. All of the ones this build relies on are real: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PermissionDenied`, `Notification`, `TaskCreated`, `TaskCompleted`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `SessionEnd`. Also useful and not in v1 of this brief: **`PostToolUseFailure`** (a direct `ERROR` signal — use it) and `PreCompact`/`PostCompact` (long-session housekeeping signals).
Hook handler types include `type: "http"` (POSTs the event JSON to a URL — verified) and `type: "command"` (arbitrary shell), plus `mcp_tool`, `prompt`, and `agent` types not needed here.
**Payload caveat:** `session_id`, `cwd`, `hook_event_name`, and `tool_name` are documented payload fields. `prompt_id`, `transcript_path`, and `permission_mode` — asserted in v1 — are **not confirmed in the docs** (the field-reference page was unreachable at verification time). Capture a live payload for each event you consume in Phase 0 and build against what actually arrives, not against this list. Do not key any logic to `prompt_id` until you've seen it.
Hooks are configured in `~/.claude/settings.json`, project `.claude/settings.json`, or **carried inside a plugin** (`hooks/hooks.json` at plugin root — verified: https://code.claude.com/docs/en/plugins).
Docs: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/hooks-guide

> **The critical architectural insight:** a local settings file cannot reach sessions running in a VM — but a **plugin** installed into Cowork travels with the session. Package the hooks as a Cowork plugin and they may fire from inside Cowork sessions, local-VM and cloud alike. The docs confirm plugins carry hooks; they do **not** confirm plugin hooks execute inside Cowork sessions. That is Q1, still the highest-value unknown in this build. Note also Q9 (new): Cowork desktop sessions run in a sandboxed VM on the Mac itself, while mobile-started sessions run in Anthropic's cloud — the two may differ in whether a hook can reach the relay or the host at all, so Q1 must be answered separately for each.

**Path B — OpenTelemetry export (secondary; org-wide, zero per-session setup). VERIFIED with two corrections.**
Cowork exports events over OTLP to an admin-configured collector. Events: `user_prompt`, `assistant_response`, `tool_result`, `api_request`, `api_error`, `tool_decision`. Every event carries `session.id`, `prompt.id` (links all events from one prompt), `event.sequence` (monotonic ordering), `event.timestamp`, plus user and org identifiers. `tool_result` carries `tool_name`, `success`, `duration_ms`, `decision_type`, `decision_source`. Configured at **Admin settings → Cowork** with an OTLP endpoint, protocol (`http/json` or `http/protobuf`), and headers.
Docs: https://claude.com/docs/cowork/monitoring

Constraints you must design around (corrected from v1):
- Team and Enterprise plans only; requires desktop app ≥ 1.1.4173 — **except `assistant_response`, which requires ≥ 1.17377.** Check the operator's installed version in Phase 0; an OTel design that leans on `assistant_response` for DONE inference silently degrades on older builds.
- The exporter runs inside the Cowork VM and is subject to the session's egress rules, but **Cowork auto-adds the collector hostname to the egress allowlist** — the requirement is a stable hostname reachable from the VM, which still rules out `localhost` but does not strictly require a public server (a tunnel hostname qualifies; verify in Phase 0).
- Settings load at session start; existing sessions won't pick up a config change.
- Content (`prompt`, `response`, `tool_input`) is redacted unless `otlpContentCapture` is enabled. Leave it off.

**Path C — Browser/DOM observation (for non-Claude platforms only).**
For ChatGPT and Perplexity there is no other option. A browser extension with content scripts observes generating/idle/complete state in the DOM and POSTs to the local HUD. This is inherently fragile; isolate it behind the same adapter interface as everything else so its breakage is contained.

---

## 4. Required architecture

Four layers. Keep them genuinely decoupled — the adapters are the part that will break, and they must be replaceable without touching the HUD.

```
[ Adapters ] → [ Relay ] → [ State Engine ] → [ HUD ]
```

### 4.1 Adapters
Each adapter conforms to one interface and emits **normalized events**, never raw vendor payloads:

```ts
type ThreadEvent = {
  source: 'cowork-hook' | 'cowork-otel' | 'claude-code-local' | 'browser-ext';
  platform: 'claude' | 'chatgpt' | 'perplexity';
  threadId: string;          // stable per thread; session.id where available
  parentThreadId?: string;   // for subagents
  seq: number;               // monotonic per thread
  ts: string;                // ISO 8601
  kind: 'session_start' | 'prompt_submitted' | 'tool_started' | 'tool_finished'
      | 'permission_requested' | 'input_requested' | 'task_created'
      | 'task_completed' | 'assistant_responded' | 'turn_finished'
      | 'session_ended' | 'error' | 'heartbeat';
  payload: Record<string, unknown>;
};
```

Adapters to build, in order: `cowork-hook-plugin`, `claude-code-local`, `cowork-otel`, `browser-ext`.

### 4.2 Relay — now a Phase 1 deliverable
- **Local Claude Code and browser extension** POST directly to the HUD's local HTTP listener on a loopback port. No cloud involved.
- **Cowork (hooks from cloud-hosted sessions, and OTLP)** cannot reach loopback. Because the operator has confirmed cloud/mobile sessions must appear from day one, the relay ships in Phase 1. Build a minimal public ingest path: **evaluate a reverse tunnel (Cloudflare Tunnel / Tailscale Funnel), which keeps all state on his machine and involves no third-party server, against a minimal owned relay** (Cloudflare Worker, Fly.io app, or equivalent) that authenticates on a shared secret, holds a short rolling event buffer only, and streams to the HUD over an authenticated WebSocket or SSE. **The operator has explicitly delegated this choice to you.** Pick one, write down the reasoning in one paragraph he can actually read, and — decisive factor — pick the one whose setup he can complete without touching a config file. Note the OTel auto-allowlist finding in Section 3: a stable tunnel hostname may satisfy both hook POSTs and the OTLP endpoint, which would let one mechanism serve both paths.
- The relay stores no conversation content by default. Content capture is off unless the operator explicitly turns it on.

### 4.3 State engine
A deterministic state machine per thread, fed by normalized events. This is the heart of the product — spec it fully and unit-test it before any UI work.

**States, with the exact visual treatment:**

| State | Meaning | Color | Motion |
|---|---|---|---|
| `WORKING` | Actively running: tools firing, tokens streaming | Blue | Animated progress |
| `NEEDS_INPUT` | Waiting on the operator — a question, a choice, missing info | Amber | Pulse |
| `NEEDS_APPROVAL` | Blocked on a permission/tool decision | Orange | Pulse, harder |
| `DONE` | Finished its assigned work; output ready | **Bright green** | Steady, high contrast |
| `ERROR` | Failed, hit an API error, or stalled | Red | Steady |
| `STALE` | No events past the idle threshold; state unknown | Gray | Dimmed |
| `IDLE` | Alive but nothing assigned | Gray | Dimmed |

**Non-negotiable behaviors:**
- **`DONE` is sticky.** A completed thread stays bright green until the operator explicitly acknowledges it in the HUD. It does not time out, fade, or auto-clear. This is the single most important rule in the spec.
- Acknowledging a `DONE` tile removes it from the grid. That is the self-cleaning mechanism that replaces manual unpinning.
- `IDLE` and `STALE` threads are hidden from the main grid by default, reachable behind a toggle. **A thread the operator has not touched and that is doing nothing must not consume grid space.**
- Distinguish `NEEDS_INPUT` from `NEEDS_APPROVAL`. They demand different responses and should not share a color.
- Every state transition is timestamped and logged. Time-in-state is displayed on the tile.

**Spec gaps resolved in v2 (defaults — flag in Phase 1 report, change only if the operator objects):**
- **Re-activation after acknowledgment:** if an acknowledged thread emits new events, it re-enters the grid as `WORKING` with a fresh state history. Acknowledgment clears the tile, never blacklists the thread.
- **Persistence:** `DONE` stickiness and pending acknowledgments survive restarts of the HUD, the app, and the machine. State snapshots to local disk; on startup, reconcile snapshot against incoming events.
- **`STALE` threshold:** default 10 minutes without events while in `WORKING`. Hard-coded sensible default, no config file (Section 2.1). Tunable later only if real use demands it.

**Deriving state per path — spell out your inference rules and defend them:**
- *Hooks:* mostly explicit. `PermissionRequest` → `NEEDS_APPROVAL`. `Notification` → `NEEDS_INPUT`. `Stop` → `DONE`. `PreToolUse`/`PostToolUse` → `WORKING`. `StopFailure` and `PostToolUseFailure` → `ERROR`.
- *OTel:* inferential. Event flow → `WORKING`. `assistant_response` followed by silence beyond the threshold → likely `DONE` (only on desktop ≥ 1.17377 — see Section 3). `api_error` → `ERROR`. A long-running `AskUserQuestion` tool → `NEEDS_INPUT`, but note OTel logs tool *results*, not requests, so this signal arrives late. **Document this latency honestly in the UI — an OTel-only tile must visibly mark itself as lower-confidence.**
- Never let an inferred `DONE` overwrite an explicit hook-sourced state. Establish adapter precedence: hooks > OTel > DOM.

### 4.4 Progress
The operator asked for a progress bar. Real percent-complete is not available from any source, and a fabricated bar is worse than none. Build it from what is actually knowable, in this order of preference:
1. **Task-list completion** — `TaskCreated` / `TaskCompleted` hook events give a real `n of m` for sessions using a task list. This is the only honest percentage. Use it whenever present.
2. **Step counter** — tool calls completed this turn, shown as an activity count, not a percentage.
3. **Elapsed time + current activity** — "12m · running Bash" with an indeterminate animated bar.
Never show a percentage you cannot source. Say what it's doing instead.

---

## 5. HUD specification

**Window:** frameless, always-on-top (toggleable), resizable, remembers position and size across restarts, opens on a chosen monitor. Dark by default; light mode supported. Legible from six feet away — this is glanceable furniture, not a document.

**Grid:** responsive tiles, densest arrangement that keeps text readable. Sort order: `NEEDS_APPROVAL` → `NEEDS_INPUT` → `DONE` → `WORKING` → everything else. Within a group, most recently changed first.

**Tile contents:**
- Thread title (from first prompt or session name), truncated with hover-for-full
- Platform badge (Claude / ChatGPT / Perplexity) and source badge (hook / OTel / DOM), with the confidence indicator for inferred states
- Status color as the dominant visual element — readable peripherally, without reading a word
- Progress readout per Section 4.4
- Current activity line ("running Bash", "waiting on your answer", "done · 4m ago")
- Time in current state
- Acknowledge button on `DONE` tiles
- Subagents nest under, or visually attach to, their parent thread

**Interaction — the operator has scoped this down. Respect the scope.**
- **Click-to-jump is the whole MVP requirement.** Clicking a tile focuses the Claude desktop app and opens that thread. Nothing more. Do not spend phases on inline reply before the dashboard itself is reliable.
- No documented deep link opens an existing Cowork thread (Section 3; Q4 probes for undocumented ones). If none is found, clicking focuses the app and copies the thread identifier to the clipboard, and the UI says plainly that direct navigation isn't available. For **local Claude Code sessions only**, `claude-cli://open` can at minimum open a terminal in the right working directory — use it if it improves the jump, never as a fake "open thread."
- **Later, only if it comes free:** local Claude Code sessions driven through the Agent SDK do support real bidirectional input — `query()` exposes `.streamInput()` and `.interrupt()` (verified: https://code.claude.com/docs/en/agent-sdk/typescript). Build that only after Phase 2 is stable and only for that session class.
- **Never ship an approve button that doesn't approve.** A control that silently does nothing is worse than no control.

**Notifications:** native desktop notification on transition into `NEEDS_APPROVAL`, `NEEDS_INPUT`, or `ERROR`. Optional and off by default for `DONE` — the operator is watching the screen. Per-state toggles. Clicking a notification focuses that tile.

**Sound:** off by default, one optional distinct tone per attention state.

---

## 6. Resolve these before you write implementation code

Answer each with evidence. Report findings before proceeding. (Q8's OS half and the cloud-session scope question are settled — see Section 2.)

**Q1 (highest value).** Can a Cowork plugin carry hook definitions that execute inside a Cowork session? Docs confirm plugins carry hooks (`hooks/hooks.json`); they do not confirm execution inside Cowork. Build the smallest possible plugin with a single `type: "http"` hook, install it, and test **both session classes separately**: a desktop Cowork session and a cloud session started from mobile. Confirm whether the POST arrives from each. **If yes for both, Path A is the primary architecture. If it fails for cloud sessions specifically, the operator's day-one cloud requirement forces Path B (OTel) or another mechanism for that class — report immediately.**

**Q1b (new).** Capture one live payload per hook event you intend to consume, from a real session. Confirm which fields actually arrive — especially whether anything resembling `prompt_id`, `transcript_path`, or `permission_mode` exists, since the docs don't confirm them. Build the adapter against captured payloads, not documentation.

**Q2.** **Determine this yourself — do not ask him to look it up.** Does his account have Team or Enterprise plan access, and does he hold admin rights to configure the Cowork OTLP endpoint at Admin settings → Cowork? The operator was asked directly and answered "not sure" — so this is genuinely unknown, not merely undelegated. Check the account, check the plan, check whether the setting is reachable, and report a plain yes or no with what you found. If the answer is no, Path B is unavailable and the hook plugin plus local adapters carry the entire product — say so immediately, because it changes the plan. While you're there, record the installed desktop app version against the 1.17377 threshold (Section 3).

**Q3.** Is there any supported mechanism to send input into a running Cowork thread from outside the app? Search the docs; do not assume. A negative answer is a valid and useful finding.

**Q4.** Does any URL scheme or deep link open a specific *existing* thread in the Claude desktop app? `claude-cli://open` is documented but launches new terminal sessions only. Test undocumented candidates (e.g. `claude://` variants) and report what actually works. Expect a negative; the fallback in Section 5 is already specced.

**Q5.** What is the stable identity of a Cowork "thread" across hook `session_id`, OTel `session.id`, and what the operator sees in the sidebar? If these don't line up, the whole dashboard mislabels itself. Nail this before building tiles.

**Q6.** Do scheduled tasks and routines emit the same session events as interactive threads? The operator runs them and wants them visible.

**Q7.** For ChatGPT and Perplexity — determine current DOM selectors and state indicators for generating / complete / awaiting input, and design the extension so a selector change is a config edit rather than a code change.

**Q8.** Tauri vs Electron, for macOS on Apple Silicon (OS is settled). Recommend one. Weigh always-on-top behavior, native notifications, memory footprint on a machine already running the Claude desktop app, and packaging for a single user.

**Q9 (new).** Where does each Cowork session class actually execute — desktop-started sessions (sandboxed VM on the Mac?) versus mobile/cloud-started sessions (Anthropic's cloud)? For each: what can a hook or exporter inside that environment reach — host loopback, a tunnel hostname, the public internet? This determines whether one relay design serves both classes or the desktop class gets a cheaper local path.

---

## 7. Phased delivery

### Phase 0 — Research and spike
Answer Section 6. Deliver a written findings document with evidence, a recommended architecture, and an explicit statement of which capabilities you could not confirm.
**Accept when:** every question in Section 6 has a documented answer or a documented negative, and the operator has signed off on the architecture.

### Phase 1 — Vertical slice
One adapter (whichever Q1 proves out), **the relay (required — cloud sessions are day-one scope)**, the state engine, and a HUD showing real tiles for real threads.
**Accept when:** the operator starts three Cowork threads — **at least one of them from his phone** — and all three appear within five seconds with correct states; one finishing turns bright green and stays green until acknowledged; acknowledging removes it. Deliver the Claude Code onboarding page (Section 2.2) in this phase so he can drive Phase 2 from the CLI if he wants to.

### Phase 2 — Full Claude coverage
All Claude adapters wired: Cowork hooks, local Claude Code, OTel if Q2 came back positive. Subagent nesting. **Scheduled tasks and routines appearing as tiles — this is a requirement, not a nice-to-have; verify against Q6 before claiming the phase.** Notifications. Window persistence. Idle/stale filtering.
**Accept when:** the operator runs a full working day with the HUD as his only thread-tracking surface and does not return to the sidebar to find an active thread.

### Phase 3 — Multi-platform
Browser extension adapter for ChatGPT and Perplexity — both in daily use by the operator; this phase is confirmed, not speculative. Same tiles, same states, same grid, clearly badged by platform and marked as lower-confidence.
**Accept when:** an active ChatGPT thread and an active Perplexity thread appear alongside Claude threads and correctly report generating vs. complete.

### Phase 4 (optional, operator's call) — Deeper interaction
Approve and reply from inside the HUD, for whichever session classes Q3 proved a supported path. Do not start this without him asking for it. If Q3 came back negative for Cowork, present that finding and stop rather than engineering around it.

---

## 8. Anti-goals

Do not build any of these:
- A conversation viewer. The HUD shows status, not content. Reading happens in the source app.
- A general analytics or cost dashboard. Cost data is available from OTel; it is not the point of this tool and must not compete for grid space.
- A multi-user or hosted SaaS product.
- Anything that requires the operator to manually register or tag a thread for it to appear. Discovery is automatic or the tool has failed.
- A fabricated progress percentage.
- A cloud service that stores conversation content by default.
- Scraping claude.ai's private web API with extracted session cookies. It is fragile, it breaks without notice, and it is the wrong foundation for a tool used every day. If you conclude there is no alternative for a specific capability, surface that as a decision for the operator rather than building it quietly.

---

## 9. Definition of done

- Installs on the operator's machine with a documented, repeatable setup — including any plugin install, admin OTLP configuration, and relay deployment.
- Survives restarts of the HUD, the Claude desktop app, and the machine, with no lost or orphaned tiles — including sticky `DONE` states and pending acknowledgments (Section 4.3).
- Runs for eight hours with no memory growth and no runaway CPU.
- Every adapter fails independently and visibly. Losing one never blanks the grid or silently drops a platform.
- A README that states plainly which signals are explicit, which are inferred, and what breaks if a vendor changes their internals.
- Source in a single repo, typed, with the state engine covered by unit tests including every transition in Section 4.3.

---

## 10. Report format for every phase

```
WHAT SHIPPED
WHAT I VERIFIED (with URLs or captured responses)
WHAT I COULD NOT VERIFY
ASSUMPTIONS I MADE
WHAT BREAKS FIRST, AND WHY
NEXT PHASE — GO / NO-GO
```
