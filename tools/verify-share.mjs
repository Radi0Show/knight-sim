#!/usr/bin/env node
// SHAREABLE SETUPS — `?cfg=<token>`, so a brutal loadout is a link.
//
// NO DUMP INVOLVED: this is the tool's own feature, not a translation, and
// nothing here claims otherwise. What it is worth testing is the part that
// takes UNTRUSTED INPUT. A token arrives from a stranger's URL and every value
// in it is used to index a real table — a weapon id reaches `statsOf`, an item
// id reaches the menu's renderer — so the decoder has to be hostile to its
// input or a malformed link produces a run built from ids nothing can draw.
//
// The round trip is the cheap half. The half that matters is what a BAD token
// does, which is why most of this file is junk strings.

import { encodeConfig, decodeConfig, NONE, CONFIG_LENGTH } from '../sim/share.js';
import { WEAPONS, ARMOR, canEquip } from '../sim/equipment.js';
import { ITEMS, DEFAULT_BAG } from '../sim/items.js';
import { DEFAULT_GEAR } from '../sim/damage.js';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

/** The driver's own validators, so this tests what actually runs. */
const RULES = {
  weaponOk: (id, c) => id === 0 || (!!WEAPONS[id] && canEquip('weapon', id, c)),
  armorOk: (id, c) => id === 0 || (!!ARMOR[id] && canEquip('armor', id, c)),
  itemOk: (id) => !!ITEMS[id],
  modeCount: 4,
  attackCount: 18,
};

// ------------------------------------------------------------ the round trip
{
  const gear = DEFAULT_GEAR.map((g) => ({ weapon: g.weapon, armor: [...g.armor] }));
  const bag = [...DEFAULT_BAG];
  const token = encodeConfig({ mode: 1, attack: 7, difficulty: 2, gear, bag });
  check(token.length === CONFIG_LENGTH,
    `a token is ${CONFIG_LENGTH} characters; this one is ${token.length}`);
  // URL-SAFE, or the link breaks the moment someone pastes it into a chat
  // client that escapes things.
  check(/^[A-Za-z0-9_-]+$/.test(token), `the token must be URL-safe, got ${token}`);

  const back = decodeConfig(token, RULES);
  check(back !== null, 'a token this module wrote should decode');
  check(back.mode === 1 && back.attack === 7 && back.difficulty === 2,
    `mode/attack/difficulty should survive, got ${back.mode}/${back.attack}/${back.difficulty}`);
  check(JSON.stringify(back.gear) === JSON.stringify(gear),
    `the gear should survive:\n    ${JSON.stringify(back.gear)}\n    ${JSON.stringify(gear)}`);
  check(back.bag.join() === bag.join(), `the bag should survive, got [${back.bag.join()}]`);
}

// ---------------------------------------------------- NONE means "not pinned"
// A link that carries only a loadout must not also wipe the reader's mode or
// bag back to a default — leaving a field alone and setting it to zero are
// very different, and the decoder distinguishes them with null.
{
  const gear = DEFAULT_GEAR.map((g) => ({ weapon: g.weapon, armor: [...g.armor] }));
  const back = decodeConfig(encodeConfig({ gear }), RULES);
  check(back.mode === null, 'an unpinned mode should decode as null, not 0');
  check(back.attack === null, 'an unpinned attack should decode as null');
  check(back.bag === null, 'an unpinned bag should decode as null, not an empty bag');
  check(back.gear !== null, 'the gear that WAS pinned should come through');
}

// ------------------------------------------------------------- hostile input
{
  const bad = [
    null, undefined, '', 'x', '!!!!', 'A'.repeat(CONFIG_LENGTH - 1),
    'A'.repeat(CONFIG_LENGTH + 1),
    // Right length, wrong version — a future token must be refused rather
    // than read with today's field offsets.
    `Z${'A'.repeat(CONFIG_LENGTH - 1)}`,
    // Right length and version, one character outside the alphabet.
    `A${'A'.repeat(CONFIG_LENGTH - 2)}%`,
  ];
  for (const t of bad) {
    check(decodeConfig(t, RULES) === null, `a bad token should decode to null: ${String(t)}`);
  }
}

