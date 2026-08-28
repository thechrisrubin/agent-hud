// Electron main process. Owns the window, the ingest listener, the state
// engine, and the clock. The renderer owns nothing but pixels.
//
// Chosen over Tauri because this is one packaged app with one runtime: one
// thing to install, one thing to restart, one thing to explain to someone who
// does not write code (PHASE0-FINDINGS Q8).

import { app, BrowserWindow, ipcMain, Notification, clipboard, shell, screen } from 'electron';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, saveConfig, STATE_PATH, LOG_PATH, type HudConfig } from '../config.js';
import { StateEngine } from '../engine/state-engine.js';
import { loadSnapshot, saveSnapshot } from '../engine/persistence.js';
import { project } from '../engine/project.js';
import { IngestServer } from '../ingest/server.js';
import { loadRoutineSlugs } from '../ingest/routines.js';
import type { ThreadEvent, ThreadState } from '../shared/types.js';

const TICK_MS = 1000;
const SAVE_DEBOUNCE_MS = 2000;

let win: BrowserWindow | null = null;
let cfg: HudConfig = loadConfig();
const engine = new StateEngine();
let ingest: IngestServer | null = null;
let ingestError: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;

/** States that earn a desktop notification when a thread enters them. */
const NOTIFY_ON: ThreadState[] = ['NEEDS_APPROVAL', 'NEEDS_INPUT', 'ERROR'];
const lastNotified = new Map<string, ThreadState>();

function log(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  try {
    appendFileSync(LOG_PATH, entry);
  } catch {
    /* logging must never be the thing that breaks the app */
  }
}

/**
 * The status line the operator reads when something looks wrong. Plain
 * language, and it always ends with what to do next — never a stack trace.
 */
function statusLine(): string {
  if (ingestError) return ingestError;
  const s = ingest?.stats;
  const where = cfg.tunnelHostname
    ? `Listening for your Claude sessions on ${cfg.tunnelHostname}`
    : 'Listening for Claude Code sessions on this Mac only';
  const cloud = cfg.tunnelHostname
    ? ''
    : ' · Cowork and phone threads need the tunnel — run the setup script to add it';
  const seen = s?.accepted ? ` · ${s.accepted} events received` : ' · nothing received yet';
  return `${where}${seen}${cloud}`;
}

