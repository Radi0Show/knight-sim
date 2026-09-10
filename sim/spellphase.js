// THE SPELL / ITEM RESOLVE PHASE — `obj_spellphase`, and the branch of
// `scr_attackphase` that creates it.
//
// STATUS, 2026-09-09: TRANSLATED AND UNWIRED. Nothing imports this file, no
// suite exercises it, and it has never been run. It is committed on this branch
// so the translation is not lost, not because it is trusted.
//
// WHAT IS LINE-CITED: the three events above (Create / Alarm_0 / Step_0, all 78
// lines of the Step quoted verbatim), scr_attackphase's branch, the hero's
// state-2/4 timing (obj_heroparent Step_0:118-124 arming spelltimer = 16 and
// :444-461 firing scr_spell when it reaches 0), and scr_spelltext's lines.
//
// WHAT IS INFERRED AND STILL NEEDS A LINE: itemSpelldelay's kind/target mapping
// (scr_spell sets 15 or 20 per item CASE; this groups them instead of listing
// them), and the PACIFY variant in SPELL_TEXT (the dump's case 3 branches on
// monsterstatus and mercymod; the Knight is neither TIRED nor sparable, so the
// "wasn't TIRED" line is the reachable one — say so at the table when it is
// wired). The colour codes (\cB ... \cW) are dropped from every line.
//
// A SECOND SKIP LOOP DOES NOT BELONG HERE — AND THE RETRACTION THAT SAID SO
// WAS ITSELF HALF WRONG. CORRECTED 2026-09-10.
//
// An earlier draft carried, at the TOP of the Step's else-branch, a second
// `repeat (2)` testing `hp[global.char[char]] <= 0`, plus a `char < 3` guard
// around the cast body with an `else global.spelldelay = 1`. Removing them
// from THIS file was right: v1.03's obj_spellphase does not have them. Its
// else-branch (Step_0:19-21) goes straight to `if (gotitem[char] == 1)`, and
// its ONE skip loop is at the tail (:55-64) testing `using[char] == 0`.
//
// But the note that replaced them said "Neither is in the dump", flat, and
// that is false of the dump the draft was written against. EnderCat8's Kaizo
// Roaring Knight HAS BOTH, at gml_Object_obj_spellphase_Step_0.gml:21-31 and
// :31-82 — the skip loop verbatim, and the guard with its `else` arm. They
// are a real mod mechanic: the mod skips a member who queued a spell and was
// then knocked down, where vanilla plays their cast pose and burns the
// 90-frame spelldelay anyway.
//
// So this file is correct and the kaizo lane is MISSING that override. The
// wording mattered: an absolute "not in the dump" is an argument against
// re-adding code the mod really has, sitting in the file someone would read
// first. The law the old note quoted still holds, with one word added: a
// citation is a claim, an unread citation is a fabrication, and a citation
// that does not say WHICH dump is an ambiguity that will be read as both.
//
// TO WIRE IT (the work this does not do): sim/scenes/practice.js must create
// this object INSTEAD of the bar when any charaction is 2 or 4 and create the
// bar on the frame this returns true, replacing the `maxdelay = 25 + 15 * n`
// model it has now — which translates obj_attackpress's Draw block that NEVER
// RUNS (Create_0:1-6 sets `fastmode = 1 -> active = 1` and :58 clears
// `spelluse` after the caster loop). sim/menu.js must open the ENEMY picker for
// a spelltarget-2 spell (obj_battlecontroller Step_0:648-651, bmenuno 3), which
// it skips today. The oracle is the kaizo _rev1 whole fight: its f8556 menu is
// the only one of thirty in which the mash lands on MAGIC, and it predicts the
// second writer at f8575, the bar at f8644 and ac 108 at f8730. No vanilla
// whole-fight recording casts anything (checked: no tension drop over 20 in any
// of the six), so the vanilla gate can only prove this INERT — which is worth
// proving, and is the first thing to run after wiring it.
//
// A turn in which anyone chose MAGIC or ITEM does not go straight to the
// attack bar. scr_attackphase (gml_GlobalScript_scr_attackphase.gml:20-47)
// reads `global.charaction[0..2]`:
//
//     fightphase = 1;
//     if (charaction[i] == 4 || charaction[i] == 2) fightphase = 0;   // i = 0..2
//     if (global.myfight == 4) fightphase = 1;
//     if (fightphase == 1) { global.myfight = 1; instance_create(xx + 2, yy + 365, obj_attackpress); }
//     else                 { global.myfight = 4; instance_create(0, 0, obj_spellphase); }
//
// so a caster's turn creates obj_spellphase INSTEAD of the bar, and the bar
// is created by obj_spellphase itself when it is done — it calls
// scr_attackphase again with `myfight == 4`, which forces `fightphase = 1`.
//
// THE OBJECT (gml_Object_obj_spellphase_Create_0 / Alarm_0 / Step_0):
//
//     Create   spelltimer = 0; spellmax = 40; spelltotal = 0; char = 0;
//              castyet = 0; re_castyet = 0; active = 0; alarm[0] = 5;
//
//     Alarm_0  for (xyz = 0; xyz < 3; xyz++) {
//                  using[xyz] = gotspell[xyz] = gotitem[xyz] = 0;
//                  if (charaction[xyz] == 2) { spelltotal++; using = gotspell = 1;
//                      if (castyet == 0) { with (charinstance[xyz]) { state = 2; attacktimer = 0; }
//                                          castyet = 1; char = xyz + 1;
//                                          scr_spelltext(charspecial[xyz], xyz);
//                                          spellwriter = scr_battletext_default(); } }
//                  if (charaction[xyz] == 4) { ...the same with state = 4 / gotitem... }
//              }
//              active = 1; global.spelldelay = 90;
//
//     Step     if (active == 1) {
//                  spelltimer += 1;
//                  if (spelltimer >= global.spelldelay && i_ex(spellwriter) == false) {
//                      if (char >= 3 || spelltotal == 1) { scr_attackphase(); destroy writer; destroy self; }
//                      else if (scr_monsterpop() > 0) {
//                          if (gotitem[char])  { re_castyet = 1; state = 4; destroy writer; scr_spelltext; new writer }
//                          if (gotspell[char]) { re_castyet = 1; state = 2; destroy writer; scr_spelltext; new writer }
//                          global.spelldelay = 90; if (re_castyet == 0) global.spelldelay = 1;
//                          char += 1; repeat (2) if (char < 3 && using[char] == 0) char += 1;
//                          spelltimer = 0; re_castyet = 0;
//                      } else { scr_attackphase(); destroy writer; destroy self; }
//                  }
//              }
//
// (gml_Object_obj_spellphase_Step_0.gml, V1.03, all 78 lines. ITS ONE SKIP
// LOOP IS AT THE END AND IT TESTS `using`, NOT HP: the phase walks only the
// slots that actually chose something, and it never inspects whether a member
// is down. `char < 3` is already guaranteed by the `char >= 3` test above it,
// and the GML indexes gotitem[char] with no guard at all — which is why the
// top-of-branch loop and the guard an earlier draft carried do not belong in
// THIS file. THE KAIZO MOD HAS BOTH (see the correction in the header): its
// copy of this event is 77 diff lines longer and adds them at :21-31 and
// :31-82. A mod lane wanting them overrides this module; it does not edit it.)

