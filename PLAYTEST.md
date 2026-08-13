# Playtesting the Roaring Knight Simulator

Thanks for testing. This is a practice tool for DELTARUNE Chapter 3's Roaring
Knight fight — the attacks are translated from the game itself, so the point of
testing is to find where it *doesn't* match.

## Playing

Open the link. Nothing to install.

| key | |
|---|---|
| arrows / WASD | move the soul |
| **Z** | confirm |
| **X** | cancel — and hold it to move slowly while dodging |
| **R** | restart the fight |
| **P** | pause |
| **B** | **report a bug** |

X does two jobs on purpose: that's how the real game binds it.

## Reporting a bug — press B

**When something looks or behaves wrong, press `B` straight away.**

That copies a **replay token** to your clipboard — a short string that
reproduces your entire run, frame for frame, on my machine. It looks like:

```
K1.9.fight.-.0.420.IAIABiACAAYgAgAGIAIABiACA...
```

Then [open an issue](https://github.com/Radi0Show/knight-sim/issues/new?template=bug.yml),
paste it in, and say
what looked wrong. That's it — you don't have to describe how to get there,
because the token already does.

**Press B before restarting.** A reset starts a new recording, so the token
only covers the run you're currently in.

### What's worth reporting

Anything that looks off against the real fight:

- an attack that behaves differently to how it does in-game
- a sprite in the wrong place, wrong colour, missing, or flickering
- damage or timing that feels wrong
- the menu doing something odd — items, TP, cancelling
- anything that freezes, or throws you out of the fight

"It felt harder than the real thing" is a useful report too. So is "the sword
tunnel ends weirdly." Vague is fine as long as the token is attached.

### Known and expected

- **Sound effects only, no music.** The SFX are in; the soundtrack is not, so
  the fight plays without its track. If a sound is missing, late, or stacks up
  into a wall of noise, that IS worth reporting.
- The HUD line at the bottom is developer info, not part of the game.
- The Knight's HP shows `???` — that's correct, the real fight hides it.

## For me (fixing one)

```bash
node tools/replay.mjs "<token>"                  # summary + the frames you got hit
node tools/replay.mjs "<token>" --at 412         # state at a specific frame
node tools/replay.mjs "<token>" --trace out.csv  # full per-frame trace
```

The tool prints a `?replay=` URL that lands the browser on the exact frame,
input and all — that's the half a headless replay can't check, because the
token captures `sim/` and not the renderer.

**If a token doesn't reproduce the bug, that's a finding, not a dead end:** it
means the problem is in `render/`, and the search just halved.
