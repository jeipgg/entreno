/* GENERADO por herramientas/generar-sw.mjs — no editar a mano.
   El nombre de caché es el hash del contenido: cambia solo cuando cambia algo. */
const CACHE = 'pole-e17511f4d6';
const ASSETS = [
  "./",
  "./README.md",
  "./app/app.css",
  "./app/data/arbol.json",
  "./app/data/calendario.json",
  "./app/data/ejercicios.json",
  "./app/data/sesiones.json",
  "./app/data/textos.json",
  "./app/icons/icon-180.png",
  "./app/icons/icon-192.png",
  "./app/icons/icon-512-maskable.png",
  "./app/icons/icon-512.png",
  "./app/icons/icon.svg",
  "./app/img/bird-dog.svg",
  "./app/img/bisagra.svg",
  "./app/img/colgada-activa.svg",
  "./app/img/dead-bug.svg",
  "./app/img/flexion.svg",
  "./app/img/hollow-hold.svg",
  "./app/img/plancha-hombro.svg",
  "./app/img/plancha-lateral.svg",
  "./app/img/puente-unilateral.svg",
  "./app/img/remo-invertido.svg",
  "./app/index.html",
  "./app/js/cronometro.js",
  "./app/js/estado.js",
  "./app/js/main.js",
  "./app/js/motor.js",
  "./app/js/reglas.js",
  "./app/js/tiempo.js",
  "./app/js/vista.js",
  "./app/manifest.webmanifest",
  "./index.html"
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // YouTube nunca se cachea

  if (url.pathname.includes('/data/')) {        // contenido: red primero
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        (await caches.open(CACHE)).put(req, r.clone());
        return r;
      } catch { return (await caches.match(req)) || Response.error(); }
    })());
    return;
  }

  e.respondWith((async () => {                  // el resto: caché primero
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
      return r;
    } catch { return (await caches.match('./app/index.html')) || Response.error(); }
  })());
});
