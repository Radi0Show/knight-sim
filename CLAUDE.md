# CLAUDE.md — Knight Fight Simulator (browser)

This supersedes the previous CLAUDE.md. The GameMaker standalone plan is
cancelled. Read "What changed" before acting on anything from the old doc.

## What this is

A free, non-commercial browser practice tool for the Roaring Knight fight
(DELTARUNE Chapter 3). Spiritual successor to Bad Time Simulator: drop the player
into the bullet patterns, instant restart, no story.

Reference build for all behavior: v1.03 post-nerf.

## What changed and why

- Target is now the browser, in plain JS on a canvas. No GameMaker. GameMaker's
  HTML5 export is a different runtime from the Windows one, so it buys zero
  fidelity while adding a toolchain. GML reals and JS numbers are both f64
  doubles, so GML → JS translation preserves arithmetic exactly, provided
  operation order is preserved.
- Scope is dodge-only. No ACT menu, no TP, no turn system, no party management.
  Party HP and the Shadow Mantle damage reduction are hardcoded constants.
  Deliberate — matches the reference tool and removes the largest chunk of work.
- The clean-room membrane is dropped. We are translating GML to JS; there is no
  membrane to maintain and the previous provenance ritual protected nothing real.
  `notes/` survives as debugging documentation, not as legal posture.
- The pre-commit identifier hook is narrowed: it now rejects whole `.gml` files
  and original game data only. Comments citing original object names are
  encouraged for traceability.
- Ship incrementally. Soul movement + one attack is a publishable tool. Do not
  wait for all 14.

## Platform note (macOS)

This install is macOS, where the GameMaker data file is named **`game.ios`**, not
`data.win` — same FORM/GEN8 container, different extension. Every guide online
says `data.win`; on this machine that path does not exist. References to
`data.win` elsewhere in this doc mean `game.ios` here.

```
knight-research/oracle/DELTARUNE.app/Contents/Resources/chapter3_mac/game.ios
```

Node is **not on PATH** — it is an unpacked tarball at `~/tools/node` (no admin
rights were needed, and none are available: there is no Homebrew and the `.pkg`
installer wants a password). Every command below assumes:

```
export PATH="$HOME/tools/node/bin:$PATH"
```

Tooling is `UndertaleModCli` (`~/tools/utmt-cli`). There is **no macOS GUI build**
of UndertaleModTool — release 0.9.1.2 ships GUI for Windows only. The CLI binary
is Intel x86_64 and runs under Rosetta 2. Instrumenting the oracle breaks the
bundle's code signature; unsigned modified bundles will not launch on Apple
Silicon, so re-sign after every oracle rebuild:
`codesign --force --deep --sign - <app>`.

## Known constraints from recon

- The 14 attack objects are bespoke state machines with no shared bullet manager
  (58 code entries). There is no manager to port once and reuse. Expect to
  reverse each attack individually.
- **Dump accounting is confirmed (T1 done). No code is missing.** See below.

### T1 result: the 9,262 / 7,603 gap

All 9,262 code entries are accounted for. The hypothesis in the previous draft
— that the gap was anonymous nested functions — was wrong about the dominant
cause. Actual breakdown, measured via `ParentEntry` on every entry:

| count | what | where the body lives |
|------:|------|----------------------|
| 7,603 | root entries | exactly 1:1 with dumped `.gml` files, verified by set diff |
| 1,316 | GMS 2.3 script functions | `gml_GlobalScript_<file>.gml`, as `function <name>(` |
| 319 | nested methods | parent file, declared plainly; entry name is `<fn>_<parentEntry>` |
| 24 | anonymous struct constructors | parent file, as struct literals (`___struct___N_<parent>`) |

Every one of the 1,093 distinct parent entries was dumped. **A negative grep on
file contents is now trustworthy evidence.**

The one real trap: **filename ≠ function name.** One GlobalScript file can define
many functions, and its filename matches none of them. `screenx`, `screeny`,
`screenvec2`, and `draw_self_screenspace` all live in
`gml_GlobalScript_scr_screenspace.gml`. So:

