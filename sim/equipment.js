// EQUIPMENT — one weapon and two armour slots per character.
//
// EVERY NUMBER BELOW IS GENERATED from `scr_weaponinfo` and `scr_armorinfo`
// by parsing their case blocks, not retyped from a table. That matters: the
// handoff spec this replaces had four values wrong, and three of them were
// wrong in the direction that flatters the item.
//
// ── What the spec got wrong, all confirmed against the dump ───────────────
//
// 1. **THE RIBBONS COST YOU TP.** The spec lists Pink/TwinRibbon as pure
//    graze-area upgrades. `obj_grazebox`'s Create:
//
//        grazetpfactor -= (scr_armorcheck_equipped_party(3) * 0.2);   PinkRibbon
//        grazetpfactor -= (scr_armorcheck_equipped_party(9) * 0.25);  TwinRibbon
//        grazetimefactor -= (scr_armorcheck_equipped_party(3) * 0.2); PinkRibbon
//
//    A bigger box that pays LESS per graze. The spec's "Turbo-TP variant",
//    which puts TwinRibbon on Ralsei to farm tension, produces 25% less TP
//    per graze than no ribbon at all — it is backwards.
//
// 2. **LodeStone is +5%, not +10%.** `* 0.05`, against TensionBow's `* 0.1`.
//
// 3. **TwinRibbon's area is +25% and PinkRibbon's +20%** — the spec had the
//    area right but called TwinRibbon's `grazesize` 25 when the field says
//    20 for both; the 25 is the SIZE FACTOR in grazebox, a different number
//    from the item's own `grazesize`. Modelled from grazebox, which is what
//    actually runs.
//
// 4. **BounceBlade is df 1**, which the spec flagged as a guess at 2.
//
// ── The ribbon rule is DATA, not a special case ───────────────────────────
//
// "Susie refuses ribbons" is `armorchar2temp = 0` on every ribbon. There is
// no rule to enforce — the char flags already say it, and `allowed` below is
// generated straight from them. Hardcoding a `susieRefusesRibbons` boolean
// would be a second source of truth that can disagree with the first.
//
// `scr_armorcheck_equipped_party(id)` returns a COUNT of how many members
// wear it, so every graze factor scales with the number wearing — two
// TensionBows is +20%.

// ── The special-effect audit (player request: "make sure all special armor
// and weapons do their special things") ─────────────────────────────────────
//
// Every battle-side equipment conditional in the dump was swept
// (scr_armor/weaponcheck callers + direct chararmor/charweapon reads).
// The complete list for THIS fight:
//
//   IMPLEMENTED, verbatim:
//   - ShadowMantle 23: x0.33 taken, the two-of-three redirect, and the
//     reset chain's slot-2 precedence quirk (sim/damage.js knightTarget).
//   - Graze set (grazebox AND the tracking-slash extra graze): TensionBow
//     +10% TP, LodeStone +5% TP, SilverWatch +10% time, PinkRibbon
//     -20% TP/-20% time/+20% size, TwinRibbon -25% TP/+25% size, size
//     capped at 3 (grazeFactors below).
//   - BlueRibbon 26: heals BY the wearer get + ceil(amount/8) PER equipped
//     ribbon (scr_heal_amount_modify_by_equipment; stacks across slots).
//   - Devilsknife 7 on Susie: Rude Buster 125 -> 100 (scr_spellinfo).
//   - Stats (at/df/mag): every piece, summed base + slots = battleat/df/mag.
//
//   AUDITED NO-OPS for this fight, so nobody "fixes" them in later:
//   - Elements: the knight's bullets all carry element 5, the mantle's own —
//     and scr_damage routes the mantle by ID, skipping the generic
//     scr_element_damage_reduction. No other chapter armour resists
//     element 5, so the generic path cannot fire here. The element fields
//     ride along as data.
//   - Silver Card / Dealmaker money bonuses: no money in the sim.
//   - White Ribbon "Cuteness", CheerScarf "Smiley", MechaSaber "Annoying",
//     AutoAxe "BadIdea", Spookysword/Brave Ax/DaintyScarf flavour abilities:
//     no battle-side reads in the dump for this encounter (ACT/overworld
//     flavour); their stats still apply.
//   - TwistedSwd/ThornRing "Trance": reads only on charweapon[4] (Noelle),
//     who is not in this party.

/** ShadowMantle's DF is `global.chapter`, and this fight is chapter 3. */
export const CHAPTER = 3;

