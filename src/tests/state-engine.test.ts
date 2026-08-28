// State engine tests. Written before the UI, per brief §4.3.
//
// Coverage target: every transition in the brief's state table, plus the
// three rules the live captures forced on us (lazy creation, is_interrupt,
// DONE surviving session_ended).
//
// The operator cannot read this file, and there is no second engineer on this
// project. These tests are the only thing standing between a wrong colour and
// him trusting a tile that is lying to him.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StateEngine, STALE_AFTER_MS, progressFor } from '../engine/state-engine.js';
import type { EventKind, ThreadEvent } from '../shared/types.js';

const T0 = '2026-08-28T12:00:00.000Z';
const t = (offsetMs: number) => new Date(Date.parse(T0) + offsetMs).toISOString();

function ev(kind: EventKind, over: Partial<ThreadEvent> = {}): ThreadEvent {
  return {
    source: 'cowork-hook',
    platform: 'claude',
    threadId: 'thread-1',
    seq: 0,
    ts: T0,
    kind,
    detail: {},
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tile creation
// ---------------------------------------------------------------------------

test('any first event creates a tile in WORKING — never waits for a session-open event', () => {
  // SessionStart was observed to never fire (6 headless sessions, 0 events),
  // so tile creation must not depend on it.
  for (const kind of ['tool_started', 'turn_finished', 'permission_requested'] as EventKind[]) {
    const e = new StateEngine();
    e.apply(ev(kind, { threadId: `t-${kind}` }));
    assert.equal(e.get(`t-${kind}`)!.threadId, `t-${kind}`, `${kind} should open a tile`);
  }
});

test('title derives from the first prompt, collapsed and truncated', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted', { detail: { promptText: '  run   the\nthing  ' } }));
  assert.equal(e.get('thread-1')!.title, 'run the thing');

  const e2 = new StateEngine();
  e2.apply(ev('prompt_submitted', { detail: { promptText: 'x'.repeat(200) } }));
  const title = e2.get('thread-1')!.title;
  assert.equal(title.length, 90);
  assert.ok(title.endsWith('…'));
});

// ---------------------------------------------------------------------------
// The brief's state table
// ---------------------------------------------------------------------------

test('each event kind maps to the specified state', () => {
  const cases: Array<[EventKind, string]> = [
    ['prompt_submitted', 'WORKING'],
    ['tool_started', 'WORKING'],
    ['tool_finished', 'WORKING'],
    ['permission_requested', 'NEEDS_APPROVAL'],
    ['input_requested', 'NEEDS_INPUT'],
    ['turn_finished', 'DONE'],
    ['subagent_finished', 'DONE'],
    ['error', 'ERROR'],
    ['interrupted', 'IDLE'],
  ];
  for (const [kind, expected] of cases) {
    const e = new StateEngine();
    e.apply(ev('prompt_submitted'));
    e.apply(ev(kind, { ts: t(1000) }));
    assert.equal(e.get('thread-1')!.state, expected, `${kind} should give ${expected}`);
  }
});

test('NEEDS_APPROVAL and NEEDS_INPUT stay distinct — they demand different responses', () => {
  const e = new StateEngine();
  e.apply(ev('permission_requested', { detail: { pendingTool: 'WebFetch' } }));
  assert.equal(e.get('thread-1')!.state, 'NEEDS_APPROVAL');
  assert.equal(e.get('thread-1')!.pendingTool, 'WebFetch');

  const e2 = new StateEngine();
  e2.apply(ev('input_requested', { threadId: 'x' }));
  assert.equal(e2.get('x')!.state, 'NEEDS_INPUT');
});

// ---------------------------------------------------------------------------
// DONE is sticky. The most important rule in the spec.
// ---------------------------------------------------------------------------

test('DONE survives session_ended arriving milliseconds later', () => {
  // Measured live: Stop → SessionEnd is ~180ms. Without the guard, every
  // finished thread would drop out of green almost immediately.
  const e = new StateEngine();
  e.apply(ev('prompt_submitted'));
  e.apply(ev('turn_finished', { ts: t(1000) }));
  assert.equal(e.get('thread-1')!.state, 'DONE');
  e.apply(ev('session_ended', { ts: t(1180) }));
  assert.equal(e.get('thread-1')!.state, 'DONE', 'session_ended must never downgrade DONE');
});

test('DONE never times out, however long it waits', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished'));
  e.tick(Date.parse(T0) + STALE_AFTER_MS * 100);
  assert.equal(e.get('thread-1')!.state, 'DONE');
});

test('session_ended on a thread that never finished gives IDLE, not DONE', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started'));
  e.apply(ev('session_ended', { ts: t(500) }));
  assert.equal(e.get('thread-1')!.state, 'IDLE');
});

