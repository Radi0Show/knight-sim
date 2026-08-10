// Seeded PRNG. Rule 2: Math.random never appears in sim/.
//
// mulberry32. The whole generator state is one uint32 held in a plain object,
// so it can be snapshotted into a replay file and restored bit-exactly. That
// matters more than raw quality here — we need reproducibility, not crypto.
//
// GML's own random() stream is a different generator. We are not trying to
// match it. Where an attack's behaviour depends on the original stream, the
// plan (see CLAUDE.md, "The oracle") is to log the original's outputs and
// replay them from a table rather than pretend our PRNG agrees.

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
