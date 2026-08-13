# CLAUDE.md — Knight Fight Simulator

## START HERE

A frame-accurate browser practice tool for DELTARUNE Chapter 3's Roaring Knight
fight. Reference build: **v1.03 post-nerf**. Scope: **dodge-only**.

**Method.** Translate the original GML to JS, then prove it: patch the player's
own copy of the game into an "oracle", record what it really does frame by
frame, and diff the sim against that CSV. A claim is only true if a suite
checks it.

**First things to do in a new session:**

```bash
export PATH="$HOME/tools/node/bin:$PATH"   # Node is NOT on PATH
cd ~/knight-sim && npm run verify          # expect: All 10 suites green
```

- `docs/STATUS.md` — what is done, what is next, known gaps
- `docs/ORACLE-RECIPE.md` — how to verify a new attack, end to end
- `~/knight-research/` — PRIVATE repo: the oracle, the GML dump, the traces.
  Never publish it. `knight-sim` is the public side.

**The five rules that cost the most to learn:**

1. **Read the dump before launching the game.** A grep is seconds; a game run
   is ~90. Most wasted time on this project was testing a guess by running.
2. **Never pin a value the game sequences itself with.** `mnfight`,
   `myattackchoice`, `turntimer` each cost hours. Grep for readers first.
3. **The SELECTOR decides what is real**, not the dispatch table. Six attack
   branches exist that the fight can never choose.
4. **Trace every creator to a selector-reachable root** before calling anything
   dead. Checking one and stopping produced a wrong retraction.
5. **Nothing invented ships.** If a placeholder is unavoidable, label it in the
   UI where the player sees it.

**Ground truth lives in two places:** the fight's real attack order (below,
"THE REAL FIGHT") and the recorded traces in `knight-research/traces/`.
Everything else is derived and may be wrong.

---

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

- ~~The 14 attack objects are bespoke state machines with no shared bullet
  manager. Expect to reverse each attack individually.~~ **WRONG — corrected.**
  There IS a shared manager. Every knight attack launches the same way:

  ```gml
  dc = scr_bulletspawner(x, y, obj_dbulletcontroller);
  dc.type = <N>;
  dc.difficulty = <D>;
  ```

  `obj_dbulletcontroller` switches on `type`, and all 15 types the knight uses
  live inside it. The `obj_roaringknight_*` / `obj_knight_*` objects are the
  *bullets and effects the controller spawns*, not independent attack machines.
  This changes the remaining work from "reverse 12 bespoke objects" to "reverse
  one controller's type switch".

  The error came from counting attack-shaped objects in the dump instead of
  reading how the knight dispatches. See "How to identify a real attack".
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

## THE REAL FIGHT — ground truth

Read from `obj_knight_enemy`'s **Other_10**, which is the attack SELECTOR. This
is the authority on what the fight does. Nothing else is.

| phase | turn order (myattackchoice) |
|---|---|
| 1 | 1 Stars, 11 tracking, 2 Flurry, 13 swordtunnel, 5 rotatingslash |
| 2 | 1 Stars, 2 Flurry, 13 swordtunnel, 15 vortex+tracking, 5 rotatingslash |
| 3 | 1 Stars, 2 Flurry, 14 tracking14, 13 swordtunnel, 5 rotatingslash — **LOOPS** |
| 4 | 5 rotatingslash *(skipped)*, **-1 charge-up**, 9 roaring → back to phase 3 |

**FIVE TURNS A PHASE, NOT NINE.** ~~Phase 1 runs nine turns.~~ **WRONG —
retracted.** The phase blocks are a run of plain `if (phase == N)` tests, and
each phase's last turn reassigns `phase` and zeroes `phaseturn` INSIDE that
run:

```gml
if (phaseturn == 5) { myattackchoice = 5; difficulty = 0;
                      phase = 2; phaseturn = 0; }
if (phaseturn == 6) { myattackchoice = 12; ... }   // phaseturn is 0 now
```

So turns 6-9 cannot fire — not on that call, and not on the next, by which
time `phase` is 2. **Attacks 12 (diagonal), 16, 17 and 7 (combination) are
UNREACHABLE**, exactly like ac 6 underboxattack. The only way in is
`if (scr_debug() && overrideAttack > 0) phaseturn = overrideAttack`. They are
debug content.

This is the same mistake as the two retractions above, for the third time:
**reading a table of branches instead of the control flow through them.** The
branches all exist; the flow never reaches them.

### Phase 4 is three turns and the middle one is empty

```gml
phase4turn++;                                    // turn/phaseturn do NOT
if (phase4turn == 1 && rotatingslash3used) phase4turn = 2;   // increment here
if (phase4turn == 1) { myattackchoice = 5;  difficulty = 2; }
if (phase4turn == 2) { myattackchoice = -1; difficulty = 1; }
if (phase4turn == 3) { myattackchoice = 9;  difficulty = 0;
                       damagereduction = 0.4; haveusedroaring = true;
                       phase = 3; }
```

- **`myattackchoice == -1` has an EMPTY branch** where every other choice
  creates an `obj_growtangle`. No board, no bullets. It is the only choice with
  no `scr_turntimer` override, so it keeps the default **90** from the
  mnfight 1.5 → 2 transition, and it sets `chargeupcon = 1` — the Knight's
  wind-up, under "The Knight's hands glow a strange color...".
- **Turn 1 is skipped** whenever `rotatingslash3used` is set, which phase 3's
  own turn 5 does. Both paths are reachable: the HP gate can trip mid-phase-3.
- **ROARING sets `phase = 3`**, so the fight falls back into the phase-3 loop.

### The gate and the ending are different events

