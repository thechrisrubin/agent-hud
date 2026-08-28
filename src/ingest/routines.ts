// Discovering the operator's scheduled routines.
//
// Each routine is a folder under ~/Documents/Claude/Scheduled containing a
// SKILL.md. The folder name is a human-readable slug (`daily-briefing`,
// `weekly-meeting-analysis`). He had 21 of them on 2026-08-28.
//
// Two uses: filtering routine threads out of the grid (his decision), and —
// if that decision is ever reversed — giving routine tiles a better title
// than a first prompt could.

import { existsSync, readdirSync } from 'node:fs';
import { ROUTINES_DIR } from '../config.js';

export function loadRoutineSlugs(dir: string = ROUTINES_DIR): Set<string> {
  if (!existsSync(dir)) return new Set();
  try {
    return new Set(
      readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name.toLowerCase()),
    );
  } catch {
    // An unreadable routines directory means we cannot filter. That degrades
    // to showing routine tiles, which is visibly wrong rather than silently
    // wrong — the operator will tell us, and nothing crashes.
    return new Set();
  }
}
