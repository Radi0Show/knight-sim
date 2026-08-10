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

/** GML lengthdir_x / lengthdir_y — degrees, y down on screen. */
export function lengthdirX(len, dir) {
  return len * Math.cos((dir * Math.PI) / 180);
}

export function lengthdirY(len, dir) {
  return -len * Math.sin((dir * Math.PI) / 180);
}

export function pointDirection(x1, y1, x2, y2) {
  const d = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

export function angleDifference(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
