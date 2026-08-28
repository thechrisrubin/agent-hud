// Projection tests — the rules that decide what the operator actually sees.
//
// These matter as much as the engine tests. A correct state rendered in the
// wrong place, or a finished tile that refuses to clear, fails him just as
// surely as a wrong colour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StateEngine } from '../engine/state-engine.js';
import { project, humanDuration, activityLineFor, progressLabelFor } from '../engine/project.js';
import { saveSnapshot, loadSnapshot } from '../engine/persistence.js';
import type { EventKind, ThreadEvent } from '../shared/types.js';

const T0 = '2026-08-28T12:00:00.000Z';
const NOW = Date.parse(T0) + 60_000;

function ev(kind: EventKind, threadId: string, over: Partial<ThreadEvent> = {}): ThreadEvent {
  return {
    source: 'cowork-hook',
    platform: 'claude',
    threadId,
    seq: 0,
    ts: T0,
    kind,
    detail: {},
    ...over,
  };
}

const OPTS = { showQuiet: false, connected: true, statusLine: 'ok' };

// ---------------------------------------------------------------------------
// Grid order and visibility
// ---------------------------------------------------------------------------

test('tiles sort by urgency: approval, then input, then done, then working', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started', 'working'));
  e.apply(ev('turn_finished', 'done'));
  e.apply(ev('input_requested', 'input'));
  e.apply(ev('permission_requested', 'approval'));

  const snap = project(e.all(), NOW, OPTS);
  assert.deepEqual(snap.tiles.map((t) => t.threadId), ['approval', 'input', 'done', 'working']);
});

test('idle and stale threads are hidden but counted, not silently dropped', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started', 'live'));
  e.apply(ev('interrupted', 'quiet'));

  const hidden = project(e.all(), NOW, OPTS);
  assert.deepEqual(hidden.tiles.map((t) => t.threadId), ['live']);
  assert.equal(hidden.hiddenCount, 1, 'the operator must be able to see that something is hidden');

  const shown = project(e.all(), NOW, { ...OPTS, showQuiet: true });
  assert.equal(shown.tiles.length, 2);
  assert.equal(shown.hiddenCount, 0);
});

test('acknowledging removes the tile from the grid entirely', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished', 'a'));
  assert.equal(project(e.all(), NOW, OPTS).tiles.length, 1);
  e.acknowledge('a');
  assert.equal(project(e.all(), NOW, OPTS).tiles.length, 0, 'this is the self-cleaning mechanism');
});

test('subagents nest under their parent rather than taking grid space', () => {
  const e = new StateEngine();
  e.apply(ev('prompt_submitted', 'parent'));
  e.apply(ev('subagent_started', 'child', { parentThreadId: 'parent' }));

  const snap = project(e.all(), NOW, OPTS);
  assert.equal(snap.tiles.length, 1);
  assert.equal(snap.tiles[0]!.threadId, 'parent');
  assert.equal(snap.tiles[0]!.children.length, 1);
});

test('an orphaned subagent is promoted rather than lost', () => {
  // A missing tile is the one failure the operator cannot detect himself.
  const e = new StateEngine();
  e.apply(ev('subagent_started', 'orphan', { parentThreadId: 'never-seen' }));
  const snap = project(e.all(), NOW, OPTS);
  assert.equal(snap.tiles.length, 1);
  assert.equal(snap.tiles[0]!.threadId, 'orphan');
});

// ---------------------------------------------------------------------------
// What the tile says
// ---------------------------------------------------------------------------

test('only a real task list yields a percentage; everything else does not', () => {
  const e = new StateEngine();
  e.apply(ev('task_created', 'a', { detail: { taskId: '1' } }));
  e.apply(ev('task_created', 'a', { detail: { taskId: '2' } }));
  e.apply(ev('task_completed', 'a', { detail: { taskId: '1' } }));
  assert.equal(progressLabelFor(e.get('a')!, NOW), '1 of 2');

  const e2 = new StateEngine();
  e2.apply(ev('tool_finished', 'b'));
  assert.equal(progressLabelFor(e2.get('b')!, NOW), '1 step');

  const e3 = new StateEngine();
  e3.apply(ev('prompt_submitted', 'c'));
  assert.equal(progressLabelFor(e3.get('c')!, NOW), '1m', 'falls back to elapsed time, not a fake %');
});

