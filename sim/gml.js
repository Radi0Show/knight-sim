// GML built-in helpers used by translated code.
//
// Translated verbatim from the dump (gml_GlobalScript_*), because the exact
// branch structure is part of the spec — scr_movetowards and scr_approach
// differ subtly at the boundary, and easing curve numbers select different
// formulae entirely.

/** GML clamp. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** scr_movetowards(from, to, step) — snaps to the target, never overshoots. */
export function scrMovetowards(from, to, step) {
  if (from === to) return from;
  if (from > to) return Math.max(from - step, to);
  return Math.min(from + step, to);
}

/**
 * scr_approach(from, to, step) — note this is NOT scr_movetowards: when
 * from > to it decrements and only clamps on crossing, and the equal case
 * falls through the else branch. Kept distinct deliberately.
 */
export function scrApproach(from, to, step) {
  if (from < to) {
    from += step;
    if (from > to) return to;
  } else {
    from -= step;
    if (from < to) return to;
  }
  return from;
}

export function inverselerp(a, b, v) {
  if (b === a) return 0;
  return (v - a) / (b - a);
}

/**
 * GML `==` ON REALS IS NOT BIT-EXACT, AND THIS PROJECT LEARNED IT THE HARD WAY.
 *
 * GameMaker compares two reals with a TOLERANCE (`math_set_epsilon`; nothing in
 * the dump overrides the default). JavaScript's `===` does not. So a GML branch
 * written against an accumulated value —
 *
 *     intensity = scr_approach(intensity, 4, 0.008);   // 1.5 + 0.008 * n
 *     if (intensity == 3.66) { ...ball_darkness fades out... }
 *     if (intensity == 3.74 && knight_sprite == 664) { ...the pose... }
 *
 * — fires in the game and CANNOT fire in a literal translation. 270 additions
 * of 0.008 onto 1.5 land on 3.6600000000000019 in f64 (and 3.65997958 in f32);
 * neither is the literal `3.66`, but both are inside any tolerance GameMaker
 * has ever shipped.
 *
 * Two separate sessions were bitten by this and got it wrong in two different
 * ways: the 3.74 pose was patched to `>= 3.74` and labelled a deliberate
 * deviation, and the 3.66 fade was read as an ORIGINAL BUG and left unwritten
 * — which is a wrong retraction, the failure mode CLAUDE.md already warns
 * about twice. The recording settles it: `traces/roaring2.csv` shows
 * ball_darkness leaving 1 at frame 427, exactly 16 frames (the scr_script_
 * delayed) after intensity reaches 3.66 at frame 411. The branch fires.
 *
 * The recording also BOUNDS the tolerance without needing GameMaker's docs: it
 * fired on one frame only, and consecutive steps are 0.008 apart, so any
 * epsilon in (2e-15, 0.004) reproduces what was recorded. 1e-5 is inside that
 * window and is the default GameMaker's manual gives, so it is what is used
 * here — but the assertion this project can actually defend is the interval,
 * not the constant.
 *
 * USE THIS for any translated `==` between reals where either side is
 * accumulated, lerped or otherwise computed. Integers and values assigned from
 * a literal are safe with `===` and are left alone.
 */
export const GML_EPSILON = 1e-5;

export function gmlEq(a, b) {
  return Math.abs(a - b) < GML_EPSILON;
}

/**
 * GML `a <= b` on reals, with the same tolerance `==` carries.
 *
 * The engine's real comparisons are epsilon-based, so a value sitting a few
 * float-ulps ABOVE a threshold still compares as reaching it. That is not a
 * curiosity for the turn clock: `global.turntimer` is ACCUMULATED — the graze
 * events subtract `timepoints / 30` and `timepoints` all turn long — so a turn
 * that grazed a lot lands on 3.2e-14 rather than a clean 0, and a bit-exact
 * `<= 0` then runs the whole turn ONE FRAME LONG.
 *
 * Measured: verify37 f2315. Both clocks read 1.0 at f2314; the game tears the
 * turn down at f2315 while the sim, holding 3.197e-14, waited for f2316 and
 * diverged the rest of the run. verify21j never showed it because its turns
 * happened to land on exact values.
 */