// ------------------------------------------- out-of-range ids become SAFE ids
// Hand-built tokens with ids past the end of the tables. Nothing here should
// throw, and nothing should come back holding an id the tables do not have.
{
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const ch = (n) => A[n];
  // version, mode, attack, difficulty, then 9 gear + 12 bag all at 62 —
  // a legal symbol, and an id no table contains.
  const token = `A${ch(0)}${ch(0)}${ch(0)}${ch(62).repeat(21)}`;
  check(token.length === CONFIG_LENGTH, 'the hand-built token is the right length');
  const back = decodeConfig(token, RULES);
  check(back !== null, 'a well-formed token with silly ids should still decode');
  for (const g of back.gear) {
    check(g.weapon === 0 || !!WEAPONS[g.weapon], `weapon ${g.weapon} is not in the table`);
    for (const a of g.armor) check(a === 0 || !!ARMOR[a], `armor ${a} is not in the table`);
  }
  for (const id of back.bag) check(id === 0 || !!ITEMS[id], `item ${id} is not in the table`);

  // Mode and attack indices past the end become null rather than indexing off
  // the end of MODES — `MODES[undefined].id` is a crash at load, on a link.
  const wild = `A${ch(62)}${ch(62)}${ch(0)}${ch(0).repeat(21)}`;
  const b2 = decodeConfig(wild, RULES);
  check(b2.mode === null, `a mode index past the end should be null, got ${b2.mode}`);
  check(b2.attack === null, `an attack index past the end should be null, got ${b2.attack}`);
}

// ------------------------------------------ the char-flag rule is enforced
// The equip menu refuses a piece the character cannot wear; a link must not be
// a way around it. Susie's weapons are the test — Ralsei cannot hold one.
{
  const wrong = [
    { weapon: 0, armor: [0, 0] },
    { weapon: 0, armor: [0, 0] },
    // Ralsei (slot 2) handed every weapon in turn.
    { weapon: 0, armor: [0, 0] },
  ];
  let refused = 0;
  let offered = 0;
  for (const id of Object.keys(WEAPONS).map(Number)) {
    if (canEquip('weapon', id, 2)) continue;
    offered += 1;
    wrong[2].weapon = id;
    const back = decodeConfig(encodeConfig({ gear: wrong }), RULES);
    if (back.gear[2].weapon === 0) refused += 1;
  }
  check(offered > 0, 'there should be weapons Ralsei cannot hold, or this proves nothing');
  check(refused === offered,
    `every unequippable weapon should be refused; ${refused} of ${offered} were`);
}

// ---------------------------------------------------- an all-empty bag is real
// Twelve empty slots is a legitimate, and very brutal, setup: no items at all.
// It must not be mistaken for "no bag pinned".
{
  const back = decodeConfig(encodeConfig({ bag: new Array(12).fill(0) }), RULES);
  check(back.bag !== null, 'an all-empty bag is a CHOICE, not an absent field');
  check(back.bag.length === 12 && back.bag.every((v) => v === 0),
    `it should come back as twelve empties, got [${back.bag.join()}]`);
}

console.log('shareable setups — ?cfg=<token> (the tool\'s own feature, no dump)\n');
{
  const gear = DEFAULT_GEAR.map((g) => ({ weapon: g.weapon, armor: [...g.armor] }));
  const t = encodeConfig({ mode: 0, attack: 0, difficulty: 0, gear, bag: [...DEFAULT_BAG] });
  console.log(`→ ${t.length} characters, URL-safe: ${t}`);
}
console.log('→ bad tokens refused; out-of-range ids clamped; char flags enforced');

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  setups round-trip, and a hostile token cannot build a broken run');
