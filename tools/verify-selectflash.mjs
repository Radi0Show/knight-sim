// THE ENEMY SELECTION FLASH — the animation, not the fact of it.
//
// obj_battlecontroller's Draw, inside the enemy-select block
// (bmenuno 1/3/11/12/13):
//
//     with (global.monsterinstance[global.bmenucoord[bmenuno][charturn]])
//     {
//         if (flash == 0) fsiner = 0;
//         flash = 1;
//         becomeflash = 1;
//     }
//
// and every enemy's own Draw draws itself NORMALLY at full alpha and then, if
// flashing, composites a SOLID WHITE SILHOUETTE over it:
//
//     draw_sprite_ext(thissprite, siner / 6, x, y, 2, 2, 0, image_blend, 1);
//     if (flash == 1) {
//         fsiner += 1;
//         d3d_set_fog(true, c_white, 0, 1);
//         draw_sprite_ext(thissprite, ..., (-cos(fsiner / 5) * 0.4) + 0.6);
//         d3d_set_fog(false, c_black, 0, 0);
//     }
//
// So the enemy GLOWS -- brighter and dimmer between 0.2 and 1.0 over about 31
// frames, never losing opacity -- restarting dim every time you enter the
// menu. Two wrong versions preceded this: an invented additive halo on the
// menu's siner, and then the right curve applied to the SPRITE'S OWN alpha,
// which faded the Knight out instead of lighting him up. This pins the timing
// half (curve, period, reset); the layer half is in render/canvas.js, where
// the overlay is drawn with fogged() over a full-alpha base.
import { createState } from '../sim/state.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { stepFrame } from '../sim/index.js';

const ALPHA = (f) => (-Math.cos(f / 5) * 0.4) + 0.6;

let failed = 0;
const ok = (cond, what) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failed++;
};

const st = createState({ seed: 3 });
buildPracticeScene(st, { seed: 3 });
// Reach a frame where the Knight exists; the flash logic runs in his step.
for (let f = 0; f < 600 && !st.knight; f++) stepFrame(st, {});
ok(!!st.knight, 'the Knight exists');

// Not selecting: no flash.
st.menu.open = false;
stepFrame(st, {});
ok(!st.knight.flash, 'flash is 0 while the menu is closed');

// Enter the enemy picker. fsiner must RESET, so the pulse starts dark.
st.menu.open = true;
st.menu.submenu = 'enemy';
st.knight.fsiner = 12345;             // stale value from an earlier entry
stepFrame(st, {});
ok(st.knight.flash === 1, 'flash is 1 in the enemy row');
ok(st.knight.fsiner === 1,
  `fsiner reset on the 0->1 edge, then incremented (got ${st.knight.fsiner})`);
ok(Math.abs(ALPHA(st.knight.fsiner) - 0.2079) < 1e-3,
  `the pulse STARTS near transparent (alpha ${ALPHA(st.knight.fsiner).toFixed(4)})`);

// It must keep counting, NOT re-reset while it stays selected.
const seen = [];
for (let i = 0; i < 40; i++) { stepFrame(st, {}); seen.push(st.knight.fsiner); }
ok(seen.every((v, i) => v === i + 2), 'fsiner counts one per frame while selected');

// The curve: range and period, sampled over the values actually produced.
const alphas = seen.map(ALPHA);
ok(Math.min(...alphas) >= 0.2 - 1e-9 && Math.max(...alphas) <= 1 + 1e-9,
  `alpha stays inside [0.2, 1.0] (saw ${Math.min(...alphas).toFixed(3)}..${Math.max(...alphas).toFixed(3)})`);
ok(Math.abs(ALPHA(0) - 0.2) < 1e-12 && Math.abs(ALPHA(5 * Math.PI) - 1.0) < 1e-12,
  'the curve is -cos(f/5)*0.4 + 0.6: 0.2 at f=0, 1.0 at f=5pi');
// Period 10pi ~ 31.4 frames — a sin() of the same argument would NOT match.
ok(Math.abs(ALPHA(31.4159265) - ALPHA(0)) < 1e-6,
  'the period is 10pi ~ 31.4 frames');

// ACT's enemy picker (bmenuno 11) flashes too — same `with` block.
st.menu.submenu = 'actpick';
stepFrame(st, {});
ok(st.knight.flash === 1, "ACT's enemy picker flashes as well");

// Leaving clears it, so the Knight goes back to full opacity.
st.menu.submenu = null;
st.menu.open = false;
stepFrame(st, {});
ok(!st.knight.flash, 'flash clears when the menu closes');

console.log(failed === 0
  ? 'verify-selectflash: OK — the game curve, period and reset'
  : `verify-selectflash: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
