// Trace rows. One row per frame, emitted at end of frame.
//
// The GML side of the diff writes `string_format(value, 0, 10)`. The JS side
// must produce a byte-identical string, so reals go through toFixed(10) and
// integers are printed bare.

export const BASE_FIELDS = ['frame', 'soul_x', 'soul_y', 'hp', 'inv_timer', 'phase'];

/**
 * Format a real to match GML `string_format(v, 0, 10)`.
 *
 * JS `(-0).toFixed(10)` yields "0.0000000000" — no sign. If GML turns out to
 * emit "-0.0000000000" for negative zero, that is a one-cell false divergence
 * and this is where to fix it. Unverified until the first oracle trace lands.
 */
export function real(v) {
  return v.toFixed(10);
}

/** Integers print bare — no decimal point, matching GML string() on an int. */
export function int(v) {
  return String(v);
}

export function traceHeader(state) {
  const cols = [...BASE_FIELDS];
  for (let i = 0; i < state.traceBulletSlots; i++) {
    cols.push(`b${i}_x`, `b${i}_y`);
  }
  // Scene-defined extra columns (state.traceExtraHeader / state.traceExtra),
  // for mirroring oracle traces that carry attack state.
  if (state.traceExtraHeader) cols.push(...state.traceExtraHeader);
  return cols.join(',');
}

/**
 * Bullets in spawn order — never instance id, which shifts as objects are
 * added. Slots are fixed-width so every row has the same column count; an
 * empty slot is an empty cell, which compares exactly like any other.
 */
export function traceRow(state) {
  const soul = state.soul;

  const cells = [
    int(state.frame),
    real(soul ? soul.x : 0),
    real(soul ? soul.y : 0),
    int(state.hp),
    int(state.invTimer),
    state.phase,
  ];

  const bullets = state.entities
    .filter((e) => e.alive && e.isBullet)
    .sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < state.traceBulletSlots; i++) {
    const b = bullets[i];
    cells.push(b ? real(b.x) : '', b ? real(b.y) : '');
  }

  if (state.traceExtra) cells.push(...state.traceExtra(state));

  return cells.join(',');
}
