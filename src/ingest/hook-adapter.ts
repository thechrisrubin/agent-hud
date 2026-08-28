// The hook adapter. Turns a raw Claude Code hook payload into a ThreadEvent.
//
// This is the ONLY file that knows what a hook payload looks like. Everything
// downstream speaks ThreadEvent. When Anthropic changes a field name, this
// file changes and nothing else does — that is the whole reason the boundary
// exists (brief rule 6: survive a vendor changing internals next Tuesday).
//
// Every mapping below traces to a payload captured live on 2026-08-28 and
// documented in docs/PHASE0-PAYLOADS.md. Nothing here is from documentation.

import type { EventKind, EventSource, ThreadEvent } from '../shared/types.js';

/** The raw shape, as observed. Everything optional — never trust a payload. */
export type RawHookPayload = {
  hook_event_name?: string;
  session_id?: string;
  prompt_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  error?: string;
  is_interrupt?: boolean;
  duration_ms?: number;
  message?: string;
  notification_type?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  reason?: string;
};

export type AdaptResult =
  | { ok: true; event: ThreadEvent }
  | { ok: false; reason: 'no_session_id' | 'unknown_event' | 'filtered_routine' };

/** Cowork sessions always report this. It is the class discriminator. */
const COWORK_CWD = '/home/claude';

export function sourceForCwd(cwd: string | undefined): EventSource {
  return cwd === COWORK_CWD ? 'cowork-hook' : 'claude-code-local';
}