export function gmlLte(a, b) {
  return a <= b + GML_EPSILON;
}

/**
 * GML `median(...)` — and in this codebase it is a CLAMP, written three ways.
 *
 *     median(-arg2, arg2, angle_difference(arg1, arg0))     // scr_anglechange
 *     median(-argument2, argument2, ...)                    // scr_ease_towards_*
 *
 * Sort the arguments and take the middle, and `median(lo, hi, v)` is exactly
 * `clamp(v, lo, hi)` — which is what every three-argument call in the dump is
 * doing.
 *
 * ORIGINAL BUG, and it is why this helper exists at all:
 *
 *     boxdir = median(180, point_direction(x, y, ...));   // tunnelslash Alarm 0
 *
 * TWO arguments. A two-argument clamp is not a clamp; it degenerates to one
 * side of one. GameMaker sorts and takes index `floor((n - 1) / 2)`, which for
 * an even count is the LOWER of the two middle values — so this is `min(180,
 * dir)`, and the author's intended bound on the other side simply is not
 * there.
 *
 * THE TIE-BREAK IS FROM THE MANUAL, NOT MEASURED. Only the two-argument call
 * depends on it, and only for the half of the spears that spawn above their
 * target; both readings retreat and both lock on. Worth an oracle probe if
 * this attack ever gets one, and NOT worth a game run on its own.
 */
export function gmlMedian(...values) {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
}

/** scr_ease_in(t, curve) — only the curves actually used are implemented. */
export function scrEaseIn(t, curve) {
  if (curve < -3 || curve > 7) return t;
  switch (curve) {
    case 0:
      return t;
    case 1:
      return -Math.cos(t * 1.5707963267948966) + 1;
    case 6:
      return Math.pow(2, 10 * (t - 1));
    case 7:
      return -(Math.sqrt(1 - t * t) - 1);
    case -1: {
      const s = 1.70158;
      return t * t * ((s + 1) * t - s);
    }
    default:
      return Math.pow(t, curve);
  }
}

/** scr_ease_out(t, curve) — mirrors the original's switch exactly. */
export function scrEaseOut(t, curve) {
  if (curve < -3 || curve > 7) return t;
  switch (curve) {
    // THE NEGATIVE CURVES ARE NOT POWERS — they are the three named easings,
    // and they were missing. `default` caught them and computed
    // `pow(t - 1, curve) + 1`, which for curve -1 is `1 / (t - 1) + 1`: -1 at
    // the midpoint and INFINITY at the end. Nothing had called them yet; the
    // intro's sword rise (curve -1) did the same shape by hand as a plain
    // quadratic, which is why the flourish read as soft instead of snapping.
    case -3:
      // ease_out_bounce(t, 0, 1, 1)
      if (t < 0.36363636363636365) return 7.5625 * t * t;
      if (t < 0.7272727272727273) {
        const u = t - 0.5454545454545454;
        return 7.5625 * u * u + 0.75;
      }
      if (t < 0.9090909090909091) {
        const u = t - 0.8181818181818182;
        return 7.5625 * u * u + 0.9375;
      }
      {
        const u = t - 0.9545454545454546;
        return 7.5625 * u * u + 0.984375;
      }
    case -2: {
      // ease_out_elastic(t, 0, 1, 1). With start 0 / change 1 / duration 1
      // the guards collapse: `change < abs(change)` is false, so
      // `_s = (_p / 2pi) * arcsin(1)` = _p / 4 with _p = 0.3.
      if (t === 0) return 0;
      if (t === 1) return 1;
      const p = 0.3;
      const s = p / 4;
      return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
    }
    case -1: {
      // ease_out_back(t, 0, 1, 1) — OVERSHOOTS past the target and settles
      // back, with the standard 1.70158 constant.
      const s = 1.70158;
      const u = t - 1;
      return u * u * ((s + 1) * u + s) + 1;
    }
    case 0:
      return t;
    case 1:
      return Math.sin(t * 1.5707963267948966);
    case 2:
      return -t * (t - 2);
    case 6:
      return -Math.pow(2, -10 * t) + 1;
    case 7: {
      const u = t - 1;
      return Math.sqrt(1 - u * u);
    }
    default: {
      const u = t - 1;
      if (curve === 4) return -1 * (Math.pow(u, curve) - 1);
      return Math.pow(u, curve) + 1;
    }
  }
}

