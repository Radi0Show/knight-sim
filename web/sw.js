// The service worker: what makes add-to-home-screen a standalone app rather
// than a browser tab, and what keeps the fight playable offline once loaded.
//
// STRATEGY, deliberately boring: navigation goes network-first (a deploy is
// picked up on the next launch, offline falls back to the cached shell);
// everything else — sprites, audio, modules — is cache-first with a
// background fill, because those files are content-stable between deploys
// and there are hundreds of them. CACHE bumps on deploy via sw.js itself
// changing, which retires the old cache in activate.
// KEEP IN LOCKSTEP WITH web/version.js — the worker cannot import modules,
// so the link is by convention: every release bumps both, and the new cache
// name is what makes an installed PWA pick up the new build.
//
// THE PREFIX IS THE SEPARATION (2026-09-02). Cache Storage is PER ORIGIN, not
// per path, and GitHub project pages share one origin -- so the old activate,
// which deleted every cache that was not this one, would have evicted a
// sibling game's cache on every launch and been evicted by it in turn. The
// kaizo recreation now lives in its own repo with its own worker (prefix
// kaizoknight-); this one deletes ONLY its own prefix, and so does that one.
const PREFIX = 'blackknife-';
const CACHE = PREFIX + '1.0.17';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './main.js'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return r;
        })
        // THE SHELL MAY ONLY STAND IN FOR ITSELF.
        //
        // This used to end `?? caches.match('./index.html')` for EVERY failed
        // navigation, which is the right reflex for a single-page app and
        // wrong the moment the site has two pages. There are two now, and a
        // request for kaizo.html that failed — a flaky connection, a slow dev
        // server, genuinely offline — was answered with the VANILLA title
        // screen: the wrong game, silently, with the URL still saying kaizo.
        // Observed as the tab flipping between the two.
        //
        // A cached copy of the page actually asked for is always right. Past
        // that, only a request for the root or index may be handed the shell;
        // anything else gets an honest failure, because showing someone a
        // different application is worse than showing them an error.
        .catch(() => caches.match(e.request).then((m) => {
          if (m) return m;
          const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
          if (isShell) return caches.match('./index.html');
          return new Response(
            'Offline, and this page is not cached.',
            { status: 503, headers: { 'Content-Type': 'text/plain' } },
          );
        })),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    })),
  );
});
