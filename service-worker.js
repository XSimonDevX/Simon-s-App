const CACHE_NAME = "flashcards-v66-idb";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js?v=66",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./img/apple.png",
  "./img/orange.png",
  "./img/banana.png",
  "./img/strawberry.png",
  "./img/ice-cream.png",
  "./img/cookies.png",
  "./img/tshirt.png",
  "./img/pants.png",
  "./img/shoes.png",
  "./img/hat.png",
  "./img/socks.png",
  "./img/home.png",
  "./img/school.png",
  "./img/playground.png",
  "./img/store.png",
  "./img/boy.png",
  "./img/girl.png",
  "./img/mom.png",
  "./img/dad.png",
  "./img/grandma.png"
];

// Install: pre-cache app shell
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate for same-origin files
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // skip non-GET requests or cross-origin
  if (request.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const networkPromise = fetch(request).then(res => {
      if (res && res.status === 200) cache.put(request, res.clone());
      return res;
    }).catch(() => cached); // offline fallback

    return cached || networkPromise;
  })());
});

    caches.match(request).then((cached) => cached || fetch(request))
  );
});
