// THE FOUR PRACTICE MODES, and the title screen that picks between them.
//
// This replaces the HTML `<select>` boxes that sat above the canvas. Those
// were the fastest thing to build and they looked like a debug tool bolted to
// a game — a dropdown reading "Stars — phase 1/2/3 opener" is a developer's
// index, not something you hand a playtester.
//
// The menu is drawn ON THE CANVAS with the game's own assets: `fnt_mainbig`
// for the text, `spr_heart` for the cursor, and the same dark-fountain
// background the fight uses. That is not decoration for its own sake — it
// means the menu cannot drift stylistically from the thing it launches,
// because it IS the thing it launches, one frame earlier.
//
// The modes:
//
//   NORMAL    the real fight, the real order, and it ends when it ends
//   HITLESS   one hit and it restarts — the practice loop for learning a
//             pattern, and the reason most people open a tool like this
//   ENDLESS   never stops; the phase order wraps back to the start, so you
//             can stay in the fight as long as you like
//   SINGLE    one attack on repeat, chosen from the roster
//
// HITLESS is the mode this project has been implicitly built for the whole
// time — a deterministic sim with instant restart is exactly the shape a
// hitless practice loop wants — and it was the one thing the UI could not
// express.

export const MODES = [
  {
    id: 'normal',
    name: 'NORMAL',
    blurb: 'The real fight, in order.',
  },
  {
    id: 'hitless',
    name: 'HITLESS',
    blurb: 'One hit and it starts over.',
  },
  {
    id: 'endless',
    name: 'ENDLESS',
    blurb: 'It never stops. The order loops.',
  },
  {
    id: 'single',
    name: 'SINGLE ATTACK',
    blurb: 'One attack, on repeat.',
  },
];

// ---------------------------------------------------------------------------
// SETTINGS — a hub below the modes (player request): the equip menu, an items
// stub, the volume sliders, and UNUSED.
//
// The equip menu drives the sim's real equipment layer (sim/equipment.js /
// state.loadout.gear): every weapon and armour in the chapter's tables is
// offered EXCEPT BlackShard (weapon 26, the Knight's own drop — excluded by
// design), and the char flags from scr_weapon/armorinfo decide who can wear
// what, exactly as the game's menu refuses. Stats preview as base + slots,
// the same sum `battleat/df/mag` are.

import { WEAPONS, ARMOR, canEquip, statsOf } from './equipment.js';
import { WEAPON_REFUSALS, ARMOR_REFUSALS } from './equip-refusals.js';
import { DEFAULT_GEAR, PARTY } from './damage.js';
import { ITEMS, ITEM_IDS, DEFAULT_BAG, INVENTORY_SIZE } from './items.js';
// THE UNUSED ROW'S SHATTER reaches for four leaf helpers and nothing else:
// `mergeColor` so the ramp's red is an EXPRESSION rather than a typed constant,
// `lengthdirX/Y` for GameMaker's speed/direction motion, and the WELL512 stream
// for the two `random()` draws the chapter 4 shatter makes per fragment. Both
// modules are leaves — no cycle, and nothing here runs on an unarmed build.
import { mergeColor, lengthdirX, lengthdirY, WHITE, RED } from './gml.js';
import { gmlCreate, gmlRandom } from './rng.js';

/**
 * THE ITEMS PAGE'S ROSTER — every battle-usable item, plus an EMPTY entry at
 * the front so a slot can be cleared. `0` is the dump's own empty id
 * (`itemname[0] = " "`), which is why it is the value and not a `null`.
 */
export const ITEM_PICKER = [0, ...ITEM_IDS];

export const SETTINGS_PAGES = [
  { id: 'audio', name: 'MUSIC / SFX' },
  { id: 'graphics', name: 'GRAPHICS' },
  // SHARE is not a page — confirming on it copies a link and stays put, which
  // is why it returns `out.share` instead of setting `s.page`.
  { id: 'share', name: 'SHARE SETUP' },
  { id: 'unused', name: 'UNUSED' },
];

// ---------------------------------------------------------------------------
// THE UNUSED ROW'S SECOND LIFE — an OPT-IN state machine, off by default.
//
// WHAT THIS IS AND IS NOT. On the vanilla build `title.unused` is null and the
// row behaves exactly as it always has: dimmed, and confirming it returns
// `out.error` and nothing else. Everything below only runs for a driver that
// ARMS it by assigning `title.unused` a state object (see `armUnused`) — and
// the whole purpose of that gate is that a build which never arms it cannot
// tell this code exists. verify-titlemenu asserts both halves.
//
// WHAT THE ROW BECOMES, once armed: pressing it does not open a page. It goes
// REDDER — one step per press, `UNUSED_PRESSES` of them, monotonically — and
// it KICKS SIDEWAYS on each of those presses, four frames of `obj_shakeobj`.
// On the last press it SHATTERS WHERE IT SITS. The fragments are born at the
// row's own spot and hold there for `UNUSED_SHATTER.delay` frames before they
// move, so for those frames the row still looks whole; then they fly apart
// under gravity. When the last one is gone the row is TAKEN, the settings
// screen closes, and `out.proceed` goes out to the driver — the cue to change
// what the whole program is. One-way: `taken` never goes back to false.
//
// THE COLOUR AND THE KICK ARE THE ONLY FEEDBACK, and that is the corrected
// spec rather than an omission. A `n / 20` counter used to print beside the
// row; the user asked for it gone — "do not have the (1/20) etc when pressing
// proceed, just make the color fade, and make the UNUSED shake" — so it is
// gone from here, from render/title.js, and from the provenance list below,
// because a note describing something that no longer exists is worse than no
// note at all.
//
// PROVENANCE, because part of this is taken and part is ours and the repo's
// fourth law says which is which must be written down (CLAUDE.md, "nothing
// invented ships unlabelled"):
//
//   TAKEN — THE SHATTER'S SHAPE, from DELTARUNE CHAPTER 4 ITSELF:
//   `gml_Object_obj_intro_ch4_Step_0.gml:164-196` (the chapter 4+ dump at
//   ~/knight-research/gml_dump_ch5), the prophecy shattering:
//
//       var _shattersprite = spr_intro_prophecy_shatter;
//       var _fragments = sprite_get_number(_shattersprite);
//       var _delay = 20;
//       for (var i = 0; i < _fragments; i++)
//           with (scr_marker_ext(logo_prophecy.x, logo_prophecy.y,
//                                _shattersprite, 2, 2, undefined, i,
//                                undefined, 19800)) {
//               direction = random(360);
//               scr_delay_var("gravity", 0.4 + random(0.12), _delay);
//               scr_delay_var("friction", 0, _delay);
//               scr_delay_var("speed", 4, _delay);
//               scr_doom(id, 120);
//           }
//
//   ONE MARKER PER SUB-IMAGE, every one born at the shattered thing's OWN x/y
//   wearing fragment `i`, each given a random direction immediately but ZERO
//   speed — so the pieces sit exactly where the intact thing was and the
//   picture looks unbroken until the three delayed vars land together at frame
//   20 and it comes apart. That hold is what makes it look smooth, and it is
//   the reason the shape is copied rather than re-invented. Every number below
//   (delay 20, speed 4, gravity 0.4 + random(0.12), friction 0, doom 120) is
//   from those lines, and the two RNG draws per fragment are in the GML's own
//   order.
//
//   TAKEN — THE RED, from EnderCat8's Kaizo Roaring Knight v2.3.3. Its screen
//   shatter (`scr_screenshatter_create`, appended to
//   `gml_GlobalScript_scr_lerpvar.gml:28-100` in the kaizo dump) tints its 31
//   pieces `shatter_blend = [c_white, 16711680]` normally and, on the final
//   hit (`:57-67`), `[merge_color(c_white, c_red, 0.6), merge_color(c_blue,
//   c_red, 0.6)]`. `UNUSED_RED` IS that first expression, evaluated here
//   rather than typed as a constant, and it is BOTH the ramp's target colour
//   AND the fragments' blend — so the reddening and the shatter agree by
//   construction instead of by two numbers somebody has to keep in step.
//   (GameMaker packs colours BGR: `c_blue` is 16711680, RGB (0, 0, 255).)
//
//   TAKEN — THE WORD. On a Weird Route file the mod's game-over screen
//   replaces BOTH of DEVICE_CHOICE's options with the same string,
//   `gml_Object_DEVICE_FAILURE_Step_0.gml:384-385`:
//       NAME[0][0] = NAME[1][0] = "PROCEED#(PROCEED)"
//   and then refuses to let either answer leave (`:430-437`: on the B-Side
//   `global.choice == 1` routes to `knight_mode_con 53`, not the 55 that
//   exits). The WORD, its two-line `NAME#(NAME)` shape — `#` is a line break
//   in `string_hash_to_newline`, which is why it appears twice, once in
//   brackets under itself — and the fact that taking it does not get you out
//   of anything are all from there.
//
//   TAKEN — THE KICK, from the mod's own `scr_minishakeobj`
//   (`gml_GlobalScript_scr_minishakeobj.gml`, whole file, in the kaizo dump at
//   ~/knight-research/kaizo-mod/gml_kaizo_dump/CodeEntries):
//
//       shakeobj = instance_create(x, y, obj_shakeobj);
//       shakeobj.target = id;  shakeobj.shakeamt = 4;  shakeobj.shakereduct = 1;
//       with (shakeobj) { event_user(0); }
//
//   A PER-OBJECT shake — `obj_shakeobj` walks ONE instance's `x` about the
//   position it held when the shake started (`gml_Object_obj_shakeobj_Step_0`:
//   `shakeamt -= shakereduct; on *= -1; target.x = nowx + (shakeamt * on)`,
//   destroying itself at `shakeamt <= 0`). That is the right mechanism for one
//   menu row; `obj_shake`, which this repo already carries in sim/shake.js,
//   moves the whole camera and would shake the entire settings screen. It is
//   already translated here for k_hpscene's puff — kaizo/party/scenes.js's
//   `shakeObjTarget` / `scrMinishakeobj` — and `UNUSED_SHAKE` below is that
//   same translation in the shape a title screen can hold, NOT a second one.
//
//   OURS: THE PRESS COUNT AND THE REDDENING RAMP, and the idea of putting any
//   of it on a settings row. Neither the mod nor chapter 4 has a button that
//   must be pressed twenty times, and neither reddens anything as it is
//   pressed. The mod shakes a party member who has just been hit; hanging the
//   same four frames off a refused menu press is ours.
//
// The DRIVER owns persistence. This module only counts, and moves fragments.
// ---------------------------------------------------------------------------

