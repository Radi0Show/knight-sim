// FIGHT — the attack bar, `obj_attackpress`.
//
// FOUND BY ENUMERATING EVENTS, after two dead ends. The object has three
// events (Create, Draw, Other_11) and its DRAW does the whole thing — bolts,
// input, scoring, the turn handoff. Two greps for the mechanism came back
// empty first:
//
//   * `linex` / `linespeed` are set in Create and read NOWHERE. Red herrings.
//   * `points[0..2]` looked assigned-nowhere too — because I grepped
//     `gml_Object_obj_attackpress_*.gml`. They are set in `scr_boltcheck`, a
//     GLOBAL SCRIPT. CLAUDE.md's own rule says never conclude absence from a
//     filename listing; grepping a subset of files is that mistake wearing a
//     different hat.
//
// THE MECHANISM. Bolts sweep right-to-left toward a fixed line at x+80.
// `boltx` advances 1 per frame and a bolt scheduled for `boltframe` draws at
// `x + 80 + (boltframe - boltx) * boltspeed`, `boltspeed = 8` — so it travels
// 8px a frame and sits on the line when `boltframe - boltx == 0`.
//
// Scoring, on `close = boltframe - boltx` and `p = abs(close)`:
//
//     window   close < 15 && close > -5      (early is fine, late is not)
//     p == 0   +150   CRITICAL — yellow burst, mag 0.2
//     p == 1   +120
//     p == 2   +110
//     p >= 3   +100 - p * 2                  (94 at p=3, down to 72 at p=14)
//
// The asymmetric window is worth keeping: 15 frames early still hits, 5 frames
// late does not, so the bar rewards anticipating rather than reacting.
//
// TWO THINGS THIS MODULE HAD WRONG, both from guessing at what the Draw did
// before reading it:
//
// 1. THE SCHEDULE IS RANDOM, not `30 + i * gap`. `my_method == 1` builds it
//    with `choose(diff, diff * 1.5)` gaps and assigns each bolt to a RANDOM
//    eligible character — the bolts do not arrive in party order. It also
//    opens with `boltxoff += lastbolt` where `lastbolt` starts at **-1**, so
//    the first bolt lands on frame 29, not 30.
//
// 2. THE DEFAULT IS ONE BUTTON. `global.flag[13]` picks the scheme, and at 0 —
//    the default — every press runs `scr_boltcheck_onebutton`, which scans
//    ALL characters' bolts rather than one character's. Three-button mode
//    (flag 13 == 1) gives each character their own key and is the alternative,
//    not the norm. One-button also raises `diff` from 10 to 12, spacing the
//    bolts further apart because you only have one key to spend.
//
// DUALBOLT: in one-button mode two bolts scheduled for the SAME frame are both
// scored by a single press. That is reachable — the gap generator can pick
// literally `0` when consecutive bolts belong to different characters, and it
// flags those with `boltred`.

import { rngChoose } from './rng.js';

/** From obj_attackpress's Create. */
export const BOLT_SPEED = 8;
/** `boltframe[0] = 30 + boltxoff` with `boltxoff` already at `lastbolt = -1`. */
export const BOLT_START = 30;
/** Row pitch: every row is drawn at `y + 38 * i`. */
export const ROW_PITCH = 38;
/** `instance_create(xx + 2, yy + 365, obj_attackpress)` — view-relative. */
export const BAR_X = 2;
export const BAR_Y = 365;

/**
 * Build the bolt schedule, `my_method == 1` exactly.
 *
 * `havechar[c]` is 1 for each character who chose FIGHT, and `charbolt[c]` is
 * 1 for each of those — so there is exactly one bolt per attacker and
 * `bolttotal` is how many chose FIGHT.
 */
