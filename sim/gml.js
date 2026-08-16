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
export function lengthdirX(len, dir) {
  return Math.fround(Math.fround(len) * Math.fround(Math.cos((dir * Math.PI) / 180)));
}

export function lengthdirY(len, dir) {
  return -Math.fround(Math.fround(len) * Math.fround(Math.sin((dir * Math.PI) / 180)));
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