/**
 * HOW MANY PRESSES. TWENTY — the user's own number ("after about TWENTY
 * presses"), taken literally rather than rounded to something tidier, and the
 * ramp is built to make it legible: every press moves the row's colour exactly
 * 1/20th of the way to `UNUSED_RED`. Twenty is long enough that nobody arrives
 * on the Weird Route by mashing Z at a menu, and short enough to finish once a
 * player has decided the row is doing something — which they can see it is,
 * because the row moves under the press and comes back hotter than it was.
 *
 * THE COUNT IS NOT PRINTED. It was, as `n / 20` beside the row, and the user
 * removed it: "do not have the (1/20) etc when pressing proceed, just make the
 * color fade". The colour and the kick carry the whole signal now, which is
 * why `unusedRowStyle` no longer publishes `presses` or `total` — a field kept
 * alive for a reader that has been deleted is this repo's signature defect.
 */
export const UNUSED_PRESSES = 20;

/**
 * THE CH4 SHATTER'S NUMBERS, all from obj_intro_ch4's Step (see the block
 * above). `fragments` is `sprite_get_number(spr_intro_prophecy_shatter)`'s
 * analogue — the driver overrides it with the frame count of whatever sprite
 * it hands over, and 31 is the default because that is
 * `spr_roaringknight_finalshatter`'s count, the mod's own shatter sheet.
 *
 * `cull` IS OURS AND IS THE ONE DEPARTURE. The ch4 markers are bounded only by
 * `scr_doom(id, 120)`, which on this screen would leave about a second of
 * empty menu after the last piece has left it. A fragment that has fallen ONE
 * FULL SCREEN HEIGHT below where it started is past the bottom edge from any
 * row on a 480-pixel screen and will never be seen again, so it is dropped
 * then — the same reflex the mod's own `scr_screenshatter_step` has
 * (`if (y > (cameray() + 1000)) destroy`), at a distance that suits a fixed
 * 640x480 view rather than a scrolling room. `doom` is still the hard stop, so
 * a fragment that somehow never falls still ends, and the whole break is
 * therefore bounded by 120 frames whatever happens — asserted in
 * verify-titlemenu, because an animation that can hang the title screen is a
 * worse bug than one that ends early.
 */
export const UNUSED_SHATTER = Object.freeze({
  fragments: 31,
  delay: 20,
  speed: 4,
  gravity: 0.4,
  gravitySpread: 0.12,
  friction: 0,
  doom: 120,
  cull: 480,
});

/**
 * `merge_color(c_white, c_red, 0.6)` — the mod's final-hit shatter tint, and
 * the ramp's target. Computed through the repo's own `mergeColor`, never
 * typed: two typed constants are two things to keep in step, and this way
 * there is one.
 *
 * THE MOD'S SECOND BLEND, `merge_color(c_blue, c_red, 0.6)`, IS NOT HERE. It
 * is the BACK face of the same pieces — the mod flips them and swaps the blend
 * by the sign of `image_xscale` — and these fragments never flip, so nothing
 * on this screen would read it. A constant exported for a caller that does not
 * exist is this repo's signature defect wearing a `export` keyword; the
 * expression is written down in the block above instead, where the reader who
 * needs it will look.
 */
export const UNUSED_RED = mergeColor(WHITE, RED, 0.6);

/**
 * `scr_minishakeobj`'s TWO NUMBERS, and they are the whole object's behaviour.
 *
 * `shakeamt = 4`, `shakereduct = 1`, and obj_shakeobj's Step is
 *
 *     shakeamt -= shakereduct;  on *= -1;  target.x = nowx + (shakeamt * on);
 *     if (shakeamt <= 0) instance_destroy();
 *
 * so the offsets are exactly **-3, +2, -1, 0** and then it is gone: four
 * frames, alternating, decaying, ending where it started. The Create's
 * `shakeamt = 10 / shakereduct = 2` defaults and its `global.darkzone` light-
 * world softening never survive scr_minishakeobj, which overwrites both fields
 * before `event_user(0)` runs — kaizo/party/scenes.js documents the same thing
 * at the other call site.
 *
 * `shakespeed` and `timer` are carried by the GML object and read by NOTHING
 * in it (obj_shakeobj_ext and obj_shakeobj_susiezilla are the ones with a
 * timer). They are not carried here: a field with no reader is the defect this
 * repo keeps finding, and the other translation already records that they do
 * nothing so nobody has to re-read three files to find out.
 *
 * X ONLY. The original writes `target.x` and never `target.y` — `nowy` is
 * latched by Other_10 and then never used — so the row kicks sideways, which
 * is also the only axis a 40px menu pitch has room for.
 */