- To find a function, grep **contents** for `function <name>(`.
- Never conclude something is absent from a filename listing.

## Architecture

```
sim/      pure logic. no DOM, no canvas, no input polling, no rendering.
          steps exactly one frame given an input state; returns new state.
render/   reads sim state and draws. never writes to sim.
input/    maps keys to an input state object.
tools/    headless trace runner, CSV differ.
notes/    per-attack behavioral specs written from the dump.
```

`sim/` must run headless under Node. That is the whole point: verification is a
plain script, not a browser session with a human watching.

## Non-negotiable rules

1. Fixed timestep. Accumulate real time, step logic in whole 1/30 s units. Never
   pass a delta into logic. No `requestAnimationFrame` delta reaches `sim/`.
2. No `Math.random`. Seeded PRNG only (mulberry32 or xorshift32). The seed is
   part of every replay file.
3. Preserve operation order. `x += spd * 2` translates as one expression. Do not
   split, reorder, or factor it.
4. Preserve integer math. GML `floor`, `div`, and integer division translate to
   explicit equivalents. Never silently promote to real division.
5. Preserve step order. GML Begin Step / Step / End Step / Alarm ordering maps to
   an explicit phase order in `sim/`. Alarms fire between Begin Step and Step. Do
   not collapse an alarm into a counter — that costs exactly one frame.
6. No change to `sim/` lands without a passing trace diff.

### Rule 5 is not theoretical

`scr_heartclamp` has exactly one caller in the entire game:
`obj_roaringknight_slash`, in its **End Step**. During that attack the soul is
moved and collision-resolved in `obj_heart`'s Step, then clamped by a *different
object* later in the same frame. Collapse that into one phase and the soul sits
at a different position for one frame — on the first attack you are likely to
port.

## Trig caveat

JS `Math.sin`/`Math.cos` may differ from GML's in the last bits. If an attack
using trig for positioning diverges by a fraction of a pixel, that is the cause.
Fix: dump a precomputed lookup table from the oracle rather than computing live.

## The oracle

The instrumented v1.03 data file is internal tooling, never shipped. It is the
measuring instrument that supplies real constants and catches divergences.

Workflow per piece: patch the oracle to run a hardcoded frame-indexed input
table, trace to CSV, reproduce in `sim/`, diff.

## Trace format

One row per frame, written at end of frame:

```
frame, soul_x, soul_y, hp, inv_timer, phase, [bullet fields...]
```

- GML side: `string_format(value, 0, 10)`. Never `string(value)` — it rounds
  reals to two decimals and hides exactly the sub-pixel divergences we are
  hunting.
- JS side: `value.toFixed(10)` to match.
- Bullets sorted by spawn order, never by instance id (ids shift when objects are
  added).
- Comparison is exact string equality. No float tolerance.

Definition of done for a piece: no divergence across 50 replays.

## Task order

- **T1 — Confirm the dump accounting. DONE.** See the table above. Answer: yes,
  the dump is complete; the gap is fully explained; content greps are reliable.
- **T2 — `sim/` skeleton. DONE.** Fixed-timestep accumulator (`sim/clock.js`),
  mulberry32 (`sim/rng.js`), explicit phase order (`sim/index.js`), entities and
  alarms (`sim/entity.js`), trace writer (`sim/trace.js`), headless runner and
  differ in `tools/`. Acceptance met: 10/10 byte-identical, in-process and
  across separate Node processes.

  ```
  export PATH="$HOME/tools/node/bin:$PATH"
  node tools/verify-determinism.mjs                     # T2 acceptance
  node tools/run-trace.mjs --seed 12345 --frames 600 --out traces/stub.csv
  node tools/diff-trace.mjs traces/oracle.csv traces/stub.csv
  ```

  The stub scene deliberately exercises alarms, the PRNG, input, and spawn/
  destroy churn. A stub that only moved at a constant rate would pass while
  proving nothing, so the acceptance run also asserts that a *different* seed
  produces a *different* trace — otherwise the test would be vacuous.
