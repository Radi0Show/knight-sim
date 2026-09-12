// MAGIC and ACT — the two lists the button row opens besides the bag.
//
// `global.spell[char][i]` from `scr_gamestart`, indexed by CHARACTER ID:
//
//     spell[1][0] = 7     Kris:   ACT
//     spell[2][0] = 4     Susie:  Rude Buster
//     spell[2][1] = 11            UltraHeal
//     spell[3][0] = 3     Ralsei: Pacify
//     spell[3][1] = 2             Heal Prayer
//
// **KRIS'S "MAGIC" IS ACT.** His only entry is spell 7, whose name is literally
// `"ACT"` and whose `spelltarget` is 0. That is why his button row reads ACT
// where Susie's and Ralsei's read MAGIC — it is one menu slot holding different
// contents, not two different buttons.
//
// Costs are RAW TP out of `global.maxtension = 250`, not percentages, and they
// come out to the familiar numbers: Rude Buster 125/250 = 50%, Heal Prayer
// 80/250 = 32%, Pacify 40/250 = 16%, UltraHeal 225/250 = 90%.
//
// `spelltarget`: 0 none, 1 an ALLY, 2 an ENEMY. It is what decides whether
// choosing the spell opens a target picker, and getting it from the dump
// rather than from the spell's obvious meaning matters for Pacify — it targets
// an enemy despite doing no damage.

import { PARTY, statFor } from './damage.js';
import { spellDamage, damageKnight } from './knight.js';
import { castRudeBuster } from './rudebuster.js';
import { applyHeal } from './items.js';
import { spawnSelfHealNumber } from './dmgnumbers.js';
import { PARTY as PARTY_STATS } from './damage.js';

/**
 * `scr_heal_amount_modify_by_equipment` — BlueRibbon's Heal+, and the SPELL
 * path is its only caller (scr_healitemspell / scr_healallitemspell, both
 * reached from scr_spell alone). Items heal their printed amount.
 */
const healAmountModifyByEquipment = (amount, ribbons) =>
  amount + Math.ceil(amount / 8) * ribbons;

/**
 * The spell path's writer: `scr_dmgwriter_selfchar()` at type 3, damage = the
 * MODIFIED heal amount, and `specialmessage = 3` — the MAX graphic — when the
 * heal left them at full.
 *
 * THE TEST IS TAKEN AFTER THE HEAL, and it is `>=`, not `==`: an ally already
 * at max who is healed again still reads MAX, which is what the game does and
 * is the only way "+0" never appears on screen.
 */
function healNumber(state, target, amount) {
  const maxed = state.partyHp[target] >= PARTY_STATS[target].maxhp;
  spawnSelfHealNumber(state, target, amount, maxed);
}
import { cue } from './audio.js';
import { ACT_PAGES } from './dialogue.js';

// Where the caster and the Knight stand. Duplicated from sim/actors.js rather
// than imported: actors.js pulls in damage.js which pulls in this, and the
// cycle is not worth untangling for two coordinates.
const PARTY_POS = [{ x: 126, y: 104 }, { x: 80, y: 142 }, { x: 58, y: 190 }];
const KNIGHT_POS = { x: 425, y: 78 };
// The Knight's sprite is 2x from its origin; his mass sits down and right of
// the instance position. Measured against where the hurt strobe draws him.
// `targety -= 50` from the bolt's Create is folded in here: 90 down to his
// mass, 50 back up for the Knight's own aim offset.
const KNIGHT_AIM = { dx: 60, dy: 90 - 50 };

/** `scr_spellinfo`, the cases this fight can reach. */
export const SPELLS = {
  2: { name: 'Heal Prayer', descb: 'Heal#Ally', cost: 80, target: 1 },
  3: { name: 'Pacify', descb: 'Spare#TIRED foe', cost: 40, target: 2 },
  4: { name: 'Rude Buster', descb: 'Rude#Damage#', cost: 125, target: 2 },
  7: { name: 'ACT', descb: 'Use#action', cost: 0, target: 0 },
  11: { name: 'UltraHeal', descb: 'Best#healing', cost: 225, target: 1 },
};

/** `global.spell[char]`, by PARTY SLOT (slot + 1 is the character id here). */
export const SPELL_LIST = [[7], [4, 11], [3, 2]];

