// Agent HUD — Phase 0 capture server.
// Zero-dependency Node HTTP listener. Every POST that arrives is appended,
// verbatim, to probes/captured/events.ndjson with an envelope recording
// when it arrived, from where, and on which path. This is the ground truth
// Q1 and Q1b are answered against: we build adapters from what actually
// arrives here, not from documentation.
//
// Run:  node probes/capture-server.mjs        (listens on 127.0.0.1:43200)
//       PORT=5555 node probes/capture-server.mjs
//
// Endpoints:
//   POST /ingest/<label>   — capture a hook POST; <label> tags the source
//                            you're testing (e.g. local, desktop-cowork,
//                            cloud-mobile) so classes are separable later.
//   GET  /health           — "ok" + event count, to verify tunnel reachability.
//   GET  /                 — plain-language status page with live counts.

import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'captured');
const outFile = join(outDir, 'events.ndjson');
mkdirSync(outDir, { recursive: true });

const PORT = Number(process.env.PORT || 43200);
let count = existsSync(outFile)
  ? readFileSync(outFile, 'utf8').split('\n').filter(Boolean).length
  : 0;
const byLabel = {};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok — ${count} events captured\n`);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const lines = Object.entries(byLabel)
      .map(([k, v]) => `  ${k}: ${v.count} events, last: ${v.lastEvent} at ${v.lastAt}`)
      .join('\n') || '  (nothing captured yet this run)';
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(
      `Agent HUD capture server\n` +
      `Total events in file: ${count}\n` +
      `This run, by source label:\n${lines}\n\n` +
      `A hook that fires anywhere — your Mac, the Cowork VM, Anthropic's cloud —\n` +
      `and can reach this server will appear above within a second or two.\n`
    );
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/ingest/')) {
    const label = url.pathname.slice('/ingest/'.length) || 'unlabeled';
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = { _unparseable_raw: body }; }
      const envelope = {
        captured_at: new Date().toISOString(),
        source_label: label,
        remote_addr: req.socket.remoteAddress,
        // cf-connecting-ip / x-forwarded-for reveal whether the POST came
        // through the tunnel (cloud session) or straight from loopback.
        forwarded_for: req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || null,
        user_agent: req.headers['user-agent'] || null,
        hook_event_name: payload?.hook_event_name || null,
        payload,
      };
      appendFileSync(outFile, JSON.stringify(envelope) + '\n');
      count += 1;
      byLabel[label] = {
        count: (byLabel[label]?.count || 0) + 1,
        lastEvent: envelope.hook_event_name || '(no hook_event_name field)',
        lastAt: envelope.captured_at,
      };
      console.log(`[${envelope.captured_at}] ${label} :: ${envelope.hook_event_name || 'POST'}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found — POST to /ingest/<label>, or GET /health\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agent HUD capture server listening on port ${PORT}`);
  console.log(`Health check: http://127.0.0.1:${PORT}/health`);
  console.log(`Captures append to: ${outFile}`);
});
