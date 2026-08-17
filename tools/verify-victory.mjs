#!/usr/bin/env node
// THE ENDING CUTSCENE — obj_ch3_PTB02's Step, the block after the last hit.
//
// Nothing covered this before, and it is a hundred lines of cutscene commands
// translated by hand into a script table. The failure mode is not a crash: a
// mistranslated command puts an actor somewhere slightly wrong and the scene
// still plays, so it can only be caught by reading a number.
//
// The one that was wrong is the reason this file exists. `c_walkwait` takes a
// SPEED and a DURATION, not a distance:
//
//     // scr_cutscene_commands, the "walk" branch
//     actor_move.speed = command_arg2[i];
//     actor_move.time  = command_arg3[i];
//     // and the SKIP path, which must land the actor in the same place:
//     command_actor[i].x += lengthdir_x(command_arg2[i] * command_arg3[i], ...)
//
// so `c_walkwait("r", 8, 10)` moves Ralsei EIGHTY pixels. It was reading the
// 8 as the distance, so he took one step toward the fallen Susie and stopped —
// reported from play as him needing to walk up further. The instant branch is
// the assertion below, because it is the game stating the product itself.
//
// NO ORACLE. The cutscene cannot be traced frame-by-frame the way an attack
// can — it is driven by dialogue confirms, and every recording of it would be
// a recording of the recorder's button presses. These are positive-execution
// assertions on the sim's own script, aimed at the numbers the dump states
// outright.

import { createVictoryScene, stepVictoryScene, VICTORY_LINES } from '../sim/victory-scene.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

/**
 * Run the scene, mashing confirm on a duty cycle so the dialogue advances.
 * The writer is edge-triggered and the scene starts with confirm HELD (the
 * ending's own last press), so a solid press would advance nothing.
 */
function run(frames, watch) {
  const sc = createVictoryScene();
  const seen = [];
  for (let f = 0; f < frames; f++) {
    stepVictoryScene(sc, { ...IDLE, confirm: f % 8 < 3 ? 1 : 0 }, []);
    if (watch) {
      const v = watch(sc, f);
      if (v !== undefined) seen.push(v);
    }
    if (sc.done) break;
  }
  return { sc, seen };
}

// ------------------------------------------------------- the start positions
// `c_setxy` for each, straight out of the script.
{
  const sc = createVictoryScene();
  const A = sc.actors;
  check(A.ralsei.x === 2288 && A.ralsei.y === 190,
    `Ralsei starts at (2288, 190), got (${A.ralsei.x}, ${A.ralsei.y})`);
  check(A.susie.x === 2310 && A.susie.y === 142,
    `Susie starts at (2310, 142), got (${A.susie.x}, ${A.susie.y})`);
  check(sc.knight.x === 2655, `the Knight starts at 2655, got ${sc.knight.x}`);
}

// ------------------------------------------------------------ RALSEI'S WALK
// The reported bug. He must cross 80 pixels, not 8 — and he must END UP
// nearer Susie's fallen x than he started, which is the thing the player is
// actually looking at.
{
  // ONLY WHILE HE IS STILL STANDING. After the cut, `c_setxy(2328, 190)`
  // teleports him 40px right and then slides him to 2280 — so a plain
  // max-over-the-run reads 40 even when the walk moved him nothing at all,
  // and the assertion below would be measuring the reposition. Sampled while
  // the sprite is still a walking one, which is exactly the window the walk
  // owns.
  const { sc, seen } = run(4000, (s) => (
    s.actors.ralsei.sprite === 'spr_ralsei_defeat' ? undefined : s.actors.ralsei.x
  ));
  const startX = 2288;
  const endX = Math.max(...seen);
  const travelled = endX - startX;
  check(travelled >= 80,
    `Ralsei should walk 80px (speed 8 x 10 frames); he moved ${travelled}`);
  // Guard the other direction too — a lerp that overshoots would sail him
  // past her, and 80 is exact, not a minimum.
  check(travelled <= 80,
    `...and no further than 80; he moved ${travelled}`);
  // He is CUT DOWN afterwards and repositioned by `c_setxy(2328, 190)`, then
  // slid to 2280, so the walk's peak is the number to read, not the final x.
  check(sc.actors.ralsei.x === 2280,
    `after the cut he settles at 2280, got ${sc.actors.ralsei.x}`);
}

// ------------------------------------------------- ...and he TURNS to face up
// `c_facing("u")` after the walk. He finished the walk side-on before this was
// translated, which is a different report about the same three lines.
{
  const { seen } = run(4000, (s) => s.actors.ralsei.sprite);
  check(seen.includes('spr_ralsei_walk_right_unhappy'),
    'Ralsei should walk on the unhappy right sprite (rsprite 359)');
  const walkAt = seen.indexOf('spr_ralsei_walk_right_unhappy');
  const upAt = seen.indexOf('spr_ralsei_walk_up');
  check(upAt > walkAt,
    'c_facing("u") turns him to the UP sprite AFTER the walk, not before');
  check(seen.includes('spr_ralsei_defeat'), 'and he is cut down at the end');
}

// ------------------------------------------------------------ SUSIE'S ARC
// She CHARGES the Knight (who hovers at 2655), is thrown back to 2410 by
// `c_setxy(2410, 142)`, and then slides to 2310 —
// `c_var_lerp_to("x", 2310, 40, 2, "in")`. Three separate motions, and the
// order is what makes the scene read; a translation that dropped the charge
// would still end her in the right place.
{
  const { sc, seen } = run(4000, (s) => s.actors.susie.x);
  check(Math.max(...seen) > 2500,
    `Susie should charge out toward the Knight, but got no further than ${Math.max(...seen)}`);
  check(sc.actors.susie.x === 2310,
    `she comes to rest at 2310, got ${sc.actors.susie.x}`);
  // The throw-back happens BEFORE the rest, not after.
  const chargeAt = seen.findIndex((x) => x > 2500);
  const restAt = seen.lastIndexOf(2410);
  check(chargeAt >= 0 && restAt > chargeAt,
    'she is thrown back to 2410 after the charge, not before it');
  // AND RALSEI IS BEHIND HER when she falls — he walks toward a fallen ally,
  // so a translation that let him overtake her would be the wrong picture.
  check(sc.actors.ralsei.x < sc.actors.susie.x,
    `Ralsei should end up behind Susie (${sc.actors.ralsei.x} vs ${sc.actors.susie.x})`);
}

// ------------------------------------------------------------- the dialogue
{
  check(VICTORY_LINES.some((l) => l.text.includes('S-Susie')),
    "Ralsei's first line is missing");
  check(VICTORY_LINES.every((l) => l.speaker),
    'every line needs a speaker — the balloon anchors off it');
}

// --------------------------------------------------------- it REACHES an end
// A cutscene that never completes strands the player, and the whole thing is
// gated on confirms, so this is worth asserting outright.
{
  const { sc } = run(6000);
  check(sc.done === true, 'the ending never finished');
  check(sc.toMenu === true, 'it should return to the MAIN MENU, not a card');
}

console.log('the ending cutscene (obj_ch3_PTB02) — no oracle; confirm-driven\n');
{
  const { seen } = run(4000, (s) => (
    s.actors.ralsei.sprite === 'spr_ralsei_defeat' ? undefined : s.actors.ralsei.x
  ));
  console.log(`→ Ralsei walks ${Math.max(...seen) - 2288}px, then is cut down to 2280`);
}
console.log(`→ ${VICTORY_LINES.length} lines, and the scene runs to the menu`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the ending cutscene — positions, the walk, the turn, the exit');