- **T3 — Soul movement. DONE — verified against the real game.**
  `node tools/verify-t3.mjs` compares the `oracle-t3` scene against the
  collected trace `knight-research/traces/t3-hold-right.csv`:

  ```
  → full rows (pre-bullet): rows 4..49 match     OK
  → soul position (full window): rows 4..193 match   OK
  ```

  `sim/soul.js` is a line-for-line translation of `obj_heart` Create + Step;
  `sim/masks.js` + `sim/collision.js` implement precise-mask `place_meeting`;
  `sim/battlebox.js` is the steady-state box. Window rationale is documented
  in `tools/scenes/oracle-t3.js`: rows 0-3 are the box grow-in (excluded, see
  below), row 50+ has bullet hits from the tester's dummy enemy (inv column
  only — position verified bullet-independent through row 193), row 194 is
  the turn reset.

  Geometry and collision truth, all measured, all oracle-verified:

  | thing | value |
  |---|---|
  | `obj_heart` sprite | `spr_dodgeheart` 20x20, origin (0,0) — boundary clamps use this |
  | `obj_heart` collision mask | `spr_dodgeheartmask`, **Precise, heart-shaped**, bbox [2,2]..[17,17] — NOT a rect |
  | `obj_growtangle` parent | **`obj_battlesolid`** — the box IS the wall |
  | box collision | `spr_battlebg_0` 75x75 hollow-ring precise mask, origin (37,37), drawn at image scale |
  | wall rest position | x=374 at box (320,170) scale 2: soul's rightmost pixel x+17=391, ring border starts 392 |

  **Growth-window exclusion (important):** during the box's 15-frame grow-in,
  collision runs against a fractional-scale, *rotating* precise mask
  (image_angle spins 180°→360°). Floor-sampling does not reproduce the real
  rasterization (contradicts trace frame 0). `sim/masks.js` documents this;
  nothing may rely on mid-grow collision without a dedicated oracle study.

  The tester (`room_bullettest_new`, `obj_bullettester_new`) auto-creates the
  battle: box at (320,170), heart at (314,162), dummy monster, turn timer 200.
- **T4 — One attack, end to end. DONE — `obj_roaringknight_slash`.**
  `node tools/verify-t4.mjs`: rows 4..193 of `traces/t4-slash.csv`, ALL
  columns row-exact — soul, box position, slash width. The per-attack
  pipeline this establishes:

  1. read the attack's events from the dump (mind `event_inherited` — check
     the parent chain; slash's parents are codeless)
  2. patch the oracle: sterilize the tester's dummy bullets, spawn the attack
     at a fixed trace frame from obj_time's Draw, trace its state columns
  3. translate, spawn via an endStep spawner at the same frame (matches the
     Draw-spawn timing: nothing runs until the next frame)
  4. recover choose()/random() outcomes from the trace into the scene's
     replay table (`state.chooseTable`) — RNG is replayed, never re-rolled
  5. full-row diff

  What the slash verified beyond T3: the engine's Collision phase position
  (Step → Collision → End Step), GML alarm truthiness (`!alarm[0]` is TRUE
  for idle -1 — translate as `!(alarm[0] > 0.5)`), f64 shrink chains match
  JS bit-for-bit (`width *= 0.66` through 10 iterations), `xstart`-rebased
  box jitter, and `scr_heartclamp` live (soul dragged to gt.x+50 each jitter
  frame; box left permanently displaced afterwards — the fight's box does
  NOT snap back).

  Unexercised, flagged: the damage path (Other_15 → scr_damage_all-lite).
  At the tested spawn params the slash's 0.1-yscaled 1px line mask overlaps
  no integer heart row (floor-sampling predicts it; oracle confirms no inv
  reset). A contact scenario needs its own oracle run before the damage
  translation counts as verified. Party hp[] bookkeeping is out of scope.
- **T5 — Ship it.** GitHub Pages or itch.io.

## Assets

Browser means bundling sprites. Accepted risk; free and non-commercial posture.

Ship without music, or with a load-your-own-file option. The soundtrack is
separately sold and is more sensitive than sprites. Cheap concession.

Do not commit the data file, the GML dump, or the oracle.