/** `scr_weaponinfo`. `allowed` is [Kris, Susie, Ralsei] from char1..3. */
export const WEAPONS = {
  1: { name: "Wood Blade", allowed: [0] },
  2: { name: "Mane Ax", allowed: [] },
  3: { name: "Red Scarf", allowed: [2] },
  4: { name: "EverybodyWeapon", at: 12, df: 6, magic: 8, allowed: [0, 1, 2] },
  5: { name: "Spookysword", at: 2, allowed: [0], ability: "Spookiness UP" },
  6: { name: "Brave Ax", at: 2, allowed: [1], ability: "Guts Up" },
  7: { name: "Devilsknife", at: 5, magic: 4, allowed: [1], ability: "Buster TP DOWN" },
  8: { name: "Trefoil", at: 4, allowed: [0], ability: "Money Earned UP" },
  9: { name: "Ragger", at: 2, allowed: [2] },
  10: { name: "DaintyScarf", magic: 2, allowed: [2], ability: "Fluffiness UP" },
  11: { name: "TwistedSwd", at: 16, allowed: [0], ability: "Trance" },
  12: { name: "SnowRing", allowed: [] },
  13: { name: "ThornRing", at: 14, magic: 12, allowed: [], ability: "Trance" },
  14: { name: "BounceBlade", at: 2, df: 1, allowed: [0], ability: "Defense" },
  15: { name: "CheerScarf", at: 1, magic: 2, allowed: [2], ability: "Smiley" },
  16: { name: "MechaSaber", at: 4, allowed: [0], ability: "Annoying" },
  17: { name: "AutoAxe", at: 4, allowed: [1], ability: "BadIdea" },
  18: { name: "FiberScarf", at: 3, magic: 2, allowed: [2] },
  19: { name: "Ragger2", at: 5, magic: -1, allowed: [2], ability: "Prickly" },
  20: { name: "BrokenSwd", allowed: [], ability: "Failure" },
  21: { name: "PuppetScarf", at: 10, magic: -6, allowed: [2] },
  22: { name: "FreezeRing", at: 4, magic: 4, allowed: [] },
  23: { name: "Saber10", at: 6, allowed: [0] },
  24: { name: "ToxicAxe", at: 6, allowed: [1] },
  25: { name: "FlexScarf", at: 4, magic: 1, allowed: [2] },
  26: { name: "BlackShard", at: 16, allowed: [0] },};

/** `scr_armorinfo`. */
export const ARMOR = {
  1: { name: "Amber Card", df: 1, allowed: [0, 1, 2] },
  2: { name: "Dice Brace", df: 2, allowed: [0, 1, 2] },
  3: { name: "Pink Ribbon", df: 1, allowed: [0, 2], ability: "GrazeArea" },
  4: { name: "White Ribbon", df: 2, allowed: [0, 2], ability: "Cuteness" },
  5: { name: "IronShackle", at: 1, df: 2, allowed: [0, 1, 2] },
  6: { name: "MouseToken", magic: 2, allowed: [0, 1, 2], element: 7, elementAmount: 0.5 },
  7: { name: "Jevilstail", at: 2, df: 2, magic: 2, allowed: [0, 1, 2] },
  8: { name: "Silver Card", df: 2, allowed: [0, 1, 2], ability: "$ +5%" },
  9: { name: "TwinRibbon", df: 3, allowed: [0, 2], ability: "GrazeArea" },
  10: { name: "GlowWrist", df: 2, allowed: [0, 1, 2] },
  11: { name: "ChainMail", df: 3, allowed: [0, 1, 2] },
  12: { name: "B.ShotBowtie", df: 2, magic: 1, allowed: [0, 1, 2] },
  13: { name: "SpikeBand", at: 2, df: 1, allowed: [0, 1, 2] },
  14: { name: "Silver Watch", df: 2, allowed: [0, 1, 2], ability: "GrazeTime" },
  15: { name: "TensionBow", df: 2, allowed: [0, 1, 2], ability: "TPGain" },
  16: { name: "Mannequin", allowed: [0], element: 6, elementAmount: 0.35, ability: "???" },
  17: { name: "DarkGoldBand", allowed: [0] },
  18: { name: "SkyMantle", df: 1, allowed: [0, 1, 2], element: 1, elementAmount: 0.5, ability: "Elec/Holy" },
  19: { name: "SpikeShackle", at: 3, df: 1, allowed: [0, 1, 2], ability: "Attack" },
  20: { name: "FrayedBowtie", at: 1, df: 1, magic: 1, allowed: [0, 2], element: 6, elementAmount: 0.15 },
  21: { name: "Dealmaker", df: 5, magic: 5, allowed: [0, 1, 2], element: 6, elementAmount: 0.4, ability: "$ +30%" },
  22: { name: "RoyalPin", df: 3, magic: 1, allowed: [0, 1, 2] },
  23: { name: "ShadowMantle", df: CHAPTER, allowed: [0, 1, 2], element: 5, elementAmount: 0.66, ability: "Dark/Star" },
  24: { name: "LodeStone", df: 2, allowed: [0, 1, 2], ability: "TPGain" },
  25: { name: "GingerGuard", df: 3, allowed: [0, 1, 2] },
  26: { name: "BlueRibbon", df: 1, magic: 1, allowed: [0, 2], ability: "Heal+" },
  27: { name: "TennaTie", df: 5, magic: -2, allowed: [0, 1, 2] },};

