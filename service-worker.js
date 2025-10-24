const CACHE_NAME = "flashcards-v4-idb";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js?v=3",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./img/apple.png",
  "./img/orange.png",
  "./img/banana.png",
  "./img/strawberry.png",
  "./img/shirt.png",
  "./img/pants.png",
  "./img/shoes.png",
  "./img/hat.png",
  "./img/home.png",
  "./img/school.png",
  "./img/playground.png",
  "./img/store.png",
  "./img/boy.png",
  "./img/girl.png",
  "./img/mom.png",
  "./img/dad.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
