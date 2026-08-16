// obj_tvturnoff_manager — Chapter 3's CRT power-off, translated from its
// Other_10 (the whole effect lives in that one event: it both steps the
// state machine and draws).
//
// Driver-side like the intro and the ending, so no sim state is touched and
// replay tokens stay byte-identical.
//
// The picture collapses the way a real CRT does: a tall white pane squashes
// to a horizontal line while a bright blob swells and then pinches out.
//
//     con 0   timer 0..5    alpha lerps 0 -> 1, pane at xscale 6 / yscale 10
//     con 1   timer 0..8    snd_tvturnoff at 4; yscale1 -> 0.05 (iterative)
//                           the blob appears at 0.1
//     con 2   timer 0..30   snd_tvturnoff2 on entry; xscale1 -> 0,
//                           yscale1 -> 0.01 over 10; the blob swells to 0.4
//                           over 5 then shrinks to 0 over the next 5, and the
//                           screen holds black to 30
//
// EVERY LERP IS ITERATIVE — `_yscale1 = lerp(_yscale1, 0.05, timer / 8)`
// re-reads its own current value each frame, so it approaches its target on a
// curve rather than travelling linearly. Writing these as absolute lerps
// (`lerp(start, target, t)`) gives a visibly different, more mechanical
// collapse, so they are kept in the original's form.
//
// The manager's other three `kind`s (room transitions, warping the party) are
// not translated: this build only ever uses `kind = 0`, the plain wipe.

/** Frame counts, straight from the event. */
export const TV_CON1_END = 8;
export const TV_CON2_END = 30;

export function createTvTurnoff() {
  return {
    con: 0,
    timer: 0,
    timer2: 0,
    alpha1: 1,
    xscale1: 10,
    yscale1: 10,
    xscale2: 0.1,
    yscale2: 0.1,
    done: false,
  };
}

/** GML `lerp`. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * One 30Hz tick. `cues` collects sound requests, like every other scene here.
 *
 * NOTE the draw-time values are computed here rather than in the renderer:
 * the original does both in Other_10, and the 30Hz rule means the scales must
 * advance on sim ticks, not per paint.
 */
export function stepTvTurnoff(tv, cues) {
  if (tv.done) return;

  if (tv.con === 0) {
    tv.timer += 1;
    tv.alpha1 = lerp(0, 1, tv.timer / 5);
    // `_xscale1` is untouched in con 0 — the pane is drawn at a hardcoded 6.
    if (tv.timer === 5) {
      tv.con = 1;
      tv.timer = 0;
    }
    return;
  }

  if (tv.con === 1) {
    tv.timer += 1;
    if (tv.timer === 4) cues.push({ name: 'snd_tvturnoff', pitch: 1, gain: 1 });
    tv.yscale1 = lerp(tv.yscale1, 0.05, tv.timer / 8);
    if (tv.timer === TV_CON1_END) {
      tv.con = 2;
      tv.timer = 0;
      cues.push({ name: 'snd_tvturnoff2', pitch: 1, gain: 1 });
      // `audio_pause_sound(global.batmusic[1])` — the fight's track stops
      // dead here rather than fading.
      cues.push({ name: 'mus_knight', stop: true, music: true });
    }
    return;
  }

  if (tv.con === 2) {
    tv.timer += 1;
    const timing = 10;
    if (tv.timer <= timing) {
      tv.xscale1 = lerp(tv.xscale1, 0, tv.timer / timing);
      tv.yscale1 = lerp(tv.yscale1, 0.01, tv.timer / timing);
    }
    tv.timer2 += 1;
    const timing2 = 5;
    if (tv.timer2 <= timing2) {
      tv.xscale2 = lerp(tv.xscale2, 0.4, tv.timer2 / timing2);
      tv.yscale2 = lerp(tv.yscale2, 0.4, tv.timer2 / timing2);
    } else {
      tv.xscale2 = lerp(tv.xscale2, 0, (tv.timer2 - timing2) / timing2);
      tv.yscale2 = lerp(tv.yscale2, 0, (tv.timer2 - timing2) / timing2);
    }
    if (tv.timer === TV_CON2_END) {
      tv.con = 3;
      tv.timer = 0;
      tv.done = true;
    }
  }
}
