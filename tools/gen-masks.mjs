#!/usr/bin/env node
// Regenerate sim/data/masks.js from sim/data/masks.json.
// sim/ must not read the filesystem — it runs in the browser too.
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(new URL('../sim/data/masks.json', import.meta.url), 'utf8'));
const out =
  `// GENERATED from sim/data/masks.json — do not edit by hand.\n` +
  `// Regenerate: node tools/gen-masks.mjs\n//\n` +
  `// sim/ must not touch the filesystem (it runs in the browser too), so the\n` +
  `// mask data is a static module rather than a JSON read.\n\n` +
  `export const MASK_DATA = ${JSON.stringify(raw)};\n`;
writeFileSync(new URL('../sim/data/masks.js', import.meta.url), out);
console.log('wrote sim/data/masks.js');
