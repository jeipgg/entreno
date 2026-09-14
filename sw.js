/* Pole — service worker
   Sube CACHE cuando cambies cualquier archivo, o el iPhone seguirá con la versión vieja. */
const CACHE = 'pole-v11';

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './data/rutina.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './img/colgada-activa.svg',
  './img/hollow-hold.svg',
  './img/plancha-lateral.svg',
  './img/plancha-hombro.svg',
  './img/bird-dog.svg',
  './img/dead-bug.svg',
  './img/remo-invertido.svg',
  './img/bisagra.svg',
  './img/puente-unilateral.svg',
  './img/flexion.svg'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // uno por uno: si falta un archivo, no tumba toda la instalación
    await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // videos de YouTube: nunca se cachean

  // rutina.json: red primero (para que un cambio se vea), cache de respaldo
  if (url.pathname.endsWith('rutina.json')) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, r.clone());
        return r;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // el resto: cache primero
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
      return r;
    } catch {
      return (await caches.match('./index.html')) || Response.error();
    }
  })());
});
