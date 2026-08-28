// The state engine. Deterministic, pure, and the only thing that decides
// what colour a tile is.
//
// Two design commitments, both from brief §4.3:
//
//   1. DONE IS STICKY. It does not time out, fade, or auto-clear. Only an
//      explicit acknowledgement removes it. This rule outranks everything
//      else in this file — if you are changing behaviour here and a test
//      about DONE fails, the test is right and you are wrong.
//
//   2. NO WALL CLOCK. Every method that needs "now" is given it. The engine
//      never calls Date.now(). That is what makes the stale timeout and
//      time-in-state testable without sleeping.

import type {
  EventKind,
  EventSource,
  Progress,
  Thread,
  ThreadEvent,
  ThreadState,
  StateTransition,
} from '../shared/types.js';

/** Brief §4.3: 10 minutes without events while WORKING. Hard-coded by design. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

/** Grid order, brief §5. Lower sorts first. */
const STATE_SORT_ORDER: Record<ThreadState, number> = {
  NEEDS_APPROVAL: 0,
  NEEDS_INPUT: 1,
  DONE: 2,
  WORKING: 3,
  ERROR: 4,
  STALE: 5,
  IDLE: 6,
};

/** Adapter precedence, brief §4.3: hooks > DOM. OTel is gone (Q2 negative). */
const SOURCE_RANK: Record<EventSource, number> = {
  'cowork-hook': 2,
  'claude-code-local': 2,
  'browser-ext': 1,
};

/** Hidden from the main grid by default. Brief §4.3. */
const HIDDEN_STATES: ReadonlySet<ThreadState> = new Set<ThreadState>(['IDLE', 'STALE']);

export function isHiddenState(s: ThreadState): boolean {
  return HIDDEN_STATES.has(s);
}

export function stateSortOrder(s: ThreadState): number {
  return STATE_SORT_ORDER[s];
}

/** Every Cowork session reports this working directory, without exception. */
export const COWORK_CWD = '/home/claude';

const MAX_HISTORY = 200;
const TITLE_MAX = 90;

/** A tile with no name is a tile the operator cannot identify. Always find one. */
export const PLACEHOLDER_TITLE = 'Untitled thread';

function deriveTitle(ev: ThreadEvent): string {
  if (ev.detail.promptText) {
    const oneLine = ev.detail.promptText.replace(/\s+/g, ' ').trim();
    return oneLine.length > TITLE_MAX ? oneLine.slice(0, TITLE_MAX - 1) + '…' : oneLine;
  }
  // `agent_type` is frequently an empty string on SubagentStop, in BOTH
  // classes — 8 of the 9 subagent events captured in Phase 0 carried '',
  // including local ones. Only a paired SubagentStart/Stop reliably names the
  // agent. So the field can inform a title but must never be required for one.
  const agentType = ev.detail.agentType?.trim();
  if (agentType) return `subagent · ${agentType}`;
  if (ev.parentThreadId) return 'subagent';

  // The HUD frequently starts watching a session mid-flight, so the first
  // event it sees is often a tool call with no prompt attached.
  const cwd = ev.detail.cwd;
  if (cwd === COWORK_CWD) {
    // Every Cowork session reports /home/claude, which identifies nothing, and
    // no other field carries a name. The tile stays anonymous until the
    // operator's next message in that thread supplies one — so say what it is
    // rather than "Untitled", which reads like a bug.
    return 'Claude thread';
  }
  if (cwd) {
    // A local session's folder name is how the operator thinks about the work.
    const folder = cwd.split('/').filter(Boolean).pop();
    if (folder) return folder;
  }
  return PLACEHOLDER_TITLE;
}

/**
 * What state does this event kind imply on its own?
 * `null` means "this event does not change state" — it only updates detail.
 */
