#!/usr/bin/env node
// THE SPELL / ITEM RESOLVE PHASE — obj_spellphase, and the branch of
// scr_attackphase that creates it instead of the attack bar.
//
// WHY THIS SUITE EXISTS, AND WHY IT HAD TO BE WRITTEN BY HAND. None of the six
// whole-fight recordings casts anything — checked, not assumed: there is no
// tension drop over 20 anywhere in fullfight-{verify37,verify21j,draw37,
// end37,probe21,probe37}.csv — so the byte gate cannot see this code path at
// all. It proved the phase INERT when it landed (all six stayed byte-exact)
// and it can prove nothing more. The one recording that does cast is the kaizo
// _rev1 whole fight, and its frames are quoted at the assertions below.
//
// THE MODEL, from the dump:
//
//   scr_attackphase.gml:20-47     any charaction 2 (spell) or 4 (item), with
//                                 myfight != 4, gives fightphase 0 ->
//                                 myfight = 4 and obj_spellphase; otherwise
//                                 myfight = 1 and obj_attackpress. The phase
//                                 calls scr_attackphase again when it is
//                                 done, and myfight == 4 then forces
//                                 fightphase 1 — SO THE PHASE CREATES THE BAR.
//   obj_spellphase Create         alarm[0] = 5, active = 0, spelltimer = 0
//                  Alarm_0        the first caster's pose (state 2 or 4) and
//                                 their line in the battle box; active = 1;
//                                 global.spelldelay = 90
//                  Step_0         spelltimer += 1; when spelltimer >=
//                                 global.spelldelay AND the writer is DEAD,
//                                 chain to the next caster (spelldelay 90, or
//                                 1 for a slot that chose nothing) or finish
//   obj_heroparent Step_0         state 2/4 arms spelltimer = 16, and
//                  :118-124,      scr_spell fires when it counts to 0 —
//                  :444-461       scr_spell then rewrites global.spelldelay
//                                 (Rude Buster's case 4 sets 70)
//   obj_battlecontroller          a spelltarget-2 spell opens bmenuno 3, its
//                  Step_0:648-651 own enemy row, BEFORE the TP is charged
//
// Run with --sabotage to prove the numbers are load-bearing: each case breaks
// one of them and requires this suite to notice. A suite that cannot fail says
// nothing about a code path no recording covers.

import { createState, stepFrame } from '../sim/index.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import {
  needsSpellphase, createSpellphase, stepSpellphase,
  SPELLPHASE_ALARM, HERO_SPELLTIMER, SPELLDELAY_CHAIN, SPELLDELAY_EMPTY,
} from '../sim/spellphase.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };
const eq = (got, want, msg) => ok(got === want, msg + ': got ' + got + ', want ' + want);

/** A practice scene parked with the party menu open and full TP. */
function atMenu(seed = 3) {
  const s = createState({ seed });
  buildPracticeScene(s, { seed });
  s.keepAlive = true;
  let g = 0;
  while (!s.menu?.open && g++ < 2000) stepFrame(s, {});
  s.tension = 250;
  return s;
}

/** One press, then one released frame — the shape verify-spells drives with. */
const tap = (s, k) => {
  stepFrame(s, { [k]: true });
  stepFrame(s, {});
  // release until the buffer clears — the GRID confirms set onebuffer = 2
  // (obj_battlecontroller Step_0:636/:780/:937/:1140), two frames of lockout.
  for (let g = 0; g < 4 && (s.menu?.onebuffer ?? -1) >= 0; g++) stepFrame(s, {});
};

// THE BOX WAITS FOR A PRESS, so a test that feeds nothing hangs the phase for
// ever — correctly. obj_writer halts one character past its visible text and
// only button1 on a halted last page destroys it (the /% terminator), which is
// what obj_spellphase's Step is waiting on. The recorded token presses confirm
// every OTHER frame, so that is the input this suite drives with, and it is
// why the phase in _rev1 gets past its box in a handful of frames.
const mash = (f) => ({ confirm: f % 2 === 0 });

/** The director carries the phase; find it by the field rather than by name. */
const dirOf = (s) => s.entities.find((x) => x.alive && x.spellphase !== undefined) ?? null;

// ── 1. the branch: which object a turn creates ──────────────────────────────
{
  const s = atMenu();
  ok(!needsSpellphase(s), 'a turn with nothing queued needs no phase');
  s.pendingSpell = [];
  s.pendingSpell[1] = { id: 4, target: 1 };
  ok(needsSpellphase(s), 'a queued SPELL needs the phase (charaction 2)');
  s.pendingSpell = [];
  s.pendingItem = [];
  s.pendingItem[0] = { id: 1, target: 0 };
  ok(needsSpellphase(s), 'a queued ITEM needs it too (charaction 4)');
  s.pendingItem = [];
  ok(!needsSpellphase(s), 'and an emptied queue does not');
}