function buildBolts(rng, havechar, oneButton) {
  const charbolt = havechar.map((h) => (h ? 1 : 0));
  const bolttotal = charbolt.reduce((a, b) => a + b, 0);
  if (bolttotal === 0) return [];

  // `diff = 10; if (global.flag[13] == 0) diff += 2;`
  const diff = oneButton ? 12 : 10;

  // Character assignment by rejection sampling, as the original does: keep
  // picking a random slot until it is one that is fighting AND has a bolt
  // left. Not a shuffle — the draws are independent, so the reject loop is
  // what produces the distribution and a shuffle would produce a different one.
  const boltuse = [0, 0, 0];
  const bolts = [];
  // `rngChoose` takes an ARRAY, not varargs. Called variadically it returns
  // undefined, `havechar[undefined]` is falsy, and the rejection sampler spins
  // forever — a hang rather than a wrong answer, which is at least loud.
  for (let i = 0; i < bolttotal; i++) {
    let c = rngChoose(rng, [0, 1, 2]);
    while (!havechar[c]) c = rngChoose(rng, [0, 1, 2]);
    while (boltuse[c] >= charbolt[c]) {
      c = rngChoose(rng, [0, 1, 2]);
      while (!havechar[c]) c = rngChoose(rng, [0, 1, 2]);
    }
    bolts.push({ char: c, frame: 0, alive: true, red: false });
    boltuse[c] += 1;
  }

  // Frames. `lastbolt` starts at -1 and is ADDED BEFORE the frame is set, so
  // bolt 0 lands on 29 — an off-by-one that is in the original and matters,
  // because the whole scoring window is measured in single frames.
  let boltxoff = 0;
  let lastbolt = -1;
  for (let i = 0; i < bolttotal; i++) {
    boltxoff += lastbolt;
    bolts[i].frame = BOLT_START + boltxoff;
    if (i < bolttotal - 1 && lastbolt !== 0 && bolts[i].char !== bolts[i + 1].char) {
      // A ZERO GAP IS REACHABLE, and only here: two different characters'
      // bolts can be scheduled on the same frame. One-button scores both.
      lastbolt = rngChoose(rng, [0, diff, diff * 1.5]);
      bolts[i].red = true;
    } else {
      lastbolt = rngChoose(rng, [diff, diff * 1.5]);
    }
  }
  return bolts;
}

/**
 * @param {object} rng      the sim's generator; the schedule is random
 * @param {number[]} order  slots that chose FIGHT
 * @param {boolean} oneButton  `global.flag[13] == 0`, the default
 */
export function createFightBar(rng, order = [0, 1, 2], oneButton = true, recorded = null) {
  const havechar = [0, 1, 2].map((c) => (order.includes(c) ? 1 : 0));
  return {
    active: true,
    oneButton,
    boltx: 0,
    havechar,
    // THE SCHEDULE IS REPLAYED WHEN THE ORACLE SUPPLIED ONE.
    //
    // `my_method == 1` builds it with `choose(0, diff, diff * 1.5)` per bolt
    // plus a rejection-sampled character, so reproducing it needs the real
    // RNG stream — and the call order is not the same on both sides
    // (scr_randomtarget draws every turn; CLAUDE.md records that Draw events
    // consume too). Same situation as ds_list_shuffle, same answer: log it
    // from the game and replay it here.
    //
    // Without this the two sides run DIFFERENT bolt frames, and since the
    // scoring window forgives 15 frames of earliness, the sim scores bolts
    // the oracle has not reached — which reads as a damage divergence and is
    // nothing of the kind.
    //
    // Falls back to the sim's own generator when nothing is supplied, so
    // ordinary play is unaffected.
    bolts: recorded ?? buildBolts(rng, havechar, oneButton),
    points: [0, 0, 0],
    /** `pressbuffer[j] = 5` then -1 a frame — the row's white flash. */
    pressbuffer: [0, 0, 0, 0],
    /** obj_burstbolt: the expanding ring a scored bolt leaves. */
    bursts: [],
    /** `attacked[i]` — latched when a character's last bolt is gone. */
    attacked: [false, false, false],
    /** Edge state for the button. NOT "has pressed once". */
    held: false,
    heldPer: [false, false, false],
    imagetimer: 0,
    /** obj_afterimage trail, spawned every other frame. */
    afterimages: [],
    done: false,
  };
}

/** Score `p = abs(close)`, shared by both button schemes. */
function award(bar, bc, topclose) {
  // KNIGHT_BAR_DEBUG: one line per scored bolt, for aligning a recording's
  // bar against the sim's. Diagnostic only; no gameplay effect.
  if (globalThis.process?.env?.KNIGHT_BAR_DEBUG) {
    console.error(`[bar] f=${globalThis.__simFrame ?? '?'} boltx=${bar.boltx} char=${bc} close=${topclose}`);
  }
  const p = Math.abs(topclose);
  let gained;
  if (p === 0) gained = 150;
  else if (p === 1) gained = 120;
  else if (p === 2) gained = 110;
  else gained = 100 - p * 2;
  bar.points[bc] += gained;
  return { gained, critical: p === 0 };
}

function spawnBurst(bar, bolt, bc, critical) {
  bar.bursts.push({
    x: 80 + (bolt.frame - bar.boltx) * BOLT_SPEED,
    y: ROW_PITCH * bc,
    // `mag = 0.1` in Create, overridden to 0.2 only for a critical.
    mag: critical ? 0.2 : 0.1,
    alpha: 1,
    xscale: 1,
    yscale: 1,
    critical,
    char: bc,
  });
}