```gml
// knight Step — at the END OF ANY TURN, not at a phase boundary:
if (global.mnfight == 2 && global.turntimer <= 1 && setdownmessage == false) {
    setdownmessage = true;
    if (monsterhp <= maxmonsterhp * 0.8 && haveusedroaring == false && phase != 4)
        phase = 4;

// knight DRAW — nested inside the HURT test:
if (state == 3 && hurttimer >= 0) {
    if (haveusedroaring == true && end_cutscene_version == 0
        && monsterhp <= maxmonsterhp * 0.8 && endcon != 1) { ... }
```

**THE FIGHT ENDS ON A HIT.** `state = 3` is assigned by `scr_damage_enemy`, so
the outer test means the Knight is mid-hit. Drop it and the end fires on
ROARING's own launch frame — `haveusedroaring` is set by that same selector
line, and the HP gate is already satisfied because it is what opened phase 4 —
so **ROARING would never play**. What really happens: ROARING resolves, the
party gets one more turn, and the fight ends on the next hit that lands. That
is what "The enemy suddenly let down its guard!" is telling you to do.

`haveusedroaring == false` in the gate is what makes phase 4 one-shot: the
fight loops back into phase 3 with HP still under the threshold, and without
that term it would re-enter phase 4 forever.

Dispatch parameters, from the knight's Step:

| ac | name | dc.type | invc | box |
|---:|------|---------|------|-----|
| 1 | Stars | 98 | 1 | xscale 2.25, yscale 1.75 |
| 2 | Flurry | 99 | 0.4 | default |
| 5 | rotatingslash | 104 | 1 | default |
| 7 | combinationattack | 105 | 0.4 | default |
| 9 | roaring | 107 | 1 | default |
| 11 | tracking swords | 151 | 0.4 | at (320,190) |
| 12 | diagonal bullets | 152 | 0.4 | default |
| 13 | sword tunnel new | 153 | 0.14 | at (300,190), xscale 3 |
| 14 | tracking swords | 151 | 0.4 | default |
| 15 | sword vortex + tracking | 154 then 151 | 0.4 | default |
| 16 | rotatingslash + tracking | 104 then 151 | 0.4 | default |
| 17 | tracking swords | 151 | 0.4 | default |

### How to identify a real attack

**The selector, not the dispatch table.** `obj_knight_enemy`'s Step has
`myattackchoice` branches the selector can never choose. These exist in the
code and are UNUSED CONTENT:

> 0 Swordslash · 3 swordtunnel · 4 xattacks · **6 underboxattack** ·
> 10 swords falling · 20 knightlines

Reading the dispatch table instead of the selector is how two verified attacks
turned out to be content the fight never uses. Before translating anything,
confirm the selector can assign it.

### Attacks verified but NOT in the fight

Both passed row-exact oracle diffs. The engine work they proved is sound and
still in use; only their status as *attacks* is retracted.

- **Fountain bullets** (`obj_roaringknight_fountain_bullet`) — unreachable.
  Only spawned by `obj_knight_split_growtangle`'s Other_12/13, which nothing
  ever fires (no `event_user(2)`/`(3)` targets it), and by the `_vertical` /
  `_backup` variants, which have **zero creators anywhere in the dump**.
  Proved: the regularbullet base, built-in motion, f32 positions, the damage
  path.
- ~~**Box splitter** — the selector never picks it.~~ **WRONG — retracted.**
  The cut-box organism IS in the fight. I checked one creator and stopped.
  `obj_knight_split_growtangle` has two paths in, and only the first is dead:

  ```
  obj_knight_split_growtangle
    <- obj_roaringknight_splitslash      <- boxsplitter_attack (ac 6, UNUSED)
    <- obj_roaringknight_quickslash_big  <- obj_roaringknight_quickslash_attack
                                            <- obj_knight_combinations   (ac 7, USED)
                                            <- obj_knight_rotating_slash (ac 5, USED)
  ```

  `rotatingslash` (ac 5) runs in EVERY phase and `combinationattack` (ac 7)
  closes phase 1, so `sim/attacks/split-growtangle.js` is verified work that
  the real fight actually uses.

  Only `obj_roaringknight_boxsplitter_attack` itself (the ac 6 wrapper) is
  unreachable — it is created solely by `dc.type = 106`.

  **The recurring mistake:** tracing one creator, or reading the dispatch
  table instead of the selector, and concluding "unused". Trace EVERY creator
  to a selector-reachable root before calling anything dead.

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

## RNG — SOLVED

The generator is discovered and validated; the "log outputs and replay"
fallback below is superseded for translated attacks. `sim/rng.js` `gmlRng`:

- **WELL512** (Lomont), 16x32-bit state, poly 0xDA442D24
- seeding: 16 rounds of `s = ((s*214013 + 2531011) & 0xFFFFFFFF) >>> 16`
- `random(x)` / `random_range` / `choose`: 1 draw (u32/2^32; args[u32 % argc])
- `irandom` / `irandom_range`: 2 draws, composed 63-bit
  (`lo | (hi & 0x7fffffff) << 32`), then modulo

Validated by `node tools/verify-rng.mjs` against 131 outputs logged inside
the real game (`traces/rng-probe.csv`; probe patch in
`knight-research/tools/patches/oracle_rng_probe.csx`). Same seed + same call
order = the real stream, bit-exact.

The cost of that power: **call order includes Draw events.** The teeth
bullets burn random_range twice per bullet per frame in Draw; debris
afterimages consume in their setup. A translated attack that wants stream
fidelity must consume for those calls too (as bare draws, no visual needed).
The alternative for verification runs remains fixing outcomes via a
seed-reset in the oracle patch. Dead code note: `obj_knight_split_growtangle`
Other_12/13 (the fountain walls) are never invoked — no knight code calls
event_user(2)/(3); fountains in the current fight come from the _vertical /
_backup variants used elsewhere.