// So the phase is FIVE FRAMES of nothing (the alarm), then the first caster's
// pose and their line in the battle box, then a wait that ends when BOTH the
// timer has reached `global.spelldelay` AND the writer is dead. The timer's
// target is not a constant: the alarm sets 90, and the spell itself resets
// it when it fires (scr_spell — Rude Buster 70, the heals 15, Pacify 20, an
// item 15 or 20; see SPELLDELAY below). Two casters chain through the
// `else if` with 90 (or 1 for a slot the chain finds empty).
//
// WHEN THE SPELL FIRES — obj_heroparent's Step (gml_Object_obj_heroparent_Step_0.gml):
//
//     :118-140   if (state == 2 && hurt == 0) { siner++;
//                    if (itemed == 0) { itemed = 1; spelltimer = 16; }
//                    image_index from attacktimer vs spellframes; attacktimer += 0.5; }
//     :144-165   state == 4: the same, itemframes / itemsprite
//     :444-461   if (spelltimer > 0) { spelltimer--;
//                    if (spelltimer == 0) { if (spellframes > 0) faceaction = 0;
//                        if (scr_monsterpop() > 0) scr_spell(charspecial[myself], myself);
//                        state = 0; attacktimer = 0; } }
//
// The alarm sets `state = 2` BEFORE the hero's Step of the same frame (the
// alarm phase precedes the step phase), so that Step arms 16 and counts it
// to 15 at once, and scr_spell fires FIFTEEN frames after the alarm. Rude
// Buster's obj_rudebuster_anim is created inside scr_spell and first steps
// the frame after; its bolt leaves at t == 10 and steps from the next frame.
//
// MEASURED on the kaizo fullfight `_rev1` recording (the one MAGIC turn of
// 30): last confirm f8570 -> obj_spellphase; obj_writer born f8575 (+5, the
// alarm); the bolt's first trail afterimage at (120, 172) on f8602 = the
// hero's Step at f8590 (+15) creating the anim, t == 10 at f8601 creating
// the bolt, its own first Step at f8602; the impact burst f8614; the bar's
// first bolt trails f8644 = f8575 + 69, i.e. spelltimer 70 with the writer
// long dead. Every one of those numbers is this file's.
//
// WHAT THIS REPLACES. The director used to run "maxdelay = 25 + 15 per
// caster, the caster's state at spelldelay[xyz] == 10, the bar inactive
// until maxdelaytimer >= maxdelay" out of obj_attackpress's Create and Draw.
// That block is DEAD in the game: Create_0:1-6 sets `fastmode = 1` so
// `active = 1` from the first frame, and Create_0:61 assigns `spelluse = 0`
// AFTER the loop that would have set it, so the Draw's `if (spelluse == 1)`
// block never runs and `maxdelay` gates nothing. The bar is live from its
// first frame; the spells play BEFORE it exists, in this object.
//
// THE BATTLE WRITER is the same machine as the ACT text's (typer 4 through
// scr_battletext_default: `global.fc = 0; global.typer = 4; scr_battletext()`
// — scr_texttype case 4 is rate 1, charline 33, snd_text). Its lifecycle was
// modelled inline in sim/scenes/practice.js's ACT block; `stepBattleWriter`
// is that block factored out so both callers step one writer the same way.

