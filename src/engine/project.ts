// Projection: engine state → what the screen shows.
//
// All display decisions live here, not in the renderer. The renderer's job is
// to paint what it is given. That means the grid can never disagree with the
// engine about what state a thread is in, and every rule below is testable
// without a browser.

import type { HudSnapshot, Thread, ThreadState, TileView } from '../shared/types.js';
import { isHiddenState, progressFor, stateSortOrder } from './state-engine.js';

function secondsBetween(fromIso: string, nowMs: number): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.round((nowMs - from) / 1000));
}

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * The activity line. Says what the thread is doing in plain words, and for a
 * finished thread says what it produced. Never a stack trace — brief §2.1.
 */
export function activityLineFor(t: Thread, nowMs: number): string {
  const age = humanDuration(secondsBetween(t.stateSince, nowMs));
  switch (t.state) {
    case 'NEEDS_APPROVAL':
      return t.pendingTool ? `waiting to approve ${t.pendingTool}` : 'waiting for your approval';
    case 'NEEDS_INPUT':
      return t.activity ?? 'waiting on your answer';
    case 'DONE':
      return t.finalMessage ? `done · ${t.finalMessage}` : `done · ${age} ago`;
    case 'ERROR':
      return t.errorText ?? 'stopped with an error';
    case 'STALE':
      return `no news for ${age}`;
    case 'IDLE':
      return t.activity === 'stopped by you' ? 'you stopped this' : 'idle';
    case 'WORKING':
    default:
      return t.activity ?? 'working';
  }
}

export function progressLabelFor(t: Thread, nowMs: number): string {
  const p = progressFor(t);
  if (p.kind === 'tasks') {
    const base = `${p.completed} of ${p.total}`;
    return p.label ? `${base} · ${p.label}` : base;
  }
  if (p.kind === 'steps') {
    return `${p.count} step${p.count === 1 ? '' : 's'}`;
  }
  // Elapsed time is the honest last resort. Never a fabricated percentage.
  return humanDuration(secondsBetween(t.stateSince, nowMs));
}

function toTile(t: Thread, nowMs: number, children: TileView[]): TileView {
  return {
    threadId: t.threadId,
    parentThreadId: t.parentThreadId,
    title: t.title,
    state: t.state,
    stateSince: t.stateSince,
    secondsInState: secondsBetween(t.stateSince, nowMs),
    platform: t.platform,
    source: t.source,
    lowConfidence: t.source === 'browser-ext',
    activityLine: activityLineFor(t, nowMs),
    progress: progressFor(t),
    progressLabel: progressLabelFor(t, nowMs),
    canAcknowledge: t.state === 'DONE' || t.state === 'ERROR',
    children,
  };
}

function sortTiles(a: TileView, b: TileView): number {
  const byState = stateSortOrder(a.state) - stateSortOrder(b.state);
  if (byState !== 0) return byState;
  // Within a group, most recently changed first — brief §5.
  return Date.parse(b.stateSince) - Date.parse(a.stateSince);
}

export type ProjectOptions = {
  showQuiet: boolean;
  connected: boolean;
  statusLine: string;
};

export function project(threads: Thread[], nowMs: number, opts: ProjectOptions): HudSnapshot {
  // Acknowledged tiles are gone from the grid. That is the self-cleaning
  // mechanism replacing 121 manually-pinned threads.
  const live = threads.filter((t) => !t.acknowledged);

  const childrenByParent = new Map<string, Thread[]>();
  for (const t of live) {
    if (!t.parentThreadId) continue;
    const list = childrenByParent.get(t.parentThreadId) ?? [];
    list.push(t);
    childrenByParent.set(t.parentThreadId, list);
  }

  const visible = (s: ThreadState) => opts.showQuiet || !isHiddenState(s);

  const tiles: TileView[] = [];
  let hiddenCount = 0;

  for (const t of live) {
    if (t.parentThreadId) continue; // rendered nested under its parent
    if (!visible(t.state)) {
      hiddenCount += 1;
      continue;
    }
    const kids = (childrenByParent.get(t.threadId) ?? [])
      .map((c) => toTile(c, nowMs, []))
      .sort(sortTiles);
    tiles.push(toTile(t, nowMs, kids));
  }

  // A subagent whose parent we never saw would otherwise be invisible. Promote
  // it rather than drop it — a missing tile is the one failure the operator
  // cannot detect for himself.
  for (const t of live) {
    if (!t.parentThreadId) continue;
    if (threads.some((p) => p.threadId === t.parentThreadId)) continue;
    if (!visible(t.state)) {
      hiddenCount += 1;
      continue;
    }
    tiles.push(toTile(t, nowMs, []));
  }

  tiles.sort(sortTiles);
  return { tiles, hiddenCount, connected: opts.connected, statusLine: opts.statusLine };
}
