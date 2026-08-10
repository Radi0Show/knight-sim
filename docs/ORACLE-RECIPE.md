# Recording an oracle trace

The full procedure for verifying a new attack. Every step here was paid for
with a multi-hour bug; the ordering is not arbitrary.

A working example to copy: `knight-research/tools/patches/oracle_t7_rotating.csx`
(rotatingslash) — it is the cleanest and exercises every part of this.

---

## 0. Before touching the game: read

**Static analysis first, always.** A grep costs seconds; a game run costs ~90.
Most of the wasted time on this project came from testing a guess by launching
rather than answering it from the dump.

```bash
cd ~/knight-research/gml_dump/CodeEntries
```

1. **Confirm the fight actually uses the attack.** The authority is
   `obj_knight_enemy`'s **Other_10** (the selector), NOT the dispatch table in
   its Step. Six `myattackchoice` branches exist that the selector can never
   choose. See CLAUDE.md → THE REAL FIGHT.
2. **Find its `dc.type`** in the knight's Step, plus `invc` and any box
   size/position override.
3. **Read the type's block** in `gml_Object_obj_dbulletcontroller_Step_0.gml`.
   Some types are thin wrappers that create a driver object (104); others run
   the whole attack inline (98).
4. **Trace EVERY creator** of anything you plan to translate, all the way to a
   selector-reachable root, before calling it live or dead. Checking one
   creator and stopping is how the box splitter was wrongly declared dead.
5. **Grep for writers of anything you care about**, e.g.
   `grep -rn 'obj_heart\.x *=' *.gml`. This one line would have saved hours.

---

## 1. Build the patch

Copy an existing patch. The skeleton:

```
tester Create   encounter 115, battlecontroller, box (NOT the soul yet)
tester Step     HP upkeep only
tester Draw     exit;
obj_time Draw   soul placement, attack launch, per-frame CSV row
```

### Non-negotiables

**Set `myattackchoice` on the knight.** A fresh knight defaults to 0
(Swordslash) and its End Step then drags the soul to x 165 every frame.

```gml
if (i_ex(obj_knight_enemy))
    obj_knight_enemy.myattackchoice = <ac>;
```

**Never pin a value the game sequences itself with.** `mnfight`,
`myattackchoice`, `turntimer` have each cost hours. Give a starting value and
let the game drive it:

```gml
global.turntimer = 300;   // in Create; battlecontroller counts it down
```

**Create the box first, the soul only after it has finished growing.** The box
starts at `image_xscale = 0` and grows over ~15 frames; a soul created in the
same frame is shoved out of the arena by the growing ring's collision.

```gml
if (!i_ex(obj_heart) && i_ex(obj_growtangle) &&
    obj_growtangle.image_xscale >= obj_growtangle.maxxscale)
    instance_create(obj_growtangle.x - 6, obj_growtangle.y - 8, obj_heart);
```

**Launch through the real controller**, inside the knight's scope — never by
hand-constructing the attack object. `scr_bullet_inherit` only propagates
`creatorid`/`creator` when the CALLER is `obj_dbulletcontroller`; skipping it
crashes the attack on its first Step.

```gml
with (obj_knight_enemy)
{
    var _dc = scr_bulletspawner(x, y, obj_dbulletcontroller);
    _dc.type = <N>;
    _dc.difficulty = <D>;
}
```

**Make damage a recorder.** A Game Over destroys `obj_heart` and the buffered
trace dies with it.

```gml
Patch("gml_Object_obj_collidebullet_Other_15", @"
if (variable_global_exists(""oracle_hits""))
    global.oracle_hits += 1;
");
```

**Flush periodically.** `file_text_*` writes are buffered; a crash loses
everything not yet closed.

```gml
if ((global.oracle_frame mod 50) == 0)
{
    file_text_close(global.oracle_file);
    global.oracle_file = file_text_open_append(""oracle_trace.csv"");
}
```

**Trace `image_angle` and the scales** for anything whose mask rotates or
scales. A field nothing looks at is a field that can diverge silently.

### Two syntax traps that cost four compile failures each

- GML inside a C# verbatim string needs **doubled quotes** — including quotes
  inside comments. `""bullets""`, not `"bullets"`.
- Replacing a decompiled code entry **drops anything else declared in it**.
  The `enum e__VW { XView, YView, ... }` at the bottom of many entries is the
  usual casualty — redeclare it.

### Patching an object at all? Enumerate its events first

```bash
ls gml_Object_<name>_*.gml
grep -hoE '\b[a-z_]+\b' gml_Object_<name>_*.gml | sort -u   # vars they read
```

Patching one event at a time produced four consecutive crashes on
`obj_bullettester_new` (Create → Step → Draw → an undefined instance var).

---

## 2. Build, sign, run

```bash
S=/tmp/scratch                      # any scratch dir
cd ~/tools/utmt-cli
./UndertaleModCli load \
  ~/knight-research/oracle/DELTARUNE.app/Contents/Resources/chapter3_mac/game.ios \
  -s ~/knight-research/tools/patches/<patch>.csx -o "$S/patched.ios" < /dev/null

DST=~/knight-research/oracle-instrumented/DELTARUNE.app
cp "$S/patched.ios" "$DST/Contents/Resources/chapter3_mac/game.ios"
codesign --force --deep --sign - "$DST"          # REQUIRED on Apple Silicon
"$DST/Contents/MacOS/Mac_Runner" > "$S/run.txt" 2>&1 &
sleep 50
pkill -f oracle-instrumented
```

- `< /dev/null` — the CLI hangs on stdin when backgrounded.
- **Always check the compile output.** A failed import silently leaves the
  PREVIOUS build in place, and the run then produces stale, misleading data.
  Grep for `APPLIED|rror|Compile`.
- **Always check for runtime errors**: `grep -A6 -iE '^ERROR in' "$S/run.txt"`.
  A modal GML error looks exactly like a hang.

Collect:

```bash
cp ~/Library/Application\ Support/com.tobyfox.deltarune/oracle_trace.csv \
   ~/knight-research/traces/<name>.csv
```

---

## 3. Translate

Line-for-line, in source order. Rules 3–5 in CLAUDE.md are not stylistic:
preserve operation order, integer math, and phase order.

Where RNG is involved, prefer `gmlRng` (it reproduces the real stream). Where
the stream is impractical to align — `ds_list_shuffle`, or draws far downstream
of the seed — record the outcomes from the trace and replay them, and say so in
the file header.

Engine facts already handled for you: f32 built-ins narrow automatically
(`spawn()` installs accessors), friction and gravity are in the motion phase,
and collision is a calibrated precise-mask test.

---

## 4. Verify

Build a scene in `tools/scenes/oracle-<n>.js` mirroring the patch exactly, and
a `tools/verify-<name>.mjs` that diffs it.

- Compare at the **oracle's** recorded precision, per value — never a fixed
  epsilon, which silently accepts divergence in a coarsely-printed column.
- Add a **positive execution assertion** (`state.counters`). A suite of
  negative results once hid a dead code path for hours.
- **State the window honestly.** If something outside the model perturbs a
  column, narrow the claim and write down why — do not widen the tolerance.

Then add it to `tools/verify-all.mjs` and run `npm run verify`.
