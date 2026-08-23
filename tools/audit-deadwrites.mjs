// Find HANDOFF fields: written by one side, read by nobody.
//
// The pattern behind several reported bugs — the empty speech balloon
// (dlg.timer written nowhere, read by the renderer), the inert ShadowMantle
// flag (written, read via a key that never existed) — is a live write facing
// a dead read, or the reverse. Both are invisible to the suites because the
// state each side keeps is individually correct.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
};
for (const d of ['sim', 'render', 'web', 'input']) if (existsSync(d)) walk(d);

// Comments mention fields constantly; strip them so a note is not a "read".
const code = new Map(files.map((f) => [
  f,
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, ''),
]));

const WRITE = /\b(?:state|st|s)\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+\+|--|\+=|-=)/g;
const writes = new Map();
for (const [f, t] of code) {
  for (const m of t.matchAll(WRITE)) {
    if (!writes.has(m[1])) writes.set(m[1], new Set());
    writes.get(m[1]).add(f);
  }
}

const rows = [];
for (const [name, wf] of writes) {
  let reads = 0;
  const readers = new Set();
  for (const [f, t] of code) {
    // any `.name` occurrence that is NOT immediately an assignment
    const re = new RegExp(`\\.${name}\\b(?!\\s*(?:=(?!=)|\\+\\+|--|\\+=|-=))`, 'g');
    const n = (t.match(re) || []).length;
    if (n) { reads += n; readers.add(f); }
  }
  if (reads === 0) rows.push({ name, wf: [...wf], readers: [] });
}

console.log(`${writes.size} state fields written; ${rows.length} with NO read anywhere\n`);
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  state.${r.name}`);
  console.log(`      written in ${r.wf.join(', ')}`);
}