/**
 * `scr_boltcheck_onebutton()` — the DEFAULT. One press scans every live bolt,
 * not just one character's, and scores the nearest.
 *
 * DUALBOLT: a second bolt at exactly the same `close` is scored too. The
 * original checks `close == topclose` BEFORE `close < topclose`, so the tie is
 * caught against the running best rather than the final one — which means only
 * a tie with the current leader counts, and a third bolt at the same frame is
 * silently dropped. Reproduced as written rather than "fixed".
 */
export function boltCheckOneButton(bar) {
  let qualify = -1;
  let dualId = -1;
  let topclose = 999;
  for (let i = 0; i < bar.bolts.length; i++) {
    const b = bar.bolts[i];
    if (!b.alive) continue;
    const close = b.frame - bar.boltx;
    if (close < 15 && close > -5) {
      if (close === topclose) dualId = i;
      if (close < topclose) {
        topclose = close;
        qualify = i;
      }
    }
  }
  for (let k = 0; k < 4; k++) bar.pressbuffer[k] = 5;
  if (qualify === -1) return 0;

  let total = 0;
  const hit = (idx) => {
    const b = bar.bolts[idx];
    const { gained, critical } = award(bar, b.char, topclose);
    spawnBurst(bar, b, b.char, critical);
    b.alive = false;
    total += gained;
  };
  hit(qualify);
  if (dualId !== -1) hit(dualId);
  return total;
}

/** `scr_boltcheck(char)` — three-button mode, one character's bolts only. */
export function boltCheck(bar, char) {
  let qualify = -1;
  let topclose = 99;
  for (let i = 0; i < bar.bolts.length; i++) {
    const b = bar.bolts[i];
    if (b.char !== char || !b.alive) continue;
    const close = b.frame - bar.boltx;
    if (close < 15 && close > -5 && close < topclose) {
      topclose = close;
      qualify = i;
    }
  }
  // `pressbuffer[global.char[arg0]] = 5` — indexed by CHARACTER ID, not slot,
  // which is why the buffer has four entries for three characters.
  bar.pressbuffer[char + 1] = 5;
  if (qualify === -1) return 0;
  const b = bar.bolts[qualify];
  const { gained, critical } = award(bar, char, topclose);
  spawnBurst(bar, b, char, critical);
  b.alive = false;
  return gained;
}

/**
 * One frame of the Draw event, in its order: kill overdue bolts, spawn the
 * afterimage trail, fire `event_user(1)` for anyone whose bolts are gone, THEN
 * read input, THEN advance `boltx`.
 *
 * The advance coming last is the counter-phase rule again — a press is judged
 * against the position the player is looking at, not the next one.
 */
