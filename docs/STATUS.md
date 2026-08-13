# Status and next steps

Living document. Update when an attack lands or a claim changes.

## Health check

```bash
export PATH="$HOME/tools/node/bin:$PATH"
cd ~/knight-sim && npm run verify
```

Expected: **All 22 suites green.** If not, stop and fix before adding anything.

## Engine — done and verified

| capability | verified by |
|---|---|
| Fixed 30 Hz timestep, GM phase order (begin → alarm → step → motion → collision → end) | verify-t3/t4 |
| GameMaker's RNG: WELL512, exact draw counts per function | verify-rng, 131 logged outputs |
| Precise-mask collision with rotation and scale | verify-contact, 48 measured points |
| float32 built-in fields (structural, via `spawn()` accessors) | verify-f32, 15 fields |
| Built-in motion: speed/direction, friction, gravity | verify-fountain, verify-splitter |
| Component motion: direct hspeed/vspeed writes | verify-diagonal |
| Per-type Step ordering (`stepOrder`) | verify-vortex — measured, not assumed |
| `lengthdir_*` narrows BOTH operands to float32 | verify-tracking (5 candidate roundings fitted) |
| Bullet inheritance chain (`regularbullet` → `collidebullet`) | verify-fountain |
| Trace formatting matching `string_format(v,0,10)`, ties-to-even | all trace suites |

## The oracle is now universal — read this before writing a patch

There is **one** harness for every attack, at
`knight-research/tools/patches/universal/`. Choosing what to record is writing
a text file, not editing C# and rebuilding.

```bash
cd ~/knight-research
./tools/build-oracle.sh                       # only when the harness .gml changes
./tools/oracle-run.sh 1 3 flurry frames=600   # phase 1, turn 3
```

`<phase> <turn>` index CLAUDE.md's THE REAL FIGHT table. They go to
`obj_knight_enemy`'s own selector, which then picks myattackchoice, box
position, box scale, soul placement, turn length and controller type. Nothing
about an attack is configured by hand any more — that is what kept producing
wrong arenas.

Three properties worth keeping:

- **The GML lives in `.gml` files**, loaded by a thin driver. No C# verbatim
  strings, so the quote-doubling bug that silently reused stale builds five
  times cannot happen. Add a patched event by dropping in a file named after
  the code entry.
- **It records everything.** One row per instance per frame: all the motion
  and image built-ins, plus *every instance variable* packed into a trailing
  `k=v|k=v` field. Long format, so the schema never changes when an attack is
  added. The old per-attack recorders each picked a few columns up front, and
  every divergence then needed another 90-second run to log the field nobody
  had thought of.
- **`build-oracle.sh` refuses to lie.** It rebuilds from pristine, patches
  BOTH data files (the launcher and chapter 3 — forgetting the launcher boots
  to the menu), greps the log for errors, and requires the APPLIED marker.

Diagnosing a run that recorded nothing starts with the synthetic `__global`
row, which carries `mnfight`, `turntimer`, `invc`, and the preconditions for
the knight's Step to run at all (`susie`, `ralsei`, `bc`, `monster0`).

## Look and feel — Flurry as the proof of concept

The presentation layer was built out on Flurry specifically, to find out
whether a faithful recreation is reachable before committing the rest of the
roster to it. It is.

| piece | where | state |
|---|---|---|
| Sprite animation as sim state | `sim/index.js` `runAnimation` | engine advances `image_index` by `image_speed`, wrapping on frame count |
| Sprite pack | `tools/pack-sprites.mjs` + `knight-research/tools/patches/sprite_meta.csx` | **175 sprites / 664 frames**, with origins AND precise masks |
| The cut battle box | `render/splitbox.js` | the original's surface composite, reproduced with clipping |
| Cut telegraph | `render/canvas.js` `drawTelegraph` | the additive red bar, from the slash's own `timer`/`flip`/`angleoffset` |
| Slash debris | `sim/fx.js` + `splitslash.js` | 16 `obj_afterimage`, real friction, real RNG draws |
| Knight + party | `sim/actors.js` | visual only; cannot touch bullet state |
| Screen shake | `sim/fx.js` `addShake`/`stepShake` | magnitude in sim so replays are identical |
| Sound cues | `sim/audio.js` + `render/audio.js` | **cues fire; no samples yet — see below** |

**The renderer is now generic.** It draws any entity from `sprite_index` +
`image_index` at the manifest origin, sorted by `depth`. A new attack that sets
those fields — as the GML already does — arrives on screen with no per-attack
render code. That was the point of doing this on one attack first.

**Sound is plumbed but silent.** `sim/` records cues (name, pitch, gain, frame)
and never touches audio, so the headless verifier is unaffected;
`render/audio.js` plays whatever is in `assets/audio/`, which is **gitignored
and empty**. The samples this build cues live inside `audiogroup1.dat`, not
loose beside the data file, and `knight-research/tools/extract-audio.sh`
currently finds 0 of them — UndertaleModTool's `ExportAllSounds.csx` produced
no output folder under the CLI. **So there is no sound yet.** The timing is
exact and verifiable; only the samples are missing.

### The battle board is measured, not arranged

Recorded with the universal harness at phase 1 turn 3 (`traces/flurry2.csv`,
camera at (0,0) for the whole turn, so room coordinates are screen
coordinates). `sim/actors.js` holds these and nothing else:

| object | x | y | sprite | depth |
|---|---:|---:|---|---:|
| `obj_herokris` | 126 | 104 | `spr_krisb_idle` | 200 |
| `obj_herosusie` | 80 | 142 | `spr_susieb_idle` | 180 |
| `obj_heroralsei` | 58 | 190 | `spr_ralsei_idle` | 160 |
| `obj_knight_enemy` | 425 | bobbing | `spr_roaringknight_idle` | 88 |
| `obj_growtangle` | 320 | 170 | `spr_battlebg_0` | 5 |
| `obj_heart` | 310 | 160 | `spr_dodgeheart` | 1 |

The previous layout — a tidy column at x=100 — was invented, and two of the
three party sprites were the wrong asset (`spr_susieb_idle_serious`,
`spr_ralseib_idle`). The real arrangement is a diagonal.

**The knight's bob** is his Draw event exactly: `siner2++;
y = ystart + cos(siner2 / 8) * 8`, amplitude 8 about ystart 78.

**During Flurry the knight is not the knight.** The type-99 dispatch does
`with (creatorid) image_alpha = 0` and creates
`obj_roaringknight_boxsplitter_attack` at his position — from frame 13 the
manager IS the visible knight, wearing `spr_roaringknight_attack_ol`. Its slash
animation is its own Draw event:

```
if (animtimer < 4) animtimer++;
else if (image_index == 1 || image_index == 4) image_index++;
```

with each cut setting `image_index = (image_index >= 4) ? 1 : 4; animtimer = 0`
— so he alternates two two-frame poses, 4→5 and 1→2, holding each until the
next cut. Confirmed frame-for-frame against the recording.

**Sprites carry their own playback rate.** `image_speed = 1` does not mean one
frame per step: the party idles advance 0.2 per step. `sprite_meta.csx` now
extracts `GMS2PlaybackSpeed`/`GMS2PlaybackSpeedType`, the manifest carries it,
and `runAnimation` multiplies by it.

**Both telegraph layers are drawn.** The slash draws a long bar for itself
(`ease * 180`), and the manager draws a second, shorter one (`clamp01(timer/30)
* 90`) into a 142x142 surface centred on the box, textured with two
counter-scrolling copies of `spr_knight_bullet_flow`. The surface layer is the
one that reads as "the cut lands HERE"; only drawing the long bar gets the
geometry right and the character wrong.

**Known approximations, none of them physics:**

- The `update_box` shimmer on a WHOLE box (a `choose(-2,-1,1,2)` nudge plus a
  grey seam) is not reproduced. The split itself is.
- The split box's 1px shake and the flame-edge frame counter use RENDER-LOCAL
  counters. The original draws them from the shared RNG stream, but `sim/` has
  to stay deterministic for the verifier and the renderer may not write to sim
  state.
- The party idles loop but do not react — no hurt, defend or victory poses.
  The knight's poses during Flurry ARE modelled; other attacks are not.
- `spr_roaringknight_attack_ol` is the outline layer. The original composites
  the knight from more than one sprite; only this one is drawn.
- The manager's `scr_afterimage` trail (one every 4 frames, drifting away from
  the box) is not drawn.
- `bm_add` is approximated by canvas `lighter`.

## THE FIGHT IS SEVEN ATTACKS, AND WHAT IS LEFT IS DIFFICULTY VARIANTS

Corrected against the wiki's observed turn-by-turn sequence, then confirmed in
the selector. Phase 1's block defines branches for `phaseturn` 6-9, but its
`phaseturn == 5` branch does `phase = 2; phaseturn = 0` — so **turns 6-9 of
phase 1 can never run**. Counting branches gives nine attacks; reading the
control flow gives five. The fight is 5 turns x 3 phases, then phase 3 loops,
then phase 4.

**Now known unreachable, in addition to the six previously listed:**
`ac 12` diagonal bullets, `ac 16`, `ac 17`, `ac 7` combinationattack — and
therefore `obj_knight_swordfall` and `obj_knight_tunnel_slasher_2_revised`,
whose only origin was combination's `next_up` chain.

So the roster is **seven attacks**, and six of them are already translated at
difficulty 0. What remains is mostly the DIFFICULTY VARIANTS each phase uses:

| ac | attack | difficulties the fight uses | verified |
|---:|---|---|---|
| 1 | Stars | 0, 1, 2 | cone + star lifecycle at 0; burst + starchild homing at 2 |
| 11/14 | Tracking Swords | 0 | **0 — done** |
| 2 | Box Splitter | 0, 1, 3 | **0, 1, 3 — done** |
| 13 | Sword Tunnel | 0, 3, 4 | **corridor at 0, 3, 4 — done** |
| 5 | Rotating Slash | 0, 1, 2 | **0, 1, 2 — done** |
| 15 | Sword Vortex | 0 (variant pinned to 3) | **done** |
| 9 | Roaring | — | **DONE** — lifecycle, pull, rings, shake, corral and the roar; exact to f678. Only the cosmetic Draw and the finale tail remain |

**First variant landed: Rotating Slash 1 and 2** (`verify-rotating-difficulty`,
2,130 exact comparisons each, five cut cycles each). Both difficulty branches
were already translated from the GML and had simply never been exercised —
they turned out correct, and their cut counts match the observed fight:

```
difficulty 0   slash_number 1, array [1,2,2,3,3,4]  ->  1-2-2-3-3-4
difficulty 1   slash_number 3, array [2,3,4,4,4,4]  ->  3-3-4-4-4-4
difficulty 2   slash_number 3, array [3,4,4,4,4,4]  ->  3-4-4-4-4-4
```

`slash_array[0]` is NEVER READ — `slash_counter` is incremented before the
lookup, so the opening count comes from `slash_number` and the array supplies
the five after it. Sabotaging that element does not fail the suite, which is
the evidence for the claim rather than a hole in it; sabotaging a live element
(difficulty 1's second cut) fails at frame 71, and sabotaging `slash_offset`
fails at frame 13.

Still open on this attack: difficulty 2's SPIRAL FINISHER (the `aim_type 2`
branch — `slash_number` drops to 1 from `slash_counter` 6 onward). The window
stops before it.

**Second variant landed: Box Splitter 1 and 3** (`verify-splitter-difficulty`,
2,226 exact comparisons each, eight cuts each). Again already translated and
never exercised, and again correct. What the difficulty changes:

```
0   spawn_speed 50; `vertical = force_oneside` — the SAME axis all turn
1   spawn_speed 46 decaying to 40 by 3; `vertical` is the live draw, so the
    cleave axis switches per cut. Also rolls force_swap, which nothing reads.
3   spawn_speed STAYS at the Create's 40 — difficulty 3 has no branch in the
    init block, and the decay line is gated `difficulty <= 2`. Adds DIAGONAL
    cleaves; firing one sets `timer = -4`, stretching the next gap.