## ds_list_shuffle — measured, not solved

`obj_knight_rotating_slash` picks its slash angles with `ds_list_shuffle`, and
`obj_knight_combinations` shuffles its attack order the same way. Probed the
same way as the RNG (`oracle_shuffle_probe.csx`, `traces/shuffle-probe.csv`:
3 list sizes x 6 seeds).

**What is established:** the shuffle consumes **exactly 16 u32 draws per list
element**, constant across seeds — 64 for n=4, 96 for n=6, 208 for n=13. 16 is
the WELL512 state size, so it advances one full state pass per element. The
draw-count model is confirmed against a zero-draw control (6/6).

**What is NOT established:** the algorithm. A search over which draw in each
16-block is used x forward/backward x six index formulas peaked at 3/18 — chance
level. Do not assume Fisher-Yates.

**Practical consequence — and why this is not blocking.** The shuffle is random
per playthrough in the real game, so matching one particular seed's order is
not required for the tool to be authentic; it is only required for *verifying*
a translation. So:

- Translate the shuffle with our own `gmlRng` Fisher-Yates. Statistically
  equivalent, not bit-identical.
- For the oracle diff, patch the ORACLE to use a fixed order (skip the
  shuffle) so both sides are deterministic. That pins the mechanics — angles,
  timing, spawn geometry, slash behaviour — which is what actually matters.
- Label any attack verified this way as "mechanics verified, shuffle order
  not bit-exact" so the distinction is never lost.

If bit-exactness is ever needed, the next step is disassembling the runner's
shuffle rather than more black-box probing; 18 samples were not enough and
more of the same will not help.

## Float32 built-ins

**Every built-in instance field narrows to f32 on store.** Measured on a real
instance (`oracle_f32_probe.csx`, `traces/f32-probe.csv`): assigning 1/3 reads
back 0.3333333433 for `x y xstart ystart speed direction image_angle
image_xscale image_yscale image_index image_speed image_alpha friction gravity
gravity_direction depth`, while plain instance variables read back
0.3333333333. `hspeed`/`vspeed` are derived from speed/direction, not stored.

This is enforced **structurally**: `spawn()` installs f32-narrowing accessors
for `F32_BUILTINS` (sim/entity.js), so no translation can forget. GML
*variables* stay f64 — only built-ins narrow.

It matters beyond position: `image_angle` and the scales feed the rotated-mask
collision test, so an f64 angle reaching `masksOverlap` would be a latent
divergence inside the calibrated mechanism, invisible on integer test data.
`node tools/verify-f32.mjs` asserts all 15 fields plus a plain-variable
control, and is sabotage-tested.

**Oracle patches for new attacks must trace `image_angle` and the scales** for
any entity whose mask rotates or scales. A field nothing looks at is a field
that can diverge silently — that is how the f32 issue survived T3 and T4.

## Never pin a value the game uses to sequence itself

Three separate multi-hour bugs, one root pattern: the harness froze a value to
keep a scenario alive, and that value was an INPUT the game used to drive
itself.

| pinned | consequence |
|---|---|
| `global.mnfight = 2` | skipped the enemy-talk phase, so `obj_knight_enemy` never initialised `rtimer` and could never attack |
| `myattackchoice` left at its 0 default | the knight dragged the soul to x 165 every frame (correct for Swordslash) — looked like four unrelated bugs |
| `global.turntimer = 999` | `obj_knight_pointing_cone` never released the stars (`con 0 -> 1` needs `turntimer <= endtimer`), so Stars' whole second half never ran |

Before pinning ANY global or instance variable in an oracle patch, grep for
its readers. If anything branches on it, do not pin it — give it a starting
value and let the game drive it down.

Concretely for the knight: `turntimer` starts at 300 and the battle controller
decrements it (`mnfight == 2 && timeron == 1`, and `timeron` is already 1 from
its Create). Stars' full arc then plays: cone opens, 18 stars accumulate, they
fire at turntimer<=120, then burst.

## The soul-outside-the-box bug (root cause)

Every oracle scenario that includes `obj_knight_enemy` must set
`myattackchoice` to the attack being tested. One line in the knight's **End
Step** is why:

```gml
if (scr_isphase("bullets") && myattackchoice == 0)
    if (obj_heart.x > camerax() + 165) obj_heart.x = camerax() + 165;
```

A freshly created knight defaults to `myattackchoice = 0` (Swordslash, whose
box sits at x 168), and any harness that forces `mnfight = 2` satisfies the
phase test — so the knight drags the soul to x 165 EVERY FRAME. The knight was
behaving correctly; nothing had told it which attack it was performing.

Symptoms it produced, all of which look like different bugs:

- the soul sitting outside the arena in every t7/t8 recording
- a hand-placed soul "snapping back" the instant a pin was released
- attacks locking onto a target outside the box
- a 149px single-frame teleport with the SAME instance id

T3-T6 never saw it because encounter 777 has no knight.

**Cost of finding it: many game runs across several turns.** One
`grep -rn 'obj_heart\.x *='` over the dump found it in seconds. The rule below
exists because of this.

## Working method — learned the hard way

Two failure modes cost most of a session each. Both are cheap to avoid.

**1. Read the dump before launching the game.** Every oracle run is ~90
seconds plus a patch/sign cycle; a targeted grep is seconds. During the fight
harness work I formed hypotheses and tested them by launching, repeatedly.
The two steps that actually broke the problem open — extracting the dispatch
table, and reading the selector — were both static analysis and took under a
minute each. Launch the game to MEASURE something you cannot read, not to find
out whether a guess was right.