// ── 2. the clocks, driven directly ──────────────────────────────────────────
{
  const s = atMenu();
  s.pendingSpell = [];
  s.pendingSpell[1] = { id: 4, target: 1 };   // Susie, Rude Buster
  const sp = createSpellphase(s);
  eq(sp.alarm, SPELLPHASE_ALARM, 'Create sets alarm[0] = 5');
  eq(sp.active, 0, 'and the object is inactive until that alarm fires');
  const e = { actConfirmHeld: false };
  let firedAt = -1;
  let doneAt = -1;
  for (let f = 1; f <= 400 && doneAt < 0; f++) {
    s.frame = f;
    s.input = mash(f);
    const before = sp.active;
    if (stepSpellphase(s, sp, e)) doneAt = f;
    if (before === 0 && sp.active === 1 && firedAt < 0) firedAt = f;
  }
  eq(firedAt, SPELLPHASE_ALARM, 'Alarm_0 fires on the fifth step, not the sixth');
  eq(sp.spelltotal, 1, 'one caster counted');
  // FIFTEEN, NOT SIXTEEN, and the dump is why. obj_spellphase's Alarm_0 sets
  // the hero's state = 2, alarms run before steps, so the hero's OWN Step
  // lands in the same frame: :118-124 arms spelltimer = 16 and :444-446
  // decrements it to 15 before that frame is over. scr_spell fires when it
  // reaches 0, i.e. fifteen frames after the alarm. HERO_SPELLTIMER is the
  // armed value; the observable offset is one less.
  eq(sp.castFrames[1] - firedAt, HERO_SPELLTIMER - 1,
    'scr_spell fires 15 frames after the pose (Step_0:118-124 arms 16, :444-446 spends one that frame)');
  ok(doneAt > 0, 'the phase finishes');
  // _rev1: the writer is born at f8575 (this alarm) and the bar at f8644 —
  // 69 frames later, spelltimer reaching Rude Buster's spelldelay of 70 on a
  // frame when the writer is already dead.
  eq(doneAt - firedAt, 69,
    'the phase runs 69 frames past its alarm (_rev1: writer f8575, bar f8644)');
  eq(s.spelldelay, 70, 'scr_spell case 4 left global.spelldelay at 70');
}

// ── 3. the writer gates the end ─────────────────────────────────────────────
{
  const s = atMenu();
  s.pendingSpell = [];
  s.pendingSpell[1] = { id: 4, target: 1 };
  const sp = createSpellphase(s);
  const e = { actConfirmHeld: false };
  let endedEarly = -1;
  for (let f = 1; f <= 300; f++) {
    s.frame = f;
    const done = stepSpellphase(s, sp, e);
    // Keep the box alive forever: two pages, permanently halted on the first.
    if (sp.writer) {
      sp.writer.pages = ['* held', '* held'];
      sp.writer.page = 0;
      sp.writer.halted = true;
    }
    if (done) { endedEarly = f; break; }
  }
  eq(endedEarly, -1, 'the phase never ends while its writer lives (Step_0:8, i_ex(spellwriter) == false)');
  ok(sp.spelltimer >= 70, 'and its timer ran past spelldelay while it waited');
}

// ── 4. two casters chain at 90; the slot that chose nothing is skipped ──────
{
  const s = atMenu();
  s.pendingSpell = [];
  s.pendingSpell[0] = { id: 4, target: 0 };
  s.pendingSpell[2] = { id: 2, target: 2 };   // Ralsei, Heal Prayer
  const sp = createSpellphase(s);
  const e = { actConfirmHeld: false };
  let done = false;
  const delays = [];
  for (let f = 1; f <= 800 && !done; f++) {
    s.frame = f;
    s.input = mash(f);
    const d = s.spelldelay;
    done = stepSpellphase(s, sp, e);
    if (s.spelldelay !== d) delays.push(s.spelldelay);
  }
  eq(sp.spelltotal, 2, 'both casters counted');
  ok(sp.castFrames[0] > 0 && sp.castFrames[2] > 0, 'both casts fired');
  ok(sp.castFrames[2] > sp.castFrames[0], 'in slot order, the second after the first');
  ok(delays.includes(SPELLDELAY_CHAIN), 'the chain re-arms global.spelldelay at 90');
  ok(done, 'and the phase still finishes');
  // Step_0:55-64's skip loop tests `using`, so char walks 0 -> 1 (skipped,
  // it chose nothing) -> 2 and slot 1 never poses.
  ok(!(sp.castFrames[1] > 0), 'the slot that chose nothing never casts');
}

