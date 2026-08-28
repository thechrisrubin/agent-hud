# Captured hook payloads — the adapter contract

**Source: live capture on CR's Mac, 2026-08-28. Claude Code CLI 2.1.250.**
Every field below was observed arriving at `127.0.0.1:43200`, not read from documentation.
Raw evidence: `probes/captured/events.ndjson`. Regenerate this view with `node probes/summarize-captures.mjs --all`.

This is the file the `claude-code-local` and `cowork-hook-plugin` adapters get built against. Where documentation and this file disagree, this file wins.

---

## Both classes produce the same payloads

Captured from **two** transports, and this is the headline: they are the same shape.

| Class | Transport | Sessions | `cwd` observed |
|---|---|---|---|
| Local Claude Code | loopback `127.0.0.1:43200` | 7 | the real project directory on the Mac |
| Cowork (all of it) | Cloudflare tunnel, from Anthropic's cloud | 5 | always `/home/claude` |

Every field listed below arrived identically from both. **The adapters differ only in transport and labelling — not one line of payload parsing needs to branch on class.** Against the brief's plan for two separately-designed adapters, that is a genuine simplification, and it is the strongest single argument for making the hook adapter the product's spine.

Two class-specific facts worth keeping:

- **`cwd` is the class discriminator, and it is more reliable than the source IP.** Cowork sessions always report `/home/claude`; local sessions report a real path on the Mac. Origin IP varies per session (five sessions, five different Anthropic addresses) and cannot be allowlisted.
- **Cowork `session_id`s are UUID **v5**** (`4603d1d5-aa0e-53dc-…`, `8138eb3a-3b9b-5a48-…` — note the `5` starting the third group), while local sessions are v4. A deterministic, namespace-derived identifier is a good sign for stability across reconnects, but nothing here proves it, so do not depend on it.

## Coverage

12 of the 14 events the HUD consumes were captured from the local class.

| Event | Captured | Notes |
|---|---|---|
| `SessionStart` | **NO** | Never fired across 6 headless (`claude -p`) sessions. See "SessionStart is not reliable" below. |
| `UserPromptSubmit` | yes | |
| `PreToolUse` | yes | |
| `PostToolUse` | yes | |
| `PostToolUseFailure` | yes | |
| `PermissionRequest` | yes | Interactive sessions only — see "Permission signals" below. |
| `Notification` | yes | |
| `TaskCreated` | yes | |
| `TaskCompleted` | yes | |
| `SubagentStart` | yes | |
| `SubagentStop` | yes | |
| `Stop` | yes | |
| `StopFailure` | **NO** | Could not be forced synthetically. Shape unverified — treat as `// UNVERIFIED`. |
| `SessionEnd` | yes | |

## The common envelope

Present on **every** captured event, without exception:

| Field | Type | Notes |
|---|---|---|
| `session_id` | UUID | The thread identity. Also the transcript filename. |
| `prompt_id` | UUID | Stable across all events of one turn. Documented as matching OTel `prompt.id`. |
| `transcript_path` | absolute path | Present even on events the docs don't promise it on. |
| `cwd` | absolute path | |
| `hook_event_name` | string | Duplicated in the HTTP body, not only in config. |

`permission_mode` is **not** universal — it is absent on `Notification`, `SessionEnd`, `SubagentStart`, `TaskCreated`, and `TaskCompleted`. Do not key logic to its presence.

`effort` (`{ level: "high" }`) appears on most tool- and turn-scoped events. Not needed by the HUD; noted so it isn't mistaken for a signal.

## Per-event fields beyond the envelope

```
UserPromptSubmit      permission_mode, prompt
PreToolUse            permission_mode, effort, tool_name, tool_input, tool_use_id
PostToolUse           permission_mode, effort, tool_name, tool_input, tool_use_id,
                      tool_response, duration_ms
PostToolUseFailure    permission_mode, effort, tool_name, tool_input, tool_use_id,
                      error, is_interrupt, duration_ms
PermissionRequest     permission_mode, effort, tool_name, tool_input
Notification          message, notification_type
TaskCreated           task_id, task_subject, task_description
TaskCompleted         task_id, task_subject, task_description
SubagentStart         agent_id, agent_type
SubagentStop          agent_id, agent_type, agent_transcript_path, permission_mode,
                      effort, last_assistant_message, stop_hook_active,
                      background_tasks, session_crons
Stop                  permission_mode, effort, last_assistant_message,
                      stop_hook_active, background_tasks, session_crons
SessionEnd            reason
```