import { heroAct, HERO_SPELL, HERO_ITEM } from './heroes.js';
import { castSpell, spellInfo } from './spells.js';
import { applyItem, ITEMS } from './items.js';
import { PARTY } from './damage.js';
import { msgLines, textSoundChar } from './dialogue.js';
import { cue } from './audio.js';

/** `alarm[0] = 5` — obj_spellphase Create_0:8. */
export const SPELLPHASE_ALARM = 5;
/** `spelltimer = 16` — obj_heroparent Step_0:122 / :153, the pose's exit. */
export const HERO_SPELLTIMER = 16;
/** `global.spelldelay = 90` — Alarm_0:44 and Step_0:61. */
export const SPELLDELAY_CHAIN = 90;
/** `global.spelldelay = 1` — Step_0:64 / :80, a chain slot with nothing to cast. */
export const SPELLDELAY_EMPTY = 1;
/** `global.spelldelay = 10` — scr_spell:11, what every case starts from. */
export const SPELLDELAY_DEFAULT = 10;

/**
 * scr_spell's `global.spelldelay` for an ITEM (charspecial = item + 200):
 * scr_healitemspell's last line is `global.spelldelay = 15` (:14), and
 * scr_healallitemspell's is 20 (:36). Every heal and revive item in the bag
 * reaches one of the two; the TP items never get here (they resolve in the
 * menu, sim/menu.js recordItem), and a case with neither call (203 the
 * GlowShard, 204 the Manual) leaves the entry's 10.
 */
