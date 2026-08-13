#!/usr/bin/env node
// EVERY LIVE BULLET CARRIES REAL DAMAGE — a guard against the quietest bug
// this project has produced.
//
// `scr_bullet_init` gives every bullet `damage = 10`. That is a PLACEHOLDER:
// the real number arrives later, either from the bullet's own Other_15 (the
// slashes hardcode 206/75) or from `scr_bullet_inherit` walking it down the
// spawn chain (controller 200, or the splitslash's 206).
//
// A bullet that never receives either keeps the 10 — and 10 is small enough
// that `scr_damage_calculation` subtracts it almost to nothing, because it
// takes 1 per DF point below maxhp/8 rather than 3. Against the party's real
// defence, 10 lands as 0-3, which the game floors at 1.
//
// So the failure does not crash, does not throw, does not diverge in any
// column the trace differ watches, and does not look wrong in the renderer.
// It looks like an attack that is not very dangerous. Flurry's teeth shipped
// that way and were caught by a human PLAYING the fight, not by 41 suites.
//
// This check exists so the next one is caught here. For each live attack it
// runs the scene and inspects every entity that resolves damage through
// `collidebulletOther15` — the path that reads `e.damage` at hit time rather
// than assigning its own. Any such entity still holding the placeholder is a
// missing inherit.
//
//     node tools/verify-damage.mjs

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { ATTACK_MENU } from '../sim/scenes/single.js';
import { collidebulletOther15 } from '../sim/bullets/regularbullet.js';
import { scrDamageCalculation } from '../sim/damage.js';

// scr_bullet_init's value. Not a magic number — the whole point of the check.
const PLACEHOLDER = 10;
const FRAMES = 900;

// The bullets below legitimately keep a value the check would otherwise
// flag, with the dump line that says so. Anything not listed must inherit.
const EXPECTED = new Map([
  // No entries today. Add one only with a dump citation showing the object
  // is spawned WITHOUT an inherit and never overrides — not to silence a
  // failure. A wrong entry here re-hides exactly the bug this file exists to
  // catch.
]);

function damagingEntities(state) {
  const out = [];
  for (const e of state.entities) {
    if (!e.alive) continue;
    // Only the bullets that resolve through the inherited gate: those read
    // `e.damage` when they hit. An object with its own other15 assigns its
    // damage there and is not at risk.
    if (e.type?.other15 !== collidebulletOther15) continue;
    out.push(e);
  }
  return out;
}

let failures = 0;
let checked = 0;

for (const atk of ATTACK_MENU) {
  const difficulty = atk.difficulties[0];
  const state = createState({ seed: 12345 });
  buildSingleAttackScene(state, { seed: 12345, attack: atk.id, difficulty });

  // name -> the damage it was first seen carrying
  const seen = new Map();
  for (let f = 0; f < FRAMES; f++) {
    stepFrame(state, {});
    for (const e of damagingEntities(state)) {
      const n = e.type.name;
      if (!seen.has(n)) seen.set(n, { damage: e.damage, frame: f });
    }
  }

  if (seen.size === 0) {
    console.log(`  ${atk.name}: no inherit-gated bullets`);
    continue;
  }

  for (const [name, v] of seen) {
    checked += 1;
    const expected = EXPECTED.get(name);
    const bad = v.damage === undefined
      || (v.damage === PLACEHOLDER && expected !== PLACEHOLDER);
    // What a hit would actually take off Kris, which is the number a player
    // sees and the reason this matters.
    const lands = v.damage === undefined
      ? 'NaN'
      : Math.max(1, scrDamageCalculation(v.damage, 0, true, state));

    if (bad) {
      failures += 1;
      console.log(
        `  FAIL ${atk.name} / ${name}: damage=${v.damage} (placeholder) `
        + `-> lands ${lands} on Kris. Missing scr_bullet_inherit from its spawner.`,
      );
    } else {
      console.log(
        `  ok   ${atk.name} / ${name}: damage=${v.damage} -> lands ${lands}`,
      );
    }
  }
}

console.log(
  failures === 0
    ? `\nall ${checked} inherit-gated bullets carry real damage`
    : `\n${failures} of ${checked} bullets still hold scr_bullet_init's placeholder`,
);
process.exit(failures === 0 ? 0 : 1);
