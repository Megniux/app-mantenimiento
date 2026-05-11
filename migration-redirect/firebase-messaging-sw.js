// Service Worker de auto-desregistro.
// Reemplaza al firebase-messaging-sw.js viejo. Se instala, se activa,
// se desregistra a sí mismo, limpia todas las caches y fuerza una recarga
// de los clientes para que vean la página de mudanza.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => {
        try { c.navigate(c.url); } catch (_) {}
      });
    } catch (_) {}
  })());
});

// Si quedó algún listener de push del SW anterior, este SW ya no recibirá nada
// porque se desregistra al activarse.
