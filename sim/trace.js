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
 * is not spawn order either.
 *
 * Spawn order makes the bullet columns POSITIONAL, so the differ compares them
 * cell for cell with no matching step: `b3_x` is the fourth bullet to exist on
 * each side. The one thing that breaks is a disagreement about how many
 * bullets are alive, which shifts every column at once — so
 * tools/verify-fullfight.mjs checks the COUNT first and suppresses the
 * positional columns past a count divergence, reporting one fault instead of
 * forty.
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
    // `phaseturn` IS NOT THE SIM'S TURN INDEX, and the two disagree for most
    // of every turn.
    //
    // The sim's `turnNum` is the turn ABOUT TO RUN — it advances the moment
    // the previous turn ends. `phaseturn` is incremented by the SELECTOR
    // (Other_10), which the Knight only calls in his `mnfight == 1.5` setup,
    // i.e. after the party has finished acting. So through the whole party
    // menu the game still reads the PREVIOUS turn's number — 0 during turn 1.
    //
    // Both directions of this were wrong in turn: first the raw 0-based index
    // (oracle 1, sim 0 once the attack was up), then a blanket +1 (oracle 0,
    // sim 1 during the menu). Neither is an off-by-one to be patched at the
    // trace; they are different quantities, so the sim tracks the game's own
    // counter and reports that.
    int(state.phaseturn ?? 0),
    // The oracle's coarse menu vocabulary (oracle_fullfight.csx) folds
    // bmenuno 2 (the non-Kris spell list) and 11 (Kris's act picker) into
    // "act", and leaves 9 (the act option grid) as its raw number. The sim's
    // internal submenu names map onto that vocabulary here, so the two
    // columns compare without either side knowing the other's naming.
    state.menu?.open
      ? ({ magic: 'act', actpick: 'act', actgrid: '9' }[state.menu.submenu]
        ?? state.menu.submenu ?? 'buttons')
      : '-',
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
