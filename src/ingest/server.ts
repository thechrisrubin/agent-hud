// The ingest listener.
//
// Two ways in, and they are authenticated differently on purpose:
//
//   • Loopback (127.0.0.1) — local Claude Code hooks. Anything already running
//     as this user on this Mac can post. No secret required, because a secret
//     would buy nothing against an attacker who is already local.
//
//   • Everything else — Cowork, arriving through the Cloudflare tunnel from
//     Anthropic's cloud. Requires the shared secret. Five probe sessions
//     produced five unrelated egress IPs, so the origin address authenticates
//     nothing and an allowlist is not an option (PHASE0-FINDINGS, Q1 verdict).
//
// The endpoint is public the moment the tunnel is up. It refuses unauthenticated
// writes from the first commit rather than as later hardening.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { adaptHookPayload, type RawHookPayload } from './hook-adapter.js';
import type { ThreadEvent } from '../shared/types.js';

const MAX_BODY_BYTES = 2_000_000;

export type IngestStats = {
  accepted: number;
  ignored: number;
  filtered: number;
  rejected: number;
  lastEventAt?: string;
  lastRemote?: string;
};

export type IngestOptions = {
  port: number;
  secret: string;
  hideRoutines: boolean;
  routineSlugs: ReadonlySet<string>;
  onEvent: (event: ThreadEvent) => void;
  onLog?: (line: string) => void;
};

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  // A request that arrived through the tunnel is proxied by cloudflared, which
  // runs on this machine — so it too appears to come from loopback. The
  // forwarded-for header is what distinguishes a genuinely local caller from
  // a remote one, and a remote caller cannot strip it.
  const forwarded = req.headers['x-forwarded-for'] ?? req.headers['cf-connecting-ip'];
  if (forwarded) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class IngestServer {
  private server: Server | undefined;
  readonly stats: IngestStats = { accepted: 0, ignored: 0, filtered: 0, rejected: 0 };

  constructor(private opts: IngestOptions) {}

  private log(line: string): void {
    this.opts.onLog?.(line);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.on('error', (err) => reject(err));
      // Bound to all interfaces so the tunnel can reach it. The secret, not
      // the bind address, is what keeps strangers out.
      server.listen(this.opts.port, '0.0.0.0', () => resolve());
      this.server = server;
    });
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    this.server = undefined;
  }

  private handle(req: IncomingMessage, res: import('node:http').ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...this.stats }));
      return;
    }

    if (req.method !== 'POST' || !url.pathname.startsWith('/ingest')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found. POST hook events to /ingest.\n');
      return;
    }

    if (!isLoopback(req)) {
      const provided = String(req.headers['x-hud-secret'] ?? '');
      if (!provided || !secretMatches(provided, this.opts.secret)) {
        this.stats.rejected += 1;
        this.log(`rejected unauthenticated request from ${req.headers['x-forwarded-for'] ?? '?'}`);
        res.writeHead(401, { 'content-type': 'text/plain' });
        res.end('Unauthorized\n');
        return;
      }
    }

    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES && !tooBig) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('error', () => {
      /* client vanished mid-request; nothing to do and nothing to report */
    });
    req.on('end', () => {
      if (tooBig) return;
      // Hooks fire on the critical path of the operator's sessions. Always
      // answer 200 fast: a slow or failing hook endpoint would make his
      // Claude sessions feel broken, which is far worse than a dropped tile.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');

      let payload: RawHookPayload;
      try {
        payload = JSON.parse(body);
      } catch {
        this.stats.ignored += 1;
        return;
      }

      const result = adaptHookPayload(payload, {
        hideRoutines: this.opts.hideRoutines,
        routineSlugs: this.opts.routineSlugs,
      });

      if (!result.ok) {
        if (result.reason === 'filtered_routine') this.stats.filtered += 1;
        else this.stats.ignored += 1;
        return;
      }

      this.stats.accepted += 1;
      this.stats.lastEventAt = result.event.ts;
      this.stats.lastRemote = String(req.headers['x-forwarded-for'] ?? 'local');
      try {
        this.opts.onEvent(result.event);
      } catch (err) {
        // A bug downstream must never take the listener down with it, or the
        // HUD would go silently deaf while still looking alive.
        this.log(`event handler failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }
}
