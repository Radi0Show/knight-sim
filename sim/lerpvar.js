// obj_lerpvar — GameMaker-side tweening, and it is a real INSTANCE rather than
// a coroutine, which is why it belongs in sim/ and not in the renderer.
//
// `scr_lerpvar(varname, a, b, maxtime)` creates one of these pointed at the
// caller. Every Step it advances its own clock and writes
// `lerp(a, b, time / maxtime)` straight into the target's variable, then
// destroys itself on the last frame.
//
// It is NOT cosmetic here. ROARING's roar phase spawns its stars at
// `image_xscale = 0.1` and lerps them to 1.2 or 1.6 over 32 frames, and
// `sprite_width` is width x image_xscale — which is exactly what the star's
// offscreen cull measures. A star whose scale does not grow is culled at the
// wrong frame.
//
// ORDERING: the tween is created during the caller's Step, so its own first
// Step lands on the following frame. The first value written is therefore
// `lerp(a, b, 1/maxtime)`, never `a` — the clock increments before the write.
//
// `pointa` may be a STRING in the original, meaning "read the target's current
// value when you start" (deferred, not at create time). Supported here for
// fidelity; roaring always passes a number.

import { destroy } from './entity.js';
import { lerp, scrEaseOut, scrEaseIn, scrEaseInout } from './gml.js';

export const lerpvar = {
  name: 'obj_lerpvar',

  create(e) {
    e.variable = 0;
    e.varname = 'variable';
    e.pointa = 0;
    e.pointb = 0;
    e.time = 0;
    e.maxtime = 30;
    e.target = -1;
    e.init = 0;
    e.easetype = 0;
    e.easeinout = 'out';
    e.respectglobalinteract = false;
  },

  step(e, state) {
    // `i_ex(target)` — a tween whose target has been destroyed goes with it.
    if (!e.target || e.target === -1 || !e.target.alive) {
      destroy(e);
      return;
    }

    if (e.init === 0) {
      if (typeof e.pointa === 'string') e.pointa = e.target[e.varname];
      e.init = 1;
    }

    e.time += 1;

    if (e.easetype === 0) {
      e.target[e.varname] = lerp(e.pointa, e.pointb, e.time / e.maxtime);
    } else if (e.easeinout === 'out') {
      e.target[e.varname] = lerp(
        e.pointa,
        e.pointb,
        scrEaseOut(e.time / e.maxtime, e.easetype),
      );
    } else if (e.easeinout === 'in') {
      e.target[e.varname] = lerp(
        e.pointa,
        e.pointb,
        scrEaseIn(e.time / e.maxtime, e.easetype),
      );
    } else if (e.easeinout === 'inout') {
      // The underbox's spin lurch is the first caller of this arm (curve 2).
      e.target[e.varname] = lerp(
        e.pointa,
        e.pointb,
        scrEaseInout(e.time / e.maxtime, e.easetype),
      );
    } else {
      throw new Error(`lerpvar easeinout "${e.easeinout}" not translated`);
    }

    if (e.time >= e.maxtime) destroy(e);
  },
};

/**
 * `scr_lerpvar(...)`, with the caller passed explicitly since JS has no `id`.
 * Returns the tween so a caller can adjust it, as the original's return does.
 */
export function scrLerpvar(
  state, spawnFn, target, varname, pointa, pointb, maxtime, easetype, easeinout,
) {
  const t = spawnFn(state, lerpvar, { x: 0, y: 0 });
  t.target = target;
  t.varname = varname;
  t.pointa = pointa;
  t.pointb = pointb;
  t.maxtime = maxtime;
  if (easetype !== undefined) t.easetype = easetype;
  if (easeinout !== undefined) t.easeinout = easeinout;
  return t;
}