test('an approval tile names the tool it is waiting on', () => {
  const e = new StateEngine();
  e.apply(ev('permission_requested', 'a', { detail: { pendingTool: 'WebFetch' } }));
  assert.equal(activityLineFor(e.get('a')!, NOW), 'waiting to approve WebFetch');
});

test('a finished tile shows what it produced', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished', 'a', { detail: { finalMessage: 'All three steps ran.' } }));
  assert.equal(activityLineFor(e.get('a')!, NOW), 'done · All three steps ran.');
});

test('an error tile shows plain language, never a trace', () => {
  const e = new StateEngine();
  e.apply(ev('error', 'a', { detail: { errorText: 'File does not exist.' } }));
  const line = activityLineFor(e.get('a')!, NOW);
  assert.equal(line, 'File does not exist.');
  assert.ok(!line.includes('at '), 'must never look like a stack trace');
});

test('durations read like a person wrote them', () => {
  assert.equal(humanDuration(45), '45s');
  assert.equal(humanDuration(90), '1m');
  assert.equal(humanDuration(3600), '1h');
  assert.equal(humanDuration(3900), '1h 5m');
});

test('only finished and failed tiles offer a clear button', () => {
  const e = new StateEngine();
  e.apply(ev('tool_started', 'w'));
  e.apply(ev('turn_finished', 'd'));
  const byId = new Map(project(e.all(), NOW, OPTS).tiles.map((t) => [t.threadId, t]));
  assert.equal(byId.get('w')!.canAcknowledge, false);
  assert.equal(byId.get('d')!.canAcknowledge, true);
});

// ---------------------------------------------------------------------------
// Persistence — brief §9
// ---------------------------------------------------------------------------

test('sticky DONE and pending acknowledgements survive a full restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hud-test-'));
  const path = join(dir, 'state.json');
  try {
    const e = new StateEngine();
    e.apply(ev('turn_finished', 'kept'));
    e.apply(ev('turn_finished', 'acked'));
    e.acknowledge('acked');
    saveSnapshot(path, e.all());

    const revived = new StateEngine();
    revived.load(loadSnapshot(path), T0);

    assert.equal(revived.get('kept')!.state, 'DONE');
    assert.equal(revived.get('acked')!.acknowledged, true);
    const snap = project(revived.all(), NOW, OPTS);
    assert.deepEqual(snap.tiles.map((t) => t.threadId), ['kept'], 'acked tile stays cleared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt snapshot starts empty instead of refusing to start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hud-test-'));
  const path = join(dir, 'state.json');
  try {
    require('node:fs').writeFileSync(path, '{ this is not json');
    assert.deepEqual(loadSnapshot(path), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing snapshot is not an error', () => {
  assert.deepEqual(loadSnapshot('/nonexistent/path/state.json'), []);
});

test('a tile advertises direct opening only when it really has the id', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished', 'with', { detail: { appSessionId: 'cse_01ABC' } }));
  e.apply(ev('turn_finished', 'without'));
  const byId = new Map(project(e.all(), NOW, OPTS).tiles.map((t) => [t.threadId, t]));
  assert.equal(byId.get('with')!.canOpenDirectly, true);
  assert.equal(byId.get('without')!.canOpenDirectly, false);
});

test('the app session id survives a restart, so old tiles stay clickable', () => {
  const e = new StateEngine();
  e.apply(ev('turn_finished', 'a', { detail: { appSessionId: 'cse_01ABC' } }));
  const revived = new StateEngine();
  revived.load(JSON.parse(JSON.stringify(e.all())), T0);
  assert.equal(revived.get('a')!.appSessionId, 'cse_01ABC');
});