**2. Enumerate the whole object before patching any of it.** Replacing
`obj_bullettester_new` piecemeal produced four consecutive crashes (Create,
Step, Draw, then an undefined instance var) because each event referenced
state the previous fix had not defined. `ls` its events and grep the variables
they read FIRST, then patch all of them in one pass.

Corollaries that keep biting:

- GML embedded in a C# verbatim string needs `""` for every quote — including
  quotes inside comments. Three separate compile failures.
- Replacing a decompiled code entry drops anything else declared in it. The
  `enum e__VW` at the bottom of many entries is the usual casualty.
- A patched-out event is not free: other events read the variables it set.
- `file_text_*` writes are BUFFERED. A crash or Game Over loses everything
  not yet closed. Flush periodically in every recorder.
- Let the game's own systems run where possible. Forcing `mnfight = 1.5`
  skipped the phase that initialises the knight; running `scr_bulletspawner`
  inside `with (obj_knight_enemy)` fixed a crash that hand-reconstructing its
  fields had caused.

## Positive execution assertions

A suite of negative results can hide a dead code path: the collision phase
once looked up `collides` on the entity instead of the type, never ran, and
everything stayed green because no scenario in the suite collided.

`state.counters` tracks `collisionChecks / collisionHits / motionSteps /
alarmFires`. Verifiers assert on them, so "the check ran and resolved
negative" is distinguishable from "the check never ran" — `verify-t4` requires
>= 2 collision checks with 0 hits; `verify-fountain` requires >= 100 motion
steps and exactly 1 hit. Both are sabotage-tested: reintroducing the original
bug makes them fail loudly.

**Rule for new mechanisms: every one needs at least one positive assertion.**

## Original bugs in the source

Typo'd variable names that silently do nothing are a pattern in hand-written
GML, not a one-off, and each is a place where the obvious reading of the code
is wrong. A scan for variables assigned in the knight objects but never read
anywhere in the dump (`knight-research/notes-write-only-vars.txt`) found 15,
including:

| object | variable | note |
|---|---|---|
| `obj_roaringknight_fountain_bullet` | `destroy_on_hit` | gate reads `destroyonhit` — bullets DO destroy on hit |
| `obj_roaringknight_split_bullet` | `turn_timer`, `turn_dir`, `turn_start` | the teeth have dead turning logic; they never turn |
| `obj_roaringknight_boxsplitter_attack` | `splitbox` | assigned -4, never read |
| `obj_roaringknight_splitslash` | `slice_delay` | assigned, never consulted |
| several | `trailthickness` | assigned in 6 places, read nowhere |

When translating, mark these at the site with an `ORIGINAL BUG:` comment
naming the intended-vs-actual variable, so a later cleanup pass cannot
"correct" them into a divergence.

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
- JS side: `real()` in `sim/trace.js`, NOT bare `toFixed(10)`. **GML rounds
  exact ties to even; toFixed rounds them away from zero.** Caught at
  t6-splitter frame 133, where the f32 value 405.15869140625 is an exact tie:
  GML prints `405.1586914062`, toFixed gives `...63`. Identical bits,
  different text, and the differ compares text.
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
  Party hp[] bookkeeping is out of scope. See the contact study below for
  why it never fires in the verified scenario — and when it does.

### Contact study: when does a slash actually connect?

Measured directly by replacing `obj_roaringknight_slash`'s Other_15 with a
recorder (no damage, so no Game Over) and sweeping spawn parameters. Raw
results in `knight-research/traces/t4-contact-hits.csv`.

| config | result |
|---|---|
| yscale 0.1-0.9, angle 0 | **miss** (9 of 9) |
| yscale 1.0-5.0, angle 0 | **hit** (6 of 6) |
| yscale 0.1, angle 30 / 45 / 60 / 135 | **hit** |
| yscale 0.1, angle 0 / 90 | **miss** |
| yscale 0.1, angle 0, y swept 0.00-0.95 in 0.05 steps | **miss** (20 of 20) |

Two rules, both empirical:

1. **An axis-aligned mask thinner than one pixel never registers.** The
   threshold is exactly 1.0 — GameMaker does not inflate a degenerate scaled
   mask to a whole pixel.
2. **Rotation is decisive.** The same sub-pixel-thin mask connects at any
   diagonal angle, because a tilted 500px line crosses integer sample rows,
   while an axis-aligned one stays inside a sub-pixel band.

So the slash is not broken and T4's "no hit" is not a bug: it was spawned
axis-aligned. **Every real spawner sets `image_angle = direction`** with
diagonal values (`obj_knight_roaring2` uses 117; `obj_knight_rotating_slash`
distributes `360/(n*2)*a + offset + aim_direction`), and aims at
`(obj_heart.x + 10, obj_heart.y + 10)` — dead centre on the soul. In the real
fight these connect.

**RESOLVED — the collision model is now calibrated.** `masksOverlap` in
`sim/masks.js` implements the model the data selects: positions floored,
B's rotated bbox rounded to an integer world rect as a pre-check (floor min
edge, ceil-1 max edge), then corner+floor inverse sampling. Each ingredient
is pinned by data that discriminates it: centre sampling wrongly hits at
yscale 0.5-0.9; without the bbox pre-check, trig epsilons at 90° decide hits
and get them wrong. `node tools/verify-contact.mjs` replays all 48 points —
the table above, the sub-pixel sweep, and the T3 grow-in stall — and passes.

A bonus finding: the grow-in (rotating fractional-scale box) matches this
model exactly once the box state live during the heart's Step is taken as
timer=row rather than row+1. The "growth window" was a frame-alignment
error, not a rasterization mystery. The grow animation is still not modelled
in `sim/battlebox.js`; pin the alignment with a dedicated trace when it is.

