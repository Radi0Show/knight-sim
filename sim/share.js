// SHAREABLE SETUPS — one URL parameter carrying a whole configuration, so a
// brutal loadout can be handed to someone else as a link.
//
// The pieces that make a run what it is are the MODE, the attack and
// difficulty for SINGLE, the party's GEAR and the twelve item SLOTS. Screen
// shake, scaling and volume are deliberately NOT in here: they are how a
// person likes to sit in front of a screen, not part of the challenge, and a
// link that quietly reset someone's accessibility settings would be a bad
// trade for a share button.
//
// THE ENCODING IS ONE CHARACTER PER VALUE. Every id in the game fits in six
// bits — weapons reach 26, armour 27, items 39, the attack roster 18 — so a
// 64-character alphabet holds each of them in a single character with room to
// spare, and the whole setup is 24 characters:
//
//     [0]      version
//     [1]      mode index into MODES, or NONE
//     [2]      attack index into the roster
//     [3]      difficulty index
//     [4..12]  gear: weapon, armour 1, armour 2 for each of the three
//     [13..24] the twelve item slots
//
// The alternative — base64 of a JSON blob — is four times longer for the same
// information and no more robust, because either way the decoder has to
// validate every field against the real tables. It does; see decodeConfig.
// A token is untrusted input that arrives from a stranger's link, and the
// failure mode of trusting it is a run built from ids nothing can draw.

/** base64url's alphabet: 64 symbols, all URL-safe, none of them escaped. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VERSION = 'A'; // index 0

/** Sentinel for "the sharer did not pin this" — 63, the last symbol. */
export const NONE = 63;

const enc = (n) => ALPHABET[Math.max(0, Math.min(63, n | 0))];
const dec = (ch) => {
  const i = ALPHABET.indexOf(ch);
  return i < 0 ? null : i;
};

export const CONFIG_LENGTH = 25;

/**
 * Build the token. Every field is optional; anything missing becomes NONE and
 * the loader leaves that part of the setup alone rather than overwriting it
 * with a default — a link that pins only the gear should not also wipe the
 * bag.
 */
export function encodeConfig({
  mode = NONE, attack = NONE, difficulty = NONE, gear = null, bag = null,
} = {}) {
  let out = VERSION + enc(mode) + enc(attack) + enc(difficulty);
  for (let c = 0; c < 3; c++) {
    const g = gear?.[c];
    out += enc(g ? g.weapon : NONE);
    out += enc(g ? (g.armor?.[0] ?? 0) : NONE);
    out += enc(g ? (g.armor?.[1] ?? 0) : NONE);
  }
  for (let i = 0; i < 12; i++) out += enc(bag ? (bag[i] ?? 0) : NONE);
  return out;
}

/**
 * Read a token back, or null if it is not one.
 *
 * VALIDATION IS THE POINT. This runs on a string a stranger put in a URL, and
 * every value it produces is used to index a real table — an unknown weapon id
 * reaches `statsOf`, an unknown item id reaches the menu's renderer. Anything
 * out of range is dropped to a safe value rather than passed along, and a
 * token of the wrong length or version is refused whole.
 *
 * `valid` is the caller's membership test (id -> boolean) for gear and items,
 * so this module stays free of the equipment and item tables and cannot drift
 * out of step with them.
 */
export function decodeConfig(token, {
  weaponOk = () => true, armorOk = () => true, itemOk = () => true,
  modeCount = 4, attackCount = 1,
} = {}) {
  if (typeof token !== 'string' || token.length !== CONFIG_LENGTH) return null;
  if (token[0] !== VERSION) return null;
  const v = [];
  for (const ch of token) {
    const n = dec(ch);
    if (n === null) return null;
    v.push(n);
  }

  const pick = (n, count) => (n === NONE || n < 0 || n >= count ? null : n);
  const out = {
    mode: pick(v[1], modeCount),
    attack: pick(v[2], attackCount),
    // Difficulties are per-attack and the roster is the authority on how many
    // there are, so this is bounded loosely here and clamped by the caller.
    difficulty: v[3] === NONE ? null : v[3],
    gear: null,
    bag: null,
  };

  // GEAR — all nine or none. A half-applied loadout is worse than none: it
  // reads as the sharer's setup while being someone else's stats.
  const gearVals = v.slice(4, 13);
  if (!gearVals.includes(NONE)) {
    const gear = [];
    for (let c = 0; c < 3; c++) {
      const w = gearVals[c * 3];
      const a1 = gearVals[c * 3 + 1];
      const a2 = gearVals[c * 3 + 2];
      gear.push({
        // 0 is the empty slot and is always legal.
        weapon: weaponOk(w, c) ? w : 0,
        armor: [armorOk(a1, c) ? a1 : 0, armorOk(a2, c) ? a2 : 0],
      });
    }
    out.gear = gear;
  }

  const bagVals = v.slice(13, 25);
  if (!bagVals.every((n) => n === NONE)) {
    // An unknown item becomes an EMPTY slot rather than being dropped, so the
    // twelve positions the sharer chose stay in their places.
    out.bag = bagVals.map((n) => (n !== NONE && itemOk(n) ? n : 0));
  }

  return out;
}
