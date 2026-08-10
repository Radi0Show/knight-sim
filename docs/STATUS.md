# Status and next steps

Living document. Update when an attack lands or a claim changes.

## Health check

```bash
export PATH="$HOME/tools/node/bin:$PATH"
cd ~/knight-sim && npm run verify
```

Expected: **All 11 suites green.** If not, stop and fix before adding anything.

## Engine — done and verified

| capability | verified by |
|---|---|
| Fixed 30 Hz timestep, GM phase order (begin → alarm → step → motion → collision → end) | verify-t3/t4 |
| GameMaker's RNG: WELL512, exact draw counts per function | verify-rng, 131 logged outputs |
| Precise-mask collision with rotation and scale | verify-contact, 48 measured points |
| float32 built-in fields (structural, via `spawn()` accessors) | verify-f32, 15 fields |
| Built-in motion: speed/direction, friction, gravity | verify-fountain, verify-splitter |
| Bullet inheritance chain (`regularbullet` → `collidebullet`) | verify-fountain |
| Trace formatting matching `string_format(v,0,10)`, ties-to-even | all trace suites |

## Attacks

| ac | name | status |
|---:|---|---|
| 5 | **rotatingslash** | VERIFIED, 220 frames / 6 cycles. Ends before the `return` wind-down (untranslated). |
| 1 | **Stars** | Cone VERIFIED (210 frames incl. soul squeeze). Star bullets translated; spawn cadence + lifecycle VERIFIED (rows 95-169). Fire-phase knockback NOT verified. |
| — | `obj_roaringknight_slash` | VERIFIED row-exact — used BY rotatingslash. |
| — | split_growtangle organism | VERIFIED row-exact — reached from rotatingslash + combinationattack. |
| — | fountain bullets | Verified but **unreachable in the fight**; engine value only. |
| 2, 7, 9, 11, 12, 13, 14, 15, 16, 17 | rest of the roster | not started |

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

Both are bounded and have ground truth already recorded in
`knight-research/traces/t9-star.csv`.

**After that:** `obj_knight_pointing_starchild` — a 148-line tracking bullet
homing on `obj_heart_follower`, spawned 6 per star at burst. Separate unit.

**Then:** the rest of the roster. `Flurry` (ac 2, type 99) is third in every
phase and is the natural next attack.

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