test('acknowledging removes a DONE tile; a new event revives it with fresh history', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted'));
  e.apply(ev('turn_finished', { ts: t(10) }));

  assert.equal(e.acknowledge('thread-1'), true);
  assert.equal(e.get('thread-1')!.acknowledged, true);

  e.apply(ev('prompt_submitted', { ts: t(20) }));
  const th = e.get('thread-1')!;
  assert.equal(th.acknowledged, false, 'acknowledgement clears a tile, never blacklists a thread');
  assert.equal(th.state, 'WORKING');
  assert.equal(th.history.length, 1, 'revived thread starts a fresh history');
});

test('only finished or failed threads can be acknowledged — never live work', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started'));
  assert.equal(e.acknowledge('thread-1'), false, 'a WORKING thread must not be dismissable');

  e.apply(ev('error', { ts: t(10), detail: { errorText: 'boom' } }));
  assert.equal(e.acknowledge('thread-1'), true, 'ERROR tiles are dismissable');

  assert.equal(e.acknowledge('nope'), false);
});

// ---------------------------------------------------------------------------
// The interrupt rule — forced by the captured `is_interrupt` field
// ---------------------------------------------------------------------------

test('an interrupted thread goes IDLE, not ERROR', () => {
  // Pressing escape is a deliberate stop, not a fault. Painting it red would
  // cry wolf every time the operator changes his mind.
  const e = new StateEngine();
  e.apply(ev('tool_started'));
  e.apply(ev('interrupted', { ts: t(10) }));
  assert.equal(e.get('thread-1')!.state, 'IDLE');
});

test('a real tool failure does go ERROR, and carries plain-language text', () => {
  const e = new StateEngine();
  e.apply(ev('error', { detail: { errorText: 'File does not exist.' } }));
  const th = e.get('thread-1')!;
  assert.equal(th.state, 'ERROR');
  assert.equal(th.errorText, 'File does not exist.');
});

test('an error is cleared when work resumes', () => {
  const e = new StateEngine();
  e.apply(ev('error', { detail: { errorText: 'boom' } }));
  e.apply(ev('prompt_submitted', { ts: t(10) }));
  assert.equal(e.get('thread-1')!.errorText, undefined);
  assert.equal(e.get('thread-1')!.state, 'WORKING');
});

// ---------------------------------------------------------------------------
// Stale
// ---------------------------------------------------------------------------

test('WORKING goes STALE after the threshold, but not one millisecond before', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started'));

  e.tick(Date.parse(T0) + STALE_AFTER_MS - 1);
  assert.equal(e.get('thread-1')!.state, 'WORKING');

  e.tick(Date.parse(T0) + STALE_AFTER_MS);
  assert.equal(e.get('thread-1')!.state, 'STALE');
});

test('a thread waiting on the operator never goes stale', () => {
  // He may not answer for an hour. It is still waiting on him, and hiding it
  // would lose exactly the tile he most needs to see.
  for (const kind of ['permission_requested', 'input_requested'] as EventKind[]) {
    const e = new StateEngine();
    e.apply(ev(kind));
    e.tick(Date.parse(T0) + STALE_AFTER_MS * 10);
    assert.notEqual(e.get('thread-1')!.state, 'STALE', `${kind} must not go stale`);
  }
});

test('activity on a stale thread brings it back', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started'));
  e.tick(Date.parse(T0) + STALE_AFTER_MS);
  assert.equal(e.get('thread-1')!.state, 'STALE');
  e.apply(ev('tool_started', { ts: t(STALE_AFTER_MS + 5) }));
  assert.equal(e.get('thread-1')!.state, 'WORKING');
});

// ---------------------------------------------------------------------------
// Progress — never fabricated
// ---------------------------------------------------------------------------

test('task list gives a real n-of-m with a label', () => {
  const e = new StateEngine();
  e.apply(ev('task_created', { detail: { taskId: '1', taskSubject: 'alpha' } }));
  e.apply(ev('task_created', { ts: t(1), detail: { taskId: '2', taskSubject: 'beta' } }));
  e.apply(ev('task_completed', { ts: t(2), detail: { taskId: '1', taskSubject: 'alpha' } }));

  const p = progressFor(e.get('thread-1')!);
  assert.deepEqual(p, { kind: 'tasks', completed: 1, total: 2, label: 'alpha' });
});

test('duplicate task events do not inflate the count', () => {
  const e = new StateEngine();
  e.apply(ev('task_created', { detail: { taskId: '1' } }));
  e.apply(ev('task_created', { ts: t(1), detail: { taskId: '1' } }));
  const p = progressFor(e.get('thread-1')!);
  assert.equal(p.kind === 'tasks' && p.total, 1);
});

test('a completion for an unseen task still counts toward the total', () => {
  // Events can be missed. n-of-m must never read "1 of 0".
  const e = new StateEngine();
  e.apply(ev('task_completed', { detail: { taskId: '7' } }));
  const p = progressFor(e.get('thread-1')!);
  assert.deepEqual(p, { kind: 'tasks', completed: 1, total: 1, label: undefined });
});

