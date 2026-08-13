#!/usr/bin/env bash
# Install the fight's SFX into assets/audio/ from a local extraction.
#
# NOTHING HERE IS SHIPPED. `assets/audio/` is gitignored and empty in the repo:
# DELTARUNE's audio is sold separately and is the most sensitive asset on this
# project (CLAUDE.md, "Assets"). The tool ships silent, and each player points
# it at their own copy of the game.
#
# Two steps, because the fight's 19 cues are all PACKED — not one of them is a
# loose .ogg in the bundle:
#
#   1. extract, from your own game file:
#        cd ~/knight-research
#        SND_LIST=<list of cue names> ~/tools/utmt-cli/UndertaleModCli load \
#          oracle/DELTARUNE.app/Contents/Resources/chapter3_mac/game.ios \
#          -s tools/patches/extract_audio.csx -o /tmp/x.ios
#
#   2. install:
#        tools/install-audio.sh
#
# Regenerate the cue list at any time with:
#   grep -rhoE "cue(Loop)?\(state, '[a-z0-9_]+'" sim/ | sed "s|.*'\(.*\)'|\1|" | sort -u
set -euo pipefail

SRC="${1:-/tmp/snd_out}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/assets/audio"

if [ ! -d "$SRC" ]; then
  echo "no extraction at $SRC — run the .csx in step 1 first" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC"/* "$DEST"/

# index.json maps CUE NAME -> FILE. It carries the extension because the game
# stores some sounds as WAV and some as OGG, and because render/audio.js only
# requests samples the manifest lists — without it, the shipped default (no
# audio folder) logs one 404 per cue on every load.
python3 - "$DEST" <<'PY'
import json, os, sys
dest = sys.argv[1]
index = {}
for f in sorted(os.listdir(dest)):
    if f == 'index.json':
        continue
    name, ext = os.path.splitext(f)
    if ext.lower() in ('.wav', '.ogg', '.mp3'):
        index[name] = f
with open(os.path.join(dest, 'index.json'), 'w') as fh:
    json.dump(index, fh, indent=1, sort_keys=True)
print(f'{len(index)} samples indexed in {dest}')
PY
