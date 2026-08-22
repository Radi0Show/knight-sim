// obj_shake — the screen shake, and in the Roaring Knight fight it is
// GAMEPLAY STATE, not decoration.
//
// It moves `view.x`/`view.y`, and ROARING aims both the soul pull and the star
// spiral at `camerax() + fake_x, cameray() + fake_y + 55`. So while this thing
// is alive the knight's apparent position moves every frame, and with it the
// direction the soul is dragged and the point the stars fall toward. Two
// divergences this project chased separately — the "f192 soul kick" and a live
// star count one over the recording's — were both this object.
//
// THE ONLY SCREEN SHAKE. sim/fx.js used to carry an `addShake` stand-in whose
// magnitude the renderer flipped every frame; both it and its single caller
// were invented and have been removed. obj_shakeobj_ext, which shakes a SPRITE
// rather than the view, is a different object and is not translated.
//
// The original, event for event:
//
//   Create   shakex = shakey = 4, shakesign = 1, shakespeed = 1, active = 0.
//            A second instance destroys itself immediately — one shake at a
//            time, and a new call while one is running does nothing.
//   Step     runs its body ONCE (`active == 0` gate): remembers the unshaken
//            camera, offsets it by +shakex/+shakey, flips the sign, arms
//            alarm[0].
//   Alarm_0  camera = remembered + shake * shakesign; then each axis decays by
//            1; sign flips; alarm re-arms. When both axes reach 0 it destroys
//            itself.
//   Destroy  puts the camera back exactly where it was. The shake leaves no
//            residue — which is why the recorded view returns to a clean 0.
//
// THE PHASE IS THE WHOLE POINT, and it is what made this hard to see from the
// outside. Alarms fire BEFORE Step, so from the second frame onward every
// Step-event reader sees the shaken camera for THAT frame. On the first frame
// there is no alarm yet, only this object's own Step — so whether another
// object sees the shake depends on whether it steps before or after this one.
// obj_knight_roaring2 is created long before the shake and therefore steps
// first, which is exactly why the recording shows the pull using 0 on the
// frame the view already reads 4, and the frame's own value ever after.
//
// Decay 4,4 -> 3,3 -> 2,2 -> 1,1 -> 0 with the sign alternating gives the
// recorded view sequence 4, -4, 3, -2, 0 — matched frame for frame.

import { spawn, destroy } from './entity.js';

function setView(state, x, y) {
  // `global.flag[12]` gates both writes in the original — DELTARUNE's own
  // screen-shake switch. Always 0 in the recordings, so every oracle diff is
  // taken with the shake ON, and it defaults to on here too. When the player
  // turns it off the object still runs, still decays and still destroys
  // itself on the same frame; it just never moves the view. That is exactly
  // what the flag does in the original, so the timing of everything that
  // READS the camera (ROARING aims its pull and its stars at `camerax() +
  // fake_x`) is unchanged either way.
  if (state.flag12) return;
  state.view.x = x;
  state.view.y = y;
}

export const shakeObj = {
  name: 'obj_shake',

  create(e, state) {
    e.camera = 0;
    e.shakespeed = 1;
    e.shakesign = 1;
    e.shakex = 4;
    e.shakey = 4;
    e.siner = 0;
    e.active = 0;
    e.permashake = 0;
    e.beenset = 0;
    e.mycamerax = 0;
    e.mycameray = 0;

    // `instance_number(object_index) >= 2` — counting SELF, so this is "one
    // already existed". The newcomer dies and the running shake continues.
    const live = state.entities.filter(
      (x) => x.alive && x !== e && x.type.name === 'obj_shake',
    ).length;
    if (live >= 1) {
      e.active = -1;
      destroy(e);
    }
  },

  step(e, state) {
    if (e.active !== 0) return;

    e.beenset = 1;
    e.mycamerax = state.view.x;
    e.mycameray = state.view.y;
    setView(state, e.mycamerax + e.shakex, e.mycameray + e.shakey);
    e.shakesign = -e.shakesign;
    e.active = 1;
    e.alarm[0] = e.shakespeed;
  },

  alarm: {
    0(e, state) {
      setView(
        state,
        e.mycamerax + e.shakex * e.shakesign,
        e.mycameray + e.shakey * e.shakesign,
      );

      if (e.permashake === 0) {
        if (e.shakex > 0) e.shakex -= 1;
        if (e.shakey > 0) e.shakey -= 1;
      }

      e.shakesign = -e.shakesign;
      e.alarm[0] = e.shakespeed;

      if (e.shakex === 0 && e.shakey === 0) {
        // THE DESTROY EVENT, inlined. This engine has no Destroy hook, and
        // this is the only thing that ever destroys an obj_shake, so the body
        // lives at the one site that triggers it.
        //
        // Inlining also keeps the TIMING right, which matters: GameMaker runs
        // a Destroy event immediately, not at the end of the frame, so the
        // camera is already back to 0 when this same frame's Step events read
        // it. The recording confirms it — on the shake's last frame the pull
        // aims at an unshaken target.
        if (e.beenset) setView(state, e.mycamerax, e.mycameray);
        destroy(e);
      }
    },
  },
};

/**
 * `scr_shakescreen()` — one line in the original: create one of these. The
 * options mirror the pattern of `inst = instance_create(...); inst.shakex =
 * ...` that the fight's ending uses (30 / 8 / speed 2 — the biggest shake in
 * the fight, on the hit that ends it).
 */
export function scrShakescreen(state, opts = null) {
  // Suites drive damage with minimal states that have no entity list; a
  // shake with nowhere to live is simply skipped, like a view with no room.
  if (!state.entities) return null;
  const e = spawn(state, shakeObj, { x: 0, y: 0 });
  if (opts && e) {
    if (opts.shakex !== undefined) e.shakex = opts.shakex;
    if (opts.shakey !== undefined) e.shakey = opts.shakey;
    if (opts.shakespeed !== undefined) e.shakespeed = opts.shakespeed;
  }
  return e;
}

/**
 * THE VIEW AS INSTANCE `e` SEES IT THIS FRAME.
 *
 * obj_shake's FIRST offset is written in its own Step (every later one is in
 * the alarm, and alarms run before all Steps, so only frame one is
 * order-sensitive). The runner steps NEWEST-FIRST, so on that frame an
 * instance OLDER than the shake steps after it and reads the SHAKEN camera,
 * while a newer one reads the unshaken value.
 *
 * The sim steps oldest-first, which is exactly inverted — so a global
 * stepOrder cannot express this (tried: putting the shake first fixes the
 * tunnel swords and breaks verify21j at f547, because bullets NEWER than the
 * shake must not see it). This resolves it per-reader instead: a shake that
 * has not yet taken its first step (`active === 0`) and is NEWER than `e`
 * contributes its incoming offset.
 *
 * It is gameplay. The tunnel swords cull against `cameray() - 250`, so four
 * pixels of shake move the kill line: verify37 f3169 — a hit lands at f3168,
 * the game's line moves to -246 and kills sword #8008 at y -247.56, and the
 * sim kept it a frame longer.
 */
export function viewFor(state, e) {
  const v = state.view;
  for (const sh of state.entities) {
    if (!sh.alive || sh.type.name !== 'obj_shake') continue;
    if (sh.active !== 0) continue;
    if (!(sh.seq > (e?.seq ?? Infinity))) continue;
    return { x: v.x + sh.shakex, y: v.y + sh.shakey };
  }
  return v;
}
