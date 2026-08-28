// Ingest server tests — real HTTP over a real socket.
//
// The authentication rules here are the ones protecting an endpoint that is
// exposed to the public internet the moment the tunnel is up. They get tested
// against actual requests, not mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IngestServer } from '../ingest/server.js';
import { StateEngine } from '../engine/state-engine.js';
import type { ThreadEvent } from '../shared/types.js';

const SECRET = 'a'.repeat(64);
const SID = '4603d1d5-aa0e-53dc-8213-7679f4d76203';

async function withServer(
  fn: (base: string, events: ThreadEvent[], server: IngestServer) => Promise<void>,
  opts: { hideRoutines?: boolean; routineSlugs?: Set<string> } = {},
): Promise<void> {
  const events: ThreadEvent[] = [];
  // Port 0 lets the OS pick a free one, so tests never collide with a running HUD.
  const server = new IngestServer({
    port: 0,
    secret: SECRET,
    hideRoutines: opts.hideRoutines ?? false,
    routineSlugs: opts.routineSlugs ?? new Set(),
    onEvent: (e) => events.push(e),
  });
  await server.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (server as any).server.address().port as number;
  try {
    await fn(`http://127.0.0.1:${port}`, events, server);
  } finally {
    await server.stop();
  }
}

const AUTH = { 'x-hud-secret': SECRET };

const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/ingest/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('a local caller must present the secret too — there is no local exemption', async () => {
  // The exemption used to exist and was removed: a tunnel daemon runs on this
  // machine and proxies to loopback, so "local" is not a safe thing to trust.
  await withServer(async (base, events) => {
    const bare = await post(base, { hook_event_name: 'Stop', session_id: SID });
    assert.equal(bare.status, 401, 'no secret, no write — even from 127.0.0.1');

    const res = await post(base, { hook_event_name: 'Stop', session_id: SID }, AUTH);
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, 'turn_finished');
  });
});

test('a forwarded request without the secret is refused', async () => {
  await withServer(async (base, events) => {
    const res = await post(
      base,
      { hook_event_name: 'Stop', session_id: SID },
      { 'x-forwarded-for': '34.135.11.159' },
    );
    assert.equal(res.status, 401, 'the endpoint is public once the tunnel is up');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(events.length, 0);
  });
});

test('a forwarded request with the right secret is accepted', async () => {
  await withServer(async (base, events) => {
    const res = await post(
      base,
      { hook_event_name: 'Stop', session_id: SID, cwd: '/home/claude' },
      { 'x-forwarded-for': '34.135.11.159', ...AUTH },
    );
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.source, 'cowork-hook');
  });
});

test('a wrong secret is refused, whatever its length', async () => {
  await withServer(async (base, events) => {
    for (const bad of ['b'.repeat(64), 'short', '']) {
      const res = await post(
        base,
        { hook_event_name: 'Stop', session_id: SID },
        { 'x-forwarded-for': '1.2.3.4', 'x-hud-secret': bad },
      );
      assert.equal(res.status, 401);
    }
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(events.length, 0);
  });
});

test('malformed and unknown payloads are shrugged off, not crashed on', async () => {
  await withServer(async (base, events, server) => {
    const bad = await fetch(`${base}/ingest/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: 'not json at all',
    });
    assert.equal(bad.status, 200, 'hooks are on the critical path — always answer fast');

    await post(base, { hook_event_name: 'SomethingNew', session_id: SID }, AUTH);
    await post(base, { hook_event_name: 'Stop' }, AUTH); // no session_id

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(events.length, 0);
    assert.equal(server.stats.ignored, 3);
  });
});

test('a handler that throws does not take the listener down', async () => {
  let calls = 0;
  const server = new IngestServer({
    port: 0,
    secret: SECRET,
    hideRoutines: false,
    routineSlugs: new Set(),
    onEvent: () => {
      calls += 1;
      throw new Error('downstream is broken');
    },
  });
  await server.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (server as any).server.address().port as number;
  const base = `http://127.0.0.1:${port}`;
  try {
    await post(base, { hook_event_name: 'Stop', session_id: SID }, AUTH);
    await new Promise((r) => setTimeout(r, 30));
    const res = await post(base, { hook_event_name: 'Stop', session_id: SID }, AUTH);
    assert.equal(res.status, 200, 'still serving after a downstream failure');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 2);
  } finally {
    await server.stop();
  }
});

test('health reports what has been received', async () => {
  await withServer(async (base) => {
    await post(base, { hook_event_name: 'Stop', session_id: SID }, AUTH);
    await new Promise((r) => setTimeout(r, 30));
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { ok: boolean; accepted: number };
    assert.equal(body.ok, true);
    assert.equal(body.accepted, 1);
  });
});

test('routine filtering is counted separately so it is visible, not silent', async () => {
  await withServer(
    async (base, events, server) => {
      await post(
        base,
        {
          hook_event_name: 'Stop',
          session_id: SID,
          cwd: '/Users/chris.rubin/Documents/Claude/Scheduled/daily-briefing',
        },
        AUTH,
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(events.length, 0);
      assert.equal(server.stats.filtered, 1);
      assert.equal(server.stats.ignored, 0, 'filtered is not the same as unrecognised');
    },
    { hideRoutines: true, routineSlugs: new Set(['daily-briefing']) },
  );
});

test('end to end: a full session arrives over HTTP and lands as one DONE tile', async () => {
  await withServer(async (base, events) => {
    const engine = new StateEngine();
    const seq = [
      { hook_event_name: 'UserPromptSubmit', prompt: 'run the report', cwd: '/home/claude' },
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: '/home/claude' },
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: '/home/claude' },
      { hook_event_name: 'Stop', last_assistant_message: 'Report done.', cwd: '/home/claude' },
      { hook_event_name: 'SessionEnd', reason: 'other', cwd: '/home/claude' },
    ];
    for (const p of seq) await post(base, { ...p, session_id: SID }, AUTH);
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(events.length, 5);
    for (const e of events) engine.apply(e);

    const t = engine.get(SID)!;
    assert.equal(t.state, 'DONE', 'SessionEnd must not undo the DONE that Stop produced');
    assert.equal(t.title, 'run the report');
    assert.equal(t.finalMessage, 'Report done.');
    assert.equal(t.source, 'cowork-hook');
  });
});