/**
 * `scr_monstersetup`, monstertype 104 — the Knight's ACT list.
 *
 * Kris gets two, Susie and Ralsei one each, and the party ACTs really are
 * named `S-Action` and `R-Action` in the dump. They look like placeholders and
 * they are not: those are the strings the game draws. Renaming them to
 * something that reads better would be inventing content.
 */
export const ACTS = [
  [
    { name: 'Check', descb: 'Useless#analysis', spelltarget: 0 },
    { name: 'HoldBreath', descb: '', spelltarget: 0 },
  ],
  [{ name: 'S-Action', descb: '', spelltarget: 2 }],
  [{ name: 'R-Action', descb: '', spelltarget: 2 }],
];

// ── THE PARTNER ACT ROW IS A MAGIC-LIST ROW ─────────────────────────────────
//
// `scr_spellmenu_setup` (gml_GlobalScript_scr_spellmenu_setup.gml) builds
// `global.battlespell[slot][]` — the list bmenuno 2 draws — as the character's
// ACT rows FOLLOWED BY `global.spell[global.char[slot]]`:
//
//     for (__fj = 0; __fj < 6; __fj++) {
//         global.battlespell[__i][__fj] = 0;
//         if (global.char[__i] == 2 && global.canactsus[0][__fj] == 1) {
//             global.battlespell[__i][__fj]      = -1;          // <- the marker
//             if (global.battleactcount[__i] < (__fj + 1))
//                 global.battleactcount[__i] = __fj + 1;
//             global.battlespellcost[__i][__fj]  = global.actcostsus[0][__fj];
//             global.battlespellname[__i][__fj]  = global.actnamesus[0][__fj];
//             global.battlespelldesc[__i][__fj]  = global.actdescsus[0][__fj];
//             global.battlespelltarget[__i][__fj] = 2;
//         }
//         ...the same block for char 1 (target 0), 3 and 4...
//     }
//     for (__fj = 0; __fj < 12; __fj++) {
//         __ib = global.battleactcount[__i] + __fj;
//         global.battlespell[__i][__ib] = global.spell[global.char[__i]][__fj];
//         ...cost/name/desc/target likewise...
//     }
//
// So S-Action, R-Action and N-Action are NOT a second grid — they are the
// FIRST rows of the partner's MAGIC list, and the ACT grid (bmenuno 9) is
// Kris's alone. The button row agrees: `bmenucoord[0] == 1 && global.char[
// charturn] != 1` opens bmenuno 2, and only Kris's arm opens bmenuno 11
// (obj_battlecontroller Step_0:482-491). The confirm on a `battlespell == -1`
// row opens bmenuno 13 — an ENEMY picker, which is what `battlespelltarget
// = 2` means — and THAT confirm runs `scr_actselect(enemy, bmenucoord[2])`
// (Step_0:786-816 and :1429-1437), landing on `charaction[charturn] = 9`:
// the same act path Kris's grid reaches, entered through the spell list.
//
// THE MOD REBUILDS THE LIST MID-FIGHT — `scr_spellmenu_setup()` at
// obj_knight_enemy Step_0:1188, right after it rewrites Susie's act row to
// HoldBreath — so the list is a LIVE derivation, not a snapshot taken at
// battle start. `spellListFor` below derives it on every read for that reason.
//
// THE MARKER IS ONE VALUE FOR EVERY ACT ROW (-1) because GML carries the row
// INDEX separately, in `global.bmenucoord[2][charturn]`. This engine hands
// the confirm only the row's `id`, so the index rides in the id: act row `i`
// is `actRowId(i)` = `-1 - i`, and `actRowIndex` reads it back. -1 is still
// -1 for the single-act partners this fight fields.
export const actRowId = (i) => -1 - i;

/** The act index behind an id from `spellListFor`, or null for a real spell. */
export function actRowIndex(id) {
  return (typeof id === 'number' && id <= -1) ? -1 - id : null;
}

export function isActRowId(id) {
  return actRowIndex(id) !== null;
}

