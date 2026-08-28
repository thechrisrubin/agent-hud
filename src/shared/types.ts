// The contract every layer agrees on.
//
// Adapters emit ThreadEvent and nothing else. The state engine consumes
// ThreadEvent and nothing else. Neither knows what a hook payload looks like.
// That boundary is the whole point: when a vendor changes their internals,
// exactly one file changes (the adapter), and the engine and its tests do not.
//
// Field shapes here are grounded in docs/PHASE0-PAYLOADS.md — captured live,
// not read from documentation.

/** Where an event physically came from. Determines adapter precedence. */
export type EventSource =
  | 'cowork-hook' // Cowork sessions (all of them run in Anthropic's cloud)
  | 'claude-code-local' // Claude Code CLI on this Mac, via loopback
  | 'browser-ext'; // Phase 3 only. Declared so precedence has a place to live.

export type Platform = 'claude' | 'chatgpt' | 'perplexity';

/**
 * Normalized event kinds. Deliberately smaller than the 14 hook events —
 * several hook events collapse to one kind because the HUD treats them
 * identically. The adapter does that collapsing so the engine stays small.
 */
export type EventKind =
  | 'session_started'
  | 'prompt_submitted'
  | 'tool_started'
  | 'tool_finished'
  | 'permission_requested'
  | 'input_requested'
  | 'task_created'
  | 'task_completed'
  | 'subagent_started'
  | 'subagent_finished'
  | 'turn_finished'
  | 'session_ended'
  | 'error'
  | 'interrupted';

export type ThreadEvent = {
  source: EventSource;
  platform: Platform;
  /** Stable per thread. `session_id` for sessions, `agent_id` for subagents. */
  threadId: string;
  /** Set only for subagents. The parent's `session_id`. */
  parentThreadId?: string;
  /** Monotonic per thread, assigned on arrival. Used only for ordering ties. */
  seq: number;
  /** ISO 8601, assigned on arrival — hook payloads carry no timestamp. */
  ts: string;
  kind: EventKind;
  /** Everything the tile might want to display. Never raw vendor payload. */
  detail: EventDetail;
};

export type EventDetail = {
  /** Human-readable summary of what's happening: "running Bash". */
  activity?: string;
  /** First prompt text, used to derive the tile title. */
  promptText?: string;
  /** Final assistant message, used for the DONE caption. */
  finalMessage?: string;
  /** Plain-language error text. Never a stack trace — see brief §2.1. */
  errorText?: string;
  /** Task list item identity, for honest n-of-m progress. */
  taskId?: string;
  taskSubject?: string;
  /** Subagent descriptor, e.g. "general-purpose". */
  agentType?: string;
  /** What is being approved, e.g. "WebFetch". */
  pendingTool?: string;
  /** Working directory. The class discriminator: /home/claude means Cowork. */
  cwd?: string;
};

/**
 * The seven states from brief §4.3. Order here is not display order —
 * see STATE_SORT_ORDER in the engine.
 */
export type ThreadState =
  | 'WORKING'
  | 'NEEDS_INPUT'
  | 'NEEDS_APPROVAL'
  | 'DONE'
  | 'ERROR'
  | 'STALE'
  | 'IDLE';

/** One entry in a thread's state history. Every transition is timestamped. */
export type StateTransition = {
  state: ThreadState;
  at: string;
  /** Why this transition happened, for the record and for debugging. */
  because: EventKind | 'stale_timeout' | 'restored';
};

/** Progress, only ever from a real source. Never fabricated — brief §4.4. */
export type Progress =
  | { kind: 'tasks'; completed: number; total: number; label?: string }
  | { kind: 'steps'; count: number }
  | { kind: 'elapsed' };

export type Thread = {
  threadId: string;
  parentThreadId?: string;
  source: EventSource;
  platform: Platform;
  title: string;
  /** True once a real prompt named this thread. Fallback titles do not count. */
  titleFromPrompt: boolean;
  state: ThreadState;
  /** When the current state was entered. Drives "time in state" on the tile. */
  stateSince: string;
  history: StateTransition[];
  lastEventAt: string;
  seq: number;
  activity?: string;
  finalMessage?: string;
  errorText?: string;
  pendingTool?: string;
  cwd?: string;
  /** Task list state, if the thread uses one. */
  tasks: { created: string[]; completed: string[]; lastLabel?: string };
  /** Tool calls completed this turn — the honest step counter. */
  stepCount: number;
  /** Set when the operator acknowledges a DONE tile. Hidden until it revives. */
  acknowledged: boolean;
};

/**
 * What the renderer receives. A flat, display-ready projection —
 * the renderer contains no state logic and cannot disagree with the engine.
 */
export type TileView = {
  threadId: string;
  parentThreadId?: string;
  title: string;
  state: ThreadState;
  stateSince: string;
  secondsInState: number;
  platform: Platform;
  source: EventSource;
  /** True when the state was inferred rather than read from an explicit event. */
  lowConfidence: boolean;
  activityLine: string;
  progress: Progress;
  progressLabel: string;
  canAcknowledge: boolean;
  children: TileView[];
};

export type HudSnapshot = {
  tiles: TileView[];
  hiddenCount: number;
  connected: boolean;
  /** Plain-language ingest status for the status bar. Never a stack trace. */
  statusLine: string;
};
