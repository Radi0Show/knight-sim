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

1. `--wide` trace mode in `sim/trace.js` and a sim-side full-fight runner — **built**
2. `oracle_fullfight.csx` — drive the game from a token, trace the wide row — **written and compiling**
3. `verify-fullfight.mjs` — the diff, in `npm run verify` — **built, 10 injected faults caught**
4. One recorded fight ← **the only step left, and the only one that needs the game**
5. Then the renderer pass, separately

## What a recording must contain before it means anything

A trace that is present but empty of fight is more dangerous than one that is
missing, because it looks like evidence. The first "whole-fight" recordings
ran ONE turn and flatlined for the remaining 790 frames, and the differ
happily reported "exact through frame 21" against them — true, and it had
never compared a second turn, a phase transition, a difficulty variant or the
phase-4 gate.

`verify-fullfight.mjs` now refuses to diff a recording with fewer than 3
distinct phase/turn values or a >40% tail with no bullets, and names the
likely cause. Check the numbers directly too, and **quote the ORACLE's
coverage, not the sim's** — conflating them is how the one-turn recording
survived several reports.

A healthy recording of the 9000-frame token looks like:

```
distinct phase/turn: 11+     all of phases 1 and 2, into 3
frames with bullets: 2000+
dead tail:           under a few hundred frames
```

## What --keep-alive does and does not verify

A scripted input does not dodge, so the party wipes in a turn or two and the
fight stops. Both sides pin party HP — and BOTH must also `scr_revive`, since
being down is five globals and restoring HP alone leaves the party at full
health and still swooned.

**A --keep-alive run does not verify party HP bookkeeping**: not the
ShadowMantle's two-hits-in-three targeting, not Kris never being the default
target, not the swoon scaling. Damage still fires and still resets the inv
clock, so the damage PATH is exercised; only the resulting HP is unchecked. A
survivable hand-authored run is the other half of the picture.

## The premise is set explicitly, not inherited

`scr_gamestart` zeroes the inventory and equipment only arrives from a save
file, so a freshly booted tester party fights BARE while the sim assumes
DEFAULT_GEAR. The patch pins `battleat/battledf/battlemag` to exactly what
`sim/damage.js statFor` produces, and the diag file carries them so a
mismatch surfaces rather than hiding.

Not covered by that pin: per-item effects that are not stat contributions —
the ShadowMantle's targeting, Devilsknife's Rude Buster discount, BlueRibbon
heal multipliers.

## Running it

One command, on the machine with the game and the private bundle:

```bash
cd ~/knight-research
./tools/build-oracle.sh tools/patches/oracle_fullfight.csx   # once per patch change
./tools/record-fullfight.sh fight1 "<replay token>" 600
```

That writes the input table, plays the fight, collects the trace and the
shuffle log, replays the same token through the sim, and diffs. Afterwards
`npm run verify` picks the recording up on its own — `verify-fullfight.mjs`
diffs every `fullfight-*.csv` in `~/knight-research/traces`.

Without those traces it SKIPS loudly rather than passing, so CI cannot report
a green tick for a fight it has never seen.

## How the differ reports

By SYSTEM, in causal order, earliest divergence first — not "first differing
cell". 96 columns x ~9000 rows is 850,000 cells, and by the time a fight has
drifted the first differing cell is whichever column happens to sort first,
not the fault. The groups are `turn → soul → damage → tension → knight →
bullets`, because input drives the soul, the soul drives what hits you, hits
drive HP, HP drives whether the turn ends, and the turn drives what spawns.
**The first group printed is the one to fix.**

Bullet columns are positional (spawn order on both sides), so the COUNT is
checked first and the positional columns are suppressed past a count
divergence — one missing bullet is one fault, not forty.

## What is taken as given

**The shuffle order.** `ds_list_shuffle` burns 16 draws per element and its
algorithm resisted an 18-sample search, so the sim cannot derive a given
seed's ordering. The patch LOGS each shuffled `slash_list` as the game builds
it and the sim replays those values — the real shuffle still runs and still
consumes its draws, so nothing downstream is falsified. Report any result as
**"mechanics one-to-one, shuffle order replayed"**, the same phrasing the
per-attack suites use.