---

## What this changes about the build

### 1. Subagent nesting is solved at the payload level
`SubagentStart` / `SubagentStop` carry the **parent's** `session_id` alongside the subagent's own `agent_id` and `agent_type`. That maps straight onto the brief's schema with no inference:

```
threadId       = agent_id
parentThreadId = session_id
```

`SubagentStop` additionally carries `agent_transcript_path`, pointing at
`…/<parent-session-id>/subagents/agent-<agent_id>.jsonl` — the parent/child relationship is encoded in the path too, so it survives even if a payload field is dropped in a future version.

### 2. `Notification` self-classifies — `NEEDS_INPUT` vs `NEEDS_APPROVAL` is explicit, not inferred
The brief worried these two states would be hard to separate. They aren't. `Notification` carries `notification_type`; the captured value for a permission prompt is:

```json
{ "message": "Claude needs your permission", "notification_type": "permission_prompt" }
```

**Rule:** `notification_type === "permission_prompt"` → `NEEDS_APPROVAL`; any other `notification_type` → `NEEDS_INPUT`. Unknown future values fall through to `NEEDS_INPUT` (the safer, less alarming of the two).

`PermissionRequest` fires ~6 seconds *before* the `Notification` for the same prompt and carries `tool_name` + `tool_input`, so the tile can say *what* is being approved, not just that something is.

### 3. `is_interrupt` prevents a whole class of false red tiles
`PostToolUseFailure` carries `is_interrupt`. A user pressing escape produces a tool failure that is **not** an error.

**Rule:** `PostToolUseFailure` → `ERROR` only when `is_interrupt === false`. When `is_interrupt === true`, return the thread to `IDLE` — CR stopped it on purpose. The `error` string is a plain-language message suitable for the tile ("File does not exist…"), so the HUD never has to invent error copy or show a trace.

### 4. Real progress is available, with real labels
`TaskCreated` / `TaskCompleted` carry `task_id`, `task_subject`, and `task_description`. That is an honest `n of m` **plus** the name of the current item — the tile can read "3 of 7 · alpha" rather than a fabricated percentage. This is Section 4.4 preference 1, confirmed live.

### 5. Two rosters arrive free on every turn end
`Stop` and `SubagentStop` both carry `background_tasks` and `session_crons` arrays (empty in these captures — no crons were scheduled). `session_crons` is a per-session roster of scheduled jobs, which is a second, independent route to Q6 alongside whatever the Cowork classes report. Worth reading on every `Stop`.

### 6. `last_assistant_message` gives the DONE tile its caption
Present on `Stop` and `SubagentStop`. The brief's spec wants "done · 4m ago"; this allows "done · <first line of the answer>" with no transcript parsing. It is also the docs' supported alternative to reading `transcript_path`, which lags.

---

## Two cautions the captures forced

### SessionStart is not reliable — do not create tiles on it
Across six `claude -p` sessions, `SessionStart` **never fired**, while `UserPromptSubmit`, `Stop`, and `SessionEnd` fired every time. Whether it fires for interactive sessions is untested (this session predates the capture server).

**Consequence, and it is a design rule, not a workaround:** the state engine must **create a tile lazily on the first event of any kind bearing an unseen `session_id`**, never on `SessionStart` specifically. Every event carries the full envelope, so any event is sufficient to open a tile. A design that waits for `SessionStart` would silently miss entire sessions.

This is also the safer design against the brief's Rule 6 — it survives a vendor renaming or re-scoping any single event.

### Permission signals exist only for interactive sessions
In headless (`-p`) runs, a tool that lacks permission is **denied outright with no `PermissionRequest` and no `Notification`** — the turn simply proceeds without the tool. Observed with `WebFetch` under `--permission-mode default`.

Also observed there: a `PreToolUse` fired with **no matching `PostToolUse`** for the blocked call. A dangling `PreToolUse` is therefore a real occurrence, so the state engine must not assume tool calls pair up. Pair on `tool_use_id`; treat an unpaired `PreToolUse` older than the stale threshold as ended, not as perpetually `WORKING`.

`NEEDS_APPROVAL` is consequently a signal the HUD can only ever show for interactive sessions. That is correct behaviour — a headless session genuinely cannot be approved — but it must be stated in the README rather than looking like a missing feature.

---

## Sample payloads (redacted to 40 chars on text fields)