```

That is exactly the fight as played: "the north wind" (one axis), "the north
and east winds" (switching), "a tempest" (switching plus diagonals).

Sabotage: the diagonal nudge fails at frame 59, difficulty 1's spawn_speed at
frame 14. Widening the decay gate to `<= 3` does NOT fail — correctly, since
difficulty 3's spawn_speed is already at the floor, so the gate is unobservable
here. Worth knowing rather than assuming that gate is covered.

A contact is replayed for difficulty 3 (frame 44). A slash that connects does
`timer -= 5; local_turntimer += 5` on the manager, so a hit visibly shifts the
cadence — 25 where an untouched run reads 30.

**Third variant landed: Sword Tunnel 3 and 4** (`verify-tunnel-difficulty`,
2,618 and 2,380 exact comparisons). Unlike the first two this needed real new
code — difficulty 3 is `tobymode 3`, a sweeping corridor:

- `sworddirection` advances 8 degrees per pair, so the whole corridor rotates
  around the box and the swords enter along that heading rather than straight
  left.
- The gap breathes: `verticalchange = abs(sin(tobytimer / 8)) * 5`,
  `gapsize = 34 + verticalchange * 1.4`.
- Speed falls off as it turns side-on:
  `lerp(1, 0.8, abs(lengthdir_y(1, sworddirection + 180)))`, measured -8.000
  head-on and -7.777 eight degrees round.

**`tobytimer` is incremented TWICE per spawn**, and the sine reads the odd
value between them — at the first pair it is 1, giving 0.6234, exactly what
the recording shows. Reading the post-increment value gives 1.237 and
everything downstream drifts. Sabotaged: dropping the first increment fails at
frame 54.

Difficulty 4 is `tobymode 0` with `gapsize` 40 instead of 45 — already
translated, and it passed unchanged.

**One bug this caught in already-"verified" code:** `finishtimermax` is 230,
but the Create reads `if (obj_knight_enemy.difficulty == 3) finishtimermax =
250`. I had written a comment about that line and never implemented it. Since
`finishtimer == finishtimermax` sets `con = 1` and `con` gates spawning, the
corridor silently stopped feeding 20 frames early. The difficulty-0 suite
could never have caught it.

Difficulties 1 and 2 (tobymode 1 and 2) stay untranslated: the selector only
ever hands ac 13 difficulty 0, 3 or 4.

Remaining variants: Box Splitter's higher difficulties change cleave direction
per cut and add diagonal cleaves (done). Stars 3 gives each star two shards
that then home.

## Collision primitive: `scr_precise_hit` — implemented and LIVE for Flurry

`sim/masks.js` now has the oriented-box test the contact checks actually need,
and **Flurry's hit is computed rather than replayed**: `verify-flurry` runs
4,143 comparisons with the contact fired by the engine, and `playerstrike` plus
the manager's `timer`/`local_turntimer` feedback all match exactly — which only
happens if the hit lands on precisely the right frame.

**The key correction:** `spr_rk_quickslash`'s mask is a **RotatedRect**, not
Precise. So `scr_precise_hit(3)` is NOT a pixel-mask overlap — it is a 3x3
box around the soul's CENTRE (`x + 10`, `y + 10`) against the cut's rotated,
scaled bbox. Walking a pixel grid there would have been consulting data the
runner never looks at.

What the suite pins, and what it does not:

- Sabotaging the centre offset (testing at the soul's origin instead of
  `+10`) fails at frame 44. That part is real.
- Sabotaging the box half-size (`n/2` -> `n/4`) still PASSES. One contact on a
  240px bar cannot discriminate the box size — worth knowing rather than
  assuming the whole primitive is pinned.

**NOT switched over: `verify-splitter-difficulty`.** Difficulty 3's cut lands
on a **0.04 pixel** boundary — the bar's near edge sits at x 321.54 against the
soul box's 321.5 — and the exact-geometry model misses it. Flooring the
instance position (which `masksOverlap` does) fixes that frame but produces a
FALSE POSITIVE at 173. Calibrating that boundary needs a measured sweep like
the 48-point study behind `masksOverlap`, so contacts stay replayed there and
the scene says so. Scenes that replay contacts now set `state.replayContacts`
to suppress the computed test, so the two can never double-fire.

Also fixed while switching Flurry over: `oracle-splitter-difficulty` replayed
`vertical`/`diagonal` but NOT the per-cut jitter. That was invisible while the
hit was fed in at a recorded frame, and wrong the moment geometry mattered —
with live RNG the difficulty-1 run landed a hit the real game never takes. The
jitter is replayed now.

## `collision_line` — implemented and wired, but NOT VERIFIED

`sim/masks.js` has `collisionLineRect` (segment vs axis-aligned rectangle, slab
clipping) plus `heartBBox`, and `sim/attacks/sword-tunnel.js` now runs the real
swept test: within 80px of the soul the sword advances in 8px sub-steps,
probing 37px from its tip along its heading at each one, then restores its
position — which is what stops a sword moving 30px per frame from tunnelling
straight through.

**The `prec = 0` flag is the thing to get right.** At prec 0 GameMaker tests the
target's BOUNDING BOX, not its pixel mask, even though obj_heart's mask sprite
is Precise. Using the pixel grid would be testing something the call explicitly
opted out of.

**STILL UNDER-FIRES: 30 against the oracle's 45.** Started at 15; one real bug
found and fixed on the way, and the attribution of the 45 settled:

- **The 45 are all SWORD contacts.** `obj_sword_tunnel_hitbox` first appears at
  frame 272, well outside the 13-235 window, so it contributes nothing here.
- **The tunnel scenes had the soul in the wrong place.** They froze it at its
  spawn x of 260, but the recording shows it takes one 4px step right on frame
  10 and sits at **264** for the rest of the turn. Four pixels moves its bbox
  from 262-278 to 266-282, which is exactly the margin these grazing contacts
  turn on. Fixing it took the count from 15 to 30 and frame 88 from 0 to 1
  (oracle 2). **Nothing caught this for a long time** because the swords never
  read the soul — only the swept test is sensitive to its position, and that
  did not exist until now.

**The second-contact-path theory was TESTED AND IS WRONG.** The sword's mask is
its own sprite (`mask_index` is -1, so GameMaker falls back to `sprite_index`
= spr_knight_diamondbullet_l); that mask is now extracted into `sim/data` and
the sword has a `collides`. It fires **zero** times in the window, and on
reflection that is the expected answer rather than a bug: the soul sits in the
corridor's GAP and the swords pass above and below it, so their masks never
reach it. The swept probe reaches the soul precisely because it projects 37px
from the tip — that is the whole point of it.

So the remaining 15 are still unattributed, and the two obvious candidates are
both eliminated (hitboxes, mask overlap). What has NOT been checked: whether
the oracle fires the probe more often than once per sub-step — for instance if
`create_2nd_hitbox` gates differently than assumed, or if the recorder's
counter catches the same contact from more than one event. Counting hits
per-sword in a fresh recording, rather than globally, would separate those.

The sword's `collides` is left in place: it is faithful (the sword IS a
collidebullet) and it is what the playable build needs, but note it currently
never fires in this scene, so no suite exercises it.

It is left wired because it cannot affect anything verified — the swept test
restores x/y, so positions are untouched, and no suite compares tunnel hit
counts. All 22 suites still pass. But **nothing here should be read as
evidence the swept test is right**; it needs a hit-count comparison of its own
before that claim can be made.

## Attacks

| ac | name | status |
|---:|---|---|
| 5 | **rotatingslash** | VERIFIED, 220 frames / 6 cycles. Ends before the `return` wind-down (untranslated). |
| 1 | **Stars** | Cone VERIFIED (210 frames incl. soul squeeze). Star bullets translated; spawn cadence + lifecycle VERIFIED (rows 95-169). Fire-phase knockback NOT verified. |
| — | `obj_roaringknight_slash` | VERIFIED row-exact — used BY rotatingslash. |
| — | split_growtangle organism | VERIFIED row-exact — reached from rotatingslash + combinationattack. |
| 2 | **Flurry** | VERIFIED, 318 frames / 8 cuts — cadence and cut handoff. Hit window NOT verified (see below). |
| — | fountain bullets | Verified but **unreachable in the fight**; engine value only. |
| 11, 14 | **tracking swords** (type 151) | VERIFIED, frames 13-160 / 8 swords. Anti-repeat wheel translated but NOT covered — see below. |
| 12 | diagonal bullets (type 152) | Verified row-exact but **UNREACHABLE** — engine value only (component motion). |
| 13 | **sword tunnel** (type 153) | Corridor VERIFIED, frames 13-235 / 46 pairs, fully exact. Finale + swept hit test NOT translated. |
| 15 | **sword vortex** (type 154) | VERIFIED, frames 13-185. State machine exact; positions to <1.3e-4 px. |
| 9 | **roaring** (type 107) | RECORDED and read, NOT translated. See below. |
| 7 | combination (type 105) | **UNREACHABLE** — phase 1 never reaches phaseturn 9. |

### Flurry (ac 2) is the box splitter — corrected, then measured

CLAUDE.md said `obj_roaringknight_boxsplitter_attack` was unreachable content
created only by `dc.type = 106`. Both halves were false. Its only creator
anywhere in the dump is `obj_dbulletcontroller` under **`type == 99`**, which
is **ac 2, Flurry** — the second attack of phases 1, 2 and 3. (`type = 106`
creates `obj_knight_weird_bottom_manager`, a different object.)

Confirmed by recording, not just by grep — `oracle-run.sh 1 3 flurry` produced
`type=99` and this instance population over 600 frames:

```
obj_roaringknight_boxsplitter_attack   361     NOT translated  (209 lines, 4 events)
obj_roaringknight_splitslash           306     NOT translated  (271 lines, 7 events)
obj_knight_split_growtangle            299     VERIFIED row-exact
obj_roaringknight_split_bullet        5614     VERIFIED row-exact
```

The box parking at `x = -9999` mid-attack is authentic, not a harness fault:
that is the splitter stowing the arena during a cut.

**Translated and verified.** `sim/attacks/boxsplitter-attack.js` +
`sim/attacks/splitslash.js`; `node tools/verify-flurry.mjs` compares 4,143
values across frames 13..330 — the manager's `timer`, `spawn_speed`,
`slash_count`, `local_turntimer`, `spawn_range`, the live slash population,
each slash's `timer`/`active`/`playerstrike`/`hurt_delay`, and the organism's
`con`/`timer`/`split_delay`. Sabotage-tested on both the `spawn_speed` ramp
and the hit feedback.

Mechanics worth remembering:

- `timer = 200` in Create is `>= spawn_speed`, so the first cut lands on the
  manager's very first Step.
- `spawn_speed` is 50 at difficulty 0 and walks to 40 by 3 per cut, so the
  cuts accelerate: 50, 47, 44, 41, 40, 40, …
- **A connecting slash lengthens the turn.** Other_15 does `timer -= 5;
  local_turntimer += 5` on the manager, which is why the recorded gap between
  cuts 1 and 2 is 52 frames rather than 47.
- The slash's hit window is **four frames** (timer 30..33). The attack's real
  danger is the organism the cut spawns, not the cut.
- The manager's `growtangle` reference is replaced by the split_growtangle
  INSTANCE at the first cut, so every later slash spawns at the organism's
  position rather than the box's.

**NOT verified, stated plainly: the hit window.** The contact test is
`scr_precise_hit(3)` — a `collision_rectangle` of a 3x3 box centred on
(heart.x + 10, heart.y + 10) against the slash's precise mask, which is a
different primitive from the mask-vs-mask overlap in `sim/masks.js`, and
`spr_rk_quickslash`'s mask is not in `sim/data`. The one recorded contact is
replayed at its frame so the cadence feedback is exercised; nothing in the
suite is evidence about *when* a slash connects. Two things unblock it: add
`collision_rectangle`-vs-precise to `masks.js`, and extract the quickslash
mask.

## Immediate next step

**Finish Stars' fire phase.** The star bullet is translated
(`sim/attacks/pointing-star.js`) and its accumulation phase is verified exactly
(star count matches rows 95-169, peak 16 alive). Two things remain, both with a
known first-divergence frame:

**1. Per-star launch parameters (diverges f170).** Each real star gets an
RNG-derived `direction`/`speed` from `random_range`/`sin(random(1))`, so they
exit the view at staggered times; `oracle-t9.js` launches them uniformly, so
the population curve drifts once early leavers would have gone. Fix: extend the
oracle patch to log every star's spawn `direction`/`speed`, then replay them
(same pattern as the rotatingslash fan angles).

**2. Fire-phase knockback (diverges f197).** At the fire moment the cone sets
`knockback = 10` and then, for ~20 frames,
`gt_x -= scr_ease_in(knockback/10, 5) * 10` with `knockback` walking to 0 by
0.5. Oracle box reads 260 at f197 where the sim reads 269. The translation is
in `pointing-cone.js`; it needs checking against the trace frame by frame.

Both are bounded, and both are now much cheaper than when they were written:
`t9-star.csv` predates the universal recorder and logs only the first star, so
re-record Stars with `./tools/oracle-run.sh 1 1 stars frames=600` and the
per-star `direction`/`speed` and the cone's `knockback`/`gt_x` will all be in
the trace already. The f197 turntimer-offset hypothesis is DISPROVEN — moving
the controller's `+30` into its Create reproduced the divergence byte for
byte, so the cause is still unknown and should be read off the new trace
rather than guessed at.

**After that:** `obj_knight_pointing_starchild` — a 148-line tracking bullet
homing on `obj_heart_follower`, spawned 6 per star at burst. Separate unit.

### Instance Step order is not always spawn order

CLAUDE.md listed "mid-phase spawns / processing order" as known-unverified and
unobservable. The vortex observes it. `obj_sword_vortex` reads its manager's
`siner` and drifting centre every frame, and the trace shows it using the
PREVIOUS frame's values — at frame 19 the sword's `len` is `80 + sin(5/22)*17`
while the manager already reads `siner = 6`, and its x resolves against the
frame-18 centre. **The sword steps before the manager that created it**, even
though the manager is older.

`sim/entity.js` now sorts each phase by `type.stepOrder` (default 0) then spawn
order, and `obj_sword_vortex` declares `stepOrder: -1`. Deliberately a
per-type knob rather than a guessed global rule: one data point does not
establish GameMaker's ordering, and every other translated attack reads the
box or the soul rather than its manager, so none of them can distinguish.
Sabotage-tested — removing it diverges at frame 19.

### The trig limit, restated honestly

The vortex sweeps every angle, so it hits the `lengthdir_*` rounding
difference constantly rather than at four headings. Chasing it with an ulp cap
went 1 -> 2 -> 3 in one sitting, which is a slippery slope, so `verify-vortex`
uses a fixed sub-pixel bound (1e-3 px) and PRINTS the worst observed
difference: **377 samples inexact, worst 1.22e-4 px**.

What makes that attributable rather than hand-waved: `dir`, `len`,
`image_angle` and every manager field are compared with NO tolerance and match
to all ten digits across the entire window, including at frames 60, 100, 140
and 155. The state machine is exact; only the final trig product differs, and
it does not accumulate.

### Two findings from the earlier two attacks

**`lengthdir_x/y` narrows both operands to float32.** Tracking swords diverged
by exactly one f32 ulp at a single frame; of five candidate roundings only
`fround(len) * fround(trig)` reproduced it, and narrowing the product too moved
the first divergence from frame 63 to 122. Every other suite still passes, so
this is a real property of the runner, not a fudge. A residual 1-ulp
difference remains at the four DIAGONAL headings only — axis-aligned headings
are always exact — and `verify-tracking` allows exactly one ulp on positions
and PRINTS THE COUNT (27 of 3,120). That is the only place in the project that
is not exact string equality.

**The anti-repeat wheel is translated but unverified.** `directionprev` nudges
a repeated heading by 45 degrees so the same corner never fires twice running.
`verify-tracking` replays POST-wheel headings, so deleting the wheel entirely
still passes — sabotage-tested, it does. To cover it, an oracle patch needs to
log `inst.direction` right after the `choose` as well as after the wheel.

**Then:** the rest of the roster, cheapest-first now that recording is cheap:

### CORRECTION: combination is not cheap, and two objects were missed

The plan called `combination` (ac 7, type 105) a 65-line job that chains
things already done. Wrong on both counts.

It is a DISPATCHER. It picks three attacks and creates the first with
`turn_type = "start"`, passing `next_up`/`next_next_up` so each hands off to
the next. Recording it (`oracle-run.sh 1 9 combination`) shows what phase 1
actually chains:

```
obj_knight_tunnel_slasher_2_revised   145 rows   NOT translated  (547 lines, 6 events)
obj_knight_rotating_slash              70 rows   VERIFIED
obj_knight_swordfall                   39 rows   NOT translated  (319 lines, 11 events)
```

**Neither of those two objects was anywhere in the roster plan**, because
neither has its own myattackchoice — they are reachable only through chaining.

~~And they are not exotic: `obj_knight_rotating_slash`'s Step creates BOTH of
them itself, so they run in EVERY phase.~~ **Overstated — corrected.**
Rotatingslash does contain those two `instance_create` calls (Step lines 41
and 80), but both are gated on `next_up == 3` / `next_up == 4`, and a grep for
every origin of `next_up` in the whole dump returns exactly one:

```
gml_Object_obj_knight_combinations_Other_10.gml:51:    next_up = other.second_attack;
gml_Object_obj_knight_combinations_Other_10.gml:52:    next_next_up = other.third_attack;
```

A standalone rotatingslash (ac 5) has `next_up = -1` from its Create and never
enters those branches. So swordfall and tunnel_slasher_2_revised are reachable
**only through combination — ac 7, phase 1 turn 9, one turn in the fight.**
Real content, but far lower priority than "every phase". The lesson is the one
this project keeps relearning in a new costume: finding an `instance_create`
is not the same as showing it can run.

Separately: this chain is NOT the "rotatingslash return wind-down" that the
attack table lists as untranslated. That is the attack's own `return` state,
still outstanding.

There is also an original quirk worth recording: `obj_knight_combinations`
builds and shuffles `main_list` to pick its three attacks, then immediately
overwrites all three from `obj_knight_enemy.first_attack/second_attack/
third_attack`. The shuffle is dead work that still consumes RNG.

**Revised order:**

### Roaring (ac 9) — recorded and scoped, not translated

`traces/roaring.csv`, 400 frames, via `tools/oracle-run.sh 4 3 roaring`.

**The harness needed a fix to reach it at all.** `obj_knight_enemy`'s selector
does `if (phase != 4) { turn++; phaseturn++; }` and phase 4 advances its own
`phase4turn` instead — so the `phaseturn` knob never reaches the finale. The
recorder now takes `phase4turn` too (and sets `rotatingslash3used`, which the
selector uses to skip straight past phase 4's first turn).

It is the largest object in the fight by a wide margin:

```
obj_knight_roaring2   Step_0     596 lines
                      Other_10   414
                      Draw_0     282
                      Create/CleanUp 85
