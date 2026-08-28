// Reading the generated thread title out of a Claude Code transcript.
//
// Why this exists: a tile named after the operator's raw prompt is not the
// name he sees in the Claude app's sidebar, so the HUD and the app disagree
// about what a thread is called — which defeats recognising a tile at a glance.
//
// Claude Code writes a generated title into the transcript as its own record:
//
//   {"type":"ai-title","aiTitle":"Task list, file read, and subagent test",
//    "sessionId":"35a5138c-…"}
//
// For LOCAL sessions that file is on this Mac and we can simply read it. For
// Cowork sessions it lives inside Anthropic's container and is unreachable
// from here — those titles arrive by a different route (a command hook in the
// plugin), which is why this module deals only with what it can actually see.
//
// Two cautions, both deliberate:
//
//   • The docs warn that transcript format is internal and changes between
//     versions. This is therefore best-effort by design: any failure returns
//     undefined and the caller keeps the title it already had. A missing title
//     is a cosmetic problem; a crash in the ingest path is not.
//   • Titles appear only after Claude has generated one, so an early read
//     legitimately finds nothing. Callers should retry on later events rather
//     than concluding the title will never exist.

import { readFileSync, statSync } from 'node:fs';

/** Transcripts grow; only the tail is worth scanning for a late-written title. */
const MAX_TAIL_BYTES = 512 * 1024;

export function readAiTitle(transcriptPath: string | undefined): string | undefined {
  if (!transcriptPath) return undefined;
  try {
    const size = statSync(transcriptPath).size;
    if (size === 0) return undefined;

    let text: string;
    if (size <= MAX_TAIL_BYTES) {
      text = readFileSync(transcriptPath, 'utf8');
    } else {
      // Read only the tail. The first partial line is discarded below.
      const fd = readFileSync(transcriptPath);
      text = fd.subarray(size - MAX_TAIL_BYTES).toString('utf8');
    }

    // Scan newest-first: a session retitled later should win.
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"ai-title"')) continue;
      try {
        const rec = JSON.parse(line) as { type?: string; aiTitle?: unknown };
        if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string') {
          const title = rec.aiTitle.trim();
          if (title) return title;
        }
      } catch {
        // A truncated first line from the tail read, or a format change.
        // Neither is worth reporting; keep scanning.
      }
    }
  } catch {
    // Missing file, permissions, a path inside a container we cannot see —
    // all expected, none actionable.
  }
  return undefined;
}