test('without a task list, progress falls back to steps then elapsed', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted'));
  assert.equal(progressFor(e.get('thread-1')!).kind, 'elapsed');
  e.apply(ev('tool_finished', { ts: t(1) }));
  assert.deepEqual(progressFor(e.get('thread-1')!), { kind: 'steps', count: 1 });
});

// ---------------------------------------------------------------------------
// Subagents and precedence
// ---------------------------------------------------------------------------

test('a subagent is its own thread carrying its parent', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted', { threadId: 'parent' }));
  e.apply(
    ev('subagent_started', {
      threadId: 'agent-a',
      parentThreadId: 'parent',
      detail: { agentType: 'general-purpose' },
    }),
  );
  const child = e.get('agent-a')!;
  assert.equal(child.parentThreadId, 'parent');
  assert.equal(child.title, 'subagent · general-purpose');
  assert.equal(e.get('parent')!.state, 'WORKING', 'a child finishing must not finish its parent');
});

test('a lower-precedence source cannot overwrite a hook-sourced state', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished'));
  assert.equal(e.get('thread-1')!.state, 'DONE');
  e.apply(ev('tool_started', { ts: t(10), source: 'browser-ext' }));
  assert.equal(e.get('thread-1')!.state, 'DONE', 'DOM inference must not beat an explicit hook');
});

// ---------------------------------------------------------------------------
// History and restore
// ---------------------------------------------------------------------------

test('every transition is timestamped and recorded', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted'));
  e.apply(ev('permission_requested', { ts: t(10) }));
  e.apply(ev('turn_finished', { ts: t(20) }));

  const h = e.get('thread-1')!.history;
  assert.deepEqual(h.map((x) => x.state), ['WORKING', 'NEEDS_APPROVAL', 'DONE']);
  assert.equal(h[2]!.at, t(20));
  assert.equal(h[2]!.because, 'turn_finished');
});

test('repeated events of the same state do not spam history', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started'));
  e.apply(ev('tool_started', { ts: t(1) }));
  e.apply(ev('tool_started', { ts: t(2) }));
  assert.equal(e.get('thread-1')!.history.length, 1);
});

test('a restored thread keeps its state and is marked as restored', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished'));
  const saved = e.all();

  const revived = new StateEngine();
  revived.load(JSON.parse(JSON.stringify(saved)), t(5000));
  const th = revived.get('thread-1')!;
  assert.equal(th.state, 'DONE', 'sticky DONE must survive a restart');
  assert.equal(th.history.at(-1)!.because, 'restored');
});

test('a pending acknowledgement survives a restart', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished'));
  e.acknowledge('thread-1');

  const revived = new StateEngine();
  revived.load(JSON.parse(JSON.stringify(e.all())), t(1));
  assert.equal(revived.get('thread-1')!.acknowledged, true);
});

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

test('a thread first seen mid-flight is named after its folder, not "Untitled"', () => {
  // The HUD is usually started while sessions are already running, so the
  // first event it sees often has no prompt attached.
  const e = new StateEngine();
  e.apply(ev('tool_started', { detail: { cwd: '/Users/chris.rubin/projects/agent-hud' } }));
  assert.equal(e.get('thread-1')!.title, 'agent-hud');
});

test('a Cowork thread joined mid-flight says what it is, not "Untitled"', () => {
  // Every Cowork session reports /home/claude, and no other field carries a
  // name, so a tile joined mid-flight stays anonymous until the operator's
  // next message. "Untitled thread" reads like a bug; "Claude thread" reads
  // like a fact.
  const e = new StateEngine();
  e.apply(ev('tool_started', { detail: { cwd: '/home/claude' } }));
  assert.equal(e.get('thread-1')!.title, 'Claude thread');
});

test('a subagent is named even when agent_type is empty', () => {
  // Cowork subagents report an empty agent_type; local ones send a real value.
  const e = new StateEngine();
  e.apply(ev('subagent_finished', { threadId: 'kid', parentThreadId: 'mum', detail: { agentType: '' } }));
  assert.equal(e.get('kid')!.title, 'subagent');

  const e2 = new StateEngine();
  e2.apply(ev('subagent_started', { threadId: 'kid2', parentThreadId: 'mum', detail: { agentType: 'general-purpose' } }));
  assert.equal(e2.get('kid2')!.title, 'subagent · general-purpose');
});

test('the first real prompt replaces a fallback title; later prompts do not rename it', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started', { detail: { cwd: '/Users/chris.rubin/projects/agent-hud' } }));
  assert.equal(e.get('thread-1')!.title, 'agent-hud');

  e.apply(ev('prompt_submitted', { ts: t(10), detail: { promptText: 'the real task' } }));
  assert.equal(e.get('thread-1')!.title, 'the real task');

  e.apply(ev('prompt_submitted', { ts: t(20), detail: { promptText: 'a follow-up question' } }));
  assert.equal(
    e.get('thread-1')!.title,
    'the real task',
    'a tile that renames itself mid-flight is one he loses track of',
  );
});
