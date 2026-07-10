// sw.js
// Strategia di aggiornamento a due velocità:
//  - CODICE dell'app (navigazione HTML, file .js e .css) => NETWORK-FIRST:
//    si prende sempre la versione fresca dalla rete e si aggiorna la cache;
//    la cache serve solo da fallback quando si è offline. Così gli update si
//    vedono al PRIMO reload, senza dover disinstallare il service worker.
//  - ASSET statici (immagini, icone, manifest) => CACHE-FIRST con revalidate
//    in background: caricamento istantaneo, aggiornati silenziosamente.
//  - Richieste cross-origin (api.scryfall.com, archidekt.com) e non-GET =>
//    NON intercettate: vanno sempre dritte in rete.

const CACHE_NAME = 'token-tracker-v9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/scryfall.js',
  './js/storage.js',
  './img/bg-texture.png',
  './icons/logo.svg',
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
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// È "codice" dell'app — da tenere sempre fresco — una navigazione o un .js/.css?
function isAppCode(request, url) {
  return request.mode === 'navigate' || /\.(?:js|css)$/.test(url.pathname);
}

// Rete prima, cache come rete di sicurezza offline.
async function networkFirst(request, cache) {
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // navigazione offline senza corrispondenza esatta: servi la shell
    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./'));
    }
    throw e;
  }
}

// Cache prima (istantanea), aggiornata in background per il reload successivo.
async function staleWhileRevalidate(request, cache) {
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET same-origin: Scryfall/Archidekt e i POST passano dritti in rete.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      isAppCode(request, url)
        ? networkFirst(request, cache)
        : staleWhileRevalidate(request, cache)
    )
  );
});