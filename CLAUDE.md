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

Decompiled GML from `data.win` must **never** enter `src/`. The flow is:

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
  oracle/               instrumented data.win        [gitignored]
  gml_dump/             full UTMT text export        [gitignored]
  traces/               oracle CSVs
  notes/                per-attack specs
knight-sim/             the standalone build
  src/                  clean GML
  tools/                trace differ, build scripts
  CLAUDE.md             this file
```

Never commit: `data.win`, extracted sprites/audio, or decompiled GML.

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

- [ ] GEN8 game speed:
- [ ] GEN8 bytecode version:
- [ ] GameMaker runtime version:
- [ ] Can the IDE install that runtime? (blocking — determines if the port is viable)
- [ ] Soul object name:
- [ ] Base soul speed constant:
- [ ] Are diagonals normalized?
- [ ] Box clamping: clamp-after-move, or reject-on-collision?
- [ ] Battle controller object name:
- [ ] Attack objects: shared bullet manager, or bespoke state machines?
- [ ] Globals the battle reads (party stats, equips, flags):