export const UNUSED_SHAKE = Object.freeze({ amt: 4, reduct: 1 });

/**
 * `scr_minishakeobj()` + its `event_user(0)`, for a screen with no entity list.
 *
 * There is no `spawn()` on the title — it is a menu, not a room — so the
 * shakeobj is a RECORD on the row rather than an instance, with the same three
 * fields the instance carries and the same Step below. kaizo/party/scenes.js's
 * `scrMinishakeobj` is the instance version and stays the reference; this is
 * the same four frames in the only shape this screen can hold. Two shapes, one
 * behaviour — asserted against that translation's own offsets in
 * verify-titlemenu, so the pair cannot drift.
 *
 * `nowx` is not stored: the row's home x is the renderer's (190), and what
 * this publishes is the OFFSET from it. `target.x = nowx + (shakeamt * on)` is
 * therefore `home + off`, which is the same arithmetic with the anchor left
 * where it already lives.
 *
 * A SECOND CALL WHILE ONE IS RUNNING re-arms this one. In the original it
 * spawns a second obj_shakeobj — there is no `instance_number` guard, which is
 * the thing obj_shake HAS and this object does not — and both write
 * `target.x` from the same `nowx`, so the newest amplitude is what the frame
 * ends on. Re-arming the single record IS that outcome, and mashing the row is
 * exactly the case that reaches it.
 */
function minishakeUnused(u) {
  u.shake = { shakeamt: UNUSED_SHAKE.amt, shakereduct: UNUSED_SHAKE.reduct, on: 1, off: 0 };
  return u.shake;
}

/**
 * One Step of obj_shakeobj, verbatim, returning the offset the row is drawn at.
 *
 * THE PRESS FRAME'S OFFSET IS ZERO, and that is the translation being right
 * rather than a frame lost. `event_user(0)` only latches (`active = 1; nowx =
 * target.x`); the first `target.x` write is in the shakeobj's own Step, and an
 * instance created during the step phase does not step until the next frame in
 * this engine (sim/entity.js freezes the list at the start of each phase —
 * CLAUDE.md's "a delayed tween lands one frame earlier than it looks" is the
 * same clock). So a press reads 0, then -3, +2, -1, 0.
 */
// RETURNS NOTHING, DELIBERATELY. The offset is published on the record as
// `sh.off` and read from there by unusedRowStyle, exactly as obj_shakeobj
// writes `off` on itself and the target's Draw reads it. An earlier version
// also returned the value and no caller ever used it — a second copy of the
// same number with nothing keeping the two honest, which is this repo's most
// common defect and not worth reintroducing for symmetry.
function stepUnusedShake(title) {
  const sh = title?.unused?.shake;
  if (!sh) return;
  sh.shakeamt -= sh.shakereduct;
  sh.on *= -1;
  sh.off = sh.shakeamt * sh.on;
  // `instance_destroy()` AFTER the write, which is the order the GML has: the
  // last frame is drawn at `nowx + 0`, so the row is put back exactly where it
  // stood and the kick leaves no residue.
  if (sh.shakeamt <= 0) title.unused.shake = null;
}

/**
 * Arm the row. The driver calls this with whatever it has persisted; the saved
 * shape is deliberately a number and a boolean so a JSON round trip through
 * localStorage is lossless.
 *
 * @param {*} title
 * @param {{presses?: number, taken?: boolean, sprite?: string,
 *          fragments?: number, seed?: number}} saved
 *   `sprite` NAMES THE SHATTER SHEET and is the driver's to supply: `sim/`
 *   must not know the name of a sprite only one build ships (the isolation
 *   contract — the vanilla asset pack has no shatter sheet at all). A null
 *   sprite still counts, still steps and still proceeds; the renderer simply
 *   has nothing to paint, which is the honest outcome for a missing asset
 *   rather than a throw at the end of twenty presses.
 */
export function armUnused(title, saved = {}) {
  const taken = !!saved.taken;
  const presses = Math.max(0, Math.min(UNUSED_PRESSES, saved.presses | 0));
  title.unused = {
    // A TAKEN ROUTE IS A FULL BAR. Deriving the count from `taken` rather than
    // trusting both means a hand-edited storage entry cannot show a row that is
    // half-red and already taken.
    presses: taken ? UNUSED_PRESSES : presses,
    taken,
    sprite: typeof saved.sprite === 'string' ? saved.sprite : null,
    fragments: saved.fragments > 0
      ? Math.min(256, saved.fragments | 0)
      : UNUSED_SHATTER.fragments,
    /**
     * The seed the fragment directions come off. Fixed by default, so the
     * break is the same break every time and a check can assert its numbers;
     * a driver may vary it.
     */
    seed: saved.seed === undefined ? 0x50524f43 : (saved.seed >>> 0),
    /** null until the last press; the live fragment field while it runs. */
    shatter: null,
    /**
     * null between kicks; the live obj_shakeobj record for the four frames
     * after a refused press. NOT persisted — `armUnused` never reads it back,
     * because a shake restored from storage would kick a row nobody pressed.
     */
    shake: null,
  };
  return title.unused;
}

/**
 * THE FRAGMENT FIELD, built at the last press. One entry per sub-image, in
 * sub-image order, each carrying the fragment index it wears.
 *
 * RNG: `random(360)` then `random(0.12)`, per fragment, in that order — the
 * GML's own two draws and their own sequence, on this module's own WELL512
 * stream (`gmlCreate`), which is seeded and therefore reproducible. It is a
 * STEP, not a Draw: CLAUDE.md's 30Hz-vs-monitor-Hz trap is about rolling dice
 * inside a Draw event, and nothing here does.
 */
function createUnusedShatter(u) {
  const rng = gmlCreate(u.seed >>> 0);
  const frags = [];
  for (let i = 0; i < u.fragments; i++) {
    const direction = gmlRandom(rng, 360);
    const gravity = UNUSED_SHATTER.gravity + gmlRandom(rng, UNUSED_SHATTER.gravitySpread);
    // dx/dy are offsets FROM THE SHATTERED THING'S OWN SPOT, in screen pixels
    // — the renderer adds the row's position, which is the one thing it knows
    // and this module does not. Zero at birth is the whole trick: every
    // fragment starts exactly where the intact row was.
    frags.push({ i, dx: 0, dy: 0, hsp: 0, vsp: 0, direction, gravity, alive: true });
  }
  return { t: 0, frags, live: frags.length };
}

/**
 * One frame of the fragment field. Returns TRUE on the frame it finishes,
 * which is the frame the route is taken.
 *
 * The motion is GameMaker's built-in: `speed`/`direction` is one vector,
 * `gravity` adds `lengthdir(gravity, gravity_direction)` to it each step
 * (`gravity_direction` is 270, straight down, and the ch4 code never touches
 * it), `friction` 0 takes nothing away, and the position moves by the result.
 * The three delayed vars all land on frame `delay` together — that is what
 * `scr_delay_var(..., _delay)` does — so `delay - 1` frames of the animation
 * are the picture sitting perfectly still.
 */