/**
 * scr_spell's OWN spelldelay, per case. The script sets a default of 10 at its
 * top (line 6) and then every case that cares overwrites it:
 *
 *     case 1  :30                       case 6  (Dual Heal)   :190  15
 *     case 2  (Heal Prayer)  :57   15   case 8  (SleepMist)   :208  20 + mist*10
 *     case 3  (Pacify)       :112  20   case 9  (IceShock)    :212  30 (:221 40)
 *     case 4  (Rude Buster)  :116  30   case 10 (SnowGrave)   :232  30 (:244 140)
 *                            :123  70   case 11 (UltraHeal)   :276  15
 *     case 5  (Red Buster)   :142/:149  30 / 70
 *
 * Rude Buster's pair is the one that matters here: :116 sets 30 and the
 * UNCANCELLED branch at :123 raises it to 70, which is why a Rude Buster turn
 * holds the bar so much longer than a heal — and it is what makes the kaizo
 * _rev1 recording's bar land 69 frames after its writer.
 *
 * THE CONDITIONAL ARMS ARE NOT MODELLED: Pacify's :97 999 (the already-TIRED
 * path), IceShock's 40, SnowGrave's 140, SleepMist's mist count. None is
 * reachable in this fight, and the kaizo lane's own cases set their value
 * through the cast hook instead — which is why the caller below only fills
 * this in when the cast did not write a delay itself.
 */
export function spellSpelldelay(spellId) {
  switch (spellId) {
    case 1: return 30;
    case 2: return 15;
    case 3: return 20;
    case 4: return 70;
    case 5: return 70;
    case 6: return 15;
    case 8: return 20;
    case 9: return 30;
    case 10: return 30;
    case 11: return 15;
    // case 7 is ACT, which never touches it: the default stands.
    default: return SPELLDELAY_DEFAULT;
  }
}

export function itemSpelldelay(itemId) {
  const it = ITEMS[itemId];
  if (!it) return SPELLDELAY_DEFAULT;
  if (it.kind === 'heal' || it.kind === 'revive' || it.kind === 'hurt') {
    return it.target === 'all' ? 20 : 15;
  }
  return SPELLDELAY_DEFAULT;
}

/**
 * `global.charname[global.char[caster]]` — `~1` in scr_spelltext's lines.
 * damage.js's PARTY carries the names upper-cased for the HUD; the game's
 * charname is "Kris" / "Susie" / "Ralsei". A scene fielding a different
 * roster answers through `state.kaizo.hooks.charName` (the same seam shape
 * as sim/spells.js's tables); vanilla installs nothing.
 */
export function charName(state, c) {
  const hook = state?.kaizo?.hooks?.charName;
  if (hook) {
    const v = hook(state, c);
    if (v !== undefined) return v;
  }
  const n = PARTY[c]?.name ?? 'Kris';
  return n.charAt(0) + n.slice(1).toLowerCase();
}

/**
 * scr_spelltext (gml_GlobalScript_scr_spelltext.gml) — the ONE line the box
 * shows while a spell or item resolves. The `/%` terminator is the page's
 * end in this model (ACT_PAGES omits it the same way); `&` is a line break.
 * Case 3's Pacify branches on TIRED, which the Knight never is, so it takes
 * the "wasn't TIRED" line (:35); mercymod is 0 here, so not the SPARING one.
 */
export const SPELL_TEXT = {
  1: '* ~1 cast RUDE BUSTER!',
  2: '* ~1 cast HEAL PRAYER!',
  3: '* ~1 cast PACIFY!&* But the enemy wasn\'t TIRED...',
  4: '* ~1 used RUDE BUSTER!',
  5: '* ~1 used RED BUSTER!',
  6: '* ~1 cast DUAL HEAL!',
  8: '* ~1 cast SLEEPMIST!',
  9: '* ~1 cast ICESHOCK!',
  10: '* ~1 cast SNOWGRAVE!',
  11: '* ~1 cast ULTRAHEAL!',
};

/** scr_spelltext cases 201+, `* ~1 used the X!` with the dump's own spelling. */
export const ITEM_TEXT = {
  1: 'DARK CANDY', 2: 'REVIVEMINT', 5: 'BROKEN CAKE', 6: 'TOPCAKE', 7: 'SPINCAKE',
  8: 'DARKBURGER', 9: 'LANCERCOOKIE', 10: 'GIGASALAD', 11: 'CLUBS SANDWICH',
  12: 'HEARTS DONUT', 13: 'CHOCO DIAMOND', 14: 'FAV SANDWICH', 15: 'ROUXLS ROUX',
};

