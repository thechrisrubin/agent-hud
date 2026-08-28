// Agent HUD — Phase 0 capture summarizer (read-only).
// Reads probes/captured/events.ndjson and prints, per hook event type:
// how many arrived, from which source labels, and the exact union of
// payload field names observed. Optionally prints one redacted sample.
//
// Run:  node probes/summarize-captures.mjs            (summary only)
//       node probes/summarize-captures.mjs Stop       (summary + sample of one event)
//       node probes/summarize-captures.mjs --all      (summary + a sample of every type)
//
// Prompt text and assistant text are truncated to 40 chars, per the runbook.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, 'captured', 'events.ndjson');

if (!existsSync(file)) {
  console.log('No captures yet at probes/captured/events.ndjson');
  process.exit(0);
}

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter(Boolean);

const REDACT = ['prompt', 'last_assistant_message', 'message', 'command'];

function redact(value, depth = 0) {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.includes(k) && typeof v === 'string' && v.length > 40
        ? v.slice(0, 40) + `… [+${v.length - 40} chars redacted]`
        : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const byEvent = new Map();
for (const r of rows) {
  const key = r.hook_event_name || '(no hook_event_name)';
  if (!byEvent.has(key)) {
    byEvent.set(key, { count: 0, fields: new Set(), labels: new Set(), remotes: new Set(), sample: r });
  }
  const rec = byEvent.get(key);
  rec.count += 1;
  rec.labels.add(r.source_label);
  rec.remotes.add(r.forwarded_for ? `${r.remote_addr} via ${r.forwarded_for}` : r.remote_addr);
  for (const f of Object.keys(r.payload || {})) rec.fields.add(f);
}

const KEY_FIELDS = ['session_id', 'prompt_id', 'transcript_path', 'permission_mode', 'cwd'];

console.log(`Agent HUD — captured events: ${rows.length} total, ${byEvent.size} distinct event types\n`);
for (const [event, rec] of [...byEvent.entries()].sort()) {
  const present = KEY_FIELDS.map((f) => `${f}=${rec.fields.has(f) ? 'Y' : 'n'}`).join(' ');
  console.log(`${event}  (x${rec.count})`);
  console.log(`  labels : ${[...rec.labels].join(', ')}`);
  console.log(`  from   : ${[...rec.remotes].join(', ')}`);
  console.log(`  key    : ${present}`);
  console.log(`  fields : ${[...rec.fields].sort().join(', ')}`);
  console.log('');
}

const arg = process.argv[2];
if (arg === '--all') {
  for (const [event, rec] of [...byEvent.entries()].sort()) {
    console.log(`=== sample: ${event} ===`);
    console.log(JSON.stringify(redact(rec.sample.payload), null, 2));
    console.log('');
  }
} else if (arg) {
  const rec = byEvent.get(arg);
  if (!rec) console.log(`No captures for event "${arg}".`);
  else {
    console.log(`=== sample: ${arg} ===`);
    console.log(JSON.stringify(redact(rec.sample.payload), null, 2));
  }
}