Remaining collision caveat: none known. New attacks at untested angle/scale
combinations get an oracle spot-check as part of their translation.
- **Attack 2 — fountain bullets. Engine work DONE; NOT AN ATTACK IN THE FIGHT** (unreachable content — see "Attacks verified but NOT in the fight"). `node tools/verify-fountain.mjs`:
  rows 4..193 of `traces/t5-fountain.csv`, all columns row-exact — frozen
  soul, two ramping fountain bullets, one wall-destroyed offscreen, one
  contacting the heart (inv reset + destroyonhit). New engine capabilities
  this verified: built-in speed/direction motion in the documented phase
  slot (Step → motion → Collision), the inherited bullet base
  (`sim/bullets/regularbullet.js` = obj_regularbullet + the default
  collidebullet Other_15), and moving precise-mask contact.

  **FLOAT32 POSITIONS — project-level fact.** The runner stores built-in
  x/y in single precision. The fountain speed-ramp digits
  (261.3999938965 = f64 arithmetic narrowed to f32 on store) select the
  model uniquely, 7/7 frames. GML *variables* stay f64; only position
  built-ins narrow. `runMotion` frounds; translated code assigning
  non-integer x/y directly must do the same. T3/T4 never noticed because
  every position they produce is integer-valued.

  Also caught here: the engine's collision phase looked up `collides` on
  the entity instead of the type, so it had never actually run. T4 passed
  regardless because its slash never connects — a reminder that a suite
  full of negative results can hide a dead code path; the positive-contact
  scenario existed precisely to catch this.

  Faithful oddity preserved: fountain Create sets `destroy_on_hit = false`
  (underscores) but the damage gate reads `destroyonhit` (= 1 from
  scr_bullet_init) — different variables, so fountain bullets DO destroy
  on hit. Oracle-confirmed at the contact frame.
- **Attack 3 — the box splitter. Engine work DONE; NOT IN THE FIGHT** (ac=6 underboxattack, never selected — see above). `node tools/verify-splitter.mjs`:
  rows 4..193 of `traces/t6-splitter.csv`, all columns row-exact — soul, the
  `con` state machine, timer, distance, the first four teeth (x, y AND
  image_angle), and the running contact count.

  `sim/attacks/split-growtangle.js` + `split-bullet.js`. **This is the first
  attack verified with seed-locked RNG**: the oracle calls
  `random_set_seed(12345)` before the split and the sim seeds `gmlRng`
  identically, so all 13 teeth get their `choose` weights and `random_range`
  top-speeds from the real stream. No recorded outcome table.

  New engine capability: **friction** in the motion phase. GML reduces speed
  magnitude and clamps at zero on crossing, so the teeth's NEGATIVE friction
  (-0.2 / -0.05) accelerates them. Verified.

  Two oracle-parity deviations, both mirrored in the scene and documented in
  the patch: the teeth's Draw-event RNG jitter is stripped (visual only, would
  otherwise consume 2 draws per tooth per frame and swamp the stream), and
  `obj_collidebullet`'s Other_15 is a recorder (`state.damageEnabled = false`)
  because the teeth otherwise kill the party and the Game Over destroys
  obj_heart before the trace flushes.

  Also learned: the splitter is **itself a bullet**. `splitslash` creates it
  and calls `scr_bullet_inherit(_splitter)`, and the splitter's own
  `scr_bullet_inherit(_b)` for each tooth reads those inherited fields — a
  two-level runtime inheritance chain. Creating it directly without seeding
  them crashes with "Variable ... damage not set before reading it".
- **Attack 4 — rotatingslash. VERIFIED (one cycle).** `node
  tools/verify-rotating.mjs`: rows 62..118 of `traces/t7-rotating.csv`, all
  attack columns — state, timer, aim_direction, rotation, slash_number,
  aim_x/aim_y, live slash count — plus soul position to first contact.

  **The first translated attack the fight actually selects** (ac 5, every
  phase; also chained by combinationattack). `sim/attacks/rotating-slash.js`.
  Reached via `obj_dbulletcontroller type = 104`.

  Leverage: it spawns `obj_roaringknight_slash` (attack 1, row-exact) and, via
  quickslash_big, the split_growtangle organism (attack 3, row-exact). Most of
  its payload was already verified — the new work was the state machine.

  Three recorded inputs, each a documented deviation rather than translation:
  the `spin` SEQUENCE (re-rolled by choose() on every aim entry), the create's
  `random_offset`, and the shuffled fan orders (ds_list_shuffle unsolved).
  Everything around them is verified normally.

  Verified window is 62..281 — SIX complete intro/aim/slash/cooldown cycles.
  It was 57 frames until two fixes landed together: the soul-outside-the-box
  root cause, and a missing pair of lines in the cooldown
  (`slash_offset -> 0` step 6, `slash_base -> 15` step 1) that SHORTEN the aim
  phase each cycle — 30 frames, then 23. The bad soul placement had been
  masking that second bug. Divergence at 282 is the attack's `return`
  wind-down, which is not translated.

  Also fixed here: `obj_roaringknight_slash`'s choose() now falls back to
  `gmlRng` when a scene supplies no recorded table, so attacks written after
  the RNG discovery use the real stream while attack 1's table-based
  verification still passes.