function impliedState(kind: EventKind): ThreadState | null {
  switch (kind) {
    case 'session_started':
    case 'prompt_submitted':
    case 'tool_started':
    case 'tool_finished':
    case 'subagent_started':
      return 'WORKING';
    case 'permission_requested':
      return 'NEEDS_APPROVAL';
    case 'input_requested':
      return 'NEEDS_INPUT';
    case 'turn_finished':
    case 'subagent_finished':
      return 'DONE';
    case 'error':
      return 'ERROR';
    // A deliberate stop by the operator is not a fault. Brief-adjacent, but
    // forced by the captured `is_interrupt` field — see PHASE0-PAYLOADS.md.
    case 'interrupted':
      return 'IDLE';
    // Lifecycle facts, not states. `session_ended` is handled specially below
    // because it must never downgrade a sticky DONE.
    case 'session_ended':
      return null;
    case 'task_created':
    case 'task_completed':
      return 'WORKING';
    default:
      return null;
  }
}

export class StateEngine {
  private threads = new Map<string, Thread>();
  private seqCounter = 0;

  /** Restore from a persisted snapshot. Used at startup. */
  load(threads: Thread[], now: string): void {
    for (const t of threads) {
      this.threads.set(t.threadId, t);
      this.seqCounter = Math.max(this.seqCounter, t.seq);
    }
    // Record that these came back from disk rather than from live events, so
    // the history doesn't silently imply the engine saw them happen.
    for (const t of this.threads.values()) {
      t.history.push({ state: t.state, at: now, because: 'restored' });
      trimHistory(t);
    }
  }

  all(): Thread[] {
    return [...this.threads.values()];
  }

  get(threadId: string): Thread | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Apply one normalized event. This is the only way state changes.
   * Returns the affected thread so callers can react to transitions.
   */
  apply(ev: ThreadEvent): Thread {
    const existing = this.threads.get(ev.threadId);
    const thread = existing ?? this.createThread(ev);

    // Lower-precedence sources never overwrite a higher-precedence thread's
    // state. Detail still updates — a weaker source can inform, not decide.
    const outranked = SOURCE_RANK[ev.source] < SOURCE_RANK[thread.source];

    thread.lastEventAt = ev.ts;
    thread.seq = ++this.seqCounter;
    this.applyDetail(thread, ev);

    // An acknowledged thread that speaks again is genuinely alive. It returns
    // to the grid with a fresh history — acknowledgement clears a tile, it
    // never blacklists a thread. Brief §4.3.
    if (thread.acknowledged) {
      thread.acknowledged = false;
      thread.history = [];
      thread.tasks = { created: [], completed: [] };
      thread.stepCount = 0;
    }

    if (outranked) return thread;

    const next = this.nextState(thread, ev);
    if (next && next !== thread.state) {
      this.transition(thread, next, ev.ts, ev.kind);
    }
    return thread;
  }

  private nextState(thread: Thread, ev: ThreadEvent): ThreadState | null {
    // THE STICKY DONE RULE. `session_ended` arrives ~180ms after the `Stop`
    // that produced DONE (measured, see PHASE0-PAYLOADS.md). Without this
    // guard every finished thread would immediately fall out of green and
    // the product's single most important promise would be broken.
    if (ev.kind === 'session_ended') {
      return thread.state === 'DONE' ? null : 'IDLE';
    }
    return impliedState(ev.kind);
  }

  private applyDetail(thread: Thread, ev: ThreadEvent): void {
    const d = ev.detail;
    if (d.cwd) thread.cwd = d.cwd;
    if (d.activity) thread.activity = d.activity;
    if (d.finalMessage) thread.finalMessage = d.finalMessage;

    if (ev.kind === 'tool_finished') thread.stepCount += 1;

    if (ev.kind === 'permission_requested') {
      thread.pendingTool = d.pendingTool;
    } else if (ev.kind !== 'input_requested') {
      // Any other activity means whatever was blocking is no longer pending.
      thread.pendingTool = undefined;
    }

    if (ev.kind === 'error') {
      thread.errorText = d.errorText ?? 'Something went wrong.';
    } else if (ev.kind === 'prompt_submitted' || ev.kind === 'tool_started') {
      thread.errorText = undefined;
    }

    if (ev.kind === 'task_created' && d.taskId) {
      if (!thread.tasks.created.includes(d.taskId)) thread.tasks.created.push(d.taskId);
      if (d.taskSubject) thread.tasks.lastLabel = d.taskSubject;
    }
    if (ev.kind === 'task_completed' && d.taskId) {
      if (!thread.tasks.completed.includes(d.taskId)) thread.tasks.completed.push(d.taskId);
      if (!thread.tasks.created.includes(d.taskId)) thread.tasks.created.push(d.taskId);
      if (d.taskSubject) thread.tasks.lastLabel = d.taskSubject;
    }

    // A thread that arrived first as a subagent event may learn its parent late.
    if (ev.parentThreadId && !thread.parentThreadId) {
      thread.parentThreadId = ev.parentThreadId;
    }
    // The title comes from the FIRST prompt and then stays put — a tile that
    // renames itself mid-flight is a tile the operator loses track of. But a
    // fallback title (placeholder, or the folder name) is not a real title, so
    // the first genuine prompt is always allowed to replace it.
    if (ev.detail.promptText && !thread.titleFromPrompt) {
      thread.title = deriveTitle(ev);
      thread.titleFromPrompt = true;
    }
  }