/**
 * scr_ease_inout(t, curve) — the two-sided easing.
 *
 * The named curves short-circuit to their own ease_inout_* forms, and
 * EVERYTHING ELSE falls through to the generic split, which is what the
 * underbox's spin lerps (curve 2) actually use:
 *
 *     arg0 *= 2;
 *     if (arg0 < 1) return 0.5 * scr_ease_in(arg0, arg1);
 *     else { arg0--; return 0.5 * (scr_ease_out(arg0, arg1) + 1); }
 *
 * NOTE curve 1's branch, which is NOT the standard cosine ease and is very
 * probably an ORIGINAL BUG: `-0.5 * cos(pi*t - 1)` — the `- 1` is inside the
 * cosine where every other implementation has `(cos(pi*t) - 1)`. It never
 * reaches 0 or 1 (it runs from about -0.27 to 0.27), so a "1, inout" lerp
 * lands nowhere near its endpoints. Reproduced as written; nothing translated
 * so far passes curve 1 with "inout".
 *
 * -3 / -2 are left to throw rather than guessed at: no caller uses them, and
 * an invented easing curve is exactly the kind of thing that ships as fact.
 */
export function scrEaseInout(t, curve) {
  if (curve < -3 || curve > 7) return t;
  if (curve === -1) {
    // ease_inout_back(t, 0, 1, 1)
    const s = 1.70158 * 1.525;
    let u = t * 2;
    if (u < 1) return 0.5 * (u * u * ((s + 1) * u - s));
    u -= 2;
    return 0.5 * (u * u * ((s + 1) * u + s) + 2);
  }
  if (curve === -3 || curve === -2) {
    throw new Error(`scr_ease_inout curve ${curve} not translated`);
  }
  if (curve === 1) return -0.5 * Math.cos(Math.PI * t - 1);
  if (curve === 0) return t;

  let u = t * 2;
  if (u < 1) return 0.5 * scrEaseIn(u, curve);
  u -= 1;
  return 0.5 * (scrEaseOut(u, curve) + 1);
}

/**
 * GML lengthdir_x / lengthdir_y — degrees, y down on screen.
 *
 * BOTH OPERANDS NARROW TO FLOAT32 before the multiply. This is not a guess:
 * tracking swords diverged from the oracle by exactly one f32 ulp at a single
 * frame (y 104.1218872070 vs 104.1218795776, sword at 45 degrees, len
 * 121.45), and of five candidate roundings only `fround(len) * fround(trig)`
 * reproduces it. Every other suite still passes with it, so it is not a
 * one-frame fudge.
 *
 * Consistent with the project's other f32 findings (CLAUDE.md, "Float32
 * built-ins"): the runner does a lot of its arithmetic in single precision,
 * and only the results that land in plain GML variables stay f64.
 */
const PI32 = Math.fround(Math.PI);

/**
 * The RUNNER's degree->radian path, measured by direct probe (see
 * sim/index.js runMotion): the radian is f32(f32(f32(d) * f32(pi)) / 180)
 * with f64-grade trig. The old f64-radian variant here differed by one f32
 * ulp of trig for ~30% of angles — the seed of a compounding tooth-spawn
 * divergence at whole-fight f890 (lengthdir_x of the cut range at
 * angleoffset+90).
 */
