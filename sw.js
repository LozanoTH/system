/* =========================================================
   Service worker del POS
   Deja la app instalable y capaz de abrir sin internet:
   - guarda en caché la app (HTML, JS, iconos) y las librerías de CDN,
     que sin conexión dejarían la pantalla en blanco;
   - guarda las últimas lecturas de Firebase, para que al abrir sin
     red se vea el catálogo y los clientes que ya estaban descargados.

   Para publicar una versión nueva basta con subir el SW y cambiar
   VERSION: al activar borra las cachés viejas y se sirve lo nuevo.
   ========================================================= */

const VERSION = "v1";                 /* súbelo al cambiar la app */
const CACHE_APP = "pos-app-" + VERSION;
const CACHE_CDN = "pos-cdn-" + VERSION;
const CACHE_DATOS = "pos-datos-" + VERSION;
const CACHES = [CACHE_APP, CACHE_CDN, CACHE_DATOS];

/* Todo lo que hace falta para pintar la pantalla sin red */
const APP = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "js/config.js",
  "js/db.js",
  "js/ui.js",
  "js/ajustes.js",
  "js/pos.js",
  "icons/icono.svg",
  "icons/icono-192.png",
  "icons/icono-512.png",
  "icons/icono-maskable-512.png",
  "icons/apple-touch-icon.png"
];

/* Librerías externas: con estas URLs fijas basta cachearlas una vez */
const CDN = [
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"
];

/* Cuántas lecturas de la base se guardan (productos, clientes, facturas…) */
const MAX_DATOS = 120;

/* ---------- instalar y activar ---------- */

self.addEventListener("install", evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);

    /* addAll falla entero si un archivo falta; aquí cada cosa va por su cuenta
       para que un icono sin subir no deje la app sin service worker */
    await Promise.all(APP.map(url => cache.add(url).catch(() => {})));

    /* Las librerías de CDN se piden en segundo plano: si el primer arranque
       va sin internet, igual se guardan para el siguiente. */
    caches.open(CACHE_CDN)
      .then(cache => Promise.all(CDN.map(url => cache.add(url).catch(() => {}))))
      .catch(() => {});

    /* Se activa sin recargar la página: en un POS recargar a media venta
       sería justo lo que hay que evitar. */
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", evento => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre.startsWith("pos-") && !CACHES.includes(nombre)) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", evento => {
  if (evento.data && evento.data.tipo === "actualizar") self.skipWaiting();
});

/* ---------- estrategias ---------- */

function esCDN(url) {
  return /(^|\.)(tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|gstatic\.com)$/.test(url.hostname);
}

function esFirebase(url) {
  return /(\.firebaseio\.com|\.firebasedatabase\.(app|hosted))$/.test(url.hostname);
}

const guardable = respuesta => respuesta && (respuesta.ok || respuesta.type === "opaque");

/** Cache first: lo que no cambia (CDN con versión fija). */
async function cacheFirst(request, cachePromesa) {
  const cache = await cachePromesa;
  const guardado = await cache.match(request);
  if (guardado) {
    fetch(request).then(r => { if (guardable(r)) cache.put(request, r.clone()); }).catch(() => {});
    return guardado;
  }
  const respuesta = await fetch(request);
  if (guardable(respuesta)) cache.put(request, respuesta.clone());
  return respuesta;
}

/** Stale while revalidate: la app se pinta al instante y se actualiza detrás. */
async function staleWhileRevalidate(request, cachePromesa) {
  const cache = await cachePromesa;
  const guardado = await cache.match(request);
  const red = fetch(request).then(respuesta => {
    if (guardable(respuesta)) cache.put(request, respuesta.clone());
    return respuesta;
  }).catch(() => null);

  return guardado || red.then(r => r || Promise.reject(new Error("sin red y sin copia guardada")));
}

/** Network first con copia: los datos de la base salen frescos, salvo que no haya red. */
async function networkFirst(request, cachePromesa) {
  const cache = await cachePromesa;
  try {
    const respuesta = await fetch(request);
    if (guardable(respuesta)) {
      await cache.put(request, respuesta.clone());
      await recortar(cache);
    }
    return respuesta;
  } catch (e) {
    const guardado = await cache.match(request);
    if (guardado) return guardado;
    throw e;
  }
}

/** La base puede tener muchas lecturas; se quedan las más recientes. */
async function recortar(cache) {
  const claves = await cache.keys();
  if (claves.length <= MAX_DATOS) return;
  await Promise.all(claves.slice(0, claves.length - MAX_DATOS).map(clave => cache.delete(clave)));
}

self.addEventListener("fetch", evento => {
  const request = evento.request;
  if (request.method !== "GET") return;         /* nunca se cachea una escritura */

  const url = new URL(request.url);

  /* Firebase: red primero para no mostrar precios viejos; si no hay red,
     se sirve la última lectura guardada. */
  if (esFirebase(url)) {
    evento.respondWith(networkFirst(request, caches.open(CACHE_DATOS)));
    return;
  }

  /* Pantalla completa: la app siempre, aunque se esté sin internet */
  if (request.mode === "navigate") {
    evento.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (e) {
        const cache = await caches.open(CACHE_APP);
        return (await cache.match(request)) ||
               (await cache.match("index.html")) ||
               (await cache.match("./")) ||
               new Response("<h1>Sin conexión</h1>", { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 });
      }
    })());
    return;
  }

  if (esCDN(url)) {
    evento.respondWith(cacheFirst(request, caches.open(CACHE_CDN)));
    return;
  }

  if (url.origin === self.location.origin) {
    evento.respondWith(staleWhileRevalidate(request, caches.open(CACHE_APP)));
  }
});