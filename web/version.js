// THE VERSION, shown bottom-left of the title screen.
//
// BUMP THE PATCH NUMBER ON EVERY CHANGE THAT SHIPS — a fix, a feature, a
// tweak; if a player could notice it, it gets a number. This is the release
// discipline the project runs on (CLAUDE.md, "Versioning"), and it exists so
// a bug report can say which build it came from now that the replay-token
// reporter is gone.
//
// WHEN YOU BUMP THIS, BUMP `CACHE` IN web/sw.js TO MATCH. The service worker
// cannot import modules, so the two are linked by convention: the cache name
// is what makes an installed PWA fetch the new build instead of serving the
// old one forever.
export const VERSION = '1.0.15';