// ── THE CHARACTER-TABLE SEAM ────────────────────────────────────────────────
//
// The three tables above are indexed by PARTY SLOT because this fight's party
// is fixed: slot i is always character i + 1, so `SPELL_LIST[1]` is Susie's
// list and `ACTS[1]` is hers. The game does not index that way. Every one of
// these reads is `global.spell[global.char[charturn]]`, `global.canactsus`
// / `actnamesus` (obj_battlecontroller Draw_0, the bmenuno-9 fill) and
// `scr_actselect`'s `global.char[global.charturn] == 1 / 2 / 3 / 4` — by
// CHARACTER ID, through the slot -> id bridge. The two agree only while the
// bridge is the identity, which it is for Kris/Susie/Ralsei and nothing else.
//
// A scene that fields a different party (a kaizo lane: Kris + Noelle, whose
// `global.char` is [1, 4, 0]) supplies its own character-keyed answer through
// `state.kaizo.hooks`, and each accessor below falls back to the slot table
// when no hook is installed — `??`, exactly the shape render/menu.js's
// `state.partySprites` seam takes. Vanilla installs nothing, reads nothing
// different, and the six whole-fight diffs pin that. sim/ still imports
// nothing from any scene; the hook is a plain state field.
//
//   spellInfo(state, id)        scr_spellinfo's row for one id; a hook may
//                               ADD ids this table lacks (8, 9, 10) and never
//                               needs to restate the ones it has
//   spellListFor(state, slot)   `global.battlespell[slot]` — the MAGIC list
//                               bmenuno 2 draws: the slot's ACT rows (ids
//                               from `actRowId`) then `global.spell[
//                               global.char[slot]]`. A `spellList` HOOK still
//                               answers the narrow `global.spell` half only;
//                               the act half always comes from `actsFor`, so
//                               a scene gets the concatenation for free.
//   actsFor(state, slot)        the canact/actname/actdesc fill for that
//                               slot's character. A hook's row may carry
//                               `usable` (the mod's `canpress`/`cant` gates,
//                               computed live) and `cost` (`actcost`, TP
//                               spent at the grid's confirm); listRows and
//                               the confirm handler read both, and a vanilla
//                               row has neither, so vanilla spends nothing.
//   spellCost / castSpell / resolveActPages take a hook the same way: it
//   answers, or returns undefined (pages: a falsy value) to hand the id
//   back to the vanilla body below.
export function spellInfo(state, id) {
  // AN ACT ROW ANSWERS FIRST, and it answers out of `actsFor` rather than out
  // of any spell table: `global.battlespellname/desc/cost/target[thischar][j]`
  // were copied from `actname*/actdesc*/actcost*[0][j]` by scr_spellmenu_setup.
  // `thischar` is `global.charturn` — the row can only belong to the character
  // whose menu is open — which is why the slot is read off the menu here
  // instead of being passed: every caller of this accessor already means the
  // current character.
  const row = actRowFor(state, id);
  if (row) {
    return {
      name: row.name,
      descb: row.descb ?? '',
      cost: row.cost ?? 0,
      // `global.battlespelltarget` is 0 for Kris's rows and 2 for every
      // partner's — bmenuno 13, the enemy picker, is what a partner ACT opens.
      target: row.spelltarget ?? 2,
    };
  }
  return state?.kaizo?.hooks?.spellInfo?.[id] ?? SPELLS[id];
}

/**
 * The act rows of one slot's MAGIC list — `canact*[0][0..5]` as
 * scr_spellmenu_setup copies them, with the SAME one-use gate the ACT grid
 * applies (sim/menu.js's listRows drops Susie's row once `canactsus[0]` has
 * been cleared). The two views of one table must not disagree about whether
 * a row exists: a magic list that still offered S-Action after the grid had
 * dropped it would let it be used twice.
 */
export function actRowsFor(state, c) {
  if (c === 1 && state?.actCounts?.susieUsed) return [];
  return actsFor(state, c) ?? [];
}

function actRowFor(state, id) {
  const i = actRowIndex(id);
  if (i === null) return null;
  return actRowsFor(state, state?.menu?.charturn ?? 0)[i] ?? null;
}

/**
 * `global.battlespell[slot]` — the ACT rows first, then the character's
 * spells, exactly as scr_spellmenu_setup lays them out. See the block above
 * ACTS for the GML. `battleactcount` is the join index, which here is just
 * the length of the act half.
 */
export function spellListFor(state, c) {
  const spells = state?.kaizo?.hooks?.spellList?.(state, c) ?? SPELL_LIST[c] ?? [];
  const acts = actRowsFor(state, c);
  if (acts.length === 0) return spells;
  return [...acts.map((_, i) => actRowId(i)), ...spells];
}

