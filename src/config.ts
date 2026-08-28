// Configuration. The operator never edits this, never sees a port number,
// and never handles a secret by hand — brief §2.1 makes that a design failure.
// Everything is generated on first run and stored in one place.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HUD_DIR = join(homedir(), '.agent-hud');
export const CONFIG_PATH = join(HUD_DIR, 'config.json');
export const STATE_PATH = join(HUD_DIR, 'state.json');
export const LOG_PATH = join(HUD_DIR, 'hud.log');

/** Where his scheduled routines live, one folder per routine. */
export const ROUTINES_DIR = join(homedir(), 'Documents', 'Claude', 'Scheduled');

export type HudConfig = {
  /** Loopback ingest port. Local Claude Code posts straight here. */
  port: number;
  /**
   * Shared secret required on every request that did NOT arrive on loopback.
   * Five Cowork sessions produced five unrelated egress IPs, so origin cannot
   * authenticate anything — see PHASE0-FINDINGS Q1 verdict.
   */
  ingestSecret: string;
  /** Public tunnel hostname, once the tunnel is set up. */
  tunnelHostname?: string;
  /** Hide routine-fired threads. Operator decision, 2026-08-28. */
  hideRoutines: boolean;
  /** Show IDLE/STALE threads in the grid. Off by default, brief §4.3. */
  showQuiet: boolean;
  windowBounds?: { x: number; y: number; width: number; height: number };
  alwaysOnTop: boolean;
  notifications: { needsApproval: boolean; needsInput: boolean; error: boolean; done: boolean };
};

const DEFAULTS: HudConfig = {
  port: 43200,
  ingestSecret: '',
  hideRoutines: true,
  showQuiet: false,
  alwaysOnTop: true,
  notifications: { needsApproval: true, needsInput: true, error: true, done: false },
};

export function loadConfig(): HudConfig {
  mkdirSync(HUD_DIR, { recursive: true });
  let cfg: HudConfig = { ...DEFAULTS };
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    } catch {
      // A corrupt config must not stop the HUD from starting. Defaults are
      // always workable, and the operator sees the honest status line rather
      // than an app that refuses to open.
      cfg = { ...DEFAULTS };
    }
  }
  if (!cfg.ingestSecret) {
    cfg.ingestSecret = randomBytes(32).toString('hex');
    saveConfig(cfg);
  }
  return cfg;
}

export function saveConfig(cfg: HudConfig): void {
  mkdirSync(HUD_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  // The file holds the ingest secret. Nobody else on the machine needs it.
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort — a permissions failure must not stop startup */
  }
}
