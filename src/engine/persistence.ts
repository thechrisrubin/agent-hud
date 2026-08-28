// Snapshot persistence.
//
// Brief §9: the HUD must survive restarts of itself, the Claude app, and the
// machine, with no lost or orphaned tiles — including sticky DONE states and
// pending acknowledgements. That makes this file part of the product's core
// promise, not an optimisation.
//
// Writes are atomic (temp file + rename) because the alternative is a
// half-written snapshot after a crash, which would lose every DONE tile the
// operator had not yet acknowledged.

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Thread } from '../shared/types.js';

const SNAPSHOT_VERSION = 1;

type Snapshot = {
  version: number;
  savedAt: string;
  threads: Thread[];
};

export function saveSnapshot(path: string, threads: Thread[]): void {
  const snapshot: Snapshot = {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    threads,
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, path);
}

export function loadSnapshot(path: string): Thread[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
    if (parsed.version !== SNAPSHOT_VERSION) return [];
    if (!Array.isArray(parsed.threads)) return [];
    return parsed.threads.filter(isPlausibleThread);
  } catch {
    // A corrupt snapshot loses history, which is bad. Refusing to start would
    // be worse: the operator would have no HUD at all, and no way to diagnose
    // it. Start empty and keep going.
    return [];
  }
}

function isPlausibleThread(t: unknown): t is Thread {
  if (!t || typeof t !== 'object') return false;
  const c = t as Partial<Thread>;
  return (
    typeof c.threadId === 'string' &&
    typeof c.state === 'string' &&
    typeof c.title === 'string' &&
    Array.isArray(c.history)
  );
}