## Open questions

- [x] Dump accounting confirmed? **Yes — T1 complete, see table above.**
- [x] GEN8 game speed: **30.0**, read from the GMS2 tail of the GEN8 chunk.
- [x] Soul object name: **`obj_heart`**
- [x] Base soul speed constant: **4**, as `global.sp`, copied into the instance
      variable `wspeed` at Create. **The yellow soul is 5** — `wspeed = 5` is
      assigned when `color == 1`, at the *end* of Step, so it takes effect from
      the following frame. The frame that turns the soul yellow still moves at
      4. Any "soul speed is 4" statement is incomplete without this.
- [x] Diagonals normalized? **No.** Measured, not assumed: the two axes are set
      independently to +/- `wspeed`, with no `sqrt`, `lengthdir`, or 0.707 factor
      anywhere in the Step event. A diagonal moves 4 on both axes, so diagonal
      speed is 4·√2. Deltarune matches Undertale here.
- [x] Box clamping method: **both, and they are not interchangeable.**
      `obj_battlesolid` is reject-on-collision, resolved per axis by step-back
      loops that walk the intended delta down toward zero *before* the move.
      `scr_heartclamp` is clamp-after-move and is called from exactly one place
      (see Rule 5 above). Position commits at a single site, `x += px; y += py;`,
      after all resolution.
- [x] Focus/slow modifier value and application frame: **`ceil(v * 0.5)` per
      axis** — `ceil`, not `floor`, not a bare multiply (rule 4). Applied in the
      same Step that reads input, *before* collision resolution, gated on the
      focus button being held and `disableslow == 0`. `disableslow` latches at
      Create if the button was already down, so holding focus through the
      transition into the fight does **not** slow the first frames.
- [ ] Simplest attack for T4: **`obj_roaringknight_slash` recommended** — 84
      lines across 6 events, the smallest self-contained attack. Caveat: it pulls
      in `scr_heartclamp`, `obj_growtangle`, and `scr_get_box`, so T4 drags the
      battle box in with it. That work is needed anyway. Alternative if you want
      the box deferred: `obj_roaringknight_boxsplitter_attack` (209 lines, 4
      events). Not yet read in full — confirm before committing to it.

Attack objects by size, for planning:

```
   19  2 ev  obj_roaringknight_fountain_bullet_old
   38  4 ev  obj_roaringknight_fountain_bullet
   44  3 ev  obj_roaringknight_split_bullet
   78  4 ev  obj_roaringknight_quickslash_afterimage
   84  6 ev  obj_roaringknight_slash
  141  7 ev  obj_roaringknight_quickslash_big
  209  4 ev  obj_roaringknight_boxsplitter_attack
  271  7 ev  obj_roaringknight_splitslash
  456  9 ev  obj_roaringknight_quickslash_attack
  761 24 ev  obj_roaringknight_quickslash
```

Bullets need a spawner, so the small ones are not standalone candidates.

## Known-unverified, in priority order

Things the code currently assumes that only the oracle can settle. Each is a
plausible source of a first divergence.

1. **Collision bbox semantics** (`sim/collision.js`). GameMaker bounding boxes
   are inclusive integer ranges and instance positions are floored before the
   test; we use a half-open float AABB. These agree while the soul sits on
   integer positions — which is every frame at speed 4 — and disagree the
   instant a sub-pixel position reaches `place_meeting`. Any attack that pushes
   or pulls the soul will hit this.
2. **Mid-phase spawns** (`sim/entity.js`). We freeze the entity list at the
   start of each phase, so an entity spawned during Step does not run its own
   Step that frame. Real GameMaker depends on processing order. Unobservable
   until an attack spawns bullets mid-Step.
3. **Negative zero in the trace** (`sim/trace.js`). JS `(-0).toFixed(10)` is
   `"0.0000000000"`. If GML's `string_format` emits `"-0.0000000000"`, that is a
   one-cell false divergence with an obvious fix.
4. **`obj_battlesolid` masks.** The object has no sprite; instances are given
   one at runtime. Until we know what, solid geometry in `sim/` is a stand-in.