obj_knight_roaring_star  Step_0  115   + Create/Other_10/11/15
```

**The leverage, and its limit.** `obj_knight_roaring_star` is a SIBLING of
`obj_knight_pointing_star` (the Stars attack, already translated): same con
skeleton — friction at con 1, gravity reversed along `direction - 180` at con
2, a six-child burst at con 3. But `diff` on the two Steps is 153 lines. The
roaring star adds a `split` mechanic, a `con 2.5` state, and an `outbound`
flag that only lets it despawn once it has been on screen; it drops the grow
phase and the graze timer. Real leverage, not a copy.

**Two things the next recording needs:** more than 400 frames (no
`obj_knight_pointing_starchild` appears in this one — the stars never reach
con 3 inside the window), and the starchild is wanted by BOTH roaring and the
long-outstanding Stars gap, so translating it once serves both.

### `obj_knight_pointing_starchild` — I CALLED THE HOMING DEAD. IT IS NOT.

**Retracted.** The previous version of this section concluded, from measuring
one starchild, that `difficulty` is never >= 2 and therefore the entire
tracking state machine is unreachable. That is wrong, and the error was
sampling a single instance and generalising.

`obj_knight_pointing_star`'s burst sets the field on each child explicitly:

```gml
if (difficulty == 2 && (i % 3) > 0)   d.difficulty = -1;   // two of every three
else                                  d.difficulty = difficulty;
```

Measured across `traces/stars3.csv` (phase 3, Stars at difficulty 2): **28
children spawn with difficulty 2 and 56 with -1**, and the 28 reach con 1, 2
and 3 with delays of 25 through 72. `scr_childbullet` genuinely does not copy
`difficulty` — that part was right — but the star assigns it directly two lines
later, which I did not read.

So the homing is live content, and it is exactly what the fight shows at
Stars 3: "each star only explodes into two shards, which after a short while
turn red and shoot toward the SOUL one at a time". The staggering is the
controller's running counter:

```gml
with (obj_dbulletcontroller) {
    other.delay += delay;
    if (subdelay == 4) { subdelay = 0; delay += 5; }
    else               { subdelay++;   delay++; }
}
```

each child taking a longer delay than the last — the "one at a time".

At difficulties 0 and 1 the `difficulty >= 2` gate is genuinely false, so
children there really do just drift. Both statements are needed; the earlier
one collapsed them into a single wrong claim.

### The Stars burst, read in full — what difficulty changes

All three recordings are on disk: `stars2.csv` (difficulty 0, phase 1),
`stars_d1.csv` (difficulty 1, phase 2), `stars3.csv` (difficulty 2, phase 3).
`obj_knight_pointing_star`'s con-3 burst is the whole difference:

| | 0 | 1 | 2 |
|---|---|---|---|
| children spawned | 6 | 6 | 6 |
| angle step (i 1,4 / else) | 48 / 66 | 48 / 66 | **180 / 0** |
| speed | odd i: 1 (lifetime 30), even: 4 | all 4 | 2, scaled per index |
| `d.difficulty` | 0 | 1 | **2 for i 0,3; -1 for the rest** |
| homing | no | no | **yes, on the two difficulty-2 children** |

The 180/0 angle steps at difficulty 2 collapse six children onto two headings,
which is why the fight reads as "each star only explodes into two shards".
The odd/even speed split at difficulty 0 is "three of six shards travel and
last shorter".

**ORIGINAL BUG:** the burst computes `var _count = 6; if (difficulty == 2)
_count = 2;` and then loops `for (i = 0; i < 6; i++)` — `_count` is never
read. Six children always spawn, even at difficulty 2. Mark it at the site
when translating so a later cleanup cannot "fix" it.

**DONE.** `sim/attacks/pointing-star.js`'s burst now spawns real children with
the per-difficulty angles, speeds and difficulty assignments, and
`sim/attacks/pointing-starchild.js` translates the child itself —
`obj_heart_follower` included.

`node tools/verify-starchild.mjs` reproduces a recorded difficulty-2 child
through its whole life, **con 0 -> 1 -> 2 -> 3**: 531 comparisons, with `con`,
`timer`, `delay`, `ease` and `tracking` compared EXACTLY and only position and
direction under the usual sub-pixel trig bound (17 samples inexact, worst
3.05e-5 px). Sabotaged three ways — the rotate delta fails at frame 202, the
40-frame ease decay at 193, the con-3 acceleration at 210.

### ALL DIFFICULTY VARIANTS ARE NOW VERIFIED

`verify-stars-full` runs Stars at **0, 1 and 2** in one pass — 1,442 / 1,426 /
1,482 comparisons, every value exact — against `stars2.csv`, `stars_d1.csv` and
`stars3.csv`. That was the last variant group; every attack the fight uses is
now verified at every difficulty it is played at:

| ac | attack | difficulties the fight uses | verified |
|---:|---|---|---|
| 1 | Stars | 0, 1, 2 | **all three** |
| 11/14 | Tracking Swords | 0 | yes |
| 2 | Box Splitter | 0, 1, 3 | **all three** |
| 13 | Sword Tunnel | 0, 3, 4 | **all three** (corridor) |
| 5 | Rotating Slash | 0, 1, 2 | **all three** |
| 15 | Sword Vortex | 0 | yes |
| 9 | Roaring | — | lifecycle + pull + rings + shake + roar (to f678) |

The Stars variants confirmed the type-98 init exactly as read:

```gml
if (difficulty >= 2) { endtimer += 30; global.turntimer += 60; endtimer += 60; }
```

giving endtimer 120 / 120 / **210** and turntimer 268 / 268 / **328** across the
three phases. A longer endtimer means the cone holds its stars longer before
firing, which is why phase 3's Stars feels like it builds for so much longer.

### The visuals port — started

The game's look is not `sprite_index`. It lives in Draw events that composite
layers, scroll textures, mask them against primitives, and hide or replace
other objects outright. A renderer that blits each entity's sprite gets the
geometry right and the character wrong, and — as the Stars cone showed — can
also draw things the game deliberately hides.

**The mechanism:** `render/draw/`, a registry keyed by object name and
dispatched from the main loop. Each entry is one ported Draw event and returns
whether it drew the object completely, or wants the normal sprite blit to
follow it (GML's `draw_self()`). A shared offscreen buffer handles the
compositing the ports need.

Done so far:

- **obj_knight_pointing_cone — the WHOLE Draw event.** Ported from the dump
  line by line, and the important part is its EARLY EXITS: the event is a
  chain of them, so each phase of the attack looks completely different and
  drawing them together would be wrong.

  | phase | what is drawn |
  |---|---|
  | `con >= 4` | nothing — he is on his way home (and no `draw_self` from con 5) |
  | `con <= 1` | ONLY the charge beam, then exit |
  | `con == 3`, timer > 0 | ONLY the closing flare, then exit |
  | otherwise | the wedge, the scrolling flow, the soul cut out of it |

  * **The charge beam**: a 1px slice of `spr_knight_bullet_flow` frame 2
    stretched from the screen's left edge to the cone's mouth at `y + 54`,
    sampled at `yoff` (rolled `irandom(60) + 2` at Create, re-rolled
    `120 + irandom_range(-60, 60)` for the flare), with a second faster copy on
    even frames. Past timer 28 the texture is dropped for a solid white bar —
    the beam has charged. Both `yoff` rolls were missing entirely.
  * **The closing flare**: two slices peeling apart from the mouth as timer
    counts 10 down to 0, fading with it.
  * **The soul is PUNCHED OUT of the backdrop** — `bm_subtract` over
    `with (obj_heart)`, so the heart stays readable against the flow. Canvas
    gets it with `destination-out`.
  * **The afterimage trail**: a ghost of the pointing knight every fourth frame
    while `con <= 4`, at `speed = 2 + afterimage_spread / 30` and
    `direction = sin(aetimer) * angle / 2` — so the fan widens as the cone
    OPENS (direction scales with `angle`) and quickens as the spread climbs,
    then collapses when con 4 pulls the spread back to 0. `scr_afterimage()` is
    now a shared helper (sim/fx.js) that copies sprite, frame, blend, depth,
    scale and angle from the caller, as the original does.

- **obj_knight_pointing_cone — the Stars backdrop.** The 600px wedge from the
  cone's tip, coloured `merge_color(c_white, c_black, angle / target_angle)` so
  it darkens as it opens, with two `spr_knight_bullet_flow` layers scrolling
  over it at 20 and 80 px/frame and masked to the wedge. GML confines them with
  separate-alpha blending (`bm_dest_alpha`); canvas gets the same result from
  `source-in`. Scroll position is a function of `state.frame`, not an
  accumulator, so pausing or fast-forwarding cannot desync it.
- **The cone IS the knight.** Its Create sets `obj_knight_enemy.visible =
  false` and it `draw_self()`s in the pointing pose. Missing that drew the idle
  body and the pointing body 36px apart at 2x scale — the "two knights".
- **The cone's return (con 3 -> 4).** Draw counts a 10-frame flare down and
  hands to con 4, which walks the cone home at `lerp(pos, knight, 0.15)`.
  Without it the cone parked where it fired for the rest of the turn.
- **The knight's afterimage trail.** Every fourth frame, a 0.6-alpha ghost that
  fades at 0.02 and drifts right at hspeed 2, gated exactly as the original
  gates it (not while hidden, not during Roaring).

**ORIGINAL BUG found here:** the cone's `con = 5`, which restores the knight's
visibility, is guarded by `if (tween == 0)`. `tween` starts at 0, only ever
moves toward 1, and is never reset — so once the cone has slid into place that
test can never pass. con 5 is unreachable and the restore always comes from
CleanUp. Translated as-is.

- **obj_knight_circle** — the additive gradient bloom at an aim point, clipped
  to the arena when `draw_in_box`. Rotating slash drops one on every aim.
  ORIGINAL BUG preserved: its second destroy test reads
  `if (r == 0 && b == 0 && b == 0)` — `b` twice, `g` never — so with the
  default r of 128 it cannot fire and the alpha countdown is what ends it.
- **The battle box grow-in.** obj_growtangle opens over 15 frames: scale 0 to
  max, `image_angle` 180 -> 360, alpha 0.5 -> 1, leaving one afterimage of
  itself per frame. `growcon 3` runs it backwards, which is how ROARING's
  ending collapses the arena.

  **ONE SCALE, and getting this wrong hid a gameplay bug.** The box briefly
  carried a separate `xscale`/`yscale` for collision so the grow-in's rotating
  fractional-scale walls could be avoided (CLAUDE.md's T3 caveat). Nothing kept
  the pair in step with `image_xscale`, and ROARING expands the arena to 17x by
  tweening the built-in — so the board correctly vanished off the screen edges
  while an INVISIBLE WALL at the old size went on restricting the soul for the
  whole full-screen attack. Collision now reads `image_xscale`/`image_yscale`
  like everything else; the soul reaches x 619, which is the screen edge rather
  than any box. Every oracle scene calls `settleBox()` so its window still
  starts from a grown arena.
- **obj_knight_swordtunnelanim** — the knight's performance during Sword
  Tunnel, and he stops drawing himself while it exists (his Draw opens with
  `if (i_ex(obj_knight_swordtunnelanim)) exit;`). `image_index` tweens 0 -> 4
  as he draws back and points, `dir` swings 4 -> -18, then at timer 20 he
  fades over 10 frames while `hspeed = -4` sweeps him off to the left. That
  early exit is expressed in the DRAW layer rather than as `visible = false`
  in sim/, because that is where the original expresses it — the cone does the
  opposite and really does set visible.

- **ROARING draws `knight_sprite`, not `sprite_index`.** Its Draw builds the
  figure out of a `knight_sprite` variable, one scanline at a time with a
  per-row sine wobble, and never touches `sprite_index` — which sits on the
  generic attack pose all turn. Rendering from `sprite_index` therefore put
  the FLURRY/rotating-slash pose on screen for the whole finale. The real
  chain, with the numeric asset ids resolved from the sprite metadata dump:
  `spr_roaringknight_front` (advancing at 0.5) -> `_front_flourish` at
  `intensity == 3.74` -> `_front_roar` at roaring_timer 15 -> `_front_flourish`
  at 181 -> `_front_slash` at 275. The per-scanline wobble is not reproduced.
- **Rotating slash IS the visible knight**, and had no sprite at all. Its
  default sprite lives in the GameMaker object definition rather than the GML,
  so it came from the recording: `spr_roaringknight_attack_ol` at scale 2.
  Controller type 104 does `with (creatorid) image_alpha = 0` first — without
  that the real knight stood idling beside a half-size one performing the
  attack. Its pose is hand-stepped (frame 1 at aim start, +1 at the aim's
  halfway point, `image_speed = 0.5` on the last aim frame, clamped at 5) and
  now matches the recording exactly for 200 frames.
- **The aim telegraph** (render/draw/rotating-slash.js) — the markers that
  show where the fan will cut, one per pending slash at
  `(360 / (slash_number * 2)) * a + random_offset + aim_direction`, growing
  along their length as the aim charges (`xscale = timer * 0.2`) while
  thinning across it, clipped to the arena. Computed from the same expression
  the slash state fires from, so the warning cannot drift from the attack.
  NOT ported: the line2/line3 perpendicular rails.
- **Battle box: two bugs.** Its growth afterimage had invented values; the real
  one is `alpha = (1 - image_alpha) + 0.1` (the INVERSE of the box's, so the
  echo fades as the box solidifies) at `sizer * growscale` scale, which read as
  a flicker. And the box grew TWICE — once at scene build and again when the
  first attack launched — because the original creates a new obj_growtangle per
  turn while the playable scenes reuse one. `settleBox()` puts the scene's box
  straight into its settled state so the only grow-in is the attack's.

Still to port: `obj_knight_roaring2`'s Draw proper (282 lines of surfaces and
beams; only the pose chain is done), the vortex, the knight's remaining pose
swaps and whiteflash, and the box shimmer.

### Playtest round 2 — contact bugs the suites could not see

| symptom | cause |
|---|---|
| Roaring's stars never hit | `obj_knight_roaring_star` had no `other15` at all — skipped when masks.js lacked `scr_precise_hit`, never revisited |
| some Stars stars never hit | `obj_knight_pointing_star` used a mask-vs-mask overlap; the game uses `scr_precise_hit(3)`, a 3px probe at the soul's CENTRE. The starchild uses 5 during Stars and 2 during Roaring, and had no test at all |
| the FIRST stars never hit | this translation set `maskOff = true` at Create, on the reading that the mask arrives at con 2 because the Step assigns it there. The CREATE already assigns it (line 19); the Step's is redundant. Every star crossing the arena during the charge passed through the soul |
| the board's edges flickered | `spr_battlebg_0` has two frames and `image_speed` defaulted to 1, so the arena alternated between them every frame |
| an invisible wall during ROARING | the box carried a second scale pair for collision that never followed `image_xscale` — see the battle box section |

**`scr_precise_hit` is the knight's normal contact test**, and it is much more
forgiving than a mask overlap: a small square probe at the soul's centre
against the bullet's mask, with the soul's heart outline playing no part. Sizes
are per-object and per-attack (2, 3, 5), so they are worth reading rather than
assuming.

### Playtest round 1 — what actually reaches the player

Running the scheduled fight surfaced a class of bug the oracle suites are blind
to by construction: the suites drive attacks from SCENES that supply setup the
real controller is supposed to supply. Everything below passed verification
while being broken in the playable build.

| symptom | cause |
|---|---|
| tracking swords never hit, no damage bar | `runCollisions` SKIPPED any bullet type with no `collides` — silently. Three fight attacks could not damage the player at all |
| tracking swords flew during Flurry | the end-of-turn sweep listed `obj_knight_tracking_sword*`; the real types are `obj_tracking_sword1` / `obj_tracking_swords_manager`, so nothing matched |
| Stars' homing shards flew straight | `obj_heart_follower` — the thing they home at — is created by controller type 98, which only the oracle scene did by hand |
| stars invisible | `obj_knight_pointing_star` never set `sprite_index`; the object's default sprite lives in its GameMaker definition, not the GML |
| rotating slash had a hitbox and no sprite | the translation mirrored `visible = false`, which is free in the game (a Draw event draws it) and fatal here |
| Roaring 64px too high, arena never opened | the intro beats at `timer` 30 and 80 were never translated — the oracle scene starts at frame 149 with the settled values seeded |
| Roaring stopped mid-spiral and restarted | controller types 104 and 107 set `global.turntimer = 999999`; the scheduler used the knight's 240 |
| battle box tiny for the first 44 frames | the box carries `xscale` AND `image_xscale`; instance defaults set the built-in to 1 while the box's own stayed 2 |
| the whole board sat too high | CSS. The canvas was sized on width alone: 922px tall in a 720px window, so flex centring pushed the top 65 game rows off screen |

**The structural fix is the collision one.** `runCollisions` now falls back to
the bullet's own sprite mask — GameMaker's `mask_index = -1` — instead of
skipping, and counts `unmaskedBullets` when it cannot. That counter immediately
found another one: the difficulty-2 trail shards were skipped 67,908 times in a
single run.

**A lesson for the suites.** A scene that hands the attack something the
controller should create will verify the attack perfectly and hide a bug that
makes it inert in play. Both cases here — the heart follower and the star
sprite — were exactly that. When a scene sets something up by hand, ask which
object does it in the game, and put it there.

### The scheduler — the playable build now runs the real fight

`sim/scenes/fight.js` + `tools/verify-fight-order.mjs`. The playable scene used
to loop Flurry, because that was the whole roster at the time. It now walks the
selector's 15-turn table and phase 4, and everything it needs per turn is READ
out of the game rather than arranged:

| what | where it comes from |
|---|---|
| attack order and difficulties | `obj_knight_enemy` Other_10, the selector |
| `dc.type` per ac | the knight's Step |
| arena position and scale | the knight's Step — only ac 1, 11 and 13 differ |
| soul placement | `scr_moveheart()`, with ac 13 overriding to `(box.x - 40, box.y - 8)` |
| turn length | `scr_turntimer(...)` per ac — 350 Flurry, 292/300 tracking, 330/360 tunnel, 240 otherwise |
| `global.invc` | the knight's Step — 1, 0.4, or 0.14 for the tunnel |

**Stars' controller moved from the oracle scene into `sim/`**
(`sim/attacks/stars-controller.js`). It was the one attack the scheduler could
not launch, because obj_dbulletcontroller type 98 existed only inside
`tools/scenes/oracle-stars-full.js`. Same code, same suite — the Stars
verifiers still pass unchanged, which is what makes the move safe.

**THE TURN CLOCK IS THE AUTHORITY for ending a turn**, and getting that wrong
hung the fight. The first version waited for the arena to empty; Stars' 96
starchildren home in on the soul and hover there, so they never leave the
screen and the turn could never end — 1,500 frames of nothing. In the game the
battle controller ends the turn when `turntimer` runs out and sweeps whatever
is still flying. Bullets now get a 90-frame drain to leave on their own, then
the sweep runs regardless.

Whole fight: 17 turns in ~6,100 frames, longest turn 485. The suite asserts the
order against `FIGHT_TABLE`, that no turn exceeds 900 frames, that every turn
actually puts bullets on screen, and that the arena is reconfigured per attack.

**Still a stand-in, and the HUD says so:** no HP and no ACT menu, so phase 4 is
entered on a turn count rather than the real HP < 80%, a turn ends on its clock
rather than when the party acts, and the between-turn sweep stands in for the
battle controller's.

**Also fixed while verifying it in the browser:** the audio layer requested a
sample per cue speculatively, so the shipped default — no audio folder, which
is deliberate — logged one 404 per distinct cue, fifty console errors on every
load. It now probes `assets/audio/index.json` once and asks for nothing if the
player has supplied nothing. (The extractor should write that index; see the
SFX task.)

### Rotating slash — the spiral finisher, DONE

The last untranslated branch of an attack the fight uses in every phase.
`verify-rotating-difficulty` now runs difficulty 2 to frame 400 — the end of
its recording — with 5600 exact comparisons, against 2130 before.

**It only exists at difficulty 2.** The gate is
`difficulty == 2 && turn_type == "full"`, so it is the LAST rotating slash of
phase 3 and nothing else. Every other difficulty takes the `else`: state
"return", `alarm[3] = 22`, done. That else-branch was missing entirely, which
is what the old "divergence at 282 is the wind-down, not translated" note was
about — every difficulty fell through into another aim cycle instead.

**`aim_type` goes 0 -> 1 -> 2 within a single frame**, so the recording never
shows a 1: frame 227 reads 0 and frame 228 reads 2. `do_final` bumps it once
and the `if (aim_type == 1)` branch immediately below bumps it again.

**The attack changes shape at aim_type 2.** There is no aim phase any more —
cooldown returns straight to slash, roughly every 3 frames, while
`aim_direction` advances by an accelerating `speed_gain` (16 -> 24 over eight
slashes, then flat). 28 slashes, then `alarm[3] = 22` and destruction, measured
at frame 363.

**He stops aiming at the player.** `aim_x/aim_y` are set ONCE at the handoff,
to the box centre, and all 28 slashes spawn there. During the six cuts he locks
onto the soul every cycle; in the finisher he does not.

Two things this cost:

- **A recorded BOX TRACK.** `aim_x/aim_y` read the box centre, and
  obj_growtangle is jittered a pixel or two by every slash off the shared RNG
  stream — which this scene cannot reproduce, because it already replays the
  shuffled fan orders (ds_list_shuffle is unsolved). So the box is fed from
  the recording across the finisher. It has to be driven in **beginStep with
  the previous frame's row**: the slashes are created later than the driver, so
  in endStep their own jitter overwrites it, and the value a Step reads is the
  one the recorder wrote at the end of the previous frame.
- **`local_turntimer` must keep counting after the attack finishes.** There is
  no `done` flag in the original — the object keeps stepping, doing nothing,
  until Alarm_3 destroys it. Guarding the decrement left the value one high
  from the frame the finale ended, caught at frame 342.

Four sabotages fail: never entering the spiral, no Alarm_3, a `speed_gain` that
does not accelerate, and stopping at 27 slashes instead of 28.

### Sword tunnel contact — DONE, both paths, per frame

`collision_line` needed no new primitive. The fight has exactly ONE call site,
`obj_sword_tunnel_sword`'s Step, and it passes `prec = 0` — bounding box, no
pixel sampling. `collisionLineRect` (slab clipping, sim/masks.js) already did
it correctly.

**The long-standing "collision_line under-fires, 30 of 45" was a
misdiagnosis.** The recorder's `hits` counts every `obj_collidebullet` Other_15
invocation, and a tunnel sword reaches that event two ways:

| path | how | hits over the window |
|---|---|---:|
| swept probe | `collision_line` from the tip, 37px along `image_angle`, at each 8px sub-step, calling `event_user(5)` | 30 |
| mask overlap | the sword's own sprite mask vs the soul, via obj_heart's `Collision_obj_collidebullet` | 15 |

The second was contributing ZERO because of the `image_xscale = undefined` bug
(see CLAUDE.md, "GameMaker instance defaults"). Fixing the defaults made the
totals match exactly — 45 = 45 — and, more importantly, **every frame's delta
matches**, including the (+2, +1) pairs the attack produces as a sword crosses
the soul.

Four sabotages all fail at frame 88: killing either contact path, reverting the
instance defaults, and replacing the 8px sub-step loop with a single test.

Also corrected: the sword's `sprite_index` was set to
`spr_roaringknight_sword_ol`, while the recording's sprite column reads
`spr_knight_diamondbullet_l` for every tunnel sword. Wrong visual, and it
disagreed with the mask the contact test uses. The visible blades are drawn by
`obj_knight_swordtunnelanim`, a separate object.

Still open for this attack: the FINALE (`con == 1`, `_speed == 80`, the second
hitbox, and the soul's mask swapping to `spr_dodgeheart_smallmask`). Note the
recording dies at frame 293 — the party is wiped and `obj_returnheart` takes
over at 294 — so the finale has only ~50 usable frames in this trace.

### Roaring — the bullet is done, the controller is not

`sim/attacks/roaring-star.js` + `verify-roaring-star.mjs` (528 comparisons)
reproduce a recorded star from the moment the controller releases it through
its whole arc: con 1 brake, con 2's gravity reversal along `direction - 180`,
con 3's growth and six-child burst, destruction at timer 4.

It is a SIBLING of `obj_knight_pointing_star`, not a copy — `diff` on the two
Steps is 153 lines. Roaring's adds `split` (a star halving into top and bottom
pieces, con 2.5) and `outbound`, a flag that refuses to despawn until the star
has been on screen at least once. That flag exists because these stars are
FIRED FROM OFF SCREEN toward the knight; without it every one would die on its
first frame.

**A 400-frame recording was not enough to see any of this** — roaring's intro
alone runs ~136 frames and no star reached con 3. `traces/roaring2.csv` is 900.

**A flaw in my own scene, caught by sabotage.** The recorded star has
`outbound = true` at release and the scene did not set it, which made the
offscreen cull unreachable: sabotaging the scale-dependent bound back to a
constant 12 still PASSED. With `outbound` set it fails at frame 655. A suite
that cannot fail is not evidence, and this one could not have caught the very
bug that cost the Stars attack a long-standing divergence.

**OPEN ENGINE QUESTION — gravity accumulation is not bit-exact.** Under
constant gravity the oracle's `speed` reads exactly f32(0.8) after eight frames
and 3.90000009 after 39. That is f64 accumulation narrowed ONCE, not narrowed
per frame. This engine narrows `speed` on every store (the f32 accessors, which
the f32 probe established for single assignments) and gets 0.8000000715 and
3.89999843. Accumulating the hspeed/vspeed COMPONENTS in f32 gives the same
answer as f64, so that is not the explanation either. Residue ~6e-8;
`verify-roaring-star` compares speed and direction under the sub-pixel bound
and says so at the site.

Still to do for Roaring: `obj_knight_roaring2` itself — Step 596 lines,
Other_10 414, Draw 282. Mapped so the next session starts from a structure
rather than 596 lines:

**Three clocks, in sequence.**

| clock | where | what it drives |
|---|---|---|
| `timer` | `timer++` at Step line 24, unconditional | the intro. Fixed beats at 30, 80, 118, 132; particle streams from 136 |
| `intensity` | `scr_approach(intensity, 4, 0.008)` once `timer > 128` | a RAMP, not a counter. Beats fire on exact equality — `intensity == 3.66`, `== 3.74` — and the whole attack proper begins at `intensity == 4` |
| `roaring_timer` | `roaring_timer++` inside `if (intensity == 4)` | the attack: `< 169` spawn phase, then beats at 181, 182+, 275, 299, 363, 375 |

**Gameplay-relevant, as distinct from the very large cosmetic surface:**

- `attack_timer++` every frame past `timer > 128`; `attack_timer == 4` is the
  ring-spawn trigger (Step 169-356), firing `obj_knight_roaring_star` from a
  ring at `rand_dist` 600 aimed at the knight, with `friction = -0.1` so they
  ACCELERATE inward. Ring size and speed depend on `intensity`.
- **THE SOUL IS PULLED IN.** Every frame past 128:
  `obj_heart.x += lengthdir_x(player_suck, tempdir)` toward the knight, with
  `player_suck` approaching 1 while `intensity < 3.75` and then decaying to 0.
  That is a real dodge mechanic, not a visual.
- `bullet_list` is drained from `roaring_timer >= 182` — the stars are released
  one at a time from a stored list, which is what makes the spiral read.

**The soul pull is DONE** — `sim/attacks/roaring.js` (partial) +
`verify-roaring-pull.mjs`, frames 150-191, 168 comparisons, every position
exact. `player_suck` and `intensity` are compared with no tolerance.

Two things it pinned:

- **`player_suck` settles at 0.85, not 1.** Both approaches run each frame, in
  order: the up-step saturates at 1 and the down-step immediately takes 0.15
  off, so 0.85 is the fixed point the rest of the frame sees. Measured 0.5 ->
  0.6125 -> 0.85, held for the rest of the recording.
- **The soul ends up oscillating**, 133.27 / 132.42 every other frame, because
  `point_direction` is called at essentially zero distance once the soul
  reaches the target and the 0.85 step overshoots each way. Both sides do this
  identically, which is decent evidence the translation is right rather than
  merely close.

**THE WINDOW NOW REACHES 461, and the f192 kick is SOLVED: it was `obj_shake`.**

The pull aims at `camerax() + fake_x`, so a shaking camera drags the soul
somewhere else. That much was known. What was missing was the shaker itself —
`scr_shakescreen()` is one line, `instance_create(x, y, obj_shake)`, and
`obj_shake` generates the whole sequence from that single create:

| event | body |
|---|---|
| Create | `shakex = shakey = 4`, `shakesign = 1`, `shakespeed = 1`; a second instance destroys itself |
| Step | ONCE (`active == 0`): remembers the camera, offsets it `+4/+4`, flips the sign, arms `alarm[0]` |
| Alarm_0 | camera = remembered + `shake * shakesign`; each axis decays by 1; sign flips; re-arms; destroys at 0 |
| Destroy | puts the camera back exactly where it was |

That yields the recorded 4, -4, 3, -2, 0 — and **both axes move together**,
which the earlier work missed by looking only at `viewx`.

**The "phase mystery" was event order, not phase.** Feeding the recorded view
at frame f broke 191 and at f-1 broke 192, which looked unresolvable. It is not:
alarms fire BEFORE Step, so from the second frame onward every Step reader sees
that frame's shaken value — but on the FIRST frame there is no alarm yet, only
obj_shake's own Step, and `obj_knight_roaring2` is the older instance so it
steps first and still reads 0. Hence 0 on the frame the view already reads 4,
and the frame's own value ever after. Solving the pull backwards from the
recorded soul positions gives exactly that table.

**One cause, two symptoms.** The star spiral aims at the same shaken point, so
the camera also moves the 12px kill radius. At (-4,-4) the star the recording
destroys on frame 192 sits 8.19px from the shaken target — inside the radius —
while against an unshaken target it is at 13.65 and lives. The soul kick and
the "star count one over" were never two bugs.

`sim/shake.js` is the translation. Note it is NOT `sim/fx.js`'s `addShake`,
which is obj_shakeobj_ext — a render-only magnitude that shakes a SPRITE. This
one shakes the CAMERA and is gameplay state.

**Replayed: only the 15 create frames** (`SHAKE_FRAMES`), derived from the
recording as the frames where the logged view steps 0 -> 4. What fires them is
still unknown — it is not a star reaching the knight (stars die near him 20
times across frames holding 2 shakes), not `obj_knight_circle`, not the slash.
The caller is not in the trace at all because the universal recorder filters by
an object-name list, so finding it needs another run with that list widened.

**Also closed on the way: the `intensity >= 3` corral.** Once intensity passes
3 the ring beat yanks every live star back inside 60px of the screen on each
axis. It is a difficulty ramp — stars fired from 600px out stop having a long
approach — and it also thins them, since a corralled star reaches the kill
radius sooner. Without it the engine carried two stars too many at frame 342.

Result: camera and live star count **exact on every frame 150..461**, soul
within 1e-3 px (worst 3.05e-5), 1872 comparisons. Three sabotages — no shake,
no sign flip, no camera restore — each fail, and each reproduces the star-count
symptom too.

### The star rings — DONE to frame 461, and they gave the f192 kick a second face

`sim/attacks/roaring.js` now fires the rings and drives the spiral.
`verify-roaring-pull.mjs` compares **every ring frame and every star count over
150..461 exactly** — 69 rings, 194 stars — plus the live star population to 191
and star positions under a printed bound (worst 1.7e-3 px).

**The spiral is not in the bullet.** `obj_knight_roaring_star` has no `con == 0`
branch at all; a ring star does nothing of its own until the controller
promotes it. The controller's Step re-aims each star at the knight every frame
and then pushes it 90 degrees off that aim — `speed` on negative friction
carries it inward, the tangential term carries it around, and the sum is the
spiral. It re-derives each star's SCALE from its distance to the knight
(`distance / 170`, floored at 0.2), which is why these stars shrink as they
fall in while the Stars attack's grow, and destroys any star that gets within
12px.

Three things this cost, each worth keeping:

1. **`starcount_p1` had to be seeded, not just `attack_timer`.** Cadence was
   right in shape immediately — six stars per ring, 12 frames apart — but every
   ring fired four frames early. Only the first of every three `attack_timer`
   beats spawns a ring, so starting that counter at 0 instead of the recorded 2
   shifts the whole sequence by one beat.
2. **`spinspeed` is set ONLY by the spawner.** It appears nowhere in the star's
   own Create or Step; the spawning `with` block assigns it and the controller's
   spiral is its only reader. Omitting it made `90 * spinspeed` NaN and poisoned
   x/y on every ring star — invisible at first because an earlier divergence
   stopped the comparison before any ring fired.
3. **`speed * 0.625 * (1 / intensity)` is a reciprocal then a multiply.**
   Written as a division it is a different f32 value. Kept in the source's
   shape.

**The f192 divergence is CLOSED** — see the obj_shake section above. The
integer symptom is what cracked it: "something destroys a star at 192 that this
engine keeps" is a far better lead than a sub-pixel soul drift, and it pointed
straight at the shaken kill radius.

**Not exact, and stated as such:** star positions carry ~6e-3 px of trig
residue over the full window, and one seeded star lands one f32 ulp off in y
from frame 150. An
exhaustive search over the rounding paths (narrowing of the length, the sine,
the product, the angle, the direction, and the move step; reciprocal vs
division; move-before-swirl vs after) reproduced none of it, and frame-end
narrowing of x/y was tested against the whole suite and REJECTED — it breaks
the f32 probe and makes the scales diverge. Left open rather than papered over.

### The roar — `intensity == 4`, and it inverts the attack

The last untranslated logic in Roaring. `intensity` clamps at exactly 4
(scr_approach saturates), and that equality opens `roaring_timer`.

**`intensity >= 3.7` is not a third ring variant.** The ring gate is
`starcount_p1 == 1 && intensity < 3.7`, so above 3.7 the block fires nothing
and the attack coasts to 4. Anyone reading it expecting a faster cadence there
will look for content that is not present.

| roaring_timer | what happens |
|---:|---|
| 9 | THE ROAR. `player_suck = min(ps, -6)`, eight stars straight out on `a * 45` |
| >= 9 | `player_suck = min(ps, -3)` every frame |
| 15 | knight sprite swap (cosmetic) |
| > 15, every 5 | a three-star fan at `rand_angle`, `+20`, `-20`; `rand_angle += 60 + irandom(10)` |
| 181 | every live star gets `friction = 0.5` and is queued; `player_suck` tweened to 0 over 24 |
| >= 182 | one queued star per frame promoted to con 1 — the staggered burst |
| 275, 299 | the finale tail: box collapse, diagonal slash (not translated) |

**THE PULL BECOMES A SHOVE, and it is the same three lines of code.**
`player_suck` has been positive all attack; the roar makes it negative, and a
negative length through `lengthdir_*` pushes the soul away instead of dragging
it in. It settles at exactly -3 by the same fixed-point trick that pinned it at
0.85 earlier: `scr_approach(ps, 0, 0.15)` lifts it every frame and
`min(ps, -3)` puts it back.

**`obj_heart.boundaryup = 160`, from roaring2's Create, finally matters here.**
It reads like a ceiling and is a raised FLOOR — the soul's clamp is
`view.y + 320 - sprite_height + boundaryup`, so it moves the lower limit from
300 to 460. Irrelevant while the soul is being pulled inward; the moment the
roar shoves it out of the arena, missing it catches the soul at y 300 and drags
it back a pixel a frame. Found at frame 536 against a recording that sails past.

**Also translated:** `obj_lerpvar` (sim/lerpvar.js). GameMaker's tweens are
real instances with their own Step, and they are not cosmetic here — the roar's
stars spawn at `image_xscale = 0.1` and tween to 1.2/1.6 over 32 frames, and
`sprite_width` is what the offscreen cull measures.

**Replayed:** the roar's dice only — `8.5 + random(2)` for the burst,
`60 + irandom(10)` for each fan's walk, and the fan speeds. The fan SHAPE
(`rand_angle`, `+20`, `-20`), the burst's `a * 45`, the every-5-frames cadence
and `rand_angle`'s accumulation out of the ring phase are all computed.

**ORIGINAL BUG preserved:** the fan aims `star_angle1` at the soul with
`point_direction(knight, obj_heart)` and overwrites it with `rand_angle` on the
very next line. The fan does not track the player, however much it reads that
way.

**Verified reach**, all against `traces/roaring2.csv`:

| quantity | window | result |
|---|---|---|
| view (both axes), intensity, player_suck, roaring_timer, live star count | 150..678 | EXACT |
| ring frames and per-ring star counts | 150..678 | EXACT — 100 rings, 292 stars |
| soul position | 150..462 | within 1e-3 px (worst 3.05e-5) |
| soul resting position | 678 | EXACT — guards `boundaryup` |
| star positions | 150..639 | within 6.22e-3 px |

3273 comparisons. The window was 42 frames at the start of this work.

**Two honest limits, both understood rather than shrugged at:**

1. **The soul's escape ray past 462.** When the roar flips `player_suck`, the
   soul has been parked ON the pull target for 300 frames — about 0.6px away.
   `point_direction` at 0.6px is near-singular, so the documented ~3e-5px
   residue decides which ray the soul is thrown along. Engine and oracle pick
   rays 0.022 degrees apart, then fly straight and identically: the per-frame
   step matches in magnitude to 9 decimals, only the heading differs. This is
   not a bug that could be tightened away; it is one bit of residue amplified
   through a singular point. It also matters little in play — a real player is
   moving, and the stars are fired radially rather than aimed.
2. **The con-release arc, from 635.** The release CADENCE is right (the star
   count is exact through 678), but a promoted star needs ~45 frames to brake,
   reverse and burst, so none completes inside the window. Sabotage-checked:
   deleting the promotion left every other assertion passing, so it now has a
   positive assertion of its own (16 stars promoted). Its correctness is
   unverified, and the frame-679 count divergence that ends the window is very
   likely the first released star finishing a frame out. That is the next
   thing to chase, along with the untouched `split` / con 2.5 branch.

### Rebuilding Stars on the new recording — three real bugs found

`tools/scenes/oracle-stars-full.js` + `tools/verify-stars-full.mjs` rebuild the
whole attack against `traces/stars2.csv` (which logs EVERY star; the old
`t9-star.csv` logged only the first). It is **not yet in `npm run verify`** —
it currently reaches frame 146 of 260 and stops at the fire moment. What it
found on the way there is worth more than the suite:

1. **The cone's opening lives in its DRAW event, and I had the Draw filed as
   "cosmetic".** Nothing in the Step ever advances `con` past 1; the Draw does
   `if (con <= 1) { if (con == 0) con = 1; timer++; if (timer >= 30) con = 2; }`.
   Without it the cone never opens at all. Now modelled in `endStep`.

2. **GameMaker draws an instance on the frame it is created; its Step waits
   until the next.** The recording shows it plainly at frame 13 — `con` is
   already 1 (Draw ran) while `tween` is still 0 (Step had not). This engine
   has no Draw phase, so the cone's counter starts at 1 to compensate.
   Otherwise it opens one frame late and every angle after it is shifted.

3. **The star's offscreen cull is NOT a constant margin.** The original culls
   at `camerax() - sprite_width / 2`, and `sprite_width` is the sprite's width
   TIMES `image_xscale` — and these stars grow every frame, so the cull box
   widens as they age. The translation had 12 and 18 hardcoded, measured from
   one early frame. **That is the cause of the long-standing "star count
   diverges at f170" item**: a long-lived star was being killed about 30
   frames early.

**ORIGINAL BUG found in the same pass:** the controller sets
`d.grow_Speed = lerp(0.1, 0.25, size)` — capital S — while the star reads
`growspeed`, which its own Create fixes at 0.02. Different variables, so the
intended per-star growth variation never happens; every star in the recording
reads 0.0200.

**4. The replayed turn clock was one frame out of phase.** The recorder writes
from `obj_time`'s Draw — the END of the frame, after `obj_battlecontroller` has
decremented `turntimer`. The cone's Step ran earlier in that same frame and saw
the PREVIOUS value. Feeding frame f's value fired the attack exactly one frame
early: everything matched through 145 and the cone released at 146 instead of
147. The verifier now feeds frame f-1.

That was also hiding a plain missing import — `pointing-star.js` used `spawn`
without importing it, and nothing noticed because until the fire fired at the
right frame, no star had ever reached its burst.

**5. `with (obj_x)` ITERATES NEWEST FIRST.** The last divergence, at frame 192,
was the cone's release stagger. It does `timer = -i` over
`with (obj_knight_pointing_star)`, and that loop visits instances in REVERSE
creation order — the youngest star gets 0 and the oldest gets the largest
negative. Iterating oldest-first reverses the whole ripple, so the stars burst
in the wrong order and the population curve parts at 192. Reversed, the suite
is **exact for the entire 246-frame window**.

**A near-miss worth recording.** This looked like the general rule that
`stepOrder: -1` on the vortex sword had been standing in for — two sightings of
"newest first" ought to beat one special case. It is not. Flipping `phaseList`
in `sim/entity.js` to newest-first makes verify-flurry diverge at frame 96,
while Stars needs the flip to be exact. So `with (obj_x)` iteration order and
the Step-EVENT order are two different mechanisms, and only the former is
established. The vortex's ordering stays a per-type knob and stays unexplained.

**Stars is now fully verified at difficulty 0** — `verify-stars-full` is in
`npm run verify` (1,442 comparisons, every value exact, peak 18 stars) and the
superseded `verify-star-population` + `oracle-t9` scene are deleted.

| next | attack | why | remaining work |
|---|---|---|---|
| 1 | **`obj_knight_pointing_starchild`** | closes the Stars gap; small | resolve the speed ramp above, then translate the con-0 drift only |
| 2 | **roaring** (type 107) | the finale, phase 4 | the biggest object in the fight; star is a sibling of a translated one |
| 3 | sword tunnel FINALE + swept hit test | deferred from ac 13 | needs `collision_line` vs precise mask |
| 4 | **swordfall** (chained) | combination only, one turn | 319 lines / 11 events + the `scr_lerpvar` tween system |
| 5 | **tunnel_slasher_2_revised** (chained) | combination only, one turn | 547 lines / 6 events |
| 6 | **combination** (type 105) | needs both of the above | 65 lines of dispatch |

Groundwork already done for 4-6: `obj_fallingsword` is small (86 lines, 5
events) and its motion is a single `scr_approach(speed, 18, 0.6 + speed_gain *
sign(speed))` ramp from a negative start, which is why the swords rise before
they fall. The blocker is `scr_lerpvar` / `scr_script_delayed`, a general
tween system the swordfall pose leans on heavily; translating it once unlocks
several attacks. Ground truth is recorded at `traces/combination.csv`.

Total remaining attack logic is roughly 3,000 lines across ~40 events, and a
large share of that is Draw code with no frame-state effect.

## Known gaps, stated honestly

- **`ds_list_shuffle` unsolved.** Consumes exactly 16 draws per element (one
  WELL512 state pass), seed-independent, but the algorithm resisted a
  structured search. Attacks using it replay recorded orders; the real game
  reshuffles per playthrough so order is not a fidelity property.
- **rotatingslash `return` state** untranslated (attack wind-down).
- **The playable build is a SANDBOX**, labelled as such in the HUD. It shows
  the box splitter, which the fight does use — but the schedule is not the real
  phase order. The real order is in CLAUDE.md → THE REAL FIGHT.
- **Starchildren, particles, sounds, screen shake** — none translated. All
  cosmetic except starchildren, which are real bullets.
- **T3's grow-in window** (frames 0–3) excluded from soul verification; the
  model matches under `timer=row` alignment but the grow animation is not
  modelled in `sim/battlebox.js`.

## Where things live

```
~/knight-sim/          the browser sim (public-facing)
  sim/                 pure logic — no DOM, no filesystem, runs under Node
  render/ input/ web/  browser layer
  tools/               trace runner, differ, verify-*.mjs, scenes/
  assets/sprites/      96 sprites, 271 frames, from the player's own data file
  docs/                this file + ORACLE-RECIPE.md