export function actsFor(state, c) {
  return state?.kaizo?.hooks?.actList?.(state, c) ?? ACTS[c];
}

/**
 * `scr_spellconsumeb`'s TP check. A spell you cannot pay for is still SHOWN —
 * greyed, not hidden — because the list is built from what the character
 * knows, not from what they can afford this second.
 */
export function spellCost(state, slot, spellId) {
  // AN ACT ROW IS NOT A SPELL, AND scr_spellconsumeb NEVER SEES ONE. The
  // battlespell -1 rows are charged by bmenuno 13's confirm out of
  // `global.battlespellcost[thischar][bmenucoord[2]]` (obj_battlecontroller
  // Step_0:1433) — the ACT's own `actcost*`, not the spell path's deduction.
  //
  // Infinity here is therefore a REFUSAL, not a price: sim/menu.js's
  // recordSpell tests `state.tension < cost` and returns null, so an act row
  // that reaches the SPELL path is rejected with snd_error instead of being
  // queued into obj_spellphase as a spell that does not exist. `canAfford`
  // below answers the display question from the row's real cost, which is
  // what greys it — two different GML quantities that happen to coincide for
  // every real spell. Once the bmenuno-13 confirm routes to scr_actselect,
  // nothing reaches this line at all; it stays as the backstop.
  if (isActRowId(spellId)) return Infinity;
  // The seam (see spellInfo): a character-keyed cost, or undefined to fall
  // through to the table.
  const hook = state?.kaizo?.hooks?.spellCost;
  if (hook) {
    const v = hook(state, slot, spellId);
    if (v !== undefined) return v;
  }
  const s = spellInfo(state, spellId);
  if (!s) return Infinity;
  // Devilsknife's "Buster TP DOWN" — 125 -> 100, the familiar 50% -> 40%.
  if (spellId === 4) return statFor(state, slot).rudeBusterCost;
  return s.cost;
}

/**
 * `global.tension >= global.battlespellcost[thischar][j]` — the test the grid
 * DRAWS with (obj_battlecontroller Draw_0's `cant` / the row's grey) and the
 * one Step_0:787 gates the confirm on. For a spell that is `spellCost`; for
 * an ACT ROW it is the row's own `actcost*`, which is 0 for S-, R- and
 * N-Action, so a partner's ACT is never greyed for want of TP.
 */
export function canAfford(state, spellId, slot = 1) {
  if (isActRowId(spellId)) {
    return state.tension >= (spellInfo(state, spellId)?.cost ?? 0);
  }
  return state.tension >= spellCost(state, slot, spellId);
}

/**
 * HOLDBREATH, from obj_knight_enemy's Step:
 *
 *     if (acting == 2 && actcon == 0) {
 *         actcon = 1;
 *         holdbreathcount++;
 *         if (holdbreathcount <= 1) "* The SOUL now moves faster."
 *         if (holdbreathcount > 1)  "* Nothing happened."
 *         holdbreathcount = 1;
 *     }
 *
 * and then, at the top of the same Step:
 *
 *     if (holdbreathcount > 0 && i_ex(obj_heart))                 wspeed = 5;
 *     if (holdbreathcount > 0 && i_ex(obj_knight_roaring2) ...)    wspeed = 6;
 *
 * **IT ONLY WORKS ONCE.** The counter is incremented and then hard-assigned
 * back to 1, so the second use prints "Nothing happened" and changes nothing.
 * A naive `holdbreathcount++` would let it stack forever.
 *
 * The payoff is soul speed 4 -> 5, and 6 while Roaring is on screen — the
 * fight's one permanent buff, and the reason the ACT is worth a turn.
 */
/**
 * THE KNIGHT'S ACTING BLOCKS — the counts, their clamps, and the page choice
 * they drive, exactly as obj_knight_enemy's Step performs each ACT after the
 * menu closes:
 *
 *     acting == 2:    actcon = 1; checkcount++;  pages by checkcount == 1
 *     acting == 2b:   holdbreathcount++; pages by <= 1; holdbreathcount = 1
 *     actingsus == 1: seven pages; sactcount = 1; canactsus[0] = 0
 *     actingral == 1: ractcount++; five pages or three by ractcount == 1
 *
 * Called by the director when the ACT's writer is BORN — the sim's "after the
 * menu" — never at selection. At selection these effects could not be undone:
 * an X after choosing HoldBreath left the speed buff live and the repeat page
 * armed, and cancelling Ralsei's first R-Action burned his five-page variant
 * unseen.
 */
