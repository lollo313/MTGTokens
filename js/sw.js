// sw.js
// Cache-first per i file dell'app (l'"app shell"), così l'app si apre anche
// senza connessione. Le chiamate a Scryfall/Archidekt vanno sempre in rete:
// non vogliamo servire dati di carte/token da una cache potenzialmente vecchia.

const CACHE_NAME = 'token-tracker-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/scryfall.js',
  './js/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo same-origin: le richieste verso api.scryfall.com o archidekt.com
  // passano dritte in rete, senza intercettazione.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