/**
 * `obj_grazebox`'s Create, verbatim. These are the ONLY graze modifiers in
 * the game — there is no generic "grazeTPMult" field on the items.
 *
 *     grazetpfactor   += count(15) * 0.1    TensionBow
 *                     += count(24) * 0.05   LodeStone
 *                     -= count(3)  * 0.2    PinkRibbon
 *                     -= count(9)  * 0.25   TwinRibbon
 *     grazetimefactor += count(14) * 0.1    SilverWatch
 *                     -= count(3)  * 0.2    PinkRibbon
 *     grazesizefactor += count(3)  * 0.2    PinkRibbon
 *                     += count(9)  * 0.25   TwinRibbon    capped at 3
 */
const GRAZE_TP = { 15: 0.1, 24: 0.05, 3: -0.2, 9: -0.25 };
const GRAZE_TIME = { 14: 0.1, 3: -0.2 };
const GRAZE_SIZE = { 3: 0.2, 9: 0.25 };

/** How many party members have armour `id` equipped. */
export function partyWearing(loadout, id) {
  let n = 0;
  for (const c of loadout) {
    for (const a of c.armor ?? []) if (a === id) n += 1;
  }
  return n;
}

export function grazeFactors(loadout) {
  let tp = 1;
  let time = 1;
  let size = 1;
  for (const [id, v] of Object.entries(GRAZE_TP)) tp += partyWearing(loadout, +id) * v;
  for (const [id, v] of Object.entries(GRAZE_TIME)) time += partyWearing(loadout, +id) * v;
  for (const [id, v] of Object.entries(GRAZE_SIZE)) size += partyWearing(loadout, +id) * v;
  // `if (grazesizefactor > 3) grazesizefactor = 3;`
  if (size > 3) size = 3;
  return { tp, time, size };
}

const num = (v) => (v === 'CHAPTER' ? CHAPTER : (v ?? 0));

/** `armordftemp = global.chapter` for the mantle — resolved here. */
export function itemOf(kind, id) {
  const raw = (kind === 'weapon' ? WEAPONS : ARMOR)[id];
  if (!raw) return null;
  return { ...raw, df: num(raw.df === 'CHAPTER' ? 'CHAPTER' : raw.df) };
}

/** `armorchar<N>temp` — the char flags ARE the equip rule. */
export function canEquip(kind, id, slot) {
  const it = (kind === 'weapon' ? WEAPONS : ARMOR)[id];
  return !!it && (it.allowed ?? []).includes(slot);
}

/**
 * Total stats for one character. `battleat`, `battledf`, `battlemag` in the
 * game are exactly this: base plus the sum of what is equipped.
 */
export function statsOf(base, entry) {
  const eq = [];
  const w = itemOf('weapon', entry.weapon);
  if (w) eq.push(w);
  for (const a of entry.armor ?? []) {
    const it = itemOf('armor', a);
    if (it) eq.push(it);
  }
  let at = base.at;
  let df = base.df;
  let magic = base.magic;
  for (const e of eq) {
    at += e.at ?? 0;
    df += e.df ?? 0;
    magic += e.magic ?? 0;
  }
  return {
    at,
    df,
    magic,
    // BlueRibbon (26) — "Heal+". The real math is scr_heal_amount_modify_by_
    // equipment, verbatim: each equipped ribbon ADDS `ceil(amount / 8)` to a
    // heal PERFORMED BY the wearer — slot-checked separately, so two ribbons
    // stack to two ceils. (An earlier pass flattened this to a x1.125
    // multiplier, which drops the ceil and cannot stack.)
    healRibbons: (entry.armor ?? []).filter((a) => a === 26).length,
    // Devilsknife (7) — "Buster TP DOWN". 125 -> 100, i.e. 50% -> 40%.
    rudeBusterCost: entry.weapon === 7 ? 100 : 125,
    // ShadowMantle (23). `scr_damage` checks the ID directly rather than any
    // element field, and skips the generic element path when it applies.
    mantle: (entry.armor ?? []).includes(23),
    equipped: eq,
  };
}