function stepUnusedShatter(title) {
  const u = title?.unused;
  const sh = u?.shatter;
  if (!sh) return false;
  sh.t += 1;
  let live = 0;
  for (const f of sh.frags) {
    if (!f.alive) continue;
    if (sh.t === UNUSED_SHATTER.delay) {
      // `speed = 4` on a direction it has carried since birth.
      f.hsp = lengthdirX(UNUSED_SHATTER.speed, f.direction);
      f.vsp = lengthdirY(UNUSED_SHATTER.speed, f.direction);
    }
    if (sh.t >= UNUSED_SHATTER.delay) {
      // GameMaker's order: friction off the speed MAGNITUDE, then the gravity
      // vector onto the components, then move. `friction` is 0 here — that is
      // the ch4 call's own third delayed var — so the branch is an identity,
      // and it is written out rather than assumed because a constant nothing
      // reads is a constant nobody notices is wrong.
      if (UNUSED_SHATTER.friction) {
        const spd = Math.hypot(f.hsp, f.vsp);
        const k = spd > 0 ? Math.max(0, spd - UNUSED_SHATTER.friction) / spd : 0;
        f.hsp *= k;
        f.vsp *= k;
      }
      f.vsp += f.gravity; // gravity_direction 270, untouched by the ch4 code
      f.dx += f.hsp;
      f.dy += f.vsp;
    }
    if (sh.t >= UNUSED_SHATTER.doom || f.dy > UNUSED_SHATTER.cull) f.alive = false;
    else live += 1;
  }
  if (live > 0) return false;
  // THE POINT OF NO RETURN, and it is here rather than at the press: the mod's
  // own screen offers PROCEED as the only answer and then does not let you
  // leave (DEVICE_FAILURE_Step_0:430-437), and this row is the same shape —
  // once the glass is down there is nothing left to un-press.
  u.taken = true;
  u.shatter = null;
  u.presses = UNUSED_PRESSES;
  // "…and then you go back to the TITLE SCREEN with everything changed." The
  // settings screen the row lived on goes with it.
  title.settings = null;
  title.dirty = true;
  return true;
}

/**
 * HOW THE ROW SHOULD READ AND BE DRAWN, in one place, so the stepper and the
 * renderer cannot drift. render/title.js calls exactly this.
 *
 * @returns {{name: string, sub: string|null, dim: boolean, heat: number,
 *            shake: number, red: number[], sprite: string|null,
 *            shattering: boolean, taken: boolean}}
 *   `heat` is 0..1 — how far along the ramp, and the only thing the renderer
 *   needs in order to mix its own colour toward `red`. It is monotone in the
 *   press count by construction (it is a division), which is the property the
 *   user asked for: more presses is always more red, never less.
 *   `shake` is obj_shakeobj's `shakeamt * on` — the HORIZONTAL OFFSET in
 *   pixels the row is drawn at this frame, 0 when nothing is shaking. The
 *   renderer adds it to the row's x and does no other arithmetic with it.
 *   `sub` is the parenthesised second line, which only the TAKEN row has.
 *   `sprite` is the driver's shatter sheet, passed straight through — the
 *   renderer looks it up, this module never does.
 *
 *   THE PRESS COUNT IS NOT HERE ANY MORE. It was published as `presses` /
 *   `total` for one reader, the `n / 20` the user has since removed, and it
 *   went out with it. `title.unused.presses` is still the state; `heat` is
 *   still everything about it the screen needs.
 */
export function unusedRowStyle(title) {
  const u = title?.unused;
  // NOT ARMED — the reserved, inert row, dimmed because grey is this menu's
  // convention for "this does nothing", which there it still does not.
  if (!u) {
    return {
      name: 'UNUSED', sub: null, dim: true, heat: 0, shake: 0,
      red: UNUSED_RED, sprite: null, shattering: false, taken: false,
    };
  }
  if (u.taken) {
    return {
      name: 'PROCEED', sub: '(PROCEED)', dim: false, heat: 1, shake: 0,
      red: UNUSED_RED, sprite: u.sprite, shattering: false, taken: true,
    };
  }
  return {
    name: 'UNUSED', sub: null, dim: u.presses === 0,
    heat: Math.min(1, u.presses / UNUSED_PRESSES),
    shake: u.shake ? u.shake.off : 0,
    red: UNUSED_RED,
    sprite: u.sprite, shattering: !!u.shatter, taken: false,
  };
}

/**
 * THE GEAR / ITEMS HUB — its own two-row menu off the title, in the settings
 * hub's exact shape. WEAPONS / ARMOR and ITEMS lived inside SETTINGS first,
 * and moving the loadout to the title made the settings copies stale
 * leftovers; settings is for how the game LOOKS AND SOUNDS, the hub is for
 * what the party CARRIES.
 */
export const GEAR_PAGES = [
  { id: 'equip', name: 'WEAPONS / ARMOR' },
  { id: 'items', name: 'ITEMS' },
];

/**
 * THE TWO ROWS UNDER THE MODES. Both are top-level: SETTINGS opens the hub
 * above, CREDITS opens its page directly.
 *
 * CREDITS was a settings page first and was moved out — settings is where you
 * go to CHANGE something, and the credits change nothing. Their index is
 * `MODES.length + n`, which is what `stepTitle` branches on.
 */
export const TITLE_EXTRAS = [
  { id: 'gear', name: 'GEAR / ITEMS' },
  { id: 'settings', name: 'SETTINGS' },
  { id: 'credits', name: 'CREDITS' },
];

/**
 * THE CREDITS. `link` holds the DISPLAY string — no scheme — because the page
 * prints it under the name and a `https://` prefix on screen is noise.
 * `creditLink` turns it into the href.
 */
export const CREDITS = [
  { role: 'Developer', who: 'Radi0', link: 'radi0.dev' },
  { role: 'Bug fixing and Playtesting', who: 'WandeR', link: 'wander22lstr.carrd.co' },
  { role: 'SUPPORT', who: '', link: 'ko-fi.com/shadowcrystaldev' },
];

/**
 * The href for a row, or null. Kept apart from the DISPLAY string above so the
 * page can show a readable `ko-fi.com/shadowcrystaldev` while the driver opens
 * the real URL — and so `sim/` never holds a value only a browser can use.
 *
 * NO TRAILING SLASH. It used to append one, which is harmless on a bare host
 * but wrong the moment a link has a PATH: the Ko-fi page is
 * `ko-fi.com/shadowcrystaldev`, and `.../shadowcrystaldev/` is a different URL
 * that only works because Ko-fi happens to redirect it. The href should be
 * the address, not an address plus a character.
 */
export const creditLink = (row) => (row.link ? `https://${row.link}` : null);

