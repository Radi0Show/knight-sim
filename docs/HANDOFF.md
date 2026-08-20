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
| whole-fight diff vs the oracle | **row-exact through frame 884, diverges at 885** — turns 1-2 exact; turn 3 (Flurry) exact through its first slash + first split + all 13 teeth. Solved: Flurry's launch pad is TWO draws before the boxsplitter's create (`fight.js` case 2, oracle-fitted to the slash log); the split organism's DRAW-phase RNG is now consumed live (`drawRngTail` in practice.js: 8/frame while the box is split, 2/frame per living tooth). REMAINING: each inter-slash window consumes a few MORE one-draw events than the sim — measured at stream positions: slash inits should land at 9, 554, 2181, 4244 (scan of the anchored stream vs the logged angleoffsets in `fullfight-slashes2.csv`); the sim lands at 9, 553, 2180, 4241 (+1, +1, +3 cumulative). NOT sounds (snd_play* never draw — read the wrappers), not tooth events, not dmgwriter hits (counts don't correlate). Next probe: instrument the oracle to log the live stream position per frame (e.g. a patched scr that logs a NON-consuming marker is impossible — instead log each `random_*` call site in the split organism's window with a per-site counter patch, or bisect by logging slashes at finer granularity). `rng.js` now counts draws (`state.gmlRng.draws`) — replay any trace and print positions at suspect sites to compare against the absolute positions above. |
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

## 2026-08-14 — f177 -> f296; the method's margin has shifted

Byte-exact through f295 on fullfight-anchor2. Eight mechanics landed (see
the commit); the two collision calibrations (rect-probe/rect2-probe,
graze-probe) and the rectA/precise masksOverlap split are the load-bearing
ones. Every divergence this session turned out to be a REAL mechanic, not
noise — including a 0.07px star cull that was the camera shake moving the
despawn boundary.

OPEN at f296: on a hit frame the oracle pays the four NON-hitting bullets'
graze trickles but not the hitter's own, while the sim (damage-then-graze)
pays none. The grazebox-vs-heart collision-event order that explains BOTH
f201 and f296 is not yet found; the unconditional graze logger is already
in oracle_fullfight.csx (inv column added) — one re-record answers it.

STRATEGY NOTE, agreed with the user: the recordings are DETERMINISTIC (same
token, same trace — anchor2/4/5 differ only in instrumentation), so the
target is stable. But the marginal first-divergence now costs hours and
sits in runner-quantization minutiae. Before burning more on frame-exact
graze timing: (1) read the differ's LATER groups too — it already compares
all 9000 frames; fix structural divergences anywhere in the fight first
(they are cheap and matter to play); (2) consider a narrow documented
tolerance for hit-frame trickle timing, like the trig 0.02px carve-out;
(3) if bit-exactness on collision internals is ever really needed, the
next tool is disassembling the runner's collision routine, not more
black-box probing (same conclusion CLAUDE.md reached for ds_list_shuffle).

## 2026-08-14 (later) — player-reported fidelity pass

Five reports from actually playing it, all root-caused in the dump rather
than tuned by eye. Suites now 42/43 (verify-fullfight is still #28).

1. Charboxes vanished during target select — scr_charbox's mmy = -170 slide
   belongs to the rouxlsgrid branch, which this fight never enables.
2. Chatbox text cut off / cramped / popping — the renderer had invented its
   layout. obj_writer's formatter (charline 33, last-space break, `||` hang)
   and scr_texttype's real metrics (typer 6: mainbig/16/36; typer 81:
   dotumche/9/20) are ported. fnt_main + fnt_dotumche extracted.
3. HP showed 0 instead of -999 — the swoon system is in: scr_dead's five
   globals, scr_revive's three, both floors (-80 Kris / -999 allies) and
   scr_heal's revive gate. New suite verify-swoon.
4. "Buffered ~10 seconds, usually later attacks" — a missed bolt never
   expired (`boltframe - boltx < -5`), so the bar could never finish.
5. "Stars is missing sounds" — snd_stardrop per star spawn, plus the
   charge-up's powerup and the block bell. New suite verify-audio-coverage
   re-derives the expected sound set from the dump every run.

NOT STARTED, both real content: the opening roar animation (task #4) and the
Susie-vs-Knight ending cutscene (task #5). Sources identified: obj_ch3_PTB02's
battle-start path for the intro, and the end_cutscene_version gate in
obj_knight_enemy's Draw (already stubbed as endCutsceneReached /
startEndCutscene) for the ending.

Also open, found while auditing audio: `blockanim = 1` is never armed — the
Knight's BLOCK (obj_heroparent's knightblock) is not modelled. The bell is
wired behind it so landing the mechanic is one assignment.

## TRAP: the preview pane's server is NOT the devserver

The in-app preview starts a PLAIN `python3 -m http.server` on the
launch.json port, ignoring runtimeExecutable — no no-store headers and no
module stamping. The browser then reuses its instantiated ES-module graph
across reloads, and every edit looks like it did nothing (or throws errors
from code that no longer exists — `process is not defined` from a debug
line deleted an hour earlier). This burned most of a browser-verification
session TWICE.

Check `lsof -nP -iTCP:8177 -sTCP:LISTEN` + `ps` for `-m http.server` vs
`devserver.py`. The reliable setup: run `python3 tools/devserver.py 8178`
yourself and point the preview tab at :8178.

## 2026-08-14 (later still) — intro and ending landed

- THE OPENING ROAR: obj_knight_roaring_fx ported on its visual-only path,
  run DRIVER-SIDE between title and fight (the real one plays in the
  overworld before scr_battle exists) — so tokens, the diff and all suites
  are untouched by it. Skippable; plays on NORMAL/HITLESS entry only.
- THE ENDING, battle side: the ending hit's shake chord and triple hurt,
  the %3 strobe, the white fade at endtimer 32, the UI teardown past 45,
  and the tool's victory card at the white handoff. The STORY scene
  (Susie/Undyne/the bird) is sourced (PTB02 con 10-12) but needs the
  overworld sprite extraction — task list lives on task #5.
- knightblock is INTRO-ERA content: `blocking = 1` survives exactly one
  knight step once the heroes exist, and `damagereduction < 0.1` never
  recurs — the block cannot fire in play. The bell waits behind blockanim.

## 2026-08-14 (final) — the Susie cutscene shipped

The full post-fight scene (obj_ch3_PTB02 con 10-12) is in: glide, beam,
the Susie grab, Undyne and the spear barrage, the turn, the bird flight
with the Undyne snatch, and Susie's chase — driver-side between the white
fade and the victory card. sim/victory-scene.js has the sourcing and every
labelled approximation; 24 sprites and 6 sounds extracted (numeric ids
resolved first: reach = 1930 = look_down_full, spear = 4402).

Manifest note: assets/sprites/manifest.json is now minified (the merge
rewrote it); 184 -> 208 entries, verified nothing lost.

Verification pattern for driver-side scenes: headless full-timeline drive
(phases + cue counts) plus live browser sampling of key beats — the
throttled preview tab cannot play 40s in real time.

## 2026-08-14 (later) — the intro rebuilt to the full pre-fight sequence

Player feedback drove it: longer, the red screen layer, the sword draw,
the party on screen, the snow at the edge. All five sourced and in
(02c5c1f). Findings that matter beyond the intro:

- **dump_room.csx** (research side): dumps a room's layers/tiles/assets +
  textures. room_dw_snow_zone has NO tiles — black room, vista drawn by
  obj_dw_snow_zone_parallax in WORLD coordinates with camera clamps all
  saturated at cam 2230, and SOLID BLACK from world x 2600 right. Use this
  script whenever a scene's look is in question — the battle-bg object was
  the wrong source and cost a round of player feedback.
- **object_ids.csx**: numeric object id -> name (the 46 in
  scr_script_repeat = obj_afterimage_screen).
- **First-run vs revisit staging**: PTB02 creates the knight at
  (2350, cameray()+100) in con 0 (script lerps +320 -> 2670); the
  (2655, +106) in Create is the tempflag[90] REVISIT branch. Check which
  branch stages a scene before taking its coordinates.
- **obj_knight_circle's missing r-approach is an ORIGINAL BUG** — the white
  climax circle turns pure red and stays; the destroy test reads b==0
  twice. That IS the red screen layer.
- The title confirm was skipping the intro (a ~100ms press spans four 30Hz
  frames) — maskHeldInput() now runs at the transition.
- **__intro.drive(t)** paints any intro frame deterministically (and
  __intro.hold freezes the loop) — screenshot tooling stalls rAF and the
  drain then blasts through the timeline, so real-time watching in the
  pane is useless for cutscenes.

## 2026-08-14 (later still) — the ENDING was the wrong branch; rebuilt

flag[50] == 1 means the KNIGHT was violenced (win by hit), not that the
party lost — PTB02 con 8 routes it to con 49 -> 50: the warp destabilise,
Susie's clash + parry + the sword shard, the taunts, the two blackout
slashes with SWOON writers, and the knighting. The con 10-12 beam/Undyne
scene shipped earlier is a DIFFERENT aftermath and is out of the flow.
Read the flag semantics before trusting a branch's name.

The scene ends at the knighting -> MAIN MENU (player-directed).
__cutscene.drive(t) inspects any ending frame; drawSnowBackdrop is shared
intro/ending and camera-aware. Ids resolved: rsprite 686 =
spr_susier_dark, loopsfx 169 = snd_suslaugh, dmgwriter type 12 =
spr_battlemsg frame 13 in c_red.

## 2026-08-14 (last) — THE TRIM: csx-extracted sprites lost their margins

extract_sprite.csx exported the texture-page item UNPADDED: the PNG is
trimmed to inked content while the manifest carries full-sprite dims and
origins, so every csx-extracted sprite drew shifted by its (TargetX,
TargetY) — 38 sprites across the intro/victory/ending/backdrop/textbox,
reported from play as "the sword is not in the correct spot" (28px).
The script now passes includePadding; all 38 re-exported. RULE: any new
extraction must verify PNG dims == manifest w/h (the check is three
lines of node; the mismatch is the whole bug).

Diagnosed statically after a failed detour: a capture bundle that stages
the real intro cutscene (tools/patches/intro_capture.csx — screen_save
every 2nd frame; needs the instrumented LAUNCHER game.ios copied in,
the stock one sits at chapter select) is built and works up to the
chapter boot, kept for future ground-truth needs. macOS screencapture
needs a Screen Recording permission this process lacks; screen_save
avoids it.
