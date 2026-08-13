# One-to-one verification — the endgame plan

## Where the coverage actually is

38 suites, and they split into two kinds that are worth naming separately
because only one of them is evidence about the real game:

| | what it proves |
|---|---|
| **21 oracle suites** | a recorded scenario from the patched game, diffed row for row |
| **17 self-contained** | a rule read out of the dump, asserted in isolation |

The oracle half is real evidence. The self-contained half is a careful reading
— and this session found three places where a careful reading of the *Create*
was the wrong half of the object (Stars, the starchildren, the roaring star all
set their damage inside `Other_15`). A rule asserted from a misreading passes
its own suite forever.

**So the gap is not coverage. It is that nothing checks the fight AS PLAYED.**
Every oracle suite pins one attack, launched by a harness, against a frozen
scenario. Nothing has ever compared a whole fight — menus, turn order, damage
accumulating across fifteen turns, the party actually dying — against the real
thing.

## The plan: one token, two runs, one diff

Everything needed already exists and was built for other reasons:

1. **The replay token** (`sim/replay.js`) is a seed plus an input stream, and
   `verify-replay` proves it reproduces a live run exactly. It is already the
   input-table format the oracle harness has wanted since T4.
2. **The oracle harness** already drives the real game from a frame-indexed
   input table and traces to CSV (`docs/ORACLE-RECIPE.md`).
3. **The differ** already compares CSVs as exact text.

So:

```
   token ──┬──> patched game  ──> oracle.csv  ─┐
           │                                   ├── exact diff
           └──> sim (headless) ──> sim.csv    ─┘
```

Record one full fight by hand in the patched game, save the token, then every
future change re-diffs against that recording in seconds. **That converts the
whole fight into a regression test.**

## The four things that have to be true

**1. Input parity.** The token carries menu presses as well as movement, so
FIGHT/ACT/ITEM choices replay identically. Nothing new needed — but the
oracle patch must consume the token rather than a hand-written table.

**2. The shuffle must be pinned on both sides.** `ds_list_shuffle` is measured
but NOT solved (16 draws per element, algorithm unknown). Rotating slash and
combinations use it. The oracle patch pins a fixed order, the sim uses the
same fixed order, and the run is labelled "mechanics verified, shuffle order
not bit-exact" — the same compromise the existing rotating-slash suite makes.

**3. Bullet identity across the two runs.** The game's per-frame iteration
order is NOT spawn order. `verify-roaring-pull` already solved this: match
each engine bullet to its nearest oracle bullet and assert the COUNT exactly,
which keeps the nearest-match honest. The full-fight row uses the same rule.

**4. The row has to be wide enough to be worth calling "complete".** Today it
is `frame, soul_x, soul_y, hp, inv_timer, phase` plus a few bullet slots. The
full-fight row adds: every party member's HP, TP, the Knight's HP, his
damagereduction, the menu state, the turn and phase, the fight bar, and every
live bullet's x/y/angle/scale. A field nothing looks at is a field that can
diverge silently — that is how the f32 issue survived T3 and T4.

## What this will NOT cover, stated plainly

**The renderer.** A frame-perfect sim diff says nothing about whether the
Flurry flame is the right colour — and that exact bug shipped this session and
survived every suite. `c_gray` drawn as alpha instead of a multiply is
invisible to a CSV.

The honest answer for the renderer is a different discipline: capture frames
from the real game at known moments and compare them to `?replay=<token>&frames=N`
screenshots. That is fuzzy (scaling, timing, compression) and belongs in its
own pass, not bolted onto this one. Until it exists, **visual fidelity is
reviewed by eye and nothing more** — worth saying out loud rather than letting
a green suite imply otherwise.

## Order of work

1. `--wide` trace mode in `sim/trace.js` and a sim-side full-fight runner  ← **built**
2. `oracle_fullfight.csx` — drive the game from a token, trace the wide row
3. One recorded fight; commit the token and the CSV to `knight-research`
4. `verify-fullfight.mjs` — the diff, added to `npm run verify`
5. Then the renderer pass, separately

Step 2 needs a game run and a patch cycle; steps 1 and 4 do not.