export function resolveActPages(state, c, actId) {
  state.actCounts = state.actCounts ?? {};
  const n = state.actCounts;
  // The seam (see spellInfo): a character-keyed acting block, or a falsy
  // value to hand the act back to the slot-keyed blocks below.
  const hook = state.kaizo?.hooks?.resolveActPages;
  if (hook) {
    const pages = hook(state, c, actId);
    if (pages) return pages;
  }
  if (c === 0) {
    if (actId === 1) return ACT_PAGES[holdBreath(state)];
    n.check = (n.check ?? 0) + 1;
    return ACT_PAGES[n.check === 1 ? 'check' : 'point'];
  }
  if (c === 1) {
    // `global.canactsus[myself][0] = 0` — one performance, then the row
    // leaves her list. Read by listRows.
    n.susieUsed = true;
    return ACT_PAGES.susie;
  }
  n.ralsei = (n.ralsei ?? 0) + 1;
  return ACT_PAGES[n.ralsei <= 1 ? 'ralsei' : 'ralsei_again'];
}

export function holdBreath(state) {
  // RETURNS THE PAGE KEY, not a sentence. It used to return its own condensed
  // text —
  //
  //     '* Kris held their breath. The SOUL now moves faster.'
  //
  // — against the dump's
  //
  //     "* Kris held their breath.&* Their heartbeat quickened.&
  //      * The SOUL now moves faster./%"
  //
  // so the chatbox lost a whole line ("Their heartbeat quickened.", and
  // "* Kris smiled." on the repeat) and ran the rest together on one row. The
  // correct pages were already in ACT_PAGES and driving the writer, so the
  // fight showed two different texts for the same act depending on which one
  // you were looking at. One source now; the caller pulls both from ACT_PAGES.
  //
  // The count is the dump's, verbatim: `holdbreathcount++`, pick on `<= 1`,
  // then CLAMP back to 1 — which is what stops the buff stacking.
  const n = (state.knight.holdbreathcount ?? 0) + 1;
  state.knight.holdbreathcount = 1;
  return n <= 1 ? 'holdbreath_first' : 'holdbreath_again';
}

/** The soul's `wspeed`, which HoldBreath is the only thing that changes. */
export function soulSpeed(state) {
  if (!state.knight?.holdbreathcount) return 4;
  return state.roaringActive ? 6 : 5;
}

/**
 * Cast. Returns a line for the HUD, or null if it could not be paid for.
 *
 * `scr_spellconsumeb` spends the TP FIRST and the effect runs after, so a
 * spell that turns out to do nothing still costs — Pacify against an enemy
 * that cannot be spared is a wasted 40, and this fight's Knight is exactly
 * that enemy.
 */
