// Adapter tests.
//
// The second half of this file replays the real capture file from Phase 0 —
// 450 payloads that actually arrived from Anthropic's cloud and from this Mac.
// Synthetic tests prove the mapping I intended; the replay proves the mapping
// survives contact with what the vendor really sends. Both matter, and only
// the second one would have caught a field I misread.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adaptHookPayload, looksLikeRoutine, sourceForCwd } from '../ingest/hook-adapter.js';
import type { RawHookPayload } from '../ingest/hook-adapter.js';
import { StateEngine } from '../engine/state-engine.js';

const NOW = () => '2026-08-28T12:00:00.000Z';
const SID = '4603d1d5-aa0e-53dc-8213-7679f4d76203';

function adapt(p: RawHookPayload) {
  return adaptHookPayload(p, { now: NOW });
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

test('each hook event maps to the intended kind', () => {
  const cases: Array<[string, string]> = [
    ['SessionStart', 'session_started'],
    ['UserPromptSubmit', 'prompt_submitted'],
    ['PreToolUse', 'tool_started'],
    ['PostToolUse', 'tool_finished'],
    ['PermissionRequest', 'permission_requested'],
    ['TaskCreated', 'task_created'],
    ['TaskCompleted', 'task_completed'],
    ['SubagentStart', 'subagent_started'],
    ['SubagentStop', 'subagent_finished'],
    ['Stop', 'turn_finished'],
    ['SessionEnd', 'session_ended'],
    ['StopFailure', 'error'],
  ];
  for (const [hook, kind] of cases) {
    const r = adapt({ hook_event_name: hook, session_id: SID, agent_id: 'a1' });
    assert.equal(r.ok, true, `${hook} should adapt`);
    assert.equal(r.ok && r.event.kind, kind, `${hook} → ${kind}`);
  }
});

test('is_interrupt decides between interrupted and error', () => {
  const stopped = adapt({
    hook_event_name: 'PostToolUseFailure',
    session_id: SID,
    is_interrupt: true,
  });
  assert.equal(stopped.ok && stopped.event.kind, 'interrupted');

  const broke = adapt({
    hook_event_name: 'PostToolUseFailure',
    session_id: SID,
    is_interrupt: false,
    error: 'File does not exist.',
  });
  assert.equal(broke.ok && broke.event.kind, 'error');
  assert.equal(broke.ok && broke.event.detail.errorText, 'File does not exist.');
});

test('notification_type splits approval from a plain question', () => {
  const approval = adapt({
    hook_event_name: 'Notification',
    session_id: SID,
    notification_type: 'permission_prompt',
    message: 'Claude needs your permission',
  });
  assert.equal(approval.ok && approval.event.kind, 'permission_requested');

  const question = adapt({
    hook_event_name: 'Notification',
    session_id: SID,
    notification_type: 'something_new_anthropic_adds_later',
    message: 'Claude has a question',
  });
  assert.equal(
    question.ok && question.event.kind,
    'input_requested',
    'unknown notification types must fall through to the safer state',
  );
});

test('cwd decides the session class', () => {
  assert.equal(sourceForCwd('/home/claude'), 'cowork-hook');
  assert.equal(sourceForCwd('/Users/chris.rubin/project'), 'claude-code-local');
  assert.equal(sourceForCwd(undefined), 'claude-code-local');
});

test('a subagent becomes its own thread under its parent', () => {
  const r = adapt({
    hook_event_name: 'SubagentStart',
    session_id: SID,
    agent_id: 'a5fb22c5eb5fd74da',
    agent_type: 'general-purpose',
  });
  assert.equal(r.ok && r.event.threadId, 'a5fb22c5eb5fd74da');
  assert.equal(r.ok && r.event.parentThreadId, SID);
});

test('a payload without session_id is dropped rather than given a made-up identity', () => {
  const r = adapt({ hook_event_name: 'Stop' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'no_session_id');
});

test('unknown hook events are ignored, not guessed at', () => {
  const r = adapt({ hook_event_name: 'SomeFutureHook', session_id: SID });
  assert.equal(!r.ok && r.reason, 'unknown_event');
});

// ---------------------------------------------------------------------------
// Routine filtering — honest about what it can and cannot catch
// ---------------------------------------------------------------------------

test('a routine running locally is caught by its working directory', () => {
  const slugs = new Set(['daily-briefing']);
  assert.equal(
    looksLikeRoutine(
      { cwd: '/Users/chris.rubin/Documents/Claude/Scheduled/daily-briefing' },
      slugs,
    ),
    true,
  );
});

test('a routine is caught when its prompt names it, hyphenated or spaced', () => {
  const slugs = new Set(['daily-briefing']);
  assert.equal(looksLikeRoutine({ prompt: 'Run the daily-briefing now' }, slugs), true);
  assert.equal(looksLikeRoutine({ prompt: 'Produce my daily briefing' }, slugs), true);
  assert.equal(looksLikeRoutine({ prompt: 'unrelated work' }, slugs), false);
});

test('KNOWN GAP: a cloud routine whose prompt does not name it is NOT caught', () => {
  // This documents a real limitation rather than asserting correct behaviour.
  // A scheduled run captured live was payload-identical to an interactive
  // thread: same fields, same cwd=/home/claude. If its prompt does not happen
  // to contain the routine's name, nothing distinguishes it and the tile will
  // appear. Verify against a real routine before trusting the filter.
  const slugs = new Set(['daily-briefing']);
  assert.equal(
    looksLikeRoutine({ cwd: '/home/claude', prompt: 'Summarise yesterday and post it' }, slugs),
    false,
    'if this ever starts passing, the filter got better and this test should be rewritten',
  );
});

test('filtering is off unless asked for', () => {
  const p: RawHookPayload = {
    hook_event_name: 'Stop',
    session_id: SID,
    cwd: '/Users/chris.rubin/Documents/Claude/Scheduled/daily-briefing',
  };
  assert.equal(adaptHookPayload(p, { now: NOW }).ok, true);
  const filtered = adaptHookPayload(p, {
    now: NOW,
    hideRoutines: true,
    routineSlugs: new Set(['daily-briefing']),
  });
  assert.equal(!filtered.ok && filtered.reason, 'filtered_routine');
});

// ---------------------------------------------------------------------------
// Replay of the real Phase 0 capture file
// ---------------------------------------------------------------------------

const CAPTURE = join(__dirname, '..', '..', 'probes', 'captured', 'events.ndjson');

test('every real captured payload either adapts or is deliberately ignored', (t) => {
  if (!existsSync(CAPTURE)) return t.skip('capture file not present');

  const rows = readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { payload: RawHookPayload });

  let adapted = 0;
  const ignored: string[] = [];
  for (const row of rows) {
    const r = adaptHookPayload(row.payload, { now: NOW });
    if (r.ok) adapted += 1;
    else if (r.reason === 'unknown_event') ignored.push(String(row.payload?.hook_event_name));
  }

  assert.ok(adapted > 400, `expected to adapt most of ${rows.length} captured events, got ${adapted}`);
  assert.deepEqual([...new Set(ignored)], [], 'no captured event type should be unrecognised');
});

test('replaying the real Cowork sessions produces sane, finished threads', (t) => {
  if (!existsSync(CAPTURE)) return t.skip('capture file not present');

  const rows = readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { source_label: string; payload: RawHookPayload });

  const engine = new StateEngine();
  for (const row of rows) {
    if (row.payload?.cwd !== '/home/claude') continue;
    const r = adaptHookPayload(row.payload, { now: NOW });
    if (r.ok) engine.apply(r.event);
  }

  const threads = engine.all().filter((th) => !th.parentThreadId);
  assert.ok(threads.length >= 5, `expected the 5 real Cowork sessions, got ${threads.length}`);

  // Every one of those sessions ran to completion in the probe, so every one
  // must be sitting in sticky DONE — including after its SessionEnd arrived.
  for (const th of threads) {
    assert.equal(th.source, 'cowork-hook');
    assert.equal(th.state, 'DONE', `${th.threadId} should be DONE, is ${th.state}`);
    assert.notEqual(th.title, 'Untitled thread', 'a real session should get a real title');
  }
});
