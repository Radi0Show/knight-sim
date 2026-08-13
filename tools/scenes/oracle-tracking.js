// TRACKING SWORDS (ac 11, dc.type 151) — against
// knight-research/traces/tracking11.csv, recorded with
// `tools/oracle-run.sh 1 2 tracking11 frames=420`.
//
// Pins the manager's cadence (`rate` decaying 32 -> 16 by 4), the anti-repeat
// heading wheel, each sword's con/timer/alpha/len lifecycle, its tracked
// position around the soul, and the frame its slash hitbox appears.
//
// ONE RECORDED INPUT: the per-sword heading. The manager picks it with
// `choose` of the eight compass points and then walks it past `directionprev`,
// and the stream by that point has been consumed by the knight's own setup and
// by each sword's afterimage. The eight headings are replayed; everything
// downstream — the spawn ring, the image_angle, the slash — is computed.
//
// THE ANTI-REPEAT WHEEL IS THEREFORE NOT VERIFIED, and this is worth being
// blunt about. The recorded headings are what the manager produced AFTER the
// wheel ran, so replaying them makes the wheel a no-op: deleting the entire
// `directionprev` pass still passes this suite (sabotage-tested — it does).
// The translation is faithful to the GML, but nothing here is evidence of
// that.
//
// What would cover it: an oracle patch that logs `inst.direction` immediately
// after the `choose` and again after the wheel. Replaying the RAW value would
// make the wheel load-bearing.
//
// NOT MODELLED, and it bounds the window: the real turntimer drains faster
// than one per frame because obj_tracking_sword_slash_extra_graze subtracts
// `1/30 * grazetimefactor` on every graze. Graze is a TP mechanic and this
// project is dodge-only, so the sim ticks turntimer down by 1. The manager's
// only turntimer read is `< 70`, which the verified window never reaches.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { trackingSwordsManager } from '../../sim/attacks/tracking-swords.js';

/** Oracle frame the manager is created on; its first Step is the next frame. */
export const MANAGER_FRAME = 13;

/**
 * Eight swords. The window ENDS AT 160 for a measured reason, not a round
 * number: the manager's only turntimer read is `if (global.turntimer < 70)
 * exit`, and in the recording turntimer crosses 70 on frame 164 — at which
 * point the manager's `timer` freezes at 9 forever. It gets there early
 * because graze drains it (84 -> 72 in a single frame at 161), and graze is
 * not modelled here. Everything up to 160 is unaffected by that.
 */
export const TRACKING_WINDOW = { from: 13, to: 160 };

/** Measured from the trace, in spawn order. See the note above. */
export const SWORD_DIRECTIONS = [180, 45, 90, 135, 225, 270, 0, 315];

/** obj_growtangle for ac 11 sits at (320,190), not the usual (320,170). */
const BOX = { x: 320, y: 190 };
const SOUL_START = { x: 310, y: 180 };

export const ORACLE_TRACKING_INPUT = [{ from: 0 }];

const spawner = {
  name: 'tracking_spawner',
  create(e) {
    e.done = false;
  },
  endStep(e, state) {
    if (e.done || state.frame !== MANAGER_FRAME) return;
    // The controller creates it at (obj_growtangle.x, cameray()).
    const mg = spawn(state, trackingSwordsManager, { x: BOX.x, y: state.view.y });
    mg.variant = 0; // dc.difficulty for ac 11 phase 1
    mg.damage = 1;
    trackingSwordsManager.init(mg, state);
    e.done = true;
  },
};

/** obj_battlecontroller's turntimer countdown. */
const clock = {
  name: 'tracking_clock',
  beginStep(e, state) {
    state.turntimer -= 1;
  },
};

export function buildOracleTrackingScene(state) {
  state.view = { x: 0, y: 0 };
  // scr_turntimer(292) for ac 11 difficulty 0; the trace reads 290 by the
  // frame the manager appears.
  state.turntimer = 290 + MANAGER_FRAME;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, clock, {});
  spawn(state, spawner, {});

  state.swordDirections = SWORD_DIRECTIONS;
  state.swordIndex = 0;
}