// NO SNAP HERE: the 1e-4 snap to +/-1 belongs to the speed/direction
// component derivation ONLY (probe-verified there). The vortex suite
// discriminates: its sword hangs within the snap window of vertical, and
// the recording's lengthdir_y value is the UNSNAPPED sine (frame 36,
// y 277.4966... vs the snapped 277.5050...).
// EXACT AT THE CARDINALS — which is NOT the snap the note above forbids.
// That snap rounds anything within 1e-4 of an axis, and the vortex suite
// rightly rejects it (its sword hangs near vertical and the recording keeps
// the unsnapped sine). This fires only when the angle is EXACTLY a multiple
// of 90 after normalisation, where traces/trig-probe.csv measured the runner
// returning true zeros and ones. A near-vertical sword is untouched.
//
// It is not cosmetic. `lengthdir_x(37, 90)` is 0 in the game and -1.6e-6 in
// plain JS, so a swept probe fired straight up along x = 340 arrives at
// 339.99999838 — which floors to 339 and falls outside a box whose left edge
// is 340. probe21 f7636 and probe37 f5521 are exactly that: the game
// connects, the sim missed, and it read as a collision-model error for a
// while. The mirror case (probe21 f5549, a probe just PAST the right edge)
// must keep missing, and does: 332 stays 332 instead of drifting to
// 331.99999838 and floating into the box.
function cardinal(dir) {
  const a = ((dir % 360) + 360) % 360;
  return a % 90 === 0 ? a : -1;
}
const COS_CARDINAL = [1, 0, -1, 0];
const SIN_CARDINAL = [0, 1, 0, -1];
function runnerCos(dir) {
  const a = cardinal(dir);
  if (a >= 0) return COS_CARDINAL[a / 90];
  return Math.cos(Math.fround(Math.fround(Math.fround(dir) * PI32) / 180));
}
function runnerSin(dir) {
  const a = cardinal(dir);
  if (a >= 0) return SIN_CARDINAL[a / 90];
  return Math.sin(Math.fround(Math.fround(Math.fround(dir) * PI32) / 180));
}

export function lengthdirX(len, dir) {
  return Math.fround(Math.fround(len) * Math.fround(runnerCos(dir)));
}

export function lengthdirY(len, dir) {
  return -Math.fround(Math.fround(len) * Math.fround(runnerSin(dir)));
}

/**
 * GML `round()` — ROUND HALF TO EVEN, not JS's half-up. Measured the hard
 * way twice: round(92.5) = 92 in the runner (the Susie strike that came out
 * one point high), and again at whole-fight f736 where a FIGHT strike's
 * pre-reduction base hit a .5 tie and Math.round sent the knight's HP one
 * lower than the recording. Negative ties go to even too: round(-2.5) = -2.
 */
export function gmlRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function pointDirection(x1, y1, x2, y2) {
  const d = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

/**
 * `point_distance`. Left in f64 — unlike `lengthdir_*`, the measured values do
 * NOT show single-precision narrowing: ROARING derives each star's scale from
 * this (scale = distance/170) and the recorded scales match the f64 result
 * exactly, to the last digit, across the whole spiral.
 */
export function pointDistance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function angleDifference(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ---- colours ---------------------------------------------------------------
//
// GML packs colours BGR into one integer; the sim only ever needs to MERGE
// them and hand the result to a Draw port, so they are kept as [r,g,b] here.
// They live in sim/ rather than render/ because the original computes them in
// Step events (obj_knight_pointing_starchild's flip) — the renderer only reads.

export const WHITE = [255, 255, 255];
export const BLACK = [0, 0, 0];
export const RED = [255, 0, 0];
export const GRAY = [128, 128, 128];

/**
 * GML `merge_color(c1, c2, amount)` — a per-channel lerp. GameMaker does not
 * clamp `amount`, but it does clamp the resulting bytes, so clamping here is
 * equivalent for every caller in this project (all of which feed it a cosine).
 */
export function mergeColor(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/**
 * `scr_anglechange(current, target, limit)` —
 * `median(-limit, limit, angle_difference(target, current))`, i.e. the signed
 * turn toward `target` capped at `limit`. GML's `median` of three values is a
 * clamp when the outer two are the bounds. Returns the DELTA, not the new
 * angle: every caller adds it.
 */
export function scrAnglechange(current, target, limit) {
  const d = angleDifference(target, current);
  return d < -limit ? -limit : d > limit ? limit : d;
}