export function spellText(state, c, spellId) {
  const hook = state?.kaizo?.hooks?.spellText;
  if (hook) {
    const v = hook(state, c, spellId);
    if (v !== undefined) return v;
  }
  const line = SPELL_TEXT[spellId] ?? `* ~1 cast ${(spellInfo(state, spellId)?.name ?? 'MAGIC').toUpperCase()}!`;
  return [line.replace('~1', charName(state, c))];
}

export function itemText(state, c, itemId) {
  const name = ITEM_TEXT[itemId] ?? (ITEMS[itemId]?.name ?? 'ITEM').toUpperCase();
  return [`* ${charName(state, c)} used the ${name}!`];
}

// ── THE BATTLE WRITER ───────────────────────────────────────────────────────

/** `scr_battletext_default()` — one writer over `pages`, typing from pos 1. */
export function createBattleWriter(pages) {
  return { pages, pos: 1, page: 0, halted: false, pmb: 0, automash: 0 };
}

/**
 * One frame of an obj_writer showing battle text: the crawl (Alarm_0,
 * `pos += 1` at rate 1), the halt one past the visible text, the `/` page
 * advance and the `/%` kill on a confirm, button2's whole-line skip, and
 * button3's automash toggle (prevent_mash_buffer 3). Returns true on the
 * frame the writer DIES — its Draw's `instance_destroy()` — which a caller
 * that tests `i_ex(writer)` in its own Step sees the frame after.
 *
 * The confirm edge is `e.actConfirmHeld`, the director's own frame-over-frame
 * latch for this button: one writer at a time exists in the fight, and the
 * game's button1_p() is one global edge, so the ACT writer and the spell
 * writer share it. `state.battlemsg` is what the box draws.
 *
 * This is the ACT block of sim/scenes/practice.js moved here verbatim; the
 * six whole-fight traces pin its every branch through the ACT turns.
 */
export function stepBattleWriter(state, w, e) {
  const visible = msgLines(w.pages[w.page]).join('').length;
  let b1 = false;
  let b2 = false;
  const zP = !!state.input?.confirm && !e.actConfirmHeld;
  e.actConfirmHeld = !!state.input?.confirm;
  if (zP && w.pmb <= 0) b1 = true;
  if (state.input?.focus && w.pmb <= 0) b2 = true;
  if (state.textAutoMash !== false && state.input?.button3) {
    w.pmb = 3;
    w.automash = w.automash === 0 ? 1 : 0;
    if (w.automash === 0) b1 = true;
    if (w.automash === 1) b2 = true;
  }
  let dead = false;
  if (!w.halted) {
    w.pos += 1;
    if (textSoundChar(w.pages[w.page], w.pos - 1)) cue(state, 'snd_text', 1, 1);
    if (w.pos > visible) w.halted = true;
  }
  if (b2 && !w.halted) {
    w.pos = visible + 3;
    w.halted = true;
  }
  if (b1 && w.halted) {
    if (w.page < w.pages.length - 1) {
      w.page += 1;
      w.pos = 1;
      w.halted = false;
    } else {
      dead = true;
    }
  }
  w.pmb -= 1;
  state.battlemsg = w.pages[Math.min(w.page, w.pages.length - 1)];
  return dead;
}

// ── obj_spellphase ──────────────────────────────────────────────────────────

/** `global.charaction[c]` — 2 a spell, 4 an item — read off the queues. */
export function charactionOf(state, c) {
  if (state.pendingSpell?.[c]) return 2;
  if (state.pendingItem?.[c]) return 4;
  return 0;
}

/** scr_attackphase:22-33 — `fightphase = 0` when any slot holds 2 or 4. */
export function needsSpellphase(state) {
  for (let c = 0; c < 3; c++) {
    const a = charactionOf(state, c);
    if (a === 2 || a === 4) return true;
  }
  return false;
}

