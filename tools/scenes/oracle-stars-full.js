// STARS, whole attack — against knight-research/traces/stars2.csv (phase 1
// turn 1, 700 frames), recorded with the universal harness.
//
// This supersedes the old `oracle-t9` scene, which was built on
// `t9-star.csv` from before the universal recorder and logged only the FIRST
// star. That is why the two divergences this project carried for a long time —
// "star count differs at f170" and "box differs at f197" — were never
// closeable: the scene launched every star with a fixed `direction = 180,
// speed = 7`, and the real ones each get their own.
//
// The controller (obj_dbulletcontroller type 98) derives them from a pair of
// values that evolve per star:
//
//   size    += 0.5 + sin(made) * 0.5,  then % 1
//   special += 0.5 + (0.5 + sin(random(1)) * 0.3),  then % 1, then -= 0.5
//   direction = 180 + special * cone.angle
//   speed     = lerp(10, 5, size)
//
// The `sin(random(1))` makes them unreproducible without the stream, so the 22
// launches are REPLAYED from the recording. The spawn CADENCE is not — the
// `(made != 0 && btimer >= 4) || btimer >= 45` rule, the stop at
// `turntimer <= endtimer + 1`, the cone and the stars' own lifecycles are all
// computed.
//
// ORIGINAL BUG, and it is why every star grows at the same rate: the
// controller sets `d.grow_Speed = lerp(0.1, 0.25, size)` — capital S — while
// obj_knight_pointing_star reads `growspeed`, set to 0.02 in its own Create.
// The two are different variables, so the intended per-star growth variation
// never happens. Every star in the recording reads growspeed 0.0200. Left
// exactly as-is.
//
// TURNTIMER IS REPLAYED, by the verifier, one value per frame. The real clock
// drains faster than 1/frame because grazing subtracts from it, and graze is a
// TP mechanic this project does not model (dodge-only). Since the controller
// stops spawning on `turntimer <= endtimer + 1` and the cone fires on
// `turntimer <= endtimer`, feeding the recorded clock is what lets the attack
// be checked without modelling TP.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { pointingCone } from '../../sim/attacks/pointing-cone.js';
import { starsController } from '../../sim/attacks/stars-controller.js';
import { heartFollower } from '../../sim/attacks/pointing-starchild.js';

export const CONTROLLER_FRAME = 13;

/** Through the fire, the burst and the tail. */
export const STARS_WINDOW = { from: 14, to: 260 };

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 310, y: 160 };
const CONE_POS = { x: 425, y: 78.56589 };

/**
 * Measured per DIFFICULTY, in spawn order. Stars runs at difficulty 0 in phase
 * 1, 1 in phase 2 and 2 in phase 3, and the controller's own init differs:
 *
 *   if (difficulty >= 2) { endtimer += 30; global.turntimer += 60; endtimer += 60; }
 *
 * so difficulty 2 gets endtimer 210 and 60 extra frames of turn — both
 * confirmed by the recordings (endtimer 120/120/210, turntimer 268/268/328).
 * A longer endtimer means the cone holds the stars longer before firing.
 */