export function castSpell(state, slot, spellId, target = 0, opts = {}) {
  // The seam (see spellInfo): a character-keyed scr_spell case, or undefined
  // to hand the id to the cases below. It runs BEFORE the TP test on purpose:
  // the hook is a whole scr_spell case, and scr_spell does not charge —
  // scr_spellconsumeb already did, at selection (recordSpell in sim/menu.js).
  const hook = state.kaizo?.hooks?.castSpell;
  if (hook) {
    const r = hook(state, slot, spellId, target, opts);
    if (r !== undefined) return r;
  }
  const s = spellInfo(state, spellId);
  if (!s) return null;
  // `scr_spellconsumeb` deducts TP when the spell is SELECTED, not when it
  // resolves — that is what stops two characters spending the same 125 in one
  // turn. The menu's recordSpell has already paid, so the resolve pass must
  // not charge again.
  if (!opts.alreadyPaid) {
    if (state.tension < s.cost) return null;
    state.tension -= s.cost;
  }

  if (spellId === 4) {
    // RUDE BUSTER DOES NOT RESOLVE HERE. It is a timing minigame: the
    // animation plays, a bolt flies, and pressing Z just before it lands adds
    // up to +30 before the Knight's halving. Subtracting the damage on cast —
    // which is what this did — threw the whole mechanic away and made the
    // spell a worse Rude Buster than the game's.
    //
    // See sim/rudebuster.js. `scr_spell` sets `global.spelldelay = 70`, so the
    // turn holds while it resolves.
    // AIM AT THE KNIGHT WHERE HE ACTUALLY IS, not at a constant. `targetx/y`
    // come from `global.monsterx/monstery`, which track the instance — and
    // this Knight BOBS (`y = ystart + cos(siner2 / 8) * 8`) and shakes when
    // hit. A fixed origin sent the bolt to where he was at scene build, so it
    // flew past him and detonated on empty air.
    //
    // The sprite is drawn at scale 2 from its origin, so the visual centre is
    // well right of and below `x, y` — aiming at the raw origin puts the
    // impact off his shoulder even when the coordinates are live.
    const k = state.entities.find((en) => en.alive && en.type.name === 'obj_knight_enemy');
    const kx = (k?.x ?? KNIGHT_POS.x) + KNIGHT_AIM.dx;
    const ky = (k?.y ?? KNIGHT_POS.y) + KNIGHT_AIM.dy;
    castRudeBuster(state, PARTY_POS[slot].x, PARTY_POS[slot].y,
      spellDamage(state, slot), kx, ky);
    return 'Rude Buster!';
  }
  if (spellId === 2) {
    // Heal Prayer heals `magic * 5` — 55 at Ralsei's magic of 11. Through
    // scr_heal, so it lands on the fallen and floors at ceil(maxhp / 6).
    // `magic * 5`, off the EQUIPPED magic — Dealmaker's +5 is most of
    // Ralsei's healing. BlueRibbon's Heal+ multiplies what the WEARER heals.
    const st = statFor(state, slot);
    const amount = healAmountModifyByEquipment(st.magic * 5, st.healRibbons);
    applyHeal(state, target, st.magic * 5, st.healRibbons);
    healNumber(state, target, amount);
    // NO CHATBOX LINE. scr_spell's case 2 heals, spawns obj_healanim, and
    // writes the number through scr_dmgwriter_selfchar at type 3 (green) with
    // `specialmessage = 3` when the target is already full — and that number
    // above the character IS the entire feedback. `Heal Prayer: +55` was
    // invented text in a box the game leaves alone.
    //
    // `global.spelldelay` is NOT translated, deliberately. It drives
    // obj_spellphase, which this sim does not model. The per-character resolve
    // delay the director DOES use is obj_attackpress's own `spelldelay[c]`,
    // which the dump initialises to 10 and the director already hardcodes at
    // that. A state field nothing reads is the dead-write hazard this project
    // keeps tripping over, so it is left out rather than left inert.
    return null;
  }
  if (spellId === 11) {
    // UltraHeal's cost is `225 - round(global.flag[1045] * 2.5)`; flag 1045 is
    // 0 in this fight's state, so it is the flat 225.
    const st2 = statFor(state, slot);
    const amount = healAmountModifyByEquipment(st2.magic * 5 + 100, st2.healRibbons);
    const did = applyHeal(state, target, st2.magic * 5 + 100, st2.healRibbons);
    healNumber(state, target, amount);
    return `UltraHeal: +${did}`;
  }
  if (spellId === 3) {
    // PACIFY FAILS VISIBLY, it does not print an excuse. scr_spell's case 3
    // spares only a TIRED enemy (`global.monsterstatus[star] == 1`); the
    // Knight's status never leaves 0, so the else branch runs:
    //
    //     _pspell = instance_create(0, 0, obj_pacifyspell);
    //     _pspell.target = global.monsterinstance[star];
    //     _pspell.fail = 1;
    //     global.spelldelay = 20;
    //
    // and obj_pacifyspell's `fail` path skips the lift-and-sparkle entirely
    // (con 1 -> con 5) for a colour flash: con 6 walks image_blend toward
    // c_blue at 0.12 a frame for 8 frames, con 8 walks it back to c_white at
    // 0.16 for 8 more, con 9 restores white and destroys.
    //
    // `Pacify: the Knight is not TIRED` was invented text explaining a thing
    // the game shows you instead.
    state.pacifyFail = { con: 6, alarm: 8 };
    return null;
  }
  return null;
}