~/knight-research/     PRIVATE — never publish
  oracle/              pristine copy of DELTARUNE.app        [gitignored]
  oracle-instrumented/ the patched copy runs are made from   [gitignored]
  gml_dump/            7,603 decompiled .gml files           [gitignored]
  traces/              recorded oracle CSVs
  tools/patches/       the .csx oracle patches
  tools/run-oracle.sh  launch + collect helper

~/tools/node/          Node 24 tarball — NOT on PATH
~/tools/utmt-cli/      UndertaleModCli (Intel, runs under Rosetta)
```

## Stars — Draw events ported (visuals)

`render/draw/pointing-cone.js`, `pointing-star.js`, `pointing-starchild.js`,
with the shared GML primitives in `render/draw/gm.js` (`merge_color`,
`scr_draw_beam_color`, `scr_draw_outline`, `draw_sprite_ext` with GameMaker's
origin/scale/angle conventions, and a tint cache).

What is on screen now that was not before:

- the cone's purple backdrop — the wedge fill was silently dropping out to a
  bowtie winding, see CLAUDE.md "Porting a Draw event: four traps"
- the scrolling flow layers, additive over the wedge, with the soul punched out
- the star surface and its `spr_knight_line_grate` scanlines
- the star colour ramp grey -> red, the pulsing glow, and the beam telegraph
  (three-spike at difficulty 0/1, six rotating spikes at difficulty 2)
- the starchild glow outline, its flip colours, and the explosion at con 4
- the knight drawn UNDER his own attack, where `draw_self()` actually sits

Sim changes that came out of reading those events, both from Draw-event code:

- `image_blend` / `outline` on the starchild, driven from its Step's flip
- the starchild's fade-and-destroy at difficulty 0/1 (endStep). **Unverified** —
  no suite covers it; see CLAUDE.md.

All 23 suites green.

### Still to port (task #16)

`obj_knight_roaring2`'s Draw (282 lines: surfaces, beams, per-scanline sine
wobble), the vortex, the knight's remaining pose swaps and whiteflash, the box
shimmer.

## Roaring — Draw event ported (visuals)

`render/draw/roaring.js`, the largest Draw event in the fight (282 lines, four
surfaces). On screen now:

- the vortex: tiled `spr_knight_bullet_flow` drawn 5x, MULTIPLIED by six
  concentric rings whose radii sweep through `ball_counter`
- the per-scanline wobble and HSV tint of that vortex on `my_surface`
- the star surface: particles, roaring stars (split halves, beams, colour ramp),
  starchildren, afterimages, with the scanline grate darkened over the middle
- the knight himself, drawn one row at a time with a sine displacement scaled by
  `intensify`, doubled and thrown ±8px per alternate row above intensify 1.5
- `darkness` fading the whole composite up over 32 frames from Create+20
- the pre-cut marker from roaring_timer 275, reddening as r/g/b ramp

New sim state, all of it read (and most advanced) by that Draw event:
`darkness`, `star_flicker`, `intensify`, `line_timer`, `r/g/b`, `bobble_*`,
`ball_counter`, `hsv`, `hsv_switch`, `stop`, `do_fake_screen`. The four
per-frame counters advance in `endStep`, so a headless run produces the same
numbers a browser does.

Also added: the roaring_timer 275 wind-up branch (slash pose, marker start,
colour ramp, bobble flattening), which the sim did not have.

**`spr_roaringknight_front` was missing from `assets/sprites/` entirely** — the
knight was falling back to a collision mask for the whole roar. See CLAUDE.md,
"Asset ids are LIST INDICES".

All 23 suites green.

### Not ported

`do_fake_screen` at roaring_timer 299 — the finale that snapshots the surface
into two sprites and flings them apart as the screen is cut in half. Needs
`sprite_create_from_surface` plus the marker/lerpvar machinery. `stop` is never
set, so the roar plays to its end instead of freezing on the cut.

## The rest of the fight's Draw events

A survey of every object the sim models against its Draw event in the dump
turned up eight unported; `obj_sword_vortex`, `obj_knight_swordtunnelanim` and
the diagonal-bullet pair are one line each (`draw_self()`), and
`obj_knight_split_growtangle` was already covered by render/splitbox.js. The
rest are done:

- **obj_roaringknight_slash** (render/draw/slash.js) — the TAPERING WEDGE. A
  640px triangle whose apex retreats with `image_alpha` and whose colour
  bleaches red -> white as it fades, at `image_alpha * 2`. This closes the last
  of the "known visual gaps" in CLAUDE.md; it had been drawn as a plain line.
  Rotating slash throws a fan of these every cycle in every phase.
- **obj_sword_tunnel_sword** (render/draw/swords.js) — the red laser telegraph
  (`telegraphalpha` easing 0 <-> 0.5) and the ten-copy motion trail from
  `xprevious`. Plus the proximity tell: the Step turns a sword RED inside the
  160x160 box around the soul and the Draw ramps it back to white over 10
  frames.
- **obj_tracking_sword1** — the 40-copy launch streak, and the white
  `d3d_set_fog` flash at con 2.
- **obj_tracking_swords_manager** — the slash flashes composited additively
  into a 150x150 surface pinned to the arena, so they glow where they overlap
  and are clipped to the box. `obj_tracking_sword_slash` has no sprite draw of
  its own and reaches the screen only through this.
- **obj_roaringknight_splitslash**'s `playerstrike` overlay — on a Flurry cut
  the soul's `image_alpha` goes to 0 and the slash redraws it jittered with
  `spr_rk_slash_heartslice` over it, the frame chosen by WHERE the cut crossed
  the soul (`cuty`, from Other_15).

Engine change: **`xprevious` / `yprevious`** are now latched at the top of every
frame, as GameMaker does. The corridor's trail needs them; without them a sword
draws ten stacked copies of itself instead of a streak.

All 23 suites green.

## Five reported visual bugs, all verified against the dump and fixed

1. **The arena is green.** `obj_growtangle` Create: `merge_color(c_green,
   c_lime, 0.5)`, applied to both layers of its two-layer Draw. Needed two fixes
   in the renderer first — see CLAUDE.md, "`draw_sprite_ext`'s colour
   MULTIPLIES".
2. **Rotating slash was white; it is black over red.** The aim markers are a
   `make_color_rgb(r, g, b)` gradient with a flat BLACK `spr_rk_quickslash_marker`
   over it. `r/g/b` reset to 128 at the top of every aim and `scr_approach`
   toward (255,0,0) at 64/7 a frame. The port computed the tint and then never
   applied it. Also added: the `line2`/`line3` rails, the knight's aim bob, and
   the fact that the whole surface — including a second copy of every slash
   wedge — is CLIPPED TO THE BOX.
3. **Tracking swords redden before firing.** `image_blend =
   merge_color(c_white, c_red, timer / 30)` through con 1, plus one
   `scr_afterimage_grow()` on lock-on (new: `obj_afterimage_grow` in sim/fx.js).
   The slash flash was already clipped to the board via the manager's surface.
4. **Flurry's box effect.** `obj_knight_split_growtangle_effect`, ten frames:
   the box's halves peeling apart at 4/6/8x the timer, a SNAPSHOT OF THE WHOLE
   SCREEN redrawn as two halves sliding apart by `timer * 8`, and two white
   flash bars along the cut. sim/fx.js + render/draw/splitcut.js.
5. **The tunnel was missing its wake.** Each sword spawns an `scr_afterimage()`
   every frame at the MIDPOINT of its move (`(x + xprevious) / 2`), alpha 0.4,
   forced white once `con > 0` — separate from the ten-copy trail its Draw
   stacks. Both are there now.

All 23 suites green.

## Roaring's finale, and the sword tunnel's

**ROARING — `do_fake_screen`, roaring_timer 299 (task #16 closed).** The knight
lands the diagonal and the SCREEN ITSELF is cut. The composite is photographed,
then `sprite_create_from_surface` twice over it — each pass erasing the other
side with `gpu_set_blendenable(false)` and an alpha-0 fill, which writes zero
alpha rather than blending. The cut runs from (200, 0) to (440, 480), which is
the same -63 degree line the `line_timer` marker has been telegraphing since
roaring_timer 275: the warning and the cut are one geometry.

The two halves go to `scr_marker`s at (160,240) and (480,240) — the origins the
sprites were created with, so each starts exactly where it was — moving apart at
speed lerped 15/14 -> 0.5 over 12 frames, then `gravity = 1` along the SAME
direction they are already travelling, so they slow almost to a stop and then
accelerate away. `obj_heart` is destroyed with them.

`sim/fx.js` `screenPiece` + `render/draw/roaring.js` `takeScreenCut`. The
renderer keys its snapshot off `do_fake_screen`, not `stop`, because the sim
sets `stop` in the same endStep that arms the finale — keying off `stop` would
skip the very frame that needs photographing.

Between-turn cleanup now respawns the soul (`clearTurn`), which is stand-in
machinery: in the real game this is the end of the fight.

**SWORD TUNNEL — the finale, all difficulties (task #10 closed).** At
`finishtimer == finishtimermax` the manager flips itself and every live sword to
con 1, and with `c = 10`:

```
timer 1      gravity off, TELEGRAPH ON
timer < 15   turn onto the soul, anglespeed easing 8 -> 0, aimed at
             (heart + 10 + randx/randy) so each sword picks its own point
