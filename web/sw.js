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
const CACHE = 'blackknife-1.0.2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './main.js'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
        .catch(() => caches.match(e.request).then((m) => m ?? caches.match('./index.html'))),
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