export function stepFightBar(bar, press = false, perChar = [false, false, false]) {
  // `active` is the ONLY gate. The Draw's whole interior — the scoring, the
  // event_user(1) latches, and the per-frame maintenance (`boltx += 1`, the
  // pressbuffer decrements, imagetimer, the burstbolt Steps) — lives inside
  // `if (active == 1)` and NOTHING in it tests for completion; `goahead`
  // merely adds the posttimer path alongside. So `boltx` keeps counting all
  // the way through the post-bolt hold and the fade, a press after the last
  // bolt still calls the boltcheck (which finds nothing alive and only
  // flashes the window), and the bursts keep expanding.
  //
  // Returning on `done` as well froze all of that at the last bolt. The
  // whole-fight diff caught it as `bar` (boltx) sticking at one value from
  // the frame the final character's bolts cleared, while the oracle's kept
  // climbing for the remaining 63 frames of the hold.
  if (!bar.active) return;

  for (const b of bar.bolts) {
    if (b.alive && b.frame - bar.boltx < -5) b.alive = false;
  }

  // `if (imagetimer == 0 && boltalive[i] == 1)` — every other frame, and only
  // for bolts that have not yet passed the line.
  if (bar.imagetimer === 0) {
    for (const b of bar.bolts) {
      const close = b.frame - bar.boltx;
      if (b.alive && close >= 0) {
        bar.afterimages.push({
          x: 80 + close * BOLT_SPEED, y: ROW_PITCH * b.char, alpha: 0.4,
        });
      }
    }
  }

  // A MISSED BOLT DIES ON ITS OWN, five frames past the line:
  //
  //     if ((boltframe[i] - boltx) < -5) boltalive[i] = 0;
  //
  // and `attacked[i]` latches when that character has no live bolts left —
  // whether they were SCORED or simply swept past. Without the expiry a bolt
  // nobody pressed stayed alive forever, so `attacked[]` never completed,
  // `done` never flipped, `posttimer` never started and THE BAR NEVER ENDED.
  // The turn only moved on when something else ended it, which is the "the
  // fight is buffered too long and it just takes like 10 seconds" report —
  // and it happens on the attacks with the most bolts, later in the fight,
  // because the more bolts a bar has the likelier one is left unpressed.
  //
  // The window that SCORES is `close < 15 && close > -5`; a bolt therefore
  // dies on exactly the frame it leaves that window, never before.
  for (const b of bar.bolts) {
    if (b.alive && b.frame - bar.boltx < -5) b.alive = false;
  }

  // ONE CHARACTER PER FRAME — an ORIGINAL BUG, and load-bearing timing.
  //
  // The Draw walks `for (i = 0; i < 3; i += 1)` and, for the first character
  // whose bolts are gone, sets `attacked[i] = 1` and fires `event_user(1)`.
  // The event's body (Other_11) runs `for (i = 0; i < 3; i += 1)` too — and
  // `i` is the SAME INSTANCE VARIABLE, not var-scoped. The event returns with
  // i == 3, the outer loop's `i += 1` makes it 4, and the loop exits. So at
  // most ONE character latches per frame, lowest index first — a dual-scored
  // pair's strikes land one frame apart, and the LAST character's latch (which
  // is what completes `attacked[]` and starts `posttimer`) slips one frame per
  // simultaneously-finishing character, delaying the whole turn handoff.
  //
  // Measured, not read: fullfight-verify21b's scorer receipt shows one press
  // at boltx 16 dual-scoring chars 1 and 2 on the same frame, and the same
  // recording's hero log shows Susie entering state 1 at f25 and Ralsei at
  // f26 — with strikes at f36 and f37, eleven frames later each. Firing all
  // three in one frame also ended the bar (posttimer → fade → mnfight = 1)
  // one frame early, which showed up as the whole next turn — the knight's
  // dr ramp, the soul spawn, the first bullet — running one frame ahead.
  for (let i = 0; i < 3; i++) {
    if (!bar.havechar[i] || bar.attacked[i]) continue;
    if (!bar.bolts.some((b) => b.alive && b.char === i)) {
      bar.attacked[i] = true;
      break; // the shared-`i` exit: one character a frame
    }
  }

  if (bar.oneButton) {
    if (press && !bar.held) boltCheckOneButton(bar);
    bar.held = press;
  } else {
    for (let c = 0; c < 3; c++) {
      const down = perChar[c] && bar.havechar[c] === 1;
      if (down && !bar.heldPer[c]) boltCheck(bar, c);
      bar.heldPer[c] = down;
    }
  }

  bar.imagetimer = bar.imagetimer > 0 ? 0 : bar.imagetimer + 1;
  bar.boltx += 1;
  for (let k = 0; k < 4; k++) bar.pressbuffer[k] -= 1;

  // obj_burstbolt's Step. `sprite_width` is spr_attackspot's 10x38 scaled.
  for (const s of bar.bursts) {
    s.alpha -= 0.1;
    s.xscale += s.mag;
    s.yscale += s.mag;
    s.x += ((1 - 10 * s.xscale) * s.mag) / 2.7;
    s.y += ((1 - 38 * s.yscale) * s.mag) / 2.5;
  }
  bar.bursts = bar.bursts.filter((s) => s.alpha >= 0);

  // obj_afterimage fades out; the original object does this itself.
  for (const a of bar.afterimages) a.alpha -= 0.05;
  bar.afterimages = bar.afterimages.filter((a) => a.alpha > 0);

  if (bar.attacked.every((a, i) => a || !bar.havechar[i])) bar.done = true;

  // `goahead` / `posttimer`, LITERALLY — the Draw's own end-of-bar clock:
  //
  //     goahead = 0;
  //     if (attacked[0] == 1 || havechar[0] == 0) if (...) if (...) goahead = 1;
  //     if (goahead == 1) { posttimer += 1; ... }
  //     ...
  //     if (posttimer > timermax) { fade = 1; ...; global.mnfight = 1; }
  //
  // The caller used to re-derive this with its own `barHold` counter, and its
  // arithmetic sat two frames off the oracle at every turn boundary. The
  // original's counter is right by definition; translate it, do not model it.
  if (bar.done) bar.posttimer = (bar.posttimer ?? 0) + 1;
  // `timermax = 50`, from the Create. True from the frame `posttimer` first
  // exceeds it — the frame the fade starts and the turn hands off.
  bar.holdDone = (bar.posttimer ?? 0) > 50;
}

/** Screen x of a bolt. `x + 80 + (frame - boltx) * boltspeed`. */
export function boltScreenX(bar, bolt, originX) {
  return originX + 80 + (bolt.frame - bar.boltx) * BOLT_SPEED;
}

/** `scr_tensionheal(round(points / 10))` — and ONLY when damage > 0. */
export function fightTp(accuracy) {
  return Math.round(accuracy / 10);
}