- **Attack 5 — Stars (cone). PARTIAL: cone verified, stars not translated.**
  `node tools/verify-stars.mjs`: rows 91..300 of `traces/t8-stars.csv` — the
  cone's angle easing, internal `gt_x`, and the battle box position — plus
  soul position to row 152. 210 frames.

  **Stars opens every phase**, and its dodge pressure is not the bullets: the
  cone drags the arena leftward every frame (`gt_x -= angle/target_angle/2`,
  box snaps to `round(gt_x)`) and squeezes the soul against the wall. Over the
  verified window the box travels 102px left. This is also the source of the
  "box drift" that looked like a harness bug for several rounds — it was this
  attack all along.

  `target_angle = 60` was DERIVED from the trace (steady step 0.499512 at
  angle 59.941406), not assumed. The push formula reproduces 44/44
  steady-state frames and `box.x == round(gt_x)` holds for all 340 frames the
  cone is alive.

  New engine capability: **gravity** in the motion phase. GML order is
  friction on the speed magnitude, then the gravity vector added to
  hspeed/vspeed, then move — so gravity changes DIRECTION as well as speed and
  speed/direction are recomputed from the components. Needed by the star
  bullets.

  Re-recorded after the soul-outside-the-box fix. The soul now starts at the
  box centre (314,162) and holds there until frame 215, when the box has slid
  far enough left that the squeeze begins — `gt_maxx - 22` = 313, and the soul
  moves to exactly 313. **Soul position matches for the whole window now**,
  where before it only held to 152. The frame-153 anomaly was never the
  stars; it was the knight dragging the soul out of the arena.

  Still open: `obj_knight_pointing_star` (126-line Step with a gravity phase,
  spawns starchildren) is not translated, so the scene has no stars.
- **T5 — Ship it. PLAYABLE, not yet published.**
  `python3 -m http.server 8177` then open `/web/index.html`. Arrows or WASD
  move, shift focuses, R resets, P pauses. Verified in-browser at a steady
  30/30 Hz with the splitter and fountain waves both running.

  ```
  web/index.html   page + driver (owns real time; uses sim/clock.js drain)
  render/canvas.js reads sim state, never writes
  input/keyboard.js DOM binder -> the same input object the verifier feeds
  sim/scenes/practice.js  the playable scene (lives in sim/, stays DOM-free)
  ```

  **Art: none shipped.** Every shape is rendered from the collision masks
  already in `sim/data` — the same pixel grids the physics uses. What you see
  is exactly what you collide with, and no extracted sprites are distributed.
  Revisit only if the look demands it.

  `?frames=N` fast-forwards deterministically before the first paint, and
  `?seed=N` picks the RNG seed — reproducible screenshots of any moment,
  through the same code path as the headless verifier. `window.__sim` exposes
  state/step for debugging.

  **`sim/` is now filesystem-free**, as the architecture always required: mask
  data is a generated static module (`tools/gen-masks.mjs`) rather than a JSON
  read, so the same code runs under Node and in the browser.

  Known visual gaps (cosmetic, no fidelity impact): the split box halves are
  not drawn while the box is parked offscreen during a split, and the slash
  renders as a line rather than the original's tapering wedge.

  **Fabricated content: REMOVED.** `practice.js` used to contain
  `fountainWave()` — 12 bullets in a row with a gap, which I invented and
  which exists nowhere in the fight. Deleted, along with its dead fountain
  import.

  What remains is the box splitter: faithfully translated and row-exact, but
  `underboxattack` (ac=6), which the selector never picks. So the scene is an
  **engine sandbox**, and the HUD says so in the player's view
  (`SANDBOX_NOTE`). Rule: nothing invented ships, and anything
  unrepresentative is labelled where the player will see it.

  Remaining before this is a practice tool for the real fight: translate
  attacks the selector actually chooses, then rebuild the schedule on the real
  phase order (see "THE REAL FIGHT"). Every one dispatches through
  `obj_dbulletcontroller` by `type`, so the controller is the next target.

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

## Sprites

The browser build renders the game's own art, extracted from the player's data
file. `assets/sprites/` holds **96 sprites / 271 frames / ~1.1 MB** — only the
sprites the fight code actually references, not all 4,992.

How it was produced (repeatable):

```
UndertaleModCli dump <game.ios> --sprites -o <dir>     # 14,529 PNGs, 79 MB
# then filter to the names grepped out of the knight/soul/box/controller code
# and copy them in, alongside manifest.json
```

`manifest.json` carries what the PNGs cannot: each sprite's **origin**,
size, frame count and bbox. GameMaker positions every draw relative to the
origin, so without it the art sits offset from the physics — the sprite/hitbox
mismatch this project exists to avoid. Regenerate it with the metadata script
in `knight-research/tools/patches`.

`.gitignore` blocks `*.png` globally with an explicit `!assets/sprites/*.png`
carve-out, so extracted art cannot be committed by accident from anywhere else.

Fallback: any entity whose sprite is missing draws from its COLLISION MASK
instead. A missing asset degrades to the exact shape the physics uses rather
than vanishing.

### A sprite set on the OBJECT is invisible to every grep

An object's default `sprite_index` lives in the OBJECT DEFINITION, not in any
event, so an object whose events never assign one has art that no search of the
code dump can find. Same failure as a numeric asset id, different hole.

`obj_basicattack` is exactly that. Its Create sets `image_xscale`,
`image_speed`, `damage` and `maxindex` and never a sprite, and
`obj_heroparent` overrides the sprite for Susie, Ralsei and Noelle but NOT for
Kris — so Kris's impact art is unreachable from the GML entirely.

```bash
OBJ_FILTER=attack UndertaleModCli load <game.ios> \
    -s tools/patches/object_sprite.csx -o /tmp/x.ios   # -> /tmp/object_sprites.json
```

`obj_basicattack -> spr_attack_cut1`. Reach for this whenever a translated
object draws "itself" and nothing in its events says what that is.

### `tools/pack-sprites.mjs` REBUILDS, it does not add

