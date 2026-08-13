# HANDOFF — making the Roaring Knight fight one-to-one

**The goal, in the user's words: "the real thing is the actual fight that needs
to be 1 to 1."** Not one attack, not the engine — the whole fight, as played.

Read `CLAUDE.md` first, all of it. This file is what to do next and what has
already been tried; CLAUDE.md is what is TRUE. Where they disagree, CLAUDE.md
wins and this file is stale.

---

## 1. Where the work actually stands

**40/41 suites green.** The one failure is `verify-fullfight`, which is the
point of the project rather than a side issue — see §3.

| layer | state |
|---|---|
| eight live attacks | translated, oracle-verified row-exact individually |
| turn structure, phases 1-4, the ending | translated, matches the selector and the wiki's independent table |
| menu, items, spells, ACT, attack bar, TP | working; several details settled this session |
| damage, targeting, mantle, SWOON | translated from the dump, incl. the Kris-only scaling |
| whole-fight diff vs the oracle | **byte-exact through frame 24, diverges at 25** |
| visuals | the long tail. This is where "1:1" is now won or lost |

**Nothing invented ships.** If a placeholder is unavoidable it is labelled in
the UI where the player sees it. Two things ship deliberately: the SFX and the
soundtrack, which the user has confirmed are specifically permitted.

`~/knight-research/` is PRIVATE and must never be published — it holds the
oracle, the GML dump and the traces. `knight-sim` is the public side. Never
commit `game.ios`, the dump, or oracle bundles.

---

## 2. The single most valuable habit

**Everything found this session that mattered was found by a human PLAYING the
fight, or by reading the dump — never by the suite.** The suite says "did I
break something", not "is this right".

Five real bugs this session, none catchable by 41 green suites:

- Flurry's teeth dealt **1** damage instead of 176 (a missing
  `scr_bullet_inherit`; the placeholder 10 survives DF as 1)
- the game over played the **wrong game over entirely** (`knight_mode`)
- TP items were deferred when the dump applies them inline
- the box shake ran at the monitor's rate, not 30Hz
- three sibling objects had **NaN depth**

So: read the dump before launching anything; instrument before theorising; and
when the user says something looks wrong, they are describing a real defect
even when the mechanism they propose is not the one at fault.

---

## 3. Priority order for a 1:1 push

### P0 — close the whole-fight diff (task #28)

This is the measuring instrument for everything else. Until it runs clean,
"1:1" cannot be asserted about anything downstream of frame 25.

State: the bar instrumentation ruled out routing, schedule, boltx, window and
scoring — **all identical**. What remains is an input-parity offset: the
oracle receives confirm on even frames, the sim on odd. One inconsistency is
recorded and unresolved: 74 points implies a press at boltx 16 (frame 23,
odd), which contradicts the oracle's even-frame `b1p`, meaning the frame
`obj_attackpress` ACTS on a press differs from where the diagnostic SAMPLES
it. Resolve that before changing either side.

**Re-record first.** The recordings in `~/knight-research/traces/` predate the
Flurry damage fix, so they are stale:

```bash
~/knight-research/tools/record-fullfight.sh <name>
```

### P1 — the visual tail, which is what "1:1" now means

Ranked by how visible each is in play:

- **#41** the roaring fountain's missing effects and colours (the finale, and
  the most-looked-at attack in the fight)
- **#43** the attack bar's post-press behaviour: `pressbuffer` white flash per
  press, `obj_burstbolt` rings positioned from the bolt's own frame, the
  dualbolt double-score, `boltalive` removal, critical grades
- **#47** extract object-definition depths — a whole CLASS of ordering bugs
  that no grep can find and no test can see
- **#46** the animation set against the wiki gallery; the afterimage gating is
  done, the sprite inventory is not
- **#40 / #42** the flavour line: types out progressively, in a SMALLER font
  (`charline = 26`). **Blocked** — `global.battletyper = 4`'s speed is not
  located, and a text speed must not be invented
- **#16** the remaining Draw events

### P2 — correctness still open

- **#45** finish the wiki cross-check. The list of unverified claims is in the
  task. Treat the wiki as a hypothesis: three of its numbers are already
  disproved against the dump
- **#32** Susie's Knight dialogue placement and timing (turns 6-14; the wiki
  has the full script, including the branch on who is down)
- **#36** the sim has no `chardead`; `isUp()` is HP alone. Safe in normal play,
  cannot represent "healed but still down"
- **#44** the game over's second- and third-loss scripts, keyed off
  `global.knight_battle_losses` — deliberately not shipped, because a practice
  tool restarts constantly and a loss counter means something different here

---

## 4. Traps that have each cost hours

These are in CLAUDE.md in full. The ones most likely to bite a fresh session:

1. **The selector is the authority.** `obj_knight_enemy`'s Other_10. Six attack
   branches exist that the fight can never choose. Phase 1 is FIVE turns.
2. **Never pin a value the game sequences itself with** — `mnfight`,
   `myattackchoice`, `turntimer` have each cost a multi-hour bug.
3. **A shortcut must carry EVERY side effect of what it replaces.** One
   `talked = 1` caused three separate bugs.
4. **A silent no-op passes every test.** Five instances so far. Verify a
   behavioural change by observing the behaviour, not by watching suites stay
   green.
5. **A green suite does not mean the change took effect.**
6. **Absence is only meaningful from a whole-dump grep** — one GlobalScript
   file defines many functions and its filename matches none of them.
7. **GML in a C# verbatim string needs `""` for every quote, including inside
   comments.** Four compile failures. `~/knight-research/tools/lint-csx.py` is
   wired into the build; use it.
8. **f32:** every built-in instance field narrows to f32 on store.
9. **Draw order is by depth**, and `obj_attackpress` does its whole mechanic in
   Draw — which is why oracle input must derive from `global.time`, not from a
   mask published in a Draw.

---

## 5. Commands

```bash
export PATH="$HOME/tools/node/bin:$PATH"   # Node is NOT on PATH
cd ~/knight-sim && npm run verify          # expect 40/41; fullfight is #28
node tools/verify-damage.mjs               # no bullet holds the placeholder
```

Preview: `preview_start` with the `knight-sim` launch config (port 8177), then
`/web/index.html?mode=practice&attack=flurry&difficulty=0&pause=1&frames=140`.
`?frames=` + `?pause=1` makes any named frame reproducible; `?replay=<token>`
replays a recorded run. `window.__sim` exposes `state`, `step(n)` and `over`.

Oracle (private repo, ~90s per run, re-sign after every rebuild):

```bash
~/knight-research/tools/record-fullfight.sh <name>
```

---

## 6. What the user cares about, stated plainly

- The fight, as actually played, matching the real thing frame for frame.
- Being told the truth about what is verified and what is not. Report
  "mechanics one-to-one, shuffle order replayed" rather than "verified" when
  that is what happened.
- Not shipping invented content. If something must be a placeholder, it is
  labelled where the player sees it.
