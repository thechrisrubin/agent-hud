// The renderer. Paints what it is given and decides nothing.
//
// All state logic lives in the engine, so the grid can never disagree with it.
// Everything here is DOM construction — note there is no innerHTML anywhere:
// tile titles come from prompt text the operator typed, and building them as
// text nodes means a prompt containing markup can never become markup.

import type { HudSnapshot, TileView } from '../shared/types.js';

declare global {
  interface Window {
    hud: {
      onSnapshot(cb: (snap: HudSnapshot) => void): void;
      onFocusTile(cb: (threadId: string) => void): void;
      acknowledge(threadId: string): Promise<boolean>;
      jump(threadId: string): Promise<{ ok: boolean; message: string }>;
      toggleQuiet(): Promise<boolean>;
      toggleOnTop(): Promise<boolean>;
      close(): Promise<void>;
      minimize(): Promise<void>;
    };
  }
}

const grid = document.getElementById('grid') as HTMLElement;
const empty = document.getElementById('empty') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const dot = document.getElementById('dot') as HTMLElement;
const counts = document.getElementById('counts') as HTMLElement;
const toast = document.getElementById('toast') as HTMLElement;

/** Beyond this, live subagents collapse to a count. */
const MAX_CHILD_ROWS = 3;

const STATE_LABEL: Record<string, string> = {
  WORKING: 'Working',
  NEEDS_INPUT: 'Needs you',
  NEEDS_APPROVAL: 'Approve',
  DONE: 'Done',
  ERROR: 'Error',
  STALE: 'No news',
  IDLE: 'Idle',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}

function buildProgress(t: TileView): HTMLElement {
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  if (t.progress.kind === 'tasks' && t.progress.total > 0) {
    // The only honest percentage available: real task-list completion.
    const pct = Math.round((t.progress.completed / t.progress.total) * 100);
    fill.style.width = `${pct}%`;
  } else if (t.state === 'WORKING') {
    fill.classList.add('indeterminate');
  } else {
    fill.style.width = '0%';
  }
  track.append(fill);
  return track;
}

function buildTile(t: TileView): HTMLElement {
  const tile = el('article', `tile ${t.state}`);
  tile.tabIndex = 0;
  tile.dataset.threadId = t.threadId;

  // The head row carries the state word and, when there is one, the clear
  // button. The button lives at the top edge on purpose: a grid full of
  // finished threads used to push every clear button below the fold, and a
  // taller window was not always available. Top edge means always reachable,
  // however many tiles arrive over a weekend.
  const head = el('div', 'head');
  head.append(el('span', 'state', STATE_LABEL[t.state] ?? t.state));

  if (t.canAcknowledge) {
    const ack = el('button', 'ack', t.state === 'DONE' ? 'Clear' : 'Dismiss');
    ack.type = 'button';
    ack.title =
      t.state === 'DONE'
        ? 'Clear this finished thread off the grid'
        : 'Dismiss this thread off the grid';
    ack.setAttribute('aria-label', `${ack.textContent}: ${t.title}`);
    ack.addEventListener('click', (e) => {
      e.stopPropagation();
      void window.hud.acknowledge(t.threadId);
    });
    // Enter and Space on the button must not also fire the tile's jump.
    ack.addEventListener('keydown', (e) => e.stopPropagation());
    head.append(ack);
  }

  tile.append(head);

  tile.append(el('div', 'title', t.title));
  tile.append(buildProgress(t));
  tile.append(el('div', 'activity', t.activityLine));

  const meta = el('div', 'meta');
  meta.append(el('span', undefined, t.progressLabel));
  const badge = t.source === 'cowork-hook' ? 'Claude' : 'Claude Code';
  meta.append(el('span', undefined, `${badge} · ${humanDuration(t.secondsInState)}`));
  tile.append(meta);

  if (t.children.length) {
    // Subagents are supporting detail, not the point of the tile. A dozen
    // finished helpers listed in full buried everything else on the grid, so
    // finished ones collapse to a count and only the live ones are named.
    const kids = el('div', 'children');
    const busy = t.children.filter((c) => c.state !== 'DONE' && c.state !== 'IDLE');
    const doneCount = t.children.length - busy.length;

    const word = t.children.length === 1 ? 'subagent' : 'subagents';
    const parts = [`${t.children.length} ${word}`];
    if (doneCount) parts.push(`${doneCount} done`);
    kids.append(el('div', 'summary', parts.join(' · ')));

    for (const c of busy.slice(0, MAX_CHILD_ROWS)) {
      const row = el('div', `child ${c.state}`);
      row.append(el('span', 'pip'));
      // The child's own activity, not its final message — that text is long,
      // repetitive across siblings, and is not what the tile is for.
      row.append(el('span', 'name', c.title));
      kids.append(row);
    }
    if (busy.length > MAX_CHILD_ROWS) {
      kids.append(el('div', 'summary', `+${busy.length - MAX_CHILD_ROWS} more running`));
    }
    tile.append(kids);
  }

  const jump = async () => {
    const r = await window.hud.jump(t.threadId);
    showToast(r.message);
  };
  tile.addEventListener('click', () => void jump());
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void jump();
    }
  });

  return tile;
}

function render(snap: HudSnapshot): void {
  grid.replaceChildren(...snap.tiles.map(buildTile));

  const nothing = snap.tiles.length === 0;
  empty.hidden = !nothing;
  grid.hidden = nothing;

  const attention = snap.tiles.filter(
    (t) => t.state === 'NEEDS_APPROVAL' || t.state === 'NEEDS_INPUT',
  ).length;
  const done = snap.tiles.filter((t) => t.state === 'DONE').length;
  const parts: string[] = [];
  if (attention) parts.push(`${attention} need${attention === 1 ? 's' : ''} you`);
  if (done) parts.push(`${done} done`);
  if (snap.hiddenCount) parts.push(`${snap.hiddenCount} quiet`);
  counts.textContent = parts.join(' · ');

  statusEl.textContent = snap.statusLine;
  dot.classList.toggle('off', !snap.connected);
}

window.hud.onSnapshot(render);

window.hud.onFocusTile((threadId) => {
  const node = grid.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(threadId)}"]`);
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node?.focus();
});

document.getElementById('quiet')?.addEventListener('click', async (e) => {
  const on = await window.hud.toggleQuiet();
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
});
document.getElementById('ontop')?.addEventListener('click', async (e) => {
  const on = await window.hud.toggleOnTop();
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
});
document.getElementById('min')?.addEventListener('click', () => void window.hud.minimize());
document.getElementById('close')?.addEventListener('click', () => void window.hud.close());