/**
 * The pick list for a slot: id 0 (the empty slot), then every piece in the
 * chapter's table with BlackShard (weapon 26, the Knight's own drop) left out.
 *
 * NOTHING IS HIDDEN FOR BEING WORN. This used to drop every id anyone in the
 * party had on, on the claim that the game "cannot express two characters
 * wearing the same piece". It can, and does: `global.armor` is a 48-slot bag
 * of plain ids — scr_armorget appends with only a `noroom` check and no
 * duplicate test, the shops buy through a bare scr_armorget (obj_shop1 /
 * obj_shop_music Draw), and obj_darkcontroller's equip swap (Step_0, the
 * `newequip = global.armor[coord]` … `global.armor[coord] = oldequip` pair)
 * hands the old piece back to storage — so a second LodeStone is a second
 * entry and a second wearer. The sim has no storage model at all, which
 * makes its bag "unlimited copies of everything", and the filter turned that
 * into "one copy of everything": LodeStone could be worn once across the
 * party (1 of the 6 a player asked for landed, measured by driving this
 * menu headlessly), and the ShadowMantle — on Kris in DEFAULT_GEAR — was
 * listed for NOBODY, Kris included, so the piece the fight balances around
 * read as removed. It also broke the cursor start at the slot confirm
 * below: the worn piece was never in the list, so `indexOf` was always -1
 * and every slot opened on "(Nothing)".
 *
 * The tidiness the filter bought ("taking out already equipped items") is
 * kept by the renderer instead: `wornBy` tells it who has a piece on and it
 * draws their initials beside the name, so a second copy reads as a choice
 * rather than clutter. `gear` stays a parameter for the call sites; the list
 * no longer depends on it, and the stepper and renderer cannot drift apart
 * because there is nothing left to drift.
 */
export function pocketOf(kind, gear = null) { // gear: kept for the callers, unused
  const table = kind === 'weapon' ? WEAPONS : ARMOR;
  const ids = Object.keys(table).map(Number).filter((id) => id !== 26 || kind !== 'weapon');
  return [0, ...ids];
}

/**
 * Who has a piece on: the party slots (0 Kris, 1 Susie, 2 Ralsei) wearing
 * `id` anywhere in `kind`. The pocket renderer's wearer tag; the same walk
 * scr_armorcheck_equipped_party does when the game asks whether anyone in
 * the party wears something, which is why it COUNTS wearers rather than
 * finding one.
 */
export function wornBy(kind, id, gear) {
  if (!gear || id === 0) return [];
  return gear.flatMap((g, i) => (
    (kind === 'weapon' ? g.weapon === id : (g.armor ?? []).includes(id)) ? [i] : []
  ));
}

/**
 * THE EQUIP PAGE'S ROSTER — one tab per character the page offers, in the
 * order `title.gear` is indexed.
 *
 * WHY THIS IS NOT JUST `PARTY`. The page walked `% 3` and read `PARTY[c]`
 * everywhere, which hardcodes three characters AND hardcodes which char
 * flag each tab means: `canEquip(kind, id, slot)` tests
 * `WEAPONS[id].allowed.includes(slot)` and `allowed` is indexed by the
 * game's own `char1..4` flags. Those two indexings agree only for the
 * vanilla trio. A roster of two, or a roster containing anybody who is not
 * Kris/Susie/Ralsei, needs them separated — hence `char`, the char1..4 flag
 * index (0 Kris, 1 Susie, 2 Ralsei, 3 Noelle), carried per tab.
 *
 * `title.party` null is the vanilla three and the DEFAULT: every existing
 * caller gets exactly what it had. A driver supplies its own array of
 * `{ name, char, base, head? }` to change the roster; `base` is the stat
 * block `statsOf` previews against and `head` names the portrait sprite
 * (render/title.js falls back to the vanilla heads by `char`).
 */
export const DEFAULT_PARTY_TABS = PARTY.map((p, i) => ({ name: p.name, char: i, base: p }));

export function partyTabs(title) {
  const tabs = title?.party;
  return Array.isArray(tabs) && tabs.length ? tabs : DEFAULT_PARTY_TABS;
}

export function createTitle() {
  return {
    /** null while the menu is up; the chosen mode id once it is not. */
    mode: null,
    index: 0,
    /** Which attack, for SINGLE. An index into the attack roster. */
    attackIndex: 0,
    /** True once the mode is picked and SINGLE needs its second choice. */
    pickingAttack: false,
    /** True while SINGLE's third choice is up — an index into the picked
     *  attack's `difficulties`, SHOWN 1-based (the raw values are 0/3/4
     *  shaped and mean nothing to a player). */
    pickingDifficulty: false,
    difficultyIndex: 0,
    difficultyCount: 1,
    siner: 0,
    held: {},
    /** null, or the open settings state. */
    settings: null,
    /** The loadout the next fight is built with (persisted by the driver). */
    gear: DEFAULT_GEAR.map((g) => ({ weapon: g.weapon, armor: [...g.armor] })),
    /**
     * The twelve item slots the next fight is built with. Same lifecycle as
     * `gear`: the page edits it, `dirty` tells the driver to persist, and the
     * run reads it once at start.
     */
    bag: [...DEFAULT_BAG],
    /**
     * Master volumes 0..100 (persisted by the driver).
     *
     * FIFTY, not a hundred — a player request, and the right default for what
     * this is. The fight opens on a roar and stays loud; a practice tool that
     * blasts on the first frame is one you turn down before you play it, and
     * a first impression at half volume is easier to correct upward than a
     * startle is to undo. Anyone who has already moved the sliders keeps
     * their setting: the driver's saved entry is applied over this.
     */
    volumes: { music: 50, sfx: 50 },
    /**
     * `global.flag[12]`, DELTARUNE's own screen-shake switch, kept in the
     * player's polarity: true here = the shake happens = flag 12 is 0.
     *
     * obj_shake moves the CAMERA, and both of its writes are wrapped in
     * `if (global.flag[12] == 0)` — so with the flag set the object still
     * runs and still destroys itself on schedule, it simply never touches the
     * view. That is the game's answer to "the whole screen shakes and I don't
     * want it to", and it is the only one: nothing in the fight shakes the
     * Knight alone, and the ending explicitly zeroes his own `shakex`.
     */
    shake: true,
    /**
     * HOW THE 640x480 FRAME MEETS THE WINDOW.
     *
     * 'fit'   fill it — the frame is scaled to whatever is there, letterboxed
     *         on the short axis. This is the default and what the game looks
     *         like fullscreen.
     * 'pixel' scale by a WHOLE number of device pixels instead, which leaves
     *         black around the edges when the window is not a clean multiple
     *         of 640x480.
     *
     * The difference is real and unavoidable, not a preference between two
     * equal things: `image-rendering: pixelated` at a fractional factor gives
     * some source columns n device pixels and their neighbours n+1, so a
     * one-pixel font stem is fat on one letter and thin on the next. 'pixel'
     * is the only setting that cannot do that; 'fit' is the only one that
     * fills the screen. Both are offered because both are right sometimes.
     */
    scaling: 'fit',
    /**
     * TOUCH BUTTONS — swap the on-screen Z and X. No GML counterpart: the
     * game has no touch UI, this is the overlay's own layout. False is as
     * shipped (Z above-right, X below-left); true mirrors them. It is a
     * POSITION swap — a CSS class the driver toggles on #touch — never a
     * remap: the labels travel with the buttons, so the letter on a button
     * is always what it does. Persisted with shake and scaling, and like
     * them kept OUT of the share token: it is how a person holds a phone,
     * not a setup.
     */
    swapZX: false,
    /**
     * THE UNUSED ROW'S STATE, or null for "not armed" — which is the default
     * and is what every vanilla build stays on. See `armUnused` above; a
     * driver that never calls it gets the reserved, inert row unchanged.
     */
    unused: null,
    /**
     * THE EQUIP PAGE'S ROSTER, or null for the vanilla three (`partyTabs`).
     * A plain data field on purpose: a driver with a different party hands
     * one over without `sim/` learning anything about that driver.
     */
    party: null,
    /** Set when gear/volumes change; the driver persists and clears it. */
    dirty: false,
  };
}