/** obj_spellphase's Create. Steps from the NEXT frame, like any instance. */
export function createSpellphase(state) {
  return {
    spelltimer: 0,
    spellmax: 40,
    spelltotal: 0,
    char: 0,
    castyet: 0,
    re_castyet: 0,
    active: 0,
    alarm: SPELLPHASE_ALARM,
    using: [0, 0, 0],
    gotspell: [0, 0, 0],
    gotitem: [0, 0, 0],
    writer: null,
    // obj_heroparent's `spelltimer` per slot — the count from the pose's
    // entry to scr_spell. Kept here as well as on the hero record because
    // the director's hero step has already run by the time this object
    // acts in a frame (see enterPose), and because the cast must be made
    // from THIS object's slot in the frame: a Rude Buster created from the
    // hero step would step its animation on its creation frame.
    castIn: [0, 0, 0],
    createdFrame: state.frame,
    // Diagnostics for the tracer and the suite: when the alarm fired, when
    // each cast landed, when the phase ended.
    alarmFrame: -1,
    castFrames: [-1, -1, -1],
    doneFrame: -1,
  };
}

/**
 * `with (global.charinstance[xyz]) { state = 2; attacktimer = 0; }` and then
 * that hero's own Step of the SAME frame — which arms `spelltimer = 16` and
 * counts it to 15 (Step_0:118-124, :444-446). The director runs stepHeroes
 * before this object in a frame, so the entry frame's Step is folded in
 * here: the hero record leaves this call exactly as it leaves the game's
 * frame. `chainEntry` is the Step's `state = 2` for the second caster, which
 * does NOT reset attacktimer (Step_0:52 / :38 assign state alone).
 */
function enterPose(state, c, heroState, chainEntry, act) {
  const h = state.heroes?.[c];
  const attacktimer = h?.attacktimer ?? 0;
  act(state, c, heroState);
  if (h) {
    if (chainEntry) h.attacktimer = attacktimer;
    h.itemed = true;
    h.spelltimer = HERO_SPELLTIMER - 1;
    // the entry frame's own `attacktimer += 0.5`
    h.attacktimer += 0.5;
  }
}

function newWriter(state, sp, c) {
  const a = charactionOf(state, c);
  const pages = a === 4
    ? itemText(state, c, state.pendingItem[c].id)
    : spellText(state, c, state.pendingSpell[c].id);
  sp.writer = createBattleWriter(pages);
  state.battlemsg = pages[0];
}

/** Alarm_0 — the census, the first caster's pose and line, `active = 1`. */
function alarm0(state, sp, opts) {
  for (let xyz = 0; xyz < 3; xyz++) {
    sp.using[xyz] = 0;
    sp.gotspell[xyz] = 0;
    sp.gotitem[xyz] = 0;
    const a = charactionOf(state, xyz);
    if (a === 2 || a === 4) {
      sp.spelltotal += 1;
      sp.using[xyz] = 1;
      if (a === 2) sp.gotspell[xyz] = 1;
      else sp.gotitem[xyz] = 1;
      if (sp.castyet === 0) {
        enterPose(state, xyz, a === 2 ? HERO_SPELL : HERO_ITEM, false, opts.heroAct);
        sp.castIn[xyz] = HERO_SPELLTIMER;
        sp.castyet = 1;
        sp.char = xyz + 1;
        newWriter(state, sp, xyz);
      }
    }
  }
  sp.active = 1;
  sp.alarmFrame = state.frame;
  state.spelldelay = SPELLDELAY_CHAIN;
}

/**
 * The hero's `spelltimer == 0` frame: `scr_spell(global.charspecial[myself],
 * myself)` — the cast, which also rewrites `global.spelldelay`. An item is
 * charspecial 200 + id, whose scr_spell cases are the heal-item scripts.
 */
function fire(state, sp, c, opts) {
  sp.castFrames[c] = state.frame;
  const p = state.pendingSpell?.[c];
  const it = state.pendingItem?.[c];
  if (p) {
    // scr_spell:6 — the default, before the switch.
    state.spelldelay = SPELLDELAY_DEFAULT;
    opts.castSpell(state, c, p.id, p.target);
    // ...then the case's own value, unless the cast already wrote one. The
    // engine's castSpell translates the case BODIES but not their spelldelay
    // lines, so the table stands in for them; a hook that writes its own (the
    // kaizo lane's frozen-target 15, scr_spell:45-52) must win, hence the
    // test rather than an unconditional assignment.
    if (state.spelldelay === SPELLDELAY_DEFAULT) {
      state.spelldelay = spellSpelldelay(p.id);
    }
  } else if (it) {
    state.spelldelay = SPELLDELAY_DEFAULT;
    opts.applyItem(state, it.id, it.target);
    state.spelldelay = itemSpelldelay(it.id);
  }
}

