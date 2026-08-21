// Seeded PRNGs. Rule 2: Math.random never appears in sim/.
//
// TWO generators live here:
//
// 1. gmlRng — GameMaker's ACTUAL generator, discovered empirically per the
//    CLAUDE.md RNG policy and validated against 131 logged oracle outputs
//    (traces/rng-probe.csv, replayed by tools/verify-rng.mjs):
//
//      core     WELL512 (Lomont): 16x32-bit state, poly 0xDA442D24
//      seeding  16 rounds of s = ((s*214013 + 2531011) & 0xFFFFFFFF) >>> 16
//               (the truncation and LOGICAL shift are load-bearing — each
//               state word is seeded from only 16 bits)
//      random(x)          u32/2^32 * x                       1 draw
//      random_range(a,b)  a + u32/2^32 * (b-a)               1 draw
//      irandom(n)         (lo | (hi & 0x7fffffff)<<32) % (n+1)   2 draws
//      irandom_range(a,b) a + i63 % (b-a+1)                  2 draws
//      choose(...)        args[u32 % argc]                   1 draw
//
//    The i63 compose (low word full, high word masked to 31 bits) was pinned
//    by the irandom_range section: an unmasked 2^63 bit shifts a mod-7 by
//    exactly 1, and every observed mismatch was exactly that.
//
//    With the same seed and the same call order, gmlRng reproduces the real
//    game's stream — which makes seed-locked verification of RNG-dependent
//    attacks possible without neutralization. Call order includes DRAW-event
//    consumption (e.g. the teeth bullets' per-frame visual jitter), so
//    translated attacks must account for those draws too.
//
// 2. mulberry32 — the sim's own lightweight stream for anything that does
//    not need to match the original (menu effects, non-verified wobble).
//
// State for both is plain data, snapshottable into replay files.

export function createRng(seed) {
  return { s: seed >>> 0 };
}

/** Next real in [0, 1). Advances the stream. */
export function rngNext(r) {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** GML `random(n)` — real in [0, n). */
export function rngRandom(r, n) {
  return rngNext(r) * n;
}

/** GML `irandom(n)` — integer in [0, n], inclusive at both ends. */
export function rngIrandom(r, n) {
  return Math.floor(rngNext(r) * (n + 1));
}

/** GML `random_range(lo, hi)` — real in [lo, hi). */
export function rngRange(r, lo, hi) {
  return lo + rngNext(r) * (hi - lo);
}

/** GML `choose(...)`. */
export function rngChoose(r, values) {
  return values[Math.floor(rngNext(r) * values.length)];
}

export function rngSnapshot(r) {
  return r.s >>> 0;
}

export function rngRestore(r, s) {
  r.s = s >>> 0;
}

// ---------------------------------------------------------------------------
// gmlRng — GameMaker's generator. See the header for provenance.
// ---------------------------------------------------------------------------

const POLY = 0xda442d24;

/** GML random_set_seed(seed). */
export function gmlCreate(seed) {
  const state = new Uint32Array(16);
  let s = seed >>> 0;
  for (let i = 0; i < 16; i++) {
    // Math.imul keeps the multiply in 32 bits, matching the runner.
    s = (Math.imul(s, 214013) + 2531011) >>> 16;
    state[i] = s;
  }
  return { state, idx: 0, seed: seed >>> 0 };
}

/** One raw 32-bit draw (WELL512 step). */
export function gmlU32(r) {
  r.draws = (r.draws ?? 0) + 1;
  globalThis.__draws = (globalThis.__draws ?? 0) + 1;  // TEMP
  if (globalThis.__trap) {
    const e = new Error();
    const site = e.stack.split('\n').slice(2, 5).map((l) => l.trim().replace(/^at /, '')
      .replace(/\(.*\/(sim|tools)\//, '(')).join(' <- ');
    console.error(`DRAW f=${globalThis.__simFrame} n=${r.draws} ${site}`);
  }
  const st = r.state;
  let a = st[r.idx];
  let c = st[(r.idx + 13) & 15];
  const b = (a ^ c ^ (a << 16) ^ (c << 15)) >>> 0;
  c = st[(r.idx + 9) & 15];
  c = (c ^ (c >>> 11)) >>> 0;
  a = st[r.idx] = (b ^ c) >>> 0;
  const d = (a ^ ((a << 5) & POLY)) >>> 0;
  r.idx = (r.idx + 15) & 15;
  a = st[r.idx];
  st[r.idx] = (a ^ b ^ d ^ (a << 2) ^ (b << 18) ^ (c << 28)) >>> 0;
  return st[r.idx];
}

/** Two draws composed to 63 bits: low word full, high word masked to 31. */
function gmlI63(r) {
  const lo = gmlU32(r);
  const hi = gmlU32(r) & 0x7fffffff;
  // Exact in f64: hi < 2^31, so hi*2^32 + lo < 2^63 needs BigInt for the
  // modulo path only. Callers take % of it, so return BigInt.
  return (BigInt(hi) << 32n) | BigInt(lo);
}

/** GML random(x) — 1 draw. */
export function gmlRandom(r, x) {
  return (gmlU32(r) / 4294967296) * x;
}

/** GML random_range(lo, hi) — 1 draw. */
export function gmlRandomRange(r, lo, hi) {
  return lo + (gmlU32(r) / 4294967296) * (hi - lo);
}

/** GML irandom(n) — 2 draws. */
export function gmlIrandom(r, n) {
  return Number(gmlI63(r) % BigInt(n + 1));
}

/** GML irandom_range(lo, hi) — 2 draws. */
export function gmlIrandomRange(r, lo, hi) {
  return lo + Number(gmlI63(r) % BigInt(hi - lo + 1));
}

/** GML choose(...) — 1 draw regardless of arity. */
export function gmlChoose(r, values) {
  return values[gmlU32(r) % values.length];
}

/** randomsign() — `(irandom(1) * 2) - 1`, so TWO draws, not one. */
export function gmlRandomsign(r) {
  return gmlIrandom(r, 1) * 2 - 1;
}

/**
 * `ds_list_shuffle` — the DRAW COUNT is the verified part, not the order.
 *
 * Probed inside the real game (`oracle_shuffle_probe.csx`,
 * `traces/shuffle-probe.csv`): it consumes exactly **16 u32 draws per list
 * element**, constant across seeds — 64 for n=4, 96 for n=6, 208 for n=13.
 * Sixteen is WELL512's state size, so it advances one full state pass per
 * element. The algorithm itself resisted a structured search (peak 3/18,
 * chance level), and CLAUDE.md carries it as unsolved.
 *
 * So this burns the measured number of draws and then permutes with our own
 * Fisher-Yates over the same generator: statistically equivalent, not
 * bit-identical, and correct in the one respect anything downstream can
 * observe — where the stream is left.
 *
 * obj_knight_combinations is the only caller that matters, and it THROWS THE
 * RESULT AWAY three lines later (see sim/attacks/combination.js), so for the
 * one attack that shuffles, the unsolved algorithm is not a blocker at all.
 *
 * NOTE the older `shuffleList` in sim/attacks/rotating-slash.js consumes n-1
 * draws instead of 16n. It is left alone deliberately: its attack is
 * oracle-diffed against a recording with the order pinned on both sides, and
 * changing its stream position now would move a verified diff to chase a
 * number that diff does not depend on.
 */
export function gmlShuffle(rng, list) {
  for (let i = 0; i < list.length * 16; i++) gmlU32(rng);
  for (let i = list.length - 1; i > 0; i--) {
    const j = gmlU32(rng) % (i + 1);
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}
