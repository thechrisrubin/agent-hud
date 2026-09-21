// The ingest listener.
//
// EVERY write requires the shared secret. There is no local exemption, and
// that is a deliberate correction to an earlier design.
//
// The earlier version trusted requests that arrived on loopback without an
// `X-Forwarded-For` header, on the reasoning that anything already running as
// this user on this Mac has no need of a secret. That reasoning has a hole:
// a tunnel daemon runs ON this Mac and proxies to loopback, so whether a
// remote request is distinguishable from a local one depends entirely on
// whether that particular tunnel happens to set a forwarding header.
// Cloudflare does. Tailscale Funnel was not verified to. Getting that wrong
// once would leave the endpoint publicly writable with no sign of trouble.
//
// So the rule is now simple enough to be obviously correct: no secret, no
// write. Local hooks are given the secret by scripts/setup.sh, which is the
// same file that writes them — the operator never handles it.
//
// Origin address authenticates nothing: five probe sessions produced five
// unrelated egress IPs (PHASE0-FINDINGS, Q1 verdict), so an allowlist was
// never an option.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { adaptHookPayload, type RawHookPayload } from './hook-adapter.js';
import { readAiTitle } from './transcript.js';
import type { ThreadEvent } from '../shared/types.js';

const MAX_BODY_BYTES = 2_000_000;

export type IngestStats = {
  accepted: number;
  ignored: number;
  filtered: number;
  rejected: number;
  lastEventAt?: string;
  lastRemote?: string;
  /**
   * When this listener started. The counters above are in memory and reset
   * with it, so without this a reader cannot tell "nothing has ever arrived"
   * from "nothing has arrived since the restart ninety minutes ago". The
   * second is the failure the health check kept missing.
   */
  startedAt?: string;
};

export type IngestOptions = {
  port: number;
  secret: string;
  hideRoutines: boolean;
  routineSlugs: ReadonlySet<string>;
  onEvent: (event: ThreadEvent) => void;
  onLog?: (line: string) => void;
};

/** Headers can arrive as string[]; an unsubstituted `${VAR}` is not a value. */
function headerValue(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('${')) return undefined;
  return trimmed;
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

  /**
   * Titles are looked up at most once per session until one is found.
   * Claude writes the title a moment after the session starts, so an early
   * miss is normal and worth retrying — but re-reading a transcript on every
   * event of a long session would be pointless file I/O on the ingest path.
   */
  private titleCache = new Map<string, string>();
  private titleMisses = new Map<string, number>();
  private static readonly MAX_TITLE_ATTEMPTS = 12;

  private resolveTitle(p: RawHookPayload): string | undefined {
    // Subagent events carry the PARENT's session_id and the parent's
    // transcript, while the tile they create is the child. Resolving a title
    // here would give every subagent its parent's name — which is exactly what
    // happened: a dozen child rows all reading "Phase 0 probe runbook".
    if (p.hook_event_name === 'SubagentStart' || p.hook_event_name === 'SubagentStop') {
      return undefined;
    }
    const id = p.session_id;
    if (!id || !p.transcript_path) return undefined;

    const known = this.titleCache.get(id);
    if (known) return known;

    const misses = this.titleMisses.get(id) ?? 0;
    if (misses >= IngestServer.MAX_TITLE_ATTEMPTS) return undefined;

    const title = readAiTitle(p.transcript_path);
    if (title) {
      this.titleCache.set(id, title);
      this.titleMisses.delete(id);
      return title;
    }
    this.titleMisses.set(id, misses + 1);
    return undefined;
  }

  private log(line: string): void {
    this.opts.onLog?.(line);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.on('error', (err) => reject(err));
      // Bound to all interfaces so the tunnel can reach it. The secret, not
      // the bind address, is what keeps strangers out.
      server.listen(this.opts.port, '0.0.0.0', () => {
        this.stats.startedAt = new Date().toISOString();
        resolve();
      });
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

    const provided = String(req.headers['x-hud-secret'] ?? '');
    if (!provided || !secretMatches(provided, this.opts.secret)) {
      this.stats.rejected += 1;
      const origin = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?';
      this.log(`rejected unauthenticated request from ${origin}`);
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('Unauthorized\n');
      return;
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

      // The Claude app's conversation id rides in a header, not the body:
      // the plugin substitutes ${CLAUDE_CODE_REMOTE_SESSION_ID} into it via
      // `allowedEnvVars`. Verified live — allowedEnvVars substitutes into
      // headers only, not into the URL.
      const appSessionId = headerValue(req.headers['x-claude-session']);

      // The thread's generated name, so the tile matches what the Claude app
      // calls it. A title supplied directly (Cowork, via a command hook) wins;
      // otherwise read the transcript, which only works for local sessions
      // because a Cowork transcript lives inside Anthropic's container.
      const aiTitle =
        headerValue(req.headers['x-claude-title']) ?? this.resolveTitle(payload);

      const result = adaptHookPayload(payload, {
        hideRoutines: this.opts.hideRoutines,
        routineSlugs: this.opts.routineSlugs,
        appSessionId,
        aiTitle,
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
