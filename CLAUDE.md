# CLAUDE.md — Knight Fight Simulator

## What this project is

A frame-accurate practice tool for the Roaring Knight fight (DELTARUNE Chapter 3).
Target build: **v1.03 post-nerf**. Distribution: **standalone**, assets loaded at
runtime from the user's own DELTARUNE install.

The deliverable is not "a game that feels like the fight." It is a reimplementation
whose per-frame state is provably identical to the original's.

## Non-negotiable rules

1. **30 FPS fixed timestep.** `delta_time` appears nowhere in this repo. Ever.
2. **Never convert an Alarm into a Step counter.** GameMaker runs Alarm events
   between Begin Step and Step. This refactor costs exactly one frame.
3. **Never move code between Begin Step / Step / End Step.**
4. **Never simplify arithmetic.** `x += spd * 2` stays exactly as written. Do not
   split, reorder, or factor it. Float op order is part of the spec.
5. **Preserve integer math.** If the original uses `floor`, `div`, or integer
   division, reproduce it exactly. Do not "clean up" to real division.
6. **Never change instance creation order**, sprite origins, or collision masks.
7. **No change to `src/` lands without an accompanying passing trace diff.**

## Clean-room boundary (important)

Decompiled GML from the original data file must **never** enter `src/`. The flow is:

```
gml_dump/  →  notes/  →  src/
(original)    (specs)    (our code)
```

`notes/` is the membrane. Original code goes in one side; human-written behavioral
specs come out the other. Nothing crosses directly.

The pre-commit hook greps `src/` for original identifiers and hard-fails. If it
fires, do not weaken the hook — rewrite the code.

## Repo layout

```
knight-research/        PRIVATE, never published
  oracle/               instrumented game.ios        [gitignored]
  gml_dump/             full UTMT text export        [gitignored]
  traces/               oracle CSVs
  notes/                per-attack specs
knight-sim/             the standalone build
  src/                  clean GML
  tools/                trace differ, build scripts
  CLAUDE.md             this file
```

Never commit: `game.ios` / `data.win`, extracted sprites/audio, or decompiled GML.

## The target build (macOS)

This install is macOS, where the GameMaker data file is named **`game.ios`**, not
`data.win` — same FORM/GEN8 container, different extension. Every guide online
says `data.win`; on this machine that path does not exist.

Chapter 3 data, working copy:

```
knight-research/oracle/DELTARUNE.app/Contents/Resources/chapter3_mac/game.ios
```

Chapters 1–5 each have their own `chapterN_mac/game.ios`; the 2.8 MB one at the
`Resources/` root is just the launcher.

Instrumenting the oracle breaks the bundle's code signature, and unsigned modified
bundles will not launch on Apple Silicon. Re-sign ad hoc after every oracle
rebuild: `codesign --force --deep --sign - <app>`.

## Trace format

One row per frame, written from End Step. Fields:

```
frame, soul_x, soul_y, hp, inv_timer, phase, [bullet fields...]
```

**Use `string_format(value, 0, 10)`, never `string(value)`.** Plain `string()`
rounds reals to two decimals and will silently hide the sub-pixel divergences this
whole project exists to catch.

Bullets are sorted deterministically by spawn order, **not** by instance id —
ids shift when objects are added.

## Verification loop

```
make verify ATTACK=<name> REPLAY=<id>
→ traces match through frame N            ✅
→ DIVERGENCE at frame N: field  oracle=X  engine=Y
```

Comparison is exact string equality on the CSV. No float tolerance. No pandas.
Stdlib `csv` only.

Definition of done for a piece: no divergence observed across 50 recorded replays.

## Input handling

The input recorder lives **inside the game loop**. Never use OS-level input
automation (AutoHotkey, pyautogui) — OS keystroke scheduling is not frame
deterministic and introduces exactly the nondeterminism this project eliminates.

For early spikes, use a hardcoded frame-indexed input table rather than a recorder.

## RNG

If the GameMaker runtime cannot be pinned to the version v1.03 shipped with,
`random()` streams will differ and no amount of careful porting fixes it. In that
case: log the original's RNG outputs frame-by-frame from the oracle, then reproduce
the sequence with a hand-rolled PRNG validated against the log.

Do not guess which generator GameMaker uses internally. Discover it empirically
from the logs.

Seed-locked practice mode is a feature, not a compromise.

## Open questions (fill in as discovered)

- [x] GEN8 game speed: **30.0** — read directly from the GMS2 tail of GEN8.
      Confirms rule 1. The fixed timestep is not an assumption.
- [x] GEN8 bytecode version: **17**
- [ ] GameMaker runtime version: **not recoverable from the shipped files.** GEN8
      reports IDE version 2.0.0.0, which modern GameMaker writes as a placeholder;
      there is no `runtime-YYYY.x.x.x` string in the data file or the Mac runner,
      and `Info.plist` says 1.0.0. Bytecode 17 is the only real signal. Get the
      actual number from UTMT's data display, or infer it from the FEAT chunk.
- [ ] Can the IDE install that runtime? (blocking — determines if the port is viable)
- [x] Soul object name: **`obj_heart`**
- [x] Base soul speed constant: **4**, as `global.sp`, copied into the instance
      variable `wspeed` at Create. Slow-walk halves it with **`ceil`**, not
      `floor` and not plain multiplication — see rule 5.
- [x] Are diagonals normalized? **No.** Horizontal and vertical are set
      independently to +/- `wspeed`, with no `sqrt`, `lengthdir`, or 0.707 factor
      anywhere in the Step event. A diagonal moves 4 on both axes.
- [x] Box clamping: **both mechanisms exist and they are not interchangeable.**
      `obj_battlesolid` is reject-on-collision, resolved per axis by decrementing
      step-back loops before the move. `scr_heartclamp` is clamp-after-move, and
      it is called from exactly one place in the whole game — see below. Position
      is committed at a single site after all resolution.
- [ ] Battle controller object name:
- [x] Attack objects: **bespoke state machines.** Each attack is its own object
      with its own events; there is no shared bullet manager. 14 objects and 58
      code entries carry the fight.
- [ ] Globals the battle reads (party stats, equips, flags):

### Why rule 3 is not theoretical

`scr_heartclamp` has exactly one caller in the entire game:
`obj_roaringknight_slash`, in its **End Step**. So during that attack the soul is
moved and collision-resolved in `obj_heart`'s Step, and only then clamped, by a
different object, later in the same frame. Move that call into Step and the soul
sits at a different position for one frame — which is precisely the class of
divergence this project exists to catch.

Confirmed incidentally while reading GEN8, in case any of it saves a lookup:
internal name `DELTARUNE`, display name `DELTARUNE Chapter 3` (so `chapter3_mac`
is the right file), 640x480, 246 rooms, 31 chunks, debugger disabled.