### PreToolUse
```json
{
  "session_id": "c1e20b28-ef32-4bd5-803d-b098929a1e41",
  "transcript_path": "/Users/…/.claude/projects/<slug>/c1e20b28-….jsonl",
  "cwd": "/Users/…/agent-hud",
  "prompt_id": "93403f1e-d759-47ac-bb09-5da6634a2b9a",
  "permission_mode": "auto",
  "effort": { "level": "high" },
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "…", "description": "Check capture server health" },
  "tool_use_id": "toolu_013Mw6G67cexv9NLc2LQcDcb"
}
```

### PostToolUseFailure
```json
{
  "session_id": "35a5138c-64e1-4a67-aec5-c54fff18f367",
  "prompt_id": "7474bee8-1ce1-4209-beaf-cb8c9b93aec0",
  "permission_mode": "default",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Read",
  "tool_input": { "file_path": "/nonexistent/hud-probe.txt" },
  "tool_use_id": "toolu_01VcPsnNRqGpP6xSyLDL4Y6X",
  "error": "File does not exist. Note: your current working directory is …",
  "is_interrupt": false,
  "duration_ms": 5
}
```

### Notification
```json
{
  "session_id": "c1e20b28-ef32-4bd5-803d-b098929a1e41",
  "prompt_id": "93403f1e-d759-47ac-bb09-5da6634a2b9a",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission",
  "notification_type": "permission_prompt"
}
```

### SubagentStop
```json
{
  "session_id": "35a5138c-64e1-4a67-aec5-c54fff18f367",
  "prompt_id": "7474bee8-1ce1-4209-beaf-cb8c9b93aec0",
  "agent_id": "a6f3f012d473adcc9",
  "agent_type": "general-purpose",
  "agent_transcript_path": "/Users/…/projects/<slug>/35a5138c-…/subagents/agent-a6f3f012d473adcc9.jsonl",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "last_assistant_message": "ok",
  "background_tasks": [],
  "session_crons": []
}
```

### Stop
```json
{
  "session_id": "8b0e67d8-744f-4ec4-9cbc-fa602773db9c",
  "prompt_id": "6e181190-bf06-472f-968b-d15c0b15cb8b",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "hud-probe-headless-ok",
  "background_tasks": [],
  "session_crons": []
}
```

### TaskCreated
```json
{
  "session_id": "35a5138c-64e1-4a67-aec5-c54fff18f367",
  "prompt_id": "7474bee8-1ce1-4209-beaf-cb8c9b93aec0",
  "hook_event_name": "TaskCreated",
  "task_id": "1",
  "task_subject": "alpha",
  "task_description": "alpha"
}
```

### SessionEnd
```json
{
  "session_id": "8b0e67d8-744f-4ec4-9cbc-fa602773db9c",
  "prompt_id": "6e181190-bf06-472f-968b-d15c0b15cb8b",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

---

## Derived state table (local Claude Code class)

Built only from fields confirmed above. No inference where an explicit field exists.

| Event | Condition | State |
|---|---|---|
| any event, unseen `session_id` | — | create tile, `WORKING` |
| `UserPromptSubmit` | — | `WORKING` |
| `PreToolUse` / `PostToolUse` | — | `WORKING`, activity = `tool_name` |
| `PermissionRequest` | — | `NEEDS_APPROVAL`, detail = `tool_name` |
| `Notification` | `notification_type === "permission_prompt"` | `NEEDS_APPROVAL` |
| `Notification` | any other type | `NEEDS_INPUT`, detail = `message` |
| `PostToolUseFailure` | `is_interrupt === false` | `ERROR`, detail = `error` |
| `PostToolUseFailure` | `is_interrupt === true` | `IDLE` (deliberate stop, not a fault) |
| `TaskCreated` / `TaskCompleted` | — | `WORKING`, progress = completed/created, label = `task_subject` |
| `SubagentStart` | — | child tile under `session_id` |
| `SubagentStop` | — | child tile `DONE` |
| `Stop` | — | **`DONE`** (sticky until acknowledged) |
| `StopFailure` | — | `ERROR` — `// UNVERIFIED`, payload shape never observed |
| `SessionEnd` | — | terminal; if already `DONE`, stays `DONE` and sticky |
| no events for 10 min while `WORKING` | — | `STALE` |

Note the ordering hazard the captures revealed: `Stop` arrives ~180 ms before `SessionEnd`. Since `DONE` is sticky and outranks everything, `SessionEnd` must never downgrade a `DONE` tile. Sequence by `prompt_id` plus arrival order; `SessionEnd` is a lifecycle fact, not a state.