timer < 20   brake toward 0
timer 21-24  back up at speed 2 — the wind-up
timer 25-29  dead stop
timer 30     a growing flare, then SPEED 80 along image_angle
```

Each dashing sword lays one `obj_sword_tunnel_hitbox` when it first comes within
80px of the soul: 999 x 0.4 at its heading, damage 160, active for a single
frame. It REPLACES the swept probe (`else if` in the original), and it swaps the
soul to `spr_dodgeheart_smallmask` — an 8x8 square against the heart shape's
16x16 — which is what makes a wall of screen-wide bars survivable.

New: `scrAnglechange` (sim/gml.js), `HEART_SMALL_MASK` (sim/masks.js, real mask
data), `swordTunnelHitbox`, `afterimageGrow`.

`node tools/verify-tunnel-finale.mjs` asserts the path RUNS at difficulties 0, 3
and 4 — con 1 reached, `_speed == 80` reached 29 frames later, hitboxes actually
created, the mask actually swapped, and `finishtimermax` correct. A finale that
never triggers looks exactly like one that triggers and does nothing.

All 24 suites green.

## Roaring's burst arc — VERIFIED (task #15 closed)

`verify-roaring-pull` now runs the whole recording, 150..698 (was 150..678):

```
→ 100 rings / 292 stars, every ring frame and count exact (150..698)
→ star population exact 150..698, positions within 6.22e-3 px to 698
→ 16 stars released, 16 completed the full burst arc
```

The f679 divergence was ONE FRAME in the release, caused by step order — see
CLAUDE.md, "A SPAWNED OBJECT STEPS BEFORE THE MANAGER THAT SPAWNED IT". Fixed
with `stepOrder: -1` on obj_knight_roaring_star. New positive assertion: at
least 15 stars must reach con 3, so a release that fires and then stalls fails.

## Four reported issues, verified and fixed

1. **Flurry's manager had no trail.** Its Draw spawns an afterimage every four
   frames at 0.6 alpha, fading over fifty, drifting horizontally away from the
   arena — which is what turns his side-to-side teleports between cuts into a
   figure that moves. sim/attacks/boxsplitter-attack.js endStep.
2. **The split box turned white.** `obj_knight_split_growtangle`'s Create copies
   `obj_growtangle.image_blend` and every `draw_surface_ext` of a half passes
   it, so the cut box keeps the arena's green. Also fixed a latent bug in
   `tinted()`: it cached on `img.src`, which is undefined for the CANVASES the
   split halves are, so every frame after the first would have got the first
   frame's picture back.
3. **The knight vanished from Roaring's last frame.** The `do_fake_screen`
   branch repeats the whole scanline loop, but to the MAIN CANVAS rather than
   into `my_surface` — he is drawn over the composite at full brightness, in the
   slash pose, and then photographed. Skipping it left him out of both halves of
   the cut screen.
4. See task #15 above.

All 24 suites green.

## The split board's shear, the knight's leap, and the wheel

**The split box is GOOPY, and that is a feedback loop.** Every frame the arena
is apart, obj_knight_split_growtangle rebuilds `source_surf` out of its own two
halves — each shoved along the cut normal by `choose(-2, -1, 1, 2)` — and paints
a dark seam down the middle with `bm_dest_alpha, bm_zero`. The halves are then
re-cut from that same surface next frame. The picture is fed through itself,
sheared a couple of pixels each way, every frame: the border smears and crawls
along the cut instead of sitting still. render/splitbox.js `shearSource`.

`source` is rebuilt whenever a NEW organism appears — the original creates the
surface per instance and the shear degrades it permanently, so a renderer that
builds it once would carry one Flurry's smear into the next.

**Roaring's knight leaps over the wreckage.** At roaring_timer 299, alongside
`do_fake_screen`, he dips 40px over 16 frames easing out and is then thrown
**360px up** over 24 more, easing in, with `scr_afterimagefast` (fadeSpeed 0.08)
laying a ghost every frame. `draw_self()` sits ABOVE the `if (stop) exit;`, so he
keeps drawing after the finale has frozen everything else — arcing off the top
of the screen while the two halves fall apart behind him. At 363 he lands on the
knight's own position and warps in (`spr_knight_warp`, image_index 5 -> 8).

**Task #8 closed** — `verify-tracking-wheel.mjs`, and it found a real bug in the
engine: `direction` was not normalised to [0, 360). See CLAUDE.md.

All 25 suites green.

## Two Draw-port bugs, both reported from play

- **Flurry's split "looked seriously wrong"** — the shear was running every
  frame instead of once per split. `update_box` gates the whole re-composite and
  is only re-armed at `distance == 0`. Fixed, plus the follow-on bug where the
  box vanished under `?frames=` because the renderer had never seen a
  zero-distance frame. See CLAUDE.md.
- **The knight was baked into Roaring's cut screen** — the halves are built from
  `my_surface` + the soul, not from the application surface. His scanline rows
  go to the main canvas outside that snapshot, on purpose, so he stays whole and
  leaps over the wreckage.

Also wired: `resetScreenCut()` when the roaring controller disappears, so a
second run of the attack photographs itself rather than flinging the first run's
picture apart.

All 25 suites green.

## Sound — task #7 closed

19 cues across all eight attacks; every one traced to the GML line that plays it.
Previously six cues existed and six of the eight attacks were silent.

| attack | cues |
|---|---|
| Stars | drawpower x3, star_explosion_close x3, rocket_long, explosion_firework |
| Tracking Swords | jump_quick, cut2 |
| Flurry | boxbreak, chargeshot_fire (x2 when delayed by a hit), locker, wideslash_low |
| Sword Tunnel | heavy_passing, jump, cut |
| Rotating Slash | rotatingslash_line (LOOPED), cut, explosion_firework, puff, teleport |
| Sword Vortex | jump_quick, cut2 |
| ROARING | stretch, roar, stardrop, explosion_firework, cut |

New: `cueLoop`/`cueStop` for `snd_loop`, and `cueIfIdle` for
`if (!audio_is_playing(x))` with holds measured from the samples. `render/audio.js`
rewritten on Web Audio — see CLAUDE.md for why `cloneNode()` was wrong.

`tools/install-audio.sh` + `knight-research/tools/patches/extract_audio.csx`
extract and index a local copy. Still gitignored, still silent by default.

`node tools/verify-audio.mjs` asserts every attack is audible and none stacks —
no oracle (the recordings have no audio column), so it checks those two
properties and says so.

All 26 suites green.

## Audio follow-ups

- **Preload.** Lazy decode meant the first cue of every sound was dropped:
  Stars was almost entirely silent (it fires most cues once per run) and Flurry
  and rotating slash sounded late (first hit dropped, a later one played). All
  19 now decode on load — `window.__audio.loaded.length` reaches 19, `.missing`
  empty.
- **`snd_play_x` is (name, GAIN, pitch).** The splitslash cue was passing the
  pitch and dropping the 0.8 gain. Its two `snd_stop` calls were missing too,
  which matters at Flurry's cut rate — the sample is longer than the gap.

Checked and found CORRECT while looking for a third Flurry problem: all four of
its cues fire on the right frame (boxbreak one frame before the box parts,
locker exactly on close, wideslash on the slash), and the DOUBLED
`chargeshot_fire` on some cuts is faithful — `split_delay > 0` means the cut was
delayed by a hit, and the second report is the game's tell for it.

All 26 suites green.

## Flurry's burning cut faces

The effect in the gap between the two halves is two `obj_marker`s carrying
`spr_rk_split_flame_big` — created in obj_knight_split_growtangle's **Create**,
at double scale, facing opposite ways (image_angle 180 and 0), animating at
image_speed 0.5, tinted `c_gray`.

Its Step re-places them on the two cut faces every frame, so they stay pinned to
the severed edges however far apart the halves travel — with a different angle
and offset triple for each of the three cut orientations (diagonal, vertical,
horizontal). The offsets are asymmetric in the original (-1 on one side, +3 on
the other) and are kept that way.

**Why it was missed:** every other Flurry visual lives in a Draw event, and this
one does not — it is instance creation in Create plus positioning in Step, so a
pass that reads Draw events finds nothing. `spr_rk_split_flame_edge` (which WAS
ported) is the small flame the Draw event puts on the outer edges; this is the
big one burning across the gap.

Depth is `organism.depth + 10`, so it draws behind the teeth — the renderer
already sorts deeper-first (render/canvas.js), so that came out right.

All 26 suites green.

## The battle menu — first increment

`sim/menu.js` (state) + `render/menu.js` (the drawing), from `scr_charbox` and
obj_battlecontroller. Every coordinate is out of the dump:

```
bp = bpy = 152            -> the panel row sits at 480 - 152 = 328
bpoff = -bp + bpy + yy    == yy, the camera's y
b_offset = 430            while global.fighting == 0 (menu AND bullet phases)
xchunk   = 0 / 213 / 426  for chartotal == 3;  panels are 212 wide
buttons  = x + 15/50/85/120/155, at y 485 - bp
HP bar   = x + 128, 75 wide, filled to ceil(hp / maxhp * 75)
```

The charbox is TWO bands, not one panel: the button box at 325-361 and the
portrait/name/HP strip along the bottom at 430-449.

Ported faithfully:

- **The slide.** `mmy[c]` raising is four independent tests in sequence, so a
  panel at 0 takes all four on its first frame (-20) and then decelerates:
  0, -20, -26, -28, -30, -32. Lowering is one test, +15, three frames. Up eases,
  down snaps — that asymmetry is the original's.
- **`scr_selectionmatrix`** — the active panel's bar plus twelve phase-shifted
  pulsing verticals, two pinned to the sides and two sweeping inward while
  `cos < 0`.
- **The five buttons in the real order**, with the real per-character second
  slot: `spr_btact` for Kris, `spr_bttech` for everyone else.
- The portraits, name plates, HP labels and per-character bar colours
  (c_aqua / c_fuchsia / c_lime, GameMaker's BGR unpacked).

14 UI sprites extracted (manifest now 191). `tools/patches/extract_sprite.csx`
takes `SPR_LIST=<file>` now as well as a single `SPR_TARGET`.

**SCOPE, labelled:** dodge-only stands. The buttons are real and the turn has
its real SHAPE — each of three party members confirms, then the enemy attacks —
but choosing a button does not resolve an action. `verify-fight-order` drives
the menu (pulsing `confirm`, since it is edge-triggered) and so covers it.

### Not yet done

- HP NUMBERS and any other text: needs the game's font, which is a separate
  asset class from sprites. The bars and labels are drawn; the digits are not.
- The soul as the menu cursor. Deltarune parks obj_heart beside the selected
  button; I have not found where those coordinates come from, so rather than
  invent them the selection is shown the sourced way — the lit button frame and
  the selection matrix. The soul is frozen while the panels are up.
- `btc[]`, the button image_index array, is READ by scr_charbox and written
  nowhere in the dump. The lit button is driven from the menu's own selection.

## Damage — the practice tool now has stakes

`sim/damage.js` + `tools/verify-damage.mjs` (27 suites). Party HP is real
(160/190/140 from scr_gamestart, replacing invented placeholders), the defence
walk and ShadowMantle/DEFEND multipliers are the game's, and every one of the
eight attacks takes HP off an idle party:

```
stars 15   tracking11 69   flurry 15   tunnel 57
rotating 627   vortex 51   tracking14 66   roaring 2568      (HP lost / 600 frames)
```

Rotating slash and Roaring wipe an idle party, which is correct — standing still
in either is fatal. A wipe sets `state.gameOver`; the HUD says so and R retries.
Practice mode refills between runs (it is a drill); the full fight does not.

Two contact paths were found dealing zero — see CLAUDE.md, "Damage".

## HP numbers — the font was not a blocker

`render/text.js`. The battle UI's numbers are SPRITE FONTS
(`font_add_sprite_ext`), not font assets, so no texture page or glyph metrics
were needed — one sprite frame per character and an advance. See CLAUDE.md.

Live in the charboxes now, at the original's coordinates and with its
white/yellow/red thresholds. `spr_numbersfontsmall` extracted (manifest 192).

`FONTS.damage` (spr_numbersfontbig, proportional) is defined and unused — it is
what the damage-number popups use, which is the natural next piece now that the
mechanism exists.

## TP and grazing

`sim/tension.js`, `render/tensionbar.js`, `spr_tensionbar` extracted
(manifest 193). Grazing a bullet — a 50x50 axis-aligned box on the soul's
centre — pays `grazepoints` on entry and a thirtieth per frame after, and
subtracts `timepoints` from the turn clock. Peak TP over 600 frames of an idle
soul, out of 250:

```
stars 212   flurry 119   rotating 250   vortex 114   roaring 54   tunnel 10
```

Tracking swords read 0 because their grazes are gated out: `global.inv < 0`
means a party being hit repeatedly earns nothing, and an idle soul is hit almost
continuously by that attack. Faithful, but worth re-checking with a soul that
actually dodges.

`obj_tracking_sword1` also does not currently set `isBullet`, so the hovering
sword itself is skipped by the graze pass even when it should qualify — the
slash it spawns is the only part of that attack the box can see. Worth a look.

HUD now shows HP and TP%.

## Grazing, TP and the attacks wired together (28 suites)

Every attack now grazes, pays TP, and shortens its own turn. Peak TP out of 250
with a soul that actually moves:

```
stars 106   tracking11 50   flurry 75   tunnel 46
rotating 250   vortex 199   tracking14 54   roaring 54
```

Three fixes got them there, all of them "this attack is exempt from the graze
and nothing says so" — see CLAUDE.md, "Three ways a bullet becomes invisible to
the graze box".

Feedback, both from the dump:

- **The ring.** obj_grazebox's Draw layers `spr_grazeappear` frames 0 and 3, the
  second 0.2 dimmer, at alpha `grazetimer / 6`. The timer is 10 on entry and
  floored at 2 while a bullet stays inside, so a clean pass flashes bright and
  fades over ten frames while hugging a bullet holds a faint ring.
- **The sound.** `snd_graze`, once per frame however many bullets entered.

`verify-graze.mjs` asserts every attack is grazeable, the ring appears, and the
turn clock loses more than one per frame. Over 200 frames of the vortex, 76.9 of
the 276.9 spent came from grazing.

## Menu SFX, damage SFX, and the finished TP meter

All four battle-UI sounds are in and are modelled as the FLAGS they are — one
per frame however many things set them (CLAUDE.md): `snd_menumove` on cursor
moves and cancel, `snd_select` on confirm, `snd_graze`, `snd_damage`. 23 samples
indexed.

The TP meter is complete: casing over fill, the subtracted cutout, the marker at
the fill line, `spr_tplogo`, and the percentage in the game's own digit font.
Two documented deviations — the assembly is shifted right 30px because the
original's `x - 30` is off-screen at its instance position, and the "%" / "MAX"
glyphs need a real font asset this build has none of.

Measured over 1400 frames of the full fight with the menu driven: graze x92,
damage x24, select x12, menumove x11, alongside every attack cue.

MUSIC IS STILL OUT and stays out — CLAUDE.md's asset stance. These are all SFX.

## Items — data and effects (29 suites)

`sim/items.js` + `tools/verify-items.mjs`. The twelve slots are the specified
loadout: 1 SpinCake, 1 ExecBuffet, 6 ReviveMints, 1 ReviveDust, 1 TensionMax,
and DeluxeDinners filling the remaining 2.

Effects at the **chapter 3** values from `scr_itemuse`:

| id | item | effect |
|---|---|---|
| 7 | SpinCake | heal ALL 150 |
| 38 | ExecBuffet | heal ALL 100 |
| 39 | DeluxeDinner | heal ONE 140 |
| 2 | ReviveMint | revive one to `ceil(maxhp / 2)` |
| 30 | ReviveDust | revive ALL |
| 29 | TensionMax | fill TP |

SpinCake is the trap: one switch case carries 80 / 140 / 150 / 160 for chapters
1-4, so the wrong branch is a silent 10-point error. Healing does NOT touch a
downed character — reviving is a separate kind, which is why the bag wants six
mints rather than six more dinners.

TensionMax and ReviveDust are the two whose `scr_itemuse` case is the OVERWORLD
branch (29 is `usable = 0` and prints "try using it in battle"; 30 heals a token
10). Their battle effects are what this fight sees.

## The ITEM menu UI

ITEM on the button row opens the bag as a SUBMENU over the same panel
(`global.bmenuno` in the original) rather than ending the character's turn.
Two-column navigation, cancel backs out to the row rather than to the previous
character, and using an item IS that character's action — the turn moves on.

An item that can do nothing right now (a ReviveMint with nobody down) refuses
with `snd_error` and is not consumed. `usableSlots` greys those out.

Item NAMES need a real font asset this build has no glyphs for, so each slot is
a colour-coded chip rather than faked typography; the slot count uses the game's
digit font.

Driven end to end headlessly: right, right, confirm, confirm from a hurt party
heals 340 with the SpinCake, drops the bag to 11 and advances to the second
character.

### STILL NOT DONE

- **FIGHT — the attack bar.** Started and stopped: `obj_attackpress` looked like
  the object (it has `linex = -10`, `linespeed = 2`), but **`linex` is written
  in its Create and read nowhere in the dump** — another write-only variable in
  the pattern CLAUDE.md already documents. The real bar mechanism is somewhere
  else and needs a proper hunt, not a guess. Nothing was built on the wrong
  assumption.
- **ACT / Hold Breath**, and **Rude Buster** and the other TP spells. TP is
  earned and the spend formula is known (`scr_spellconsumeb`:
  `tension -= floor(floor(cost / maxtension * 100) * 2.5)`), but no spell is
  wired and the knight has no HP to damage.

## SWOON status, DEFEND TP, item grid — and the fight bar's second dead end

**Status is DERIVED, not stored.** `statusOf(state, i)` returns UP / DOWN /
SWOON from HP alone: above zero is UP, at or below -999 is SWOON, anything
between is DOWN. Storing it invites HP and status disagreeing; the split comes
straight from `scr_damage`'s this-fight-only death branch (Kris to
`round(-maxhp/2)`, the others to -999). The COMMAND phase skips the fallen —
verified: with Kris DOWN and Susie SWOONed the menu opens on Ralsei.

**DEFEND grants +40 TP the instant it is chosen**, not when the turn resolves,
so a later party member can spend what an earlier one's DEFEND just banked.
Verified 0 -> 40.

**The item list is 2 columns x 6 rows and WRAPS** on both axes; ITEM greys out
(snd_error) on an empty bag.

### THE FIGHT BAR — stopped twice, deliberately

`obj_attackpress` is the object and its shape is clear: `spr_attackspot` bolts
sweep in against a moving `boltx`, and when one passes unpressed `event_user(1)`
hands `points[i]` — the accuracy — to the hero instance, which resolves the
attack. But:

- `linex` / `linespeed` are set in Create and **read nowhere in the dump**.
- `points[0..2]` are set to 0 in Create and **assigned nowhere else**.

Both are the write-only pattern CLAUDE.md already documents. The press site and
the accuracy formula are somewhere the obvious greps do not reach — possibly
lost to the decompiler, possibly in an event I have not enumerated. Building a
timing minigame on either variable would produce something that looks right and
matches nothing, so nothing was built.

**Next step for this, concretely:** enumerate obj_attackpress's and
obj_heroparent's FULL event lists (`ls gml_Object_obj_heroparent_*`) rather than
grepping for names, and find who reads `boltx` at press time. That is the
approach that cracked the sprite-id problem, and it is a first move rather than
a search.

## The FIGHT bar — found (30 suites)

`sim/fightbar.js` + `tools/verify-fightbar.mjs`. Event enumeration found it; see
CLAUDE.md for the two dead ends, one of which was my own bad grep scope.

Accuracy 150 / 120 / 110 / `100 - 2*close`, window `close in (-5, 15)`, bolts at
8px a frame. A critical is 15 TP, which cross-checks against the known value.

STILL TO WIRE: the bar is a module with no caller — FIGHT on the button row does
not open it yet, and there is no knight HP to damage. Those two go together with
the ×0.5 / ×2-per-SWOON outgoing multiplier and `meleeMult` 0.20→0.35.

## FIGHT wired to the Knight (30 suites)

`sim/knight.js`. From `scr_monstersetup`'s `monstertype == 104`, confirmed in
the dump: **HP 7300, AT 40, DF 0** — and its ACT index 1 is literally named
`HoldBreath`. The turn loop is now COMMAND -> the bar -> the enemy's attack.

Working end to end: FIGHT on the button row arms one bolt per member who chose
it, the bar resolves before the Knight attacks, accuracy becomes damage and
`accuracy / 10` TP, and `meleeMult` ticks +0.01 a turn. A timed run took the
Knight 7300 -> 7247 and banked 31 TP.

The multipliers, measured: **x0.5 all up, x1.0 with one SWOONed, x2.0 with
both** — a losing party hits twice as hard, which is the fight's central
tension.

**A bug the wiring exposed:** presses are EDGE-triggered (`button1_p()`), and I
had a once-per-bar latch. The first press always lands while the bolts are 30
frames out, so the latch consumed it and nothing could ever score. Now covered
by a held-button case in verify-fightbar.

**PROVENANCE:** 7300 / 40 / 0 are the dump's. The x0.5, x2-per-SWOON, 0.20->0.35
melee ramp and Rude Buster's `(melee + 0.65) / 2` are the handoff spec's and are
NOT dump-confirmed — I did not find where they are applied. Marked in
sim/knight.js so a later pass knows what still needs grounding.

## The FIGHT bar is on screen, and the item menu is real (32 suites)

The two things asked for: the bar could not be seen because **it had no
renderer at all** — it was simulated and drawn nowhere — and the item menu was
a placeholder.

**Extracted for this:** `spr_pressfront`, `spr_pressfront_b`, `spr_pressspot`,
`spr_attackspot`, `spr_heart`, `spr_morearrow`, and — new — the **font asset
`fnt_mainbig`**, via a new `extract_font.csx`. Item names are drawn with the
game's own font now instead of coloured chips.

**Reading obj_attackpress's Draw corrected the sim as well as supplying the
renderer.** The schedule is RANDOM (`my_method == 1`), not `30 + i * gap`; the
first bolt lands on frame **29**, not 30, because `boltxoff += lastbolt` runs
before the frame is set and `lastbolt` starts at -1; bolts go to random
characters, not party order; and the DEFAULT input is **one button** scanning
every row, with a dualbolt case for two bolts on the same frame.

**And reading obj_heroparent's Step settled the multipliers, which had been
carried as spec-sourced.** Two were wrong:

- The x0.5 / x1 / x2 SWOON scaling is **Kris only** — the block sits inside
  `object_index == obj_herokris`. Party-wide, it roughly doubled everyone's
  output, since the healthy branch halves.
- Rude Buster is `x(damagereduction + 0.65)` with **no `/ 2`**. Spells are
  worth twice what was credited.

`damagereduction` also has two values outside the 0.2->0.35 ramp: an **0.04**
opening and a **0.4** phase-4 spike.

New suites: `verify-knight` (the damage formulas, hand-computed from the GML)
and `verify-itemmenu` (the 2x6 grid, pages, clamped cursor, the names).

**A self-inflicted one worth recording:** `pack-sprites.mjs` rebuilds from
scratch, and running it with a two-name list to ADD two sprites **deleted 745
PNGs**. Every suite stayed green — sim/ does not read sprites — and the PNGs
are gitignored, so there was no checkout back. Recovered by re-deriving the
name list from the code. The script now refuses to shrink the pack by more
than half without `--replace`.

**Still open:** ACT/HoldBreath, a MAGIC menu to call `spellDamage`, the
single-target selector, the Knight's "???" HP display, the phase-4 gate, and
the ReviveMint -999 path.

## TP readout, MAGIC, ACT, cancel, and real item consumption (33 suites)

**The TP number** is drawn with `fnt_mainbig` now, laid out as the original
does it: the "%" sits UNDER the number at (x-25, y+95), and MAX is three
letters at y+70/90/110 each 4px further right than the last, so the word leans
down-right. Also modelled: `maxed` is assigned at the BOTTOM of the Draw and
read near the TOP, so the bar's yellow-orange fill lags the MAX text by exactly
one frame — and it is derived from the floored percentage, not from
`tension >= maxtension`, so 249/250 is not yet "maxed".

**ACT and MAGIC did nothing because of a type error.** `BUTTONS[1].name` is a
FUNCTION — that slot is ACT for Kris and MAGIC for the others — and the menu
compared it to a string. `chosen === 'ACT'` was comparing against a Function
object, so it was never true and the button fell through every branch: no
list, no error sound, no turn advance. Nothing looked broken.

Both lists are live now, from `scr_gamestart` and `scr_monstersetup`:

    Kris    ACT: Check, HoldBreath        (spell[1][0] = 7 IS "ACT")
    Susie   Rude Buster 125, UltraHeal 225
    Ralsei  Pacify 40, Heal Prayer 80

Costs are raw TP out of 250 and display as percentages under the description
(`floor(cost / maxtension * 100) + "% TP"`, c_orange at 496, 440) — once, for
the selected spell, NOT per row. Unaffordable spells are shown in **c_gray**,
not hidden and not alpha-faded.

**HoldBreath works exactly once.** `holdbreathcount++` is followed by
`holdbreathcount = 1`, so the second use prints "Nothing happened". It takes
the soul from 4 to 5, and to 6 while Roaring is on screen — reassigned every
frame from the knight's Step, which is why the Roaring bump comes and goes.

**Items and cancel share one mechanism: `tempitem`.** A 12x3 per-character
snapshot of the bag. Choosing an item removes it from THAT character's list;
`scr_nexthero` copies the list forward; `scr_prevhero` restores it from the
previous character — UNDOING the spend — and `scr_endturn` commits to
`global.item`. Cancel was a bare `charturn -= 1`, so an item spent by
character 2 stayed spent and DEFEND's 40 TP could be re-banked once per cancel.
`global.temptension[]` does the same for TP.

Cancel is also a STACK, one step per press: from the target picker back to the
list, from the list to the button row (`bmenuno = 0`), from the row to the
previous character. Only the last calls scr_prevhero.

**The target picker** appears for `spelltarget == 1` and single-target items,
and it offers the FALLEN — a DeluxeDinner on a SWOONed ally is the whole reason
to carry single-target heals, since scr_heal adds to the negative number.

New suite: `verify-spells`. `verify-itemmenu` grew the cancel/undo cases.

## Party animation, the Knight's reaction, the fountain, and a bare arena (34)

**obj_heroparent is one state machine shared by all three**, parameterised by
the sprite set its Create picks — `sim/heroes.js`. Two fields drive it:
`state` (what they are DOING) and `faceaction` (what they are ABOUT to do).

`faceaction` is the one that matters and the easy one to miss: it does nothing
until state 0 READS it, so choosing ITEM does not animate anything — it makes
the character hold the item out and WAIT, through everyone else's turn. The
build had three characters standing in neutral for the whole command phase.

Everything advances at **0.5 a frame** — the battle is 30fps, the party
animates at 15. The idle bob is `siner / 5`. ACT has TWO clamps: the pose stops
at `actframes` (7) but the state runs to `actreturnframes` (10), so there is a
hold at the top of the swing.

The party actor used to free-run a 0.2/frame idle, with a comment saying the
real source "is not worth translating for a cosmetic actor". 0.2 IS `siner / 5`
— and the same machine picks the other six poses, which a free-running index
can never do.

**A bug the switch exposed:** GameMaker wraps `image_index` at the frame count.
`siner / 5` grows without bound (80 after a few seconds) and the engine's own
wrap is what loops a 6-frame idle. With `image_speed = 0` nothing wrapped it,
so every pose ran off the end of its sprite.

**The Knight reacts to being hit.** From `scr_damage_enemy`: `shakex = 9`,
`hurttimer = 30`, and — only at **damage >= 100** — `stronghurtanim`, which
strobes him between his idle and `spr_roaringknight_ball_transition` FRAME 7
every other frame. Below 100 there is no strobe at all, because the Draw's test
reads `|| stronghurtanim == false` and takes the plain-idle branch. The shake
alternates sign as it decays; a monotonic decay reads as drifting.

Two corrections while reading it: the `hurttimer = 999` block is the END
CUTSCENE, not an ordinary hit, and `scr_damage_enemy` plays no sound of its own
— the strike sound belongs to `obj_basicattack`, which this build does not
spawn, so none is invented.

**The background is `obj_bgfountaintest`** — `obj_knight_enemy`'s Create
destroys `obj_battleback` and puts it there. It is not wallpaper:

    battleprog = 1 - (((monsterhp - maxhp * 0.8) / maxhp) * 5)

0 at full HP, exactly **1 at 5840**, and it scales the fountain's alpha and
doubles its scroll speed past 0.65. **The background is the fight's health
bar** — and it independently confirms the phase-4 gate, which had been a spec
number with no dump source. Phase 4 now opens on HP rather than a turn count.

**The arena only exists during the bullet phase.** Alarm 11 destroys
`obj_heart` and `obj_growtangle` together and the Knight's Step recreates the
board per attack. During the command phase there is nothing between the party
and the Knight; this build kept the box and soul on screen the whole time.

**FIGHT opens the ENEMY ROW first** (`bmenuno == 1`), which is where the
Knight's HP lives: the lime bar tracks `hp / maxhp` honestly while the number
is a literal `"???"`. You can watch it move and never be told by how much.

New suite: `verify-animation`.

### Two process notes

**`http.server` caching defeated three separate fixes.** A new tab was not
enough and neither was alternating origins — the responses themselves are
cacheable and the browser kept serving old modules. `python3 tools/devserver.py
8178` (no-store) fixed it instantly. CLAUDE.md already said this; I re-learned
it the slow way.

**A DRAW_EVENTS override must return `true`.** Returning `undefined` to skip
drawing falls through to the GENERIC BLIT, so hiding the board via an early
`return` drew it anyway. The soul needed a separate fix — it has its own draw
path outside the table.

## Seven fixes: X to cancel, real turn buffers, the board's grow-in, the ending

**X now cancels.** `KeyX` was bound to `focus` only. In the game X is ONE
BUTTON WITH TWO JOBS — `button2_h()` is the slow modifier in obj_heart's Step
and `button2_p()` is cancel in obj_battlecontroller's. They never collide,
because the menu is closed during the bullet phase and the soul is frozen while
it is open. The keymap now maps one key to several actions.

**The turn buffers are sourced now.** `TURN_GAP = 45` was invented. The real
sequence has three parts, all in the dump:

    rtimer == 12          the arena is up and EMPTY before the attack spawns
    timermax == 50        obj_attackpress holds after the last bolt resolves
    fadeamt += 0.08       13 more frames of black fade before it destroys itself

**The board GROWS IN rather than blinking on.** `obj_growtangle`'s Step already
modelled it (`growcon 1`, `timer` 0->15, scale and a 180-degree spin derived
from `timer / maxtimer`) and only scene-build used it. `openArena` is now split
out of `launchAttack` and runs at the top of the rtimer window, because those
happen at different times in the original: the knight's Step creates the board
under `mnfight == 1.5` and the attack spawns 12 frames later under
`mnfight == 2`. Doing both at launch put the board and the bullets on the same
frame; doing the grow twice restarted it halfway and it stuttered.

**THE FIGHT HAS AN ENDING**, from obj_knight_enemy's Draw:

    if (haveusedroaring == true && end_cutscene_version == 0
        && global.monsterhp[myself] <= (global.monstermaxhp[myself] * 0.8))

BOTH conditions, neither alone. `end_cutscene_version > 0` then makes
obj_battlecontroller's Draw, obj_tensionbar's and obj_attackpress's all `exit`
on their first line — the entire battle UI disappears at once. That is what the
menu vanishing during Roaring actually is.

**5840 now appears in three independent places**: the phase-4 gate, the
background's `battleprog` reaching exactly 1, and this. It is the fight's one
real number.

**Animations that were never wired:** FIGHT's attack swing (`event_user(1)` ->
hero state 1) and the party's hurt flinch (`hurt` gates every other state in
obj_heroparent, and nothing was setting it — the party took damage with no
visible reaction). Rude Buster and item use already worked.

### Three bugs found while wiring it

**`if (e.bar && !e.bar.done)` skipped its own cleanup.** The moment the last
bolt cleared, the guard went false and the whole block — including `e.bar =
null` — stopped running. A finished bar stayed on screen for the rest of the
fight while the turn carried on behind it. It needs `if (e.bar)` with the
step-and-return nested inside.

**The scoring loop ran on every frame of the hold**, so the Knight took the
same hit 63 times. `attacked[i]` latches in obj_attackpress for exactly this
reason; `e.barScored` is the equivalent.

**A `python3 str.replace` that does not match fails SILENTLY.** The rtimer
decrement never landed because an earlier edit had already changed the anchor
text. `grep` after every scripted edit, not just `node --check` — the file
parses fine either way.

## Damage numbers and impacts (35 suites)

The feedback for a FIGHT hit, and it matters more here than in any other fight
because the Knight's HP reads "???" — the number that pops off him is the only
way to know whether a bar was worth anything.

**obj_dmgwriter.** Created at `(monstery + 20) - (hittarget * 20)`, so three
characters hitting in one turn stack their numbers 20px apart GOING UP rather
than overlapping. Then:

    delay 8            nothing happens — the number lands AFTER the swing
    vspeed = -5 - random(2), hspeed = 10    thrown up and to the right
    hspeed decays 1/frame                   the arc straightens
    two bounces, each half the last         then it sticks
    killtimer > 35     kill += 0.08, y -= 4 — rises and fades over 13 frames

**The squash is the whole look.** `draw_text_transformed(x + 30, y, msg,
2 - stretch, stretch + kill, 0)` with `stretch` starting at **0.2** and rising
0.4 a frame: the scale runs (1.8, 0.2) -> (1.4, 0.6) -> (1.0, 1.0). A wide flat
smear snapping to square in three frames. And `kill` is in the Y SCALE as well
as the alpha, so it stretches vertically as it goes.

`fa_right` pins the right edge, so a 3-digit hit grows leftward from where a
1-digit hit sits and the column stays aligned. `damage == 0` draws
`spr_battlemsg` frame 0 — the MISS graphic — not a "0".

**obj_basicattack**, the impact. Only Susie's branch plays `snd_impact` and
creates `obj_shake`; giving all three the shake makes every hit feel like hers.
A critical is the SAME art at 2.5 instead of 2, and it keeps growing 0.1 a
frame for its whole three-frame life rather than sitting still.

### A new class of invisible value: sprites set on the OBJECT

Kris gets no `sprite_index` override — only Susie, Ralsei and Noelle do — so
his impact is `obj_basicattack`'s own sprite, **assigned on the object
definition and never in any event**. It is invisible to every grep of the code
dump, exactly like the numeric asset ids CLAUDE.md already records
(`knight_sprite = 664`), but through a different hole.

`knight-research/tools/patches/object_sprite.csx` is new and reads
object -> default sprite straight off the object list. Kris's is
**`spr_attack_cut1`** — dump-confirmed, not guessed. Any object whose events
never assign a sprite needs this, and a name grep will never say so.

## Who gets hit, and why the number is white

Two things the fight does that no summary of it mentions, both from
`scr_damage`'s `global.chapter == 3 && i_ex(obj_knight_enemy)` block.

**KRIS IS NEVER THE DEFAULT TARGET.** A hit aimed at slot 0 is redirected to
Susie or Ralsei — `choose(1, 2)` when both stand, the survivor when one is
down. He only takes a hit when both allies are down.

**SOMEONE TAKES THE BRUNT.** With the ShadowMantle (armour 23) equipped a
counter runs and **two hits in every three go to the wearer**:

    damagecounter++;
    if (damagecounter < 3)  target = the mantle wearer;
    else { target = choose(0,1,2) walked past the fallen;
           if (that one is not a wearer) damagecounter = 0; }

That is what makes the mantle a TANK item rather than a flat damage cut — it
pulls fire onto the wearer, who eats it at x0.33. Measured: 20 of 30 hits.
**The sword tunnel is exempt** (`myattackchoice != 13`) and `aoedamage` skips
both rules.

The "pick a random living member" branch is a `repeat (2)` walk past the
fallen, wrapping 2 -> 0, NOT a filtered random — so a party with two down can
still land on a corpse and the hit is thrown away. Reproduced as written.

**AND DAMAGE TAKEN IS WHITE.** `dmgwriter.type = doomtype`, which is **-1** for
an ordinary hit, and obj_dmgwriter's Draw opens `draw_set_color(c_white)`
before any type branch — -1 matches none of them. The aqua/fuchsia/lime tints
are `dm.type = global.char[caster] - 1`, i.e. damage you DEAL. This build had
been colouring incoming hits by who took them, which reads as if the party were
hitting themselves. A death is `doomtype 4`: red, with the digits swapped for
the DOWN graphic.

Both covered in `verify-dmgnumbers`.

**CLAUDE.md** lost its accumulated findings at some point between sessions
(2098 lines -> 892). The sections have been restored from this file and from
the dump: the attack bar, the damage formulas, targeting, the fonts, the item
menu and `tempitem`, the turn buffers, the ending, the background, and the
animation model.