// ── 5. the scene: a cast-only turn, and the FIGHT-only control ──────────────
{
  const s = atMenu();
  s.menu.selected[0] = 4; tap(s, 'confirm');                       // Kris DEFEND
  // THREE presses: MAGIC, the spell, then its own enemy row (bmenuno 3).
  s.menu.selected[1] = 1; tap(s, 'confirm'); tap(s, 'confirm'); tap(s, 'confirm');
  eq(s.tension, 125, 'the enemy row is what charges the 125');
  s.menu.selected[2] = 4; tap(s, 'confirm');                       // Ralsei DEFEND
  // WATCH ONLY THIS TURN. The mash keeps pressing, so left to run it drives
  // the NEXT menu into choosing FIGHT and makes a bar that has nothing to do
  // with this turn — which is what this assertion caught the first time it was
  // written. Stop at the frame the phase ends and ask the question there.
  let sawPhase = false;
  let barWhilePhase = -1;
  let endedAt = -1;
  for (let f = 0; f < 600 && endedAt < 0; f++) {
    stepFrame(s, mash(f));
    const live = !!dirOf(s)?.spellphase;
    if (live) sawPhase = true;
    if (sawPhase && !live) endedAt = f;
    else if (sawPhase && s.fightBar && barWhilePhase < 0) barWhilePhase = f;
  }
  ok(sawPhase, 'the cast turn created obj_spellphase');
  ok(endedAt >= 0, 'and the phase ended');
  eq(barWhilePhase, -1,
    'no attack bar while it ran: nobody chose FIGHT, so the phase is the whole turn');
  ok(!s.fightBar, 'and none on the frame it ended either');
}
{
  const s = atMenu();
  s.menu.selected[0] = 0; tap(s, 'confirm'); tap(s, 'confirm');     // Kris FIGHT + enemy row
  s.menu.selected[1] = 4; tap(s, 'confirm');
  s.menu.selected[2] = 4; tap(s, 'confirm');
  let sawPhase = false;
  let barAt = -1;
  for (let f = 0; f < 200 && barAt < 0; f++) {
    stepFrame(s, mash(f));
    if (dirOf(s)?.spellphase) sawPhase = true;
    if (s.fightBar) barAt = f;
  }
  ok(!sawPhase, 'a FIGHT-only turn creates no spell phase');
  ok(barAt >= 0 && barAt <= 3, 'and its bar appears at once (frame ' + barAt + ')');
}

// ── 6. FIGHT plus a cast: the bar waits for the phase ───────────────────────
{
  const s = atMenu();
  s.menu.selected[0] = 0; tap(s, 'confirm'); tap(s, 'confirm');     // Kris FIGHT
  s.menu.selected[1] = 1; tap(s, 'confirm'); tap(s, 'confirm'); tap(s, 'confirm');
  s.menu.selected[2] = 4; tap(s, 'confirm');
  let barAt = -1;
  let phaseEnded = -1;
  let sawPhase = false;
  for (let f = 0; f < 600 && barAt < 0; f++) {
    stepFrame(s, mash(f));
    const live = !!dirOf(s)?.spellphase;
    if (live) sawPhase = true;
    if (sawPhase && !live && phaseEnded < 0) phaseEnded = f;
    if (s.fightBar) barAt = f;
  }
  // The dead maxdelay model held the bar 40 frames for one caster; the phase
  // holds it for the alarm, the pose, the cast and the box.
  ok(barAt > 40, 'the bar waits for the phase, not for 40 frames of maxdelay (frame ' + barAt + ')');
  ok(phaseEnded >= 0 && barAt - phaseEnded <= 1,
    'and it is created on the frame the phase ends (phase ' + phaseEnded + ', bar ' + barAt + ')');
}

if (process.argv.includes('--sabotage')) {
  console.log('');
  const cases = [
    ['alarm 5 -> 6 is noticed', () => {
      const s = atMenu();
      s.pendingSpell = [];
      s.pendingSpell[1] = { id: 4, target: 1 };
      const sp = createSpellphase(s);
      sp.alarm = 6;
      const e = { actConfirmHeld: false };
      let fired = -1;
      for (let f = 1; f <= 40 && fired < 0; f++) {
        s.frame = f;
        const b = sp.active;
        stepSpellphase(s, sp, e);
        if (b === 0 && sp.active === 1) fired = f;
      }
      return fired !== SPELLPHASE_ALARM;
    }],
    ['a writer that never dies is noticed', () => {
      const s = atMenu();
      s.pendingSpell = [];
      s.pendingSpell[1] = { id: 4, target: 1 };
      const sp = createSpellphase(s);
      const e = { actConfirmHeld: false };
      for (let f = 1; f <= 300; f++) {
        s.frame = f;
        const done = stepSpellphase(s, sp, e);
        if (sp.writer) { sp.writer.pages = ['* held', '* held']; sp.writer.page = 0; sp.writer.halted = true; }
        if (done) return false;   // it ended with the writer alive: NOT caught
      }
      return true;
    }],
    ['the empty-slot delay constant is real', () => SPELLDELAY_EMPTY === 1],
  ];
  let bad = 0;
  for (const [name, fn] of cases) {
    let caught = false;
    try { caught = fn(); } catch { caught = true; }
    console.log('  ' + (caught ? 'ok  ' : 'FAIL') + ' sabotage: ' + name);
    if (!caught) bad += 1;
  }
  if (bad) { console.log('\n' + bad + ' sabotage case(s) NOT caught'); process.exit(1); }
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log('→ FAILURE  ' + f);
  process.exit(1);
}
console.log('\nPASS  obj_spellphase — the branch, the clocks, the writer gate (no oracle casts; see header)');
