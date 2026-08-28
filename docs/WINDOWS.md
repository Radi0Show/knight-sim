# Setting up on Windows

The project was built on macOS; this is the migration map. The sim itself is
portable JS — the platform-specific parts are the toolchain and the PRIVATE
research repo.

## Stage 1 — sim development (everything recent work has needed)

1. Install: **Git**, **Node LTS** (the real installer — the macOS
   `~/tools/node` tarball was a no-admin-rights workaround; on Windows just
   install it and skip every `export PATH=` line in the docs), **Python 3**.
2. `git clone` this repo.
3. Copy **knight-research** from the Mac by DIRECT MEANS ONLY — external
   drive or local network. It is private and has no remote; that rule
   survives the move. Put it at `%USERPROFILE%\knight-research` — the tools
   find it via `os.homedir()`.
   - Minimum viable subset (~700MB of the 2.5GB): `traces/`, `gml_dump/`,
     `tools/`. The oracle bundles (~1.8GB) are rebuildable from a Windows
     DELTARUNE install and only matter for Stage 3.
4. `npm run verify` — **60 suites green proves the environment.** The suite
   paths were ported (`os.homedir()`, `fileURLToPath`) so a native-Windows
   Node works; no HOME variable needed.

## Stage 2 — the dev loop

- `python tools/devserver.py` serves the page; `.claude/launch.json` works
  with Claude Code on Windows as-is.
- `afconvert` (audio compression) is macOS-only. Windows equivalent:
  `winget install ffmpeg`, then `ffmpeg -i in.wav -c:a aac -q:a 1 out.m4a`.
  Only matters when extracting new audio.

## Stage 3 — oracle recording (defer; the fight is one-to-one already)

Recording NEW oracle traces on Windows is actually simpler than the Mac ever
was, but the harness needs porting:

- The data file is **`data.win` at the standard Steam path** — the whole
  `game.ios` platform note in CLAUDE.md inverts; Windows is what every guide
  online assumes.
- **UndertaleModTool has a native Windows build, GUI included** — no Rosetta,
  and the entire codesign/re-sign dance disappears (that was Apple Silicon
  only). The `< /dev/null` stdin-hang workaround for the CLI may still apply.
- The bash harness (`build-oracle.sh`, `record-fullfight.sh`) runs under Git
  Bash with path changes: the save dir is `%LOCALAPPDATA%\DELTARUNE` (not
  `~/Library/Application Support/com.tobyfox.deltarune`), and four `.csx`
  patches hardcode `/Users/aidanflynn/...` paths that must be updated.
- Alternative that avoids all of it: keep the Mac as the recording rig and
  carry the CSVs over. Verification ("step 5") runs anywhere the CSVs exist.

## Claude-side

- CLAUDE.md and docs/HANDOFF.md ride in this repo and are the operational
  ground truth — that was always the design, so a fresh machine's sessions
  start informed.
- The assistant's file memory lives outside the repo
  (`~/.claude/projects/.../memory/` on the Mac); copy it to the Windows
  Claude directory if continuity of the small cross-project notes matters.