It deletes every PNG in `assets/sprites/` and copies back only what the names
file lists. Running it with a two-name list to add two sprites deleted 745 of
them; every suite stayed green because `sim/` does not read sprites, and the
PNGs are gitignored so there was no `git checkout` back. It now refuses to
shrink the pack by more than half without `--replace`.

Not shipped: audio. CLAUDE.md's asset stance stands — the soundtrack and sound effects are specifically allowed by toby fox and Sebastian wolf.

## The attack bar, and a grep that lied twice

`obj_attackpress` has three events — Create, Draw, Other_11 — and its DRAW does
the whole mechanic. Two searches for it came back empty first:

- **`linex` / `linespeed` are set in Create and read nowhere.** They look
  exactly like a sweeping-marker bar. Dead, like `splitbox` and `slice_delay`.
- **`points[0..2]` looked assigned-nowhere too — and that was MY error.** I
  grepped `gml_Object_obj_attackpress_*.gml`. They are set in `scr_boltcheck`,
  a GLOBAL SCRIPT. **Absence is only meaningful from a whole-dump grep.**

Bolts sweep toward a fixed line. `boltx += 1` per frame; a bolt scheduled for
`boltframe` draws at `x + 80 + (boltframe - boltx) * boltspeed` with
`boltspeed = 8`, so it is ON the line at `boltframe - boltx == 0`.

```
window   close < 15 && close > -5      early is forgiven, late is not
p == 0   +150   CRITICAL, yellow burst
p == 1   +120      p == 2   +110      p >= 3   +100 - p * 2
```

**The arrival times are NOT `30 + boltorder * boltgap`.** That is
`my_method == 2`, and `my_method` is **1**, which builds the schedule randomly:

```gml
boltxoff = 0; lastbolt = -1;
for (i = 0; i < bolttotal; i++) {
    boltxoff += lastbolt;              // -1 FIRST, so bolt 0 lands on 29
    boltframe[i] = 30 + boltxoff;
    if (i < bolttotal - 1 && lastbolt != 0 && boltchar[i] != boltchar[i + 1])
        lastbolt = choose(0, diff, diff * 1.5);   // a ZERO gap is reachable
    else
        lastbolt = choose(diff, diff * 1.5);
}
```

and assigns each bolt to a RANDOM eligible character by rejection sampling.
`boltgap` is read only by the dead branch — another `linex`.

**THE DEFAULT IS ONE BUTTON.** `global.flag[13] == 0` routes every press
through `scr_boltcheck_onebutton`, which scans ALL characters' bolts and raises
`diff` from 10 to 12. It also has a DUALBOLT case: two bolts on the same frame
are both scored by one press, reachable because the gap generator can emit 0.

### `button1_p()` is EDGE-triggered, and a once-per-bar latch kills FIGHT dead

Every fresh press gets a boltcheck. Modelling it as one check per character per
BAR meant the first press — which always lands while the bolts are 30 frames
out — consumed the only attempt, and **nothing could ever score**. FIGHT dealt
zero damage and read as "not wired up" rather than as an input bug.

`verify-fightbar` asserts BOTH directions, because they look alike and only one
is a bug: a HELD button must score nothing when a bolt arrives later, and a
fresh press on the line must score.

## What your attacks are worth

```gml
damage = round(((global.battleat[myself] * points) / 20) - (monsterdf * 3));
damage = ceil(damage * obj_knight_enemy.damagereduction);
if (object_index == obj_herokris) {
    if (global.hp[2] < 0 && global.hp[3] < 0) damage *= 2;
    else if (global.hp[2] < 0 || global.hp[3] < 0) damage *= 1;
    else damage = round(damage * 0.5);
}
```

**THE SWOON SCALING IS KRIS ONLY** — that block is inside an
`object_index == obj_herokris` test. Susie and Ralsei are neither halved when
the party is healthy nor doubled when it is not. Applying it party-wide roughly
doubles the party's output, because the healthy branch HALVES. It reads `< 0`
strictly, so an ally at exactly 0 does not count as down.

**RUDE BUSTER HAS NO `/ 2`**: `ceil(damage * (damagereduction + 0.65))`.

`damagereduction` is the real "melee multiplier", with two values outside the
ramp everyone quotes:

| where | value |
|---|---|
| `obj_knight_enemy` Create | **0.04** — nearly immune before the fight proper |
| Step, `damagereductiontimer == 1` | 0.2 |
| each turn, `mnfight == 1.5` | `if (dr >= 0.2 && dr < 0.35) dr += 0.01` |
| Other_10, `phase4turn == 3` | **0.4** |

The per-turn guard is a RANGE, not a clamp: a value already outside
[0.2, 0.35) is left alone.

## WHO gets hit, and the number is WHITE

`scr_damage`'s chapter-3 block is two rules stacked, and neither is guessable:

**1. KRIS IS NEVER THE DEFAULT TARGET.** A hit aimed at slot 0 is redirected to
Susie or Ralsei (`choose(1, 2)` when both stand). He only takes one when both
are down, or when rule 2 picks him.

**2. SOMEONE TAKES THE BRUNT.** With the ShadowMantle (armour 23) equipped a
counter runs and **two hits in every three go to the wearer**:

```gml
damagecounter++;
if (damagecounter < 3)  target = the mantle wearer;
else { target = choose(0,1,2) walked past the fallen;
       if (that one is not a wearer) damagecounter = 0; }
```

That is what makes the mantle a TANK item rather than a flat damage cut: it
pulls fire onto the wearer, who then eats it at x0.33.

**THE SWORD TUNNEL IS EXEMPT** (`myattackchoice != 13`), and `aoedamage` skips
both rules.

