// Bump this any time you want clients to fetch a fresh bundle
const CACHE_NAME = "flashcards-v34-idb";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  // bump the query version whenever script.js changes
  "./script.js?v=34",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",

  // images you actually use in themes
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // activate this SW immediately
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim(); // take control of open pages
});

// Cache-first for precached assets; network fallback for anything else
self.addEventListener("fetch", (event) => {
  const { request } = event;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
