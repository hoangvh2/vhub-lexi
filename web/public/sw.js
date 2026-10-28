/* VH Lexi service worker: offline app shell + versioned dictionary shards. */
const PRECACHE = __PRECACHE__;
const BUILD = "__BUILD__";
const SHELL = `lexi-shell-${BUILD}`;
const DICT = "lexi-dict";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lexi-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(fallbackKey ?? req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackKey ?? req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, SHELL, "/").catch(() => caches.match("/")));
    return;
  }
  if (url.pathname === "/dict/latest.json") {
    e.respondWith(
      networkFirst(req, DICT).then(async (res) => {
        // Drop cached shards of older dictionary versions.
        try {
          const { version } = await res.clone().json();
          const cache = await caches.open(DICT);
          for (const k of await cache.keys()) {
            const p = new URL(k.url).pathname;
            if (p.startsWith("/dict/v") && !p.startsWith(`/dict/${version}/`)) cache.delete(k);
          }
        } catch {}
        return res;
      }),
    );
    return;
  }
  if (url.pathname.startsWith("/dict/")) {
    e.respondWith(cacheFirst(req, DICT));
    return;
  }
  if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) {
    e.respondWith(cacheFirst(req, SHELL));
  }
});