function pushSnapshot(): void {
  if (!win || win.isDestroyed()) return;
  const snap = project(engine.all(), Date.now(), {
    showQuiet: cfg.showQuiet,
    connected: ingest !== null && ingestError === null,
    statusLine: statusLine(),
  });
  win.webContents.send('hud:snapshot', snap);
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveSnapshot(STATE_PATH, engine.all());
    } catch (err) {
      log(`snapshot save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, SAVE_DEBOUNCE_MS);
}

function notifyIfNeeded(threadId: string): void {
  const t = engine.get(threadId);
  if (!t) return;
  if (lastNotified.get(threadId) === t.state) return;
  lastNotified.set(threadId, t.state);

  if (!NOTIFY_ON.includes(t.state)) return;
  const enabled =
    (t.state === 'NEEDS_APPROVAL' && cfg.notifications.needsApproval) ||
    (t.state === 'NEEDS_INPUT' && cfg.notifications.needsInput) ||
    (t.state === 'ERROR' && cfg.notifications.error);
  if (!enabled || !Notification.isSupported()) return;

  const body =
    t.state === 'NEEDS_APPROVAL'
      ? t.pendingTool
        ? `Waiting to approve ${t.pendingTool}`
        : 'Waiting for your approval'
      : t.state === 'NEEDS_INPUT'
        ? 'Waiting on your answer'
        : (t.errorText ?? 'Stopped with an error');

  const n = new Notification({ title: t.title, body, silent: true });
  n.on('click', () => {
    win?.show();
    win?.focus();
    win?.webContents.send('hud:focus-tile', t.threadId);
  });
  n.show();
}

function onEvent(ev: ThreadEvent): void {
  engine.apply(ev);
  notifyIfNeeded(ev.threadId);
  scheduleSave();
  pushSnapshot();
}

async function startIngest(): Promise<void> {
  const slugs = loadRoutineSlugs();
  const server = new IngestServer({
    port: cfg.port,
    secret: cfg.ingestSecret,
    hideRoutines: cfg.hideRoutines,
    routineSlugs: slugs,
    onEvent,
    onLog: log,
  });
  try {
    await server.start();
    ingest = server;
    ingestError = null;
    log(`ingest listening on ${cfg.port}; ${slugs.size} routines known`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Plain language plus a specific next action — brief §2.1.
    ingestError =
      code === 'EADDRINUSE'
        ? `Port ${cfg.port} is already in use, so the HUD can't receive updates. Something else is probably using it — quit the other Agent HUD window if one is open, then restart this one.`
        : `The HUD couldn't start listening for updates. Restart the app; if it keeps happening, send your engineer the file at ${LOG_PATH}.`;
    log(`ingest failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function createWindow(): void {
  const bounds = cfg.windowBounds;
  const area = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: bounds?.width ?? Math.min(900, area.width),
    height: bounds?.height ?? Math.min(700, area.height),
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d12',
    alwaysOnTop: cfg.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    saveConfig(cfg);
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => {
    win = null;
  });

  win.webContents.on('did-finish-load', () => pushSnapshot());
}

// --- IPC: the renderer asks, the main process decides -----------------------

ipcMain.handle('hud:acknowledge', (_e, threadId: string) => {
  const ok = engine.acknowledge(threadId);
  if (ok) {
    lastNotified.delete(threadId);
    scheduleSave();
    pushSnapshot();
  }
  return ok;
});

ipcMain.handle('hud:toggle-quiet', () => {
  cfg.showQuiet = !cfg.showQuiet;
  saveConfig(cfg);
  pushSnapshot();
  return cfg.showQuiet;
});

ipcMain.handle('hud:toggle-on-top', () => {
  cfg.alwaysOnTop = !cfg.alwaysOnTop;
  win?.setAlwaysOnTop(cfg.alwaysOnTop);
  saveConfig(cfg);
  return cfg.alwaysOnTop;
});

/**
 * Click-to-jump. Opens the exact thread in the Claude app.
 *
 * The route is `claude://claude.ai/code/session_<id>`, read out of the app's
 * own deep-link table and confirmed live on 2026-08-28. Phase 0 recorded this
 * as impossible; that was wrong — six guessed URL formats had all omitted the
 * `claude.ai` host segment, and the failures were read as absence of the
 * capability rather than malformed input.
 *
 * The id comes from CLAUDE_CODE_REMOTE_SESSION_ID inside the Cowork session,
 * forwarded by the plugin as a header. It arrives prefixed `cse_`; the app's
 * URL form is `session_`. Same value, different prefix.
 *
 * Threads captured before the plugin carried that header have no id, so the
 * old focus-and-copy behaviour remains as the fallback — and says so plainly
 * rather than looking like a failed click.
 */
function appUrlFor(appSessionId: string): string {
  const suffix = appSessionId.replace(/^cse_/, '');
  return `claude://claude.ai/code/session_${suffix}`;
}

ipcMain.handle('hud:jump', async (_e, threadId: string) => {
  const t = engine.get(threadId);
  if (!t) return { ok: false, message: 'That thread is no longer being tracked.' };

  if (t.appSessionId) {
    try {
      await shell.openExternal(appUrlFor(t.appSessionId));
      return { ok: true, message: 'Opened in Claude.' };
    } catch {
      // Fall through to the copy behaviour rather than leaving a dead click.
    }
  }

  if (t.source === 'claude-code-local') {
    clipboard.writeText(t.cwd ?? t.title);
    return {
      ok: true,
      message: 'Copied this session’s folder — terminal sessions can’t be opened directly.',
    };
  }

  clipboard.writeText(t.title);
  try {
    await shell.openExternal('claude://');
  } catch {
    return { ok: true, message: 'Copied the thread name. Couldn’t bring the Claude app forward.' };
  }
  return {
    ok: true,
    message: 'Claude is in front and the name is copied — this thread started before direct opening was set up.',
  };
});

ipcMain.handle('hud:close', () => win?.close());
ipcMain.handle('hud:minimize', () => win?.minimize());

// --- lifecycle --------------------------------------------------------------

app.whenReady().then(async () => {
  const restored = loadSnapshot(STATE_PATH);
  if (restored.length) {
    engine.load(restored, new Date().toISOString());
    log(`restored ${restored.length} threads`);
  }

  await startIngest();
  createWindow();

  // One timer drives staleness and the ticking time-in-state readouts.
  setInterval(() => {
    const changed = engine.tick(Date.now());
    if (changed.length) scheduleSave();
    pushSnapshot();
  }, TICK_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    saveSnapshot(STATE_PATH, engine.all());
  } catch {
    /* nothing useful left to do at exit */
  }
  void ingest?.stop();
});