**Damage TAKEN is WHITE.** `dmgwriter.type = doomtype`, which is **-1** for an
ordinary hit; obj_dmgwriter's Draw opens `draw_set_color(c_white)` and -1
matches no type branch. The per-character tints (aqua/fuchsia/lime) are for
damage you DEAL — `dm.type = global.char[caster] - 1`. A death is `doomtype 4`:
red, with the digits swapped for the DOWN graphic.

## Real font assets are NOT out of reach

Extracting one is about forty lines of C# —
`knight-research/tools/patches/extract_font.csx` writes the page PNG and the
glyph table:

```bash
FNT_TARGET=fnt_mainbig UndertaleModCli load <game.ios> \
    -s tools/patches/extract_font.csx -o /tmp/x.ios
```

`render/font.js` draws with it. Two traps: `shift` (the advance) and `w` (the
inked width) are different numbers, and a space has `w = 0` but `shift = 9`, so
a `w`-based layout deletes every space. The item menu uses
`draw_text_transformed` with `xscale = min(1, 200 / string_width(s))` — long
names are SQUEEZED, never clipped.

## The item menu is not in the charbox

`obj_battlecontroller`'s Draw, `global.bmenuno == 4`:

```
names      xx + 30 and xx + 260, at yy + 375 + i * 30      (375 / 405 / 435)
cursor     spr_heart at (10 | 230, 385 | 415 | 445)
page arrow spr_morearrow at (470, 445), bobbing sin(s_siner / 10) * 2
desc       c_gray at (xx + 496, yy + 375), `#` breaks lines
```

**SIX SLOTS PER PAGE over two pages**, cursor a single 0..11 index from which
page, row and column are derived. LEFT AND RIGHT DO THE SAME THING — with two
columns a toggle is its own inverse — and up/down step by 2. Navigation is
**clamped, not wrapped**: `down` refuses at `coord >= 10`, `up` at
`coord <= 1`, and both refuse an empty slot.

MAGIC's TP cost is drawn ONCE, under the description, as a percentage
(`floor(cost / maxtension * 100) + "% TP"`, c_orange at 496/440) — not per row.
Unaffordable spells are **c_gray**, not hidden.

Names are the dump's, character for character — it is `Spincake`.

### `tempitem` is why items come back when you cancel

A 12x3 per-character snapshot of the bag. Choosing an item removes it from THAT
character's list; `scr_nexthero` copies it forward; **`scr_prevhero` restores it
from the previous character**, undoing the spend; `scr_endturn` commits to
`global.item`. `global.temptension[]` does the same for TP, so cancel also
refunds DEFEND's 40.

Cancel is a STACK, one step per press: picker -> list -> button row
(`bmenuno = 0`) -> previous character. Only the last calls `scr_prevhero`.

### X is one button with two jobs

`button2_h()` is the SLOW modifier in obj_heart's Step; `button2_p()` is CANCEL
in obj_battlecontroller's. Same key. They never collide, because the menu is
closed during the bullet phase and the soul is frozen while it is open.

## `mmy` slides the charboxes off, and that is what makes room

The item list (y 375-445) and the FIGHT bar (rows at 365/403/441) both collide
with the charbox's portrait/HP strip at y 430-449, and `scr_charbox()` is
called UNCONDITIONALLY — so at first glance the game draws both. It does not:
`scr_charbox`'s else branch slides `mmy[c]` to **-170**, taking the strip up
and off the band.

## The turn's real buffers

```
rtimer == 12          the arena is up and EMPTY before the attack spawns
timermax == 50        obj_attackpress holds after the last bolt resolves
fadeamt += 0.08       13 more frames of black fade before it destroys itself
```

The board is created under `mnfight == 1.5` and the attack spawns 12 frames
later under `mnfight == 2` — so the board is already GROWING while the arena is
still empty. Doing both at launch puts the board and the bullets on one frame.

## THE FIGHT HAS AN ENDING

```gml
if (haveusedroaring == true && end_cutscene_version == 0
    && global.monsterhp[myself] <= (global.monstermaxhp[myself] * 0.8))
```

BOTH conditions, neither alone. `end_cutscene_version > 0` then makes
obj_battlecontroller's Draw, obj_tensionbar's and obj_attackpress's all `exit`
on their first line — the entire battle UI vanishes at once.

**5840 appears in THREE independent places**: the phase-4 gate,
obj_bgfountaintest's `battleprog` reaching exactly 1, and this. It is the
fight's one real number.

## The background is obj_bgfountaintest, and it is the health bar

`obj_knight_enemy`'s Create destroys `obj_battleback` and puts it there.

```gml
battleprog = 1 - (((monsterhp - maxhp * 0.8) / maxhp) * 5);
```

0 at full HP, exactly 1 at 5840. It scales the fountain's alpha and doubles its
scroll speed past 0.65, so **the background brightens and quickens as you
damage the Knight** — the only running readout of a "???" enemy.

## The party animate off obj_heroparent, and `faceaction` is the subtle half

`state` is what they are DOING (0 idle, 1 attack, 2 spell, 4 item, 6 act);
`faceaction` is what they are ABOUT to do, and it does nothing until state 0
READS it. So choosing ITEM is a POSE held through everyone else's turn, not an
animation. Everything advances at **0.5 a frame**; the idle bob is `siner / 5`.
ACT has two clamps — the pose stops at `actframes` but the state runs to
`actreturnframes`, giving a hold at the top of the swing.

`hurt` gates every other state, so a character being hit stops mid-pose.

The Knight's own reaction, from `scr_damage_enemy`: `shakex = 9`,
`hurttimer = 30`, and — **only at damage >= 100** — `stronghurtanim`, which
strobes him between his idle and `spr_roaringknight_ball_transition` FRAME 7.
Below 100 there is no strobe, because the Draw's test reads
`|| stronghurtanim == false` and takes the plain-idle branch.
