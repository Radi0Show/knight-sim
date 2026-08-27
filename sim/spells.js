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
    { name: 'Check', descb: 'Useless#analysis' },
    { name: 'HoldBreath', descb: '' },
  ],
  [{ name: 'S-Action', descb: '' }],
  [{ name: 'R-Action', descb: '' }],
];

/**
 * `scr_spellconsumeb`'s TP check. A spell you cannot pay for is still SHOWN —
 * greyed, not hidden — because the list is built from what the character
 * knows, not from what they can afford this second.
 */
export function spellCost(state, slot, spellId) {
  const s = SPELLS[spellId];
  if (!s) return Infinity;
  // Devilsknife's "Buster TP DOWN" — 125 -> 100, the familiar 50% -> 40%.
  if (spellId === 4) return statFor(state, slot).rudeBusterCost;
  return s.cost;
}

export function canAfford(state, spellId, slot = 1) {
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
  const s = SPELLS[spellId];
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