function firstLine(s: string | undefined, max = 120): string | undefined {
  if (!s) return undefined;
  const line = s.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/**
 * Map a hook event name to a normalized kind.
 * Returns null for events the HUD does not consume.
 */
function kindFor(p: RawHookPayload): EventKind | null {
  switch (p.hook_event_name) {
    case 'SessionStart':
      return 'session_started';
    case 'UserPromptSubmit':
      return 'prompt_submitted';
    case 'PreToolUse':
      return 'tool_started';
    case 'PostToolUse':
      return 'tool_finished';

    // `is_interrupt` separates "the operator pressed escape" from "this broke".
    // Without it every deliberate stop would paint a red tile.
    case 'PostToolUseFailure':
      return p.is_interrupt === true ? 'interrupted' : 'error';

    case 'PermissionRequest':
      return 'permission_requested';

    // Notification self-classifies via notification_type — the observed value
    // for an approval prompt is "permission_prompt". Anything else is treated
    // as a question for the operator, which is the safer of the two states to
    // guess wrong: an unexpected amber tile costs a glance, a missed approval
    // costs a stalled thread.
    case 'Notification':
      return p.notification_type === 'permission_prompt'
        ? 'permission_requested'
        : 'input_requested';

    case 'TaskCreated':
      return 'task_created';
    case 'TaskCompleted':
      return 'task_completed';
    case 'SubagentStart':
      return 'subagent_started';
    case 'SubagentStop':
      return 'subagent_finished';
    case 'Stop':
      return 'turn_finished';

    // StopFailure's payload was never captured — it could not be forced
    // synthetically. Treated as an error on the assumption it carries the
    // common envelope, which every other event did. UNVERIFIED.
    case 'StopFailure':
      return 'error';

    case 'SessionEnd':
      return 'session_ended';

    // Synthetic, sent by the plugin's command hook purely to deliver a thread
    // name. It carries no state meaning, so it maps to a kind that changes
    // nothing — the title rides in on the same event and is applied by the
    // engine's title precedence rules.
    case 'ThreadTitle':
      return 'title_only';
    default:
      return null;
  }
}

/** Human-readable activity line for the tile. */
function activityFor(kind: EventKind, p: RawHookPayload): string | undefined {
  switch (kind) {
    case 'tool_started':
      return p.tool_name ? `running ${p.tool_name}` : 'running a tool';
    case 'tool_finished':
      return p.tool_name ? `finished ${p.tool_name}` : undefined;
    case 'permission_requested':
      return p.tool_name ? `waiting to approve ${p.tool_name}` : 'waiting for your approval';
    case 'input_requested':
      return firstLine(p.message) ?? 'waiting on your answer';
    case 'subagent_started':
      return p.agent_type ? `subagent ${p.agent_type} started` : 'subagent started';
    case 'prompt_submitted':
      return 'thinking';
    case 'error':
      return 'hit an error';
    case 'interrupted':
      return 'stopped by you';
    default:
      return undefined;
  }
}

export type AdaptOptions = {
  /**
   * The Claude app's conversation id, read from the X-Claude-Session header.
   * Not part of the payload — see the header note on EventDetail.appSessionId.
   */
  appSessionId?: string;
  /** The generated thread name, when the caller has resolved one. */
  aiTitle?: string;
  /** Routine slugs from ~/Documents/Claude/Scheduled. Used for filtering. */
  routineSlugs?: ReadonlySet<string>;
  hideRoutines?: boolean;
  /** Injected so tests are deterministic. */
  now?: () => string;
};

/**
 * Is this a scheduled routine firing rather than a thread the operator started?
 *
 * HONEST LIMITATION, and it matters: for Cowork sessions this is only
 * best-effort. A scheduled run was captured live and its payload is
 * BYTE-IDENTICAL IN SHAPE to an interactive thread — same fields, same
 * `cwd=/home/claude`. There is no marker to key on. The two signals below are
 * the only ones available:
 *
 *   1. `cwd` under the routines directory — reliable, but only ever true for
 *      LOCAL runs. Cloud routines always report /home/claude.
 *   2. Prompt text beginning with a known routine slug — a heuristic, and it
 *      will miss routines whose prompt does not name them.
 *
 * The probe that established this fired a one-off scheduled task, not one of
 * the operator's 21 real routines, so it remains possible that real routines
 * are distinguishable in a way this cannot yet see. Verify when one fires.
 * Until then, assume some routine tiles WILL leak through.
 */
export function looksLikeRoutine(p: RawHookPayload, slugs: ReadonlySet<string>): boolean {
  if (p.cwd && p.cwd.includes('/Documents/Claude/Scheduled/')) return true;
  if (slugs.size === 0) return false;
  const text = (p.prompt ?? '').toLowerCase();
  if (!text) return false;
  for (const slug of slugs) {
    // Match the slug as words ("daily briefing") or verbatim ("daily-briefing").
    if (text.includes(slug) || text.includes(slug.replace(/-/g, ' '))) return true;
  }
  return false;
}

export function adaptHookPayload(p: RawHookPayload, opts: AdaptOptions = {}): AdaptResult {
  const kind = kindFor(p);
  if (!kind) return { ok: false, reason: 'unknown_event' };

  // Every captured event carried session_id without exception. If it is
  // missing, the payload is not something we understand — drop it rather than
  // invent an identity and create a phantom tile.
  if (!p.session_id) return { ok: false, reason: 'no_session_id' };

  const slugs = opts.routineSlugs ?? new Set<string>();
  if (opts.hideRoutines && looksLikeRoutine(p, slugs)) {
    return { ok: false, reason: 'filtered_routine' };
  }

  const isSubagent = kind === 'subagent_started' || kind === 'subagent_finished';
  // Subagents are their own thread hanging off the parent's session_id.
  const threadId = isSubagent && p.agent_id ? p.agent_id : p.session_id;
  const parentThreadId = isSubagent && p.agent_id ? p.session_id : undefined;

  const now = opts.now ? opts.now() : new Date().toISOString();

  const event: ThreadEvent = {
    source: sourceForCwd(p.cwd),
    platform: 'claude',
    threadId,
    parentThreadId,
    seq: 0,
    ts: now,
    kind,
    detail: {
      activity: activityFor(kind, p),
      promptText: p.prompt,
      finalMessage: firstLine(p.last_assistant_message),
      // The captured `error` string is already plain language
      // ("File does not exist…"), so the HUD never invents error copy
      // and never shows a stack trace — brief §2.1.
      errorText: kind === 'error' ? firstLine(p.error, 200) : undefined,
      taskId: p.task_id,
      taskSubject: p.task_subject ?? p.task_description,
      agentType: p.agent_type,
      pendingTool: p.tool_name,
      cwd: p.cwd,
      appSessionId: opts.appSessionId,
      transcriptPath: p.transcript_path,
      aiTitle: opts.aiTitle,
    },
  };

  return { ok: true, event };
}
