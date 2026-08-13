#!/usr/bin/env node
// THE SWORD TUNNEL'S FINALE fires, at every difficulty the fight selects.
//
// Not an oracle diff — there is no recording that runs past `finishtimer`. What
// this asserts is that the con-1 path RUNS, because a finale that never
// triggers is indistinguishable from one that triggers and does nothing, and
// this attack has already produced that exact confusion once (CLAUDE.md, the
// dead mask-overlap path).
//
// Each assertion below pins one step of the timeline that would otherwise be
// silent:
//
//   con1        the manager flipped every live sword
//   dash        `_speed == 80` was reached, i.e. the whole brake/turn/back-up/
//               pause sequence completed rather than stalling
//   hitboxes    obj_sword_tunnel_hitbox was actually created — the finale's
//               only damage source
//   smallMask   the soul was swapped to spr_dodgeheart_smallmask, without which
//               a wall of 999px bars would be unsurvivable
//
// difficulty 3 additionally checks `finishtimermax` is 250, not 230. That value
// comes from `obj_knight_enemy.difficulty` rather than the manager's own, and
// the playable scene was not passing it — so the corridor ended 20 frames early
// while every suite stayed green.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';

const idle = { left: false, right: false, up: false, down: false, focus: false };
const failures = [];

for (const difficulty of [0, 3, 4]) {
  const state = createState({ seed: 12345, traceBulletSlots: 0 });
  buildSingleAttackScene(state, { seed: 12345, attack: 'tunnel', difficulty });

  let con1 = null;
  let dash = null;
  let hitboxes = 0;
  let smallMask = null;
  let peakDash = 0;
  let finishtimermax = null;

  for (let f = 0; f < 700; f++) {
    stepFrame(state, idle);
    const mg = state.entities.find(
      (e) => e.alive && e.type.name === 'obj_sword_tunnel_manager',
    );
    if (mg && finishtimermax === null) finishtimermax = mg.finishtimermax;

    const swords = state.entities.filter(
      (e) => e.alive && e.type.name === 'obj_sword_tunnel_sword',
    );
    if (con1 === null && swords.some((s) => s.con === 1)) con1 = f;
    const dashing = swords.filter((s) => s._speed === 80);
    if (dashing.length) {
      if (dash === null) dash = f;
      if (dashing.length > peakDash) peakDash = dashing.length;
    }
    hitboxes += state.entities.filter(
      (e) => e.alive && e.type.name === 'obj_sword_tunnel_hitbox' && e.timer === 1,
    ).length;
    if (smallMask === null && state.soul?.mask?.bbox?.[0] === 6) smallMask = f;
  }

  const tag = `difficulty ${difficulty}`;
  if (con1 === null) failures.push(`${tag}: no sword ever reached con 1`);
  if (dash === null) failures.push(`${tag}: no sword ever reached _speed 80`);
  if (hitboxes === 0) failures.push(`${tag}: obj_sword_tunnel_hitbox was never created`);
  if (smallMask === null) failures.push(`${tag}: the soul's mask never shrank`);
  if (peakDash < 5) failures.push(`${tag}: only ${peakDash} swords dashed at once (expected many)`);
  // 30 frames from con 1 to the dash: 20 + c where c = 10.
  if (con1 !== null && dash !== null && dash - con1 !== 29) {
    failures.push(`${tag}: dash came ${dash - con1} frames after con 1, expected 29`);
  }

  const wantMax = difficulty === 3 ? 250 : 230;
  if (finishtimermax !== wantMax) {
    failures.push(`${tag}: finishtimermax ${finishtimermax}, expected ${wantMax}`);
  }

  console.log(
    `${tag}: con1 f${con1}, dash f${dash} (+${dash - con1}), `
    + `${peakDash} swords at once, ${hitboxes} hitboxes, finishtimermax ${finishtimermax}`,
  );
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

console.log('\nPASS  the tunnel finale runs at difficulties 0, 3 and 4');