export const STAR_VARIANTS = {
  0: {
    difficulty: 0,
    endtimer: 120,
    turntimer: 268,
    launches: [
      { direction: 156.1705322266, speed: 6.7542796135 },
      { direction: 198.3032531738, speed: 7.1506023407 },
      { direction: 183.460647583, speed: 7.3773589134 },
      { direction: 173.6015167236, speed: 9.524559021 },
      { direction: 207.1456298828, speed: 8.9165649414 },
      { direction: 186.6072540283, speed: 8.813876152 },
      { direction: 157.8937530518, speed: 7.0124144554 },
      { direction: 202.4471740723, speed: 7.8699479103 },
      { direction: 179.4524383545, speed: 7.8965525627 },
      { direction: 160.7031860352, speed: 9.3662557602 },
      { direction: 191.1464385986, speed: 8.2263088226 },
      { direction: 173.8655395508, speed: 8.2262840271 },
      { direction: 154.3473052979, speed: 7.0677165985 },
      { direction: 197.5907592773, speed: 8.5172986984 },
      { direction: 170.7286376953, speed: 8.5407810211 },
      { direction: 154.0318603516, speed: 9.415060997 },
      { direction: 185.2222442627, speed: 7.6348195076 },
      { direction: 168.9264373779, speed: 7.538312912 },
      { direction: 207.1984100342, speed: 6.9157810211 },
      { direction: 184.046875, speed: 9.0410881042 },
      { direction: 161.1366424561, speed: 9.2587251663 },
      { direction: 187.5491485596, speed: 9.6670856476 },
    ],
  },
  1: {
    difficulty: 1,
    endtimer: 120,
    turntimer: 268,
    launches: [
      { direction: 168.6537017822, speed: 6.8089609146 },
      { direction: 153.1219940186, speed: 7.2052836418 },
      { direction: 188.9240722656, speed: 7.4320397377 },
      { direction: 169.4923248291, speed: 9.5792398453 },
      { direction: 150.9663543701, speed: 8.9712457657 },
      { direction: 193.4189910889, speed: 8.8685569763 },
      { direction: 165.1246032715, speed: 7.0670952797 },
      { direction: 195.8372192383, speed: 7.9246292114 },
      { direction: 173.9270019531, speed: 7.951233387 },
      { direction: 158.4961395264, speed: 9.4209375381 },
      { direction: 189.4715881348, speed: 8.2809896469 },
      { direction: 171.0823516846, speed: 8.2809658051 },
      { direction: 150.9601135254, speed: 7.1223978996 },
      { direction: 195.8416290283, speed: 8.5719804764 },
      { direction: 175.0489196777, speed: 8.5954618454 },
      { direction: 207.8339538574, speed: 9.4697418213 },
      { direction: 179.0751190186, speed: 7.6895003319 },
      { direction: 162.7029724121, speed: 7.5929942131 },
      { direction: 199.8796234131, speed: 6.9704623222 },
      { direction: 184.6167755127, speed: 9.0957689285 },
      { direction: 164.663848877, speed: 9.3134059906 },
    ],
  },
  2: {
    difficulty: 2,
    endtimer: 210,
    turntimer: 328,
    launches: [
      { direction: 156.1705322266, speed: 6.7542796135 },
      { direction: 189.4652252197, speed: 7.1506023407 },
      { direction: 168.9946136475, speed: 7.3773589134 },
      { direction: 153.7016448975, speed: 9.524559021 },
      { direction: 192.6089019775, speed: 8.9165649414 },
      { direction: 164.2621765137, speed: 8.813876152 },
      { direction: 197.6593322754, speed: 7.0124144554 },
      { direction: 181.4397277832, speed: 7.8699479103 },
      { direction: 152.1348571777, speed: 7.8965525627 },
      { direction: 183.1102905273, speed: 9.3662557602 },
      { direction: 165.8293914795, speed: 8.2263088226 },
      { direction: 199.4026794434, speed: 8.2262840271 },
      { direction: 183.3885803223, speed: 7.0677165985 },
      { direction: 156.2321929932, speed: 8.5172986984 },
      { direction: 197.8231964111, speed: 8.5407810211 },
      { direction: 170.8288421631, speed: 9.415060997 },
    ],
  },
};

/** Which recording backs each difficulty. */
export const STAR_TRACES = { 0: 'stars2.csv', 1: 'stars_d1.csv', 2: 'stars3.csv' };

/** Difficulty 0, kept as the default export the original suite used. */
export const STAR_LAUNCH = STAR_VARIANTS[0].launches;

export const ORACLE_STARS_INPUT = [{ from: 0 }];

export function buildOracleStarsScene(state, difficulty = 0) {
  const v = STAR_VARIANTS[difficulty];
  if (!v) throw new Error(`no such Stars difficulty: ${difficulty}`);
  state.view = { x: 0, y: 0 };
  state.turntimer = v.turntimer;
  state.starVariant = v;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, heartFollower, { ...SOUL_START });

  const spawner = {
    name: 'stars_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== CONTROLLER_FRAME) return;
      const cone = spawn(st, pointingCone, { ...CONE_POS });
      cone.endtimer = v.endtimer;
      cone.difficulty = v.difficulty;
      cone.con = 1;
      const dc = spawn(st, starsController, { ...CONE_POS });
      dc.endtimer = v.endtimer;
      dc.difficulty = v.difficulty;
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