  private createThread(ev: ThreadEvent): Thread {
    // LAZY CREATION. Any event opens a tile — never SessionStart specifically,
    // which was observed to not fire at all (6 headless sessions, 0 events).
    // A design that waited for a session-open event would lose whole sessions.
    const thread: Thread = {
      threadId: ev.threadId,
      parentThreadId: ev.parentThreadId,
      source: ev.source,
      platform: ev.platform,
      title: deriveTitle(ev),
      titleFromPrompt: Boolean(ev.detail.promptText),
      state: 'WORKING',
      stateSince: ev.ts,
      history: [{ state: 'WORKING', at: ev.ts, because: ev.kind }],
      lastEventAt: ev.ts,
      seq: 0,
      cwd: ev.detail.cwd,
      tasks: { created: [], completed: [] },
      stepCount: 0,
      acknowledged: false,
    };
    this.threads.set(ev.threadId, thread);
    return thread;
  }

  private transition(
    thread: Thread,
    to: ThreadState,
    at: string,
    because: StateTransition['because'],
  ): void {
    thread.state = to;
    thread.stateSince = at;
    thread.history.push({ state: to, at, because });
    trimHistory(thread);
  }

  /**
   * Advance time. Moves silent WORKING threads to STALE.
   * Called on a timer by the host, and directly by tests.
   *
   * Note what is NOT here: DONE never goes stale, ERROR never goes stale, and
   * a thread awaiting input never goes stale. A thread that has been waiting
   * on the operator for an hour is still waiting on the operator.
   */
  tick(nowMs: number): Thread[] {
    const changed: Thread[] = [];
    for (const t of this.threads.values()) {
      if (t.state !== 'WORKING') continue;
      const last = Date.parse(t.lastEventAt);
      if (Number.isNaN(last)) continue;
      if (nowMs - last >= STALE_AFTER_MS) {
        this.transition(t, 'STALE', new Date(nowMs).toISOString(), 'stale_timeout');
        changed.push(t);
      }
    }
    return changed;
  }

  /**
   * Acknowledge a DONE thread. This is the self-cleaning mechanism that
   * replaces manual unpinning, so it is deliberately narrow: only DONE and
   * ERROR tiles can be acknowledged. Acknowledging something still running
   * would hide live work, which is the one thing the HUD must never do.
   */
  acknowledge(threadId: string): boolean {
    const t = this.threads.get(threadId);
    if (!t) return false;
    if (t.state !== 'DONE' && t.state !== 'ERROR') return false;
    t.acknowledged = true;
    return true;
  }

  /** Drop a thread entirely. Used only by explicit operator action. */
  forget(threadId: string): boolean {
    return this.threads.delete(threadId);
  }
}

function trimHistory(t: Thread): void {
  if (t.history.length > MAX_HISTORY) {
    t.history = t.history.slice(-MAX_HISTORY);
  }
}

/**
 * Progress, in the brief's order of preference (§4.4):
 *   1. real task-list completion, 2. step count, 3. elapsed time.
 * There is no fourth option that invents a percentage.
 */
export function progressFor(t: Thread): Progress {
  if (t.tasks.created.length > 0) {
    return {
      kind: 'tasks',
      completed: t.tasks.completed.length,
      total: t.tasks.created.length,
      label: t.tasks.lastLabel,
    };
  }
  if (t.stepCount > 0) return { kind: 'steps', count: t.stepCount };
  return { kind: 'elapsed' };
}