function openSettings(title) {
  title.settings = {
    page: null, // null = the hub
    cursor: 0,
    shared: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

/**
 * CREDITS, opened from the title rather than through the hub. `root` is what
 * X means on the page: without it, cancelling would drop the player into the
 * settings hub they never asked for.
 */
/**
 * GEAR, opened from the title directly. The equip page always existed inside
 * SETTINGS, and a playtester assumed the loadout was fixed because Bad Time
 * Simulator's settings never held one — "I kind of assumed you couldn't
 * tweak your armor". A thing the fight balances around should not be a page
 * players have to suspect exists. `root` gives X the same leave-to-title
 * meaning as the credits page.
 */
function openGear(title) {
  title.settings = {
    page: 'gearhub',
    root: true,
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

function openCredits(title) {
  title.settings = {
    page: 'credits',
    root: true,
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

/**
 * One frame of the settings pages. Same edge-detected input as the title.
 * Returns { moved, selected, error } for the driver's sounds.
 */
function stepSettings(title, pressed) {
  const s = title.settings;
  const out = { moved: false, selected: false, error: false };

  // ---- the hub ----
  // ONE WAY OUT OF A PAGE, wherever it was entered from: back to the gear
  // hub when that is where the player came from, off the whole overlay when
  // the page IS the root (credits, the hub itself), and to the settings hub
  // otherwise. Five call sites had five copies of a two-way version of this,
  // and the gear hub would have made every one of them three-way.
  const leavePage = () => {
    if (s.back) { s.page = s.back; s.back = null; }
    else if (s.root) title.settings = null;
    else s.page = null;
  };

  if (s.page === null) {
    // The "copied" confirmation is on a clock rather than latched, so it
    // cannot get stuck on after the player walks away from the row.
    if (s.shared > 0) s.shared -= 1;
    if (pressed('up')) { s.cursor = (s.cursor + SETTINGS_PAGES.length - 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('cancel')) { title.settings = null; out.moved = true; return out; }
    if (pressed('confirm')) {
      const page = SETTINGS_PAGES[s.cursor].id;
      // ---- UNUSED: reserved and inert, unless a driver armed it ------------
      //
      // NOT ARMED is the whole vanilla behaviour and the whole vanilla line:
      // one error sound, no page, nothing else returned.
      //
      // ARMED, the row REDDENS (see the block above SETTINGS_PAGES for what is
      // taken and what is this project's). Every press short of the last still
      // SOUNDS like the refusal it used to be — `out.error` stays true — because
      // the row is still refusing; what changes is that it is visibly hotter
      // each time it does. The mod's own menus do exactly this much: the party
      // picker's `obj_choicer_neo` beeps `snd_error` at a blank entry and
      // re-offers it (ledger G-9), so a refusal that leaves the cursor where it
      // is, is the interaction this row copies rather than one invented for it.
      //
      // `out.press` carries the new count for a driver that wants to persist it
      // (it should) or to pitch the sound by it; a page may ignore it and lose
      // nothing.
      if (page === 'unused') {
        const u = title.unused;
        if (!u) { out.error = true; return out; }        // reserved, inert
        // ALREADY GOING, OR ALREADY GONE. The shatter swallows input in
        // stepTitle so this is unreachable while it runs, and once `taken` is
        // set the row is a label rather than a button — the mod's B-Side game
        // over is the same shape, both answers PROCEED and neither leaves
        // (DEVICE_FAILURE_Step_0:384-385, :430-437).
        if (u.shatter || u.taken) { out.error = true; return out; }
        u.presses += 1;
        out.press = u.presses;
        // The ramp must survive a reload, or the player re-presses it twenty
        // times every visit and it reads as decoration rather than progress.
        title.dirty = true;
        if (u.presses >= UNUSED_PRESSES) {
          u.presses = UNUSED_PRESSES;
          // THE LAST PRESS IS THE ONE THE ROW ACCEPTS, so it gets the confirm
          // sound rather than the refusal — it is the only press that does.
          u.shatter = createUnusedShatter(u);
          // AND IT DOES NOT KICK. The row is glass from this frame on and
          // `drawUnusedRow` returns before drawing it, so a live shake would
          // be an offset nothing reads — the defect this file keeps catching.
          // A kick still running from the press before is dropped for the same
          // reason: mashing can land press 20 inside press 19's four frames.
          u.shake = null;
          out.shatter = true;
          out.selected = true;
          return out;
        }
        // EVERY REFUSED PRESS KICKS. `scr_minishakeobj` — the same four frames
        // the mod spends on a party member who has just been hit, which is the
        // nearest thing it has to "this press did something and you still
        // cannot have it". The user asked for the row to shake while being
        // pressed, so the kick is per press rather than a hum that rises with
        // the heat: a press is the event, and this is what an event looks like.
        minishakeUnused(u);
        out.error = true;
        return out;
      }
      // SHARE copies rather than opens. The driver builds the URL and talks to
      // the clipboard — `sim/` has neither, and a headless verifier must be
      // able to run this path without either.
      if (page === 'share') {
        out.share = true;
        out.selected = true;
        // NINETY frames — three seconds. Long enough to read and to be sure
        // the press registered; a shorter flash reads as nothing happening,
        // which on a button whose whole output is invisible (a clipboard) is
        // the difference between working and appearing broken.
        s.shared = 90;
        return out;
      }
      s.page = page;
      s.back = null;
      s.cursor = 0;
      s.equip = { stage: 'char', char: 0, row: 0, pocket: 0 };
      out.selected = true;
    }
    return out;
  }

  if (s.page === 'gearhub') {
    if (pressed('up')) { s.cursor = (s.cursor + GEAR_PAGES.length - 1) % GEAR_PAGES.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % GEAR_PAGES.length; out.moved = true; }
    // The hub is the root: X leaves to the title.
    if (pressed('cancel')) { title.settings = null; out.moved = true; return out; }
    if (pressed('confirm')) {
      s.page = GEAR_PAGES[s.cursor].id;
      // Pages entered from here come BACK here — the same page reached
      // through settings used to return to the settings hub, and the exit
      // has to remember which door the player used.
      s.back = 'gearhub';
      s.equip = { stage: 'char', char: 0, row: 0, pocket: 0 };
      s.items = { stage: 'slots', slot: 0, pick: 0 };
      out.selected = true;
    }
    return out;
  }

  // ---- items: TWELVE SLOTS, and any item can go in any of them --------------
  //
  // Navigation is `obj_battlecontroller`'s own, from the battle item menu:
  // a single 0..11 cursor from which page, row and column are derived, UP AND
  // DOWN STEP BY TWO because the list is two columns wide, and LEFT AND RIGHT
  // DO THE SAME THING — with two columns a toggle is its own inverse. Copying
  // that here means the page a player learns in the fight is the page they
  // get in the menu.
  //
  // What is NOT copied is the battle menu's refusal to move onto an empty
  // slot: here every slot is a target, because filling the empty ones is the
  // entire point of the page.
  if (s.page === 'items') {
    const it = s.items;
    if (it.stage === 'slots') {
      if (pressed('up') && it.slot >= 2) { it.slot -= 2; out.moved = true; }
      if (pressed('down') && it.slot <= INVENTORY_SIZE - 3) { it.slot += 2; out.moved = true; }
      // The column toggle, both keys, exactly as the battle menu has it.
      if (pressed('left') || pressed('right')) {
        it.slot += it.slot % 2 === 0 ? 1 : -1;
        out.moved = true;
      }
      if (pressed('cancel')) { leavePage(); out.moved = true; }
      if (pressed('confirm')) {
        it.stage = 'pick';
        // Open the picker ON the slot's current contents, so a nudge is one
        // keypress rather than a walk from the top of a 32-item list.
        it.pick = Math.max(0, ITEM_PICKER.indexOf(title.bag[it.slot] ?? 0));
        out.selected = true;
      }
      return out;
    }
    // the picker
    if (pressed('up')) {
      it.pick = (it.pick + ITEM_PICKER.length - 1) % ITEM_PICKER.length;
      out.moved = true;
    }
    if (pressed('down')) {
      it.pick = (it.pick + 1) % ITEM_PICKER.length;
      out.moved = true;
    }
    if (pressed('cancel')) { it.stage = 'slots'; out.moved = true; }
    if (pressed('confirm')) {
      title.bag[it.slot] = ITEM_PICKER[it.pick];
      title.dirty = true;
      it.stage = 'slots';
      out.selected = true;
    }
    return out;
  }

  // ---- credits: a cursor over three rows, one of which now goes somewhere ---
  //
  // Confirm on a row WITH a link returns it as `out.link` and the driver opens
  // it — `sim/` has no DOM and must not grow one for this. Confirm on a row
  // without is a NO-OP rather than an error sound: nothing is broken, there is
  // just nothing there.
  if (s.page === 'credits') {
    if (pressed('confirm')) {
      const href = creditLink(CREDITS[s.cursor]);
      if (href) { out.link = href; out.selected = true; }
      return out;
    }
    if (pressed('up')) { s.cursor = (s.cursor + CREDITS.length - 1) % CREDITS.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % CREDITS.length; out.moved = true; }
    // X goes back to wherever the page was opened FROM — the title now, not
    // the hub, which no longer lists it.
    if (pressed('cancel')) {
      leavePage();
      out.moved = true;
    }
    return out;
  }

  // ---- graphics: three toggles ----
  if (s.page === 'graphics') {
    // Three rows since TOUCH BUTTONS joined SCREEN SIZE and SCREEN SHAKE, so
    // the old `1 - cursor` flip became a wrap. Each key is polled ONCE —
    // `pressed()` latches, so `up || down` would leave a same-frame down
    // unrecorded (the trap verify-titlemenu's header describes).
    const ROWS = 3;
    if (pressed('up')) { s.cursor = (s.cursor + ROWS - 1) % ROWS; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % ROWS; out.moved = true; }
    const flipL = pressed('left');
    const flipR = pressed('right');
    const flipC = pressed('confirm');
    if (flipL || flipR || flipC) {
      if (s.cursor === 0) title.scaling = title.scaling === 'fit' ? 'pixel' : 'fit';
      else if (s.cursor === 1) title.shake = !title.shake;
      else title.swapZX = !title.swapZX;
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('cancel')) { leavePage(); out.moved = true; }
    return out;
  }

  // ---- audio: two sliders, left/right in steps of 5 ----
  if (s.page === 'audio') {
    if (pressed('up') || pressed('down')) { s.cursor = 1 - s.cursor; out.moved = true; }
    const key = s.cursor === 0 ? 'music' : 'sfx';
    if (pressed('left')) {
      title.volumes[key] = Math.max(0, title.volumes[key] - 5);
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('right')) {
      title.volumes[key] = Math.min(100, title.volumes[key] + 5);
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('cancel')) { leavePage(); out.moved = true; }
    return out;
  }

  // ---- equip ----
  const eq = s.equip;
  // THE ROSTER, not the literal three. `partyTabs` is `PARTY` unless a driver
  // supplied its own — and `tab.char` is the char1..4 flag index, which is
  // what `canEquip` and the refusal tables are keyed by. `% tabs.length` makes
  // the left/right wrap the roster's size instead of a hardcoded 3; a stale
  // cursor from a longer roster is clamped rather than left dangling.
  const tabs = partyTabs(title);
  if (eq.char >= tabs.length) eq.char = 0;
  const charFlag = tabs[eq.char].char;
  if (eq.stage === 'char') {
    if (pressed('left')) { eq.char = (eq.char + tabs.length - 1) % tabs.length; out.moved = true; }
    if (pressed('right')) { eq.char = (eq.char + 1) % tabs.length; out.moved = true; }
    // `root`: the page was opened straight from the title (the GEAR row), so
    // X leaves to the title rather than dropping into a settings hub the
    // player never visited — the same rule the credits page carries.
    if (pressed('cancel')) {
      leavePage();
      out.moved = true;
    }
    if (pressed('confirm')) { eq.stage = 'slot'; eq.row = 0; out.selected = true; }
    return out;
  }
  if (eq.stage === 'slot') {
    if (pressed('up')) { eq.row = (eq.row + 2) % 3; out.moved = true; }
    if (pressed('down')) { eq.row = (eq.row + 1) % 3; out.moved = true; }
    if (pressed('cancel')) { eq.stage = 'char'; out.moved = true; }
    if (pressed('confirm')) {
      eq.stage = 'pocket';
      // Start the pocket cursor on the currently-equipped piece.
      const kind = eq.row === 0 ? 'weapon' : 'armor';
      const cur = eq.row === 0 ? title.gear[eq.char].weapon : title.gear[eq.char].armor[eq.row - 1] ?? 0;
      const pocket = pocketOf(kind, title.gear);
      eq.pocket = Math.max(0, pocket.indexOf(cur));
      out.selected = true;
    }
    return out;
  }
  // pocket
  const kind = eq.row === 0 ? 'weapon' : 'armor';
  const pocket = pocketOf(kind, title.gear);
  if (pressed('up')) { eq.pocket = (eq.pocket + pocket.length - 1) % pocket.length; out.moved = true; }
  if (pressed('down')) { eq.pocket = (eq.pocket + 1) % pocket.length; out.moved = true; }
  // Moving the cursor replaces the comment in the game (scr_itemcomment runs
  // per selection); here the next attempt sets a fresh one, so just clear.
  if (out.moved) eq.comment = null;
  if (pressed('cancel')) { eq.stage = 'slot'; eq.comment = null; out.moved = true; }
  if (pressed('confirm')) {
    const id = pocket[eq.pocket];
    // THE CHARACTER COMMENTS ON EVERY ATTEMPT. The dark menu's confirm is
    //
    //     if (canequip == 1) { snd_play(snd_equip); ...swap... }
    //     else               { snd_play(snd_cantselect); }
    //     scr_itemcomment(..., wmsg);          // BOTH paths
    //
    // so the remark is not a refusal message — it shows whether the equip
    // landed or not, and refusal only changes the SOUND. The Mane Ax is why
    // this exists: it is unequippable BY DESIGN (weaponchar all 0 in
    // scr_weaponinfo) and Susie's line for it is "I'm too GOOD for that." —
    // the sim refused silently, and a player read that as the menu being
    // broken. Reported from play, twice removed: the refusal was right, the
    // silence was the bug.
    //
    // Speaker keys are the game's: 2 Susie, 3 Ralsei. Kris has no line —
    // scr_weaponinfo defines no wmessage1 because Kris never speaks.
    {
      // Keyed by the CHAR FLAG (1 Kris, 2 Susie, 3 Ralsei, 4 Noelle), not by
      // the tab position — a two-person roster puts a different character in
      // tab 1, and the line has to follow the character.
      const table = kind === 'weapon' ? WEAPON_REFUSALS : ARMOR_REFUSALS;
      const line = id !== 0 ? table[id]?.[String(charFlag + 1)] : null;
      eq.comment = line && line.trim() ? line : null;
    }
    if (id !== 0 && !canEquip(kind, id, charFlag)) { out.error = true; return out; }
    if (eq.row === 0) title.gear[eq.char].weapon = id;
    else {
      const armor = title.gear[eq.char].armor;
      while (armor.length < 2) armor.push(0);
      armor[eq.row - 1] = id;
    }
    title.dirty = true;
    eq.stage = 'slot';
    out.selected = true;
  }
  return out;
}

/**
 * The stat line the equip page previews — base plus slots, like battleat.
 * `char` is the TAB index; the stat block comes from the roster so a driver's
 * own party previews against its own numbers (Noelle's 120/5/13/1, not
 * Susie's).
 */
export function previewStats(title, char) {
  const tabs = partyTabs(title);
  return statsOf((tabs[char] ?? tabs[0]).base, title.gear[char]);
}

/**
 * One frame of the title screen. Returns true on the frame a mode is chosen.
 *
 * Edge-detected like the battle menu — the same `pressed()` shape, because a
 * held key walking the cursor down a four-item list is unusable.
 *
 * `attacks` is the SINGLE roster (the array itself; a bare count is accepted
 * for old callers, which then never see the difficulty stage).
 */
export function stepTitle(title, input, attacks) {
  const attackCount = Array.isArray(attacks) ? attacks.length : attacks;
  title.siner += 1;
  // obj_shakeobj's Step, once a frame, BEFORE anything can press the row —
  // so the kick a press arms is stepped for the first time on the frame after
  // it, which is the order the original has (see `stepUnusedShake`). It runs
  // above the shatter's own early return as well: a kick that outlived its row
  // must still decay to nothing rather than be frozen at -3 forever.
  stepUnusedShake(title);
  const pressed = (k) => {
    const down = !!input?.[k];
    const was = !!title.held[k];
    title.held[k] = down;
    return down && !was;
  };

  // ---- THE SHATTER OWNS THE WHOLE SCREEN WHILE IT RUNS ---------------------
  //
  // It is not a page and not a menu: for the ~90 frames between the twentieth
  // press and the last fragment leaving the screen, nothing else on the title
  // reads input. Every key is still LATCHED (the loop below calls `pressed` on
  // each one) so a key held down through the animation is not delivered as a
  // fresh press the frame it ends — the same trap `disableslow` solves in
  // obj_heart's Create, and the reason web/main.js latches across the title ->
  // fight transition.
  //
  // `proceed` goes out on the ONE frame it finishes, which is the frame
  // `stepUnusedShatter` closes the settings screen. Before this block existed
  // there was nowhere for a per-frame animation to live on the title screen at
  // all, so it is deliberately the first thing in the function.
  if (title.unused?.shatter) {
    for (const k of ['up', 'down', 'left', 'right', 'confirm', 'cancel']) pressed(k);
    const done = stepUnusedShatter(title);
    // `shatter` STAYS FALSE HERE. It is the cue for the moment the glass is
    // MADE — one frame, the twentieth press — and the driver plays a sound on
    // it. Reported again on every frame of the fall it would play that sound
    // seventy-odd times; the status "is it still going" has no reader, and a
    // field with no reader is this repo's signature defect. `unusedRowStyle`
    // carries `shattering` for anyone who wants the status.
    return {
      moved: false, chosen: false, selected: false, error: false,
      link: null, share: false, proceed: done, press: 0, shatter: false,
    };
  }

  // The settings pages own the input while open.
  if (title.settings) {
    const r = stepSettings(title, pressed);
    // THE WHITELIST THAT COST A DEBUG CYCLE THE LAST TIME A NEW INTENT WAS
    // ADDED. This rebuilds the settings result field by field, so an intent
    // set correctly inside `stepSettings` is DROPPED here unless it is named
    // — the row reports `selected`, the driver sees nothing to act on, and
    // the button looks dead while every test of `stepSettings` itself passes.
    // `press` and `shatter` are named for that reason, and verify-titlemenu
    // asserts them through `stepTitle`, never through `stepSettings` directly.
    // (`proceed` is named too, even though the shatter block above is the only
    // thing that can raise it today: a whitelist that carries a field only
    // while one particular producer happens to exist is the same trap one
    // level down.)
    return {
      moved: r.moved, chosen: false, selected: r.selected, error: r.error,
      link: r.link ?? null, share: r.share ?? false,
      proceed: r.proceed ?? false, press: r.press ?? 0,
      shatter: r.shatter ?? false,
    };
  }

  // The cursor walks the modes plus the TITLE_EXTRAS rows below them.
  const list = title.pickingDifficulty
    ? title.difficultyCount
    : title.pickingAttack ? attackCount : MODES.length + TITLE_EXTRAS.length;
  const cur = title.pickingDifficulty
    ? 'difficultyIndex'
    : title.pickingAttack ? 'attackIndex' : 'index';
  let moved = false;

  if (pressed('up')) {
    title[cur] = (title[cur] + list - 1) % list;
    moved = true;
  }
  if (pressed('down')) {
    title[cur] = (title[cur] + 1) % list;
    moved = true;
  }

  // ONE CALL, THEN BRANCH — `pressed()` LATCHES.
  //
  // It records the key as held on the way out, so calling it twice in a frame
  // makes the second call return false no matter what the player did. Written
  // as two guarded tests:
  //
  //     if (pressed('cancel') && title.pickingDifficulty) { ... }
  //     if (pressed('cancel') && title.pickingAttack)     { ... }
  //
  // the first one evaluates `pressed` FIRST, latches, and then fails its own
  // `&&` whenever the difficulty stage is not the one showing — and the second
  // test can never see the press. So X backed out of the difficulty list
  // (where the first test matches) and did nothing at all in the attack list.
  // Reported as issue #6: "X does not bring you back to the main menu from
  // single attack", and it works in settings because that path calls
  // `pressed('cancel')` exactly once.
  const cancelled = pressed('cancel');
  if (cancelled && title.pickingDifficulty) {
    title.pickingDifficulty = false;
    return { moved: true, chosen: false };
  }
  if (cancelled && title.pickingAttack) {
    title.pickingAttack = false;
    return { moved: true, chosen: false };
  }

  if (pressed('confirm')) {
    if (!title.pickingAttack && title.index >= MODES.length) {
      const extra = TITLE_EXTRAS[title.index - MODES.length];
      if (extra.id === 'credits') openCredits(title);
      else if (extra.id === 'gear') openGear(title);
      else openSettings(title);
      return { moved: false, chosen: false, selected: true };
    }
    if (!title.pickingAttack && MODES[title.index].id === 'single') {
      // SINGLE needs a second choice, so it opens the roster rather than
      // starting. Everything else starts immediately.
      title.pickingAttack = true;
      return { moved: false, chosen: false, selected: true };
    }
    // The roster confirm: an attack with one difficulty starts; one with
    // several opens the third stage.
    if (title.pickingAttack && !title.pickingDifficulty && Array.isArray(attacks)) {
      const entry = attacks[title.attackIndex];
      const count = entry?.difficulties?.length ?? 1;
      if (count > 1) {
        title.pickingDifficulty = true;
        title.difficultyIndex = 0;
        title.difficultyCount = count;
        return { moved: false, chosen: false, selected: true };
      }
    }
    title.mode = MODES[title.index].id;
    return { moved: false, chosen: true, selected: true };
  }

  return { moved, chosen: false };
}
