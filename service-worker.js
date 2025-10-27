// Bump this any time you want clients to fetch a fresh bundle
const CACHE_NAME = "flashcards-v97";

// Build a base path from the SW scope (works on GitHub Pages subpath)
const BASE = self.registration.scope.replace(/\/$/, "");

// Precache core assets
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/style.css?v=97`,
  `${BASE}/script.js?v=97`,
  `${BASE}/manifest.json?v=97`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`
  // add theme images here if you want them pre-cached:
  // `${BASE}/img/apple.png`, etc.
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // activate immediately
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
