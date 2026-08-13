// Trace rows. One row per frame, emitted at end of frame.
//
// The GML side of the diff writes `string_format(value, 0, 10)`. The JS side
// must produce a byte-identical string, so reals go through toFixed(10) and
// integers are printed bare.

export const BASE_FIELDS = ['frame', 'soul_x', 'soul_y', 'hp', 'inv_timer', 'phase'];

/**
 * THE WIDE ROW, for whole-fight verification (docs/VERIFICATION.md).
 *
 * The narrow row above was built to diff ONE attack in a frozen scenario. A
 * whole fight has to carry everything that accumulates across fifteen turns —
 * the party's HP individually rather than as one number, the Knight's HP and
 * his creeping damagereduction, TP, the turn and phase, the menu, the bar.
 *
 * A FIELD NOTHING LOOKS AT IS A FIELD THAT CAN DIVERGE SILENTLY. That is how
 * the f32 narrowing survived T3 and T4 — nothing traced image_angle, so
 * nothing could see it drift. Widen this rather than trusting that a column
 * would not have mattered.
 */
export const WIDE_FIELDS = [
  'frame',
  'soul_x', 'soul_y', 'inv_timer',
  'hp0', 'hp1', 'hp2',
  'tension',
  'knight_hp', 'knight_dr',
  'phase', 'turn',
  'menu', 'bar', 'balloon',
  'bullets',
];

/**
 * Format a real to match GML `string_format(v, 0, 10)`.
 *
 * JS `(-0).toFixed(10)` yields "0.0000000000" — no sign. If GML turns out to
 * emit "-0.0000000000" for negative zero, that is a one-cell false divergence
 * and this is where to fix it. Unverified until the first oracle trace lands.
 */
export function real(v) {
  // GML rounds exact ties to EVEN; JS toFixed rounds ties away from zero.
  // Caught by traces/t6-splitter.csv frame 133: the f32 value 405.15869140625
  // is an exact tie at the 10th decimal — GML prints ...4062, toFixed gives
  // ...4063. Same bits, different text, and the differ compares text.
  //
  // toFixed(20) is exact for these values: every float is a dyadic rational,
  // and f32-derived positions in this range have at most ~15 fractional
  // decimals, so no information is lost before the tie is resolved here.
  const s = v.toFixed(20);
  const dot = s.indexOf('.');
  const keep = s.slice(0, dot + 11); // sign, integer part, 10 decimals
  const rest = s.slice(dot + 11);

  if (rest === '' || rest[0] < '5') return keep;

  const isTie = rest[0] === '5' && /^0*$/.test(rest.slice(1));
  const lastDigit = keep.charCodeAt(keep.length - 1) - 48;
  if (isTie && lastDigit % 2 === 0) return keep; // round half to even

  // Round the decimal string up by one unit in the last place.
  const neg = keep[0] === '-';
  const digits = (neg ? keep.slice(1) : keep).replace('.', '').split('');
  let i = digits.length - 1;
  for (; i >= 0; i--) {
    if (digits[i] === '9') {
      digits[i] = '0';
    } else {
      digits[i] = String(Number(digits[i]) + 1);
      break;
    }
  }
  if (i < 0) digits.unshift('1');
  const intLen = digits.length - 10;
  return (neg ? '-' : '') + digits.slice(0, intLen).join('') + '.' + digits.slice(intLen).join('');
}

/** Integers print bare — no decimal point, matching GML string() on an int. */
export function int(v) {
  return String(v);
}

export function traceHeader(state) {
  if (state.traceWide) {
    const cols = [...WIDE_FIELDS];
    for (let i = 0; i < state.traceBulletSlots; i++) {
      // Angle and the scales too — they feed the rotated-mask collision, so a
      // divergence there is a divergence in what can hit you.
      cols.push(`b${i}_x`, `b${i}_y`, `b${i}_a`, `b${i}_xs`, `b${i}_ys`);
    }
    return cols.join(',');
  }
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
  if (state.traceWide) return wideRow(state);

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

/**
 * One wide row. Bullets are sorted by SPAWN ORDER (`seq`), never instance id —
 * ids shift as objects are added, and the game's own per-frame iteration order
 * is not spawn order either. Where the two runs disagree on ordering, the
 * differ matches nearest and asserts the count, as verify-roaring-pull does.
 */
function wideRow(state) {
  const soul = state.soul;
  const bullets = state.entities
    .filter((e) => e.alive && e.isBullet && e.type.name !== 'obj_heart')
    .sort((a, b) => a.seq - b.seq);

  const cells = [
    int(state.frame),
    real(soul ? soul.x : 0),
    real(soul ? soul.y : 0),
    real(state.invTimer ?? 0),
    int(state.partyHp?.[0] ?? 0),
    int(state.partyHp?.[1] ?? 0),
    int(state.partyHp?.[2] ?? 0),
    real(state.tension ?? 0),
    int(state.knight?.hp ?? 0),
    real(state.knight?.damagereduction ?? 0),
    // `phase` is a human string in the narrow row; here it is the numbers, so
    // a diff points at a turn rather than at prose.
    int(state.phaseNum ?? 0),
    int(state.turnNum ?? 0),
    state.menu?.open ? (state.menu.submenu ?? 'buttons') : '-',
    state.fightBar ? int(state.fightBar.boltx) : '-',
    int(state.dialogue?.balloonturn ?? 0),
    int(bullets.length),
  ];

  for (let i = 0; i < state.traceBulletSlots; i++) {
    const b = bullets[i];
    if (!b) {
      cells.push('', '', '', '', '');
      continue;
    }
    cells.push(real(b.x), real(b.y), real(b.image_angle ?? 0),
      real(b.image_xscale ?? 1), real(b.image_yscale ?? 1));
  }
  return cells.join(',');
}