/**
 * One frame of obj_spellphase: its alarm, its Step, then the writer's own
 * events and the casters' countdowns — the game's step order is newest
 * first, and this object is newer than every hero. Returns true on the frame
 * it destroys itself, which is the frame scr_attackphase creates the bar;
 * the caller creates the bar in that same frame.
 *
 * `opts.castSpell(state, c, id, target)` and `opts.applyItem(state, id,
 * target)` let a scene wrap the cast (the kaizo lane mirrors its own
 * spelldelay field); `opts.heroAct` likewise. Defaults are the engine's.
 */
export function stepSpellphase(state, sp, e, opts = {}) {
  const o = {
    castSpell: opts.castSpell
      ?? ((st, c, id, target) => castSpell(st, c, id, target, { alreadyPaid: true })),
    applyItem: opts.applyItem ?? applyItem,
    heroAct: opts.heroAct ?? heroAct,
  };

  // ALARM PHASE — `alarm[0] = 5` counts from the frame after Create and
  // fires on the frame it reaches 0.
  if (sp.alarm > 0) {
    sp.alarm -= 1;
    if (sp.alarm === 0) alarm0(state, sp, o);
  }

  // STEP.
  let done = false;
  if (sp.active === 1) {
    sp.spelltimer += 1;
    if (sp.spelltimer >= state.spelldelay && !sp.writer) {
      if (sp.char >= 3 || sp.spelltotal === 1) {
        done = true;
      } else {
        // scr_monsterpop() > 0 — the Knight is the fight; he is never gone
        // while a turn is resolving.
        //
        // STRAIGHT TO THE SLOT, with no guard and no HP test. `char < 3` is
        // already guaranteed by the `char >= 3` test above, and the GML
        // indexes gotitem[char] / gotspell[char] directly (Step_0:21-48).
        const c = sp.char;
        if (sp.gotitem[c] === 1) {
          sp.re_castyet = 1;
          enterPose(state, c, HERO_ITEM, true, o.heroAct);
          sp.castIn[c] = HERO_SPELLTIMER;
          sp.writer = null;
          newWriter(state, sp, c);
        }
        if (sp.gotspell[c] === 1) {
          sp.re_castyet = 1;
          enterPose(state, c, HERO_SPELL, true, o.heroAct);
          sp.castIn[c] = HERO_SPELLTIMER;
          sp.writer = null;
          newWriter(state, sp, c);
        }
        state.spelldelay = SPELLDELAY_CHAIN;
        if (sp.re_castyet === 0) state.spelldelay = SPELLDELAY_EMPTY;
        sp.char += 1;
        // Step_0:55-64 — THE ONLY skip loop in the object, and it tests
        // `using`: the phase walks past slots that chose neither a spell nor
        // an item. It does not look at anyone's HP.
        for (let r = 0; r < 2; r++) {
          if (sp.char < 3 && sp.using[sp.char] === 0) sp.char += 1;
        }
        sp.spelltimer = 0;
        sp.re_castyet = 0;
      }
    }
  }
  if (done) {
    sp.doneFrame = state.frame;
    sp.writer = null;
    return true;
  }

  // obj_writer — typed by its alarm, killed in its Draw, so a death here is
  // seen by the Step above on the NEXT frame.
  if (sp.writer && stepBattleWriter(state, sp.writer, e)) sp.writer = null;

  // obj_heroparent Step_0:444-461 for every armed caster.
  for (let c = 0; c < 3; c++) {
    if (sp.castIn[c] > 0) {
      sp.castIn[c] -= 1;
      if (sp.castIn[c] === 0) fire(state, sp, c, o);
    }
  }
  return false;
}
