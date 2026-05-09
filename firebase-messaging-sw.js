// Service Worker de Firebase Cloud Messaging.
// Vive en la raíz porque Firebase Messaging exige que el SW tenga scope raíz.
// Usa la versión "compat" del SDK porque los Service Workers todavía no soportan
// import maps de manera consistente entre navegadores.

// skipWaiting + clients.claim: cada deploy nuevo del SW se activa de inmediato
// en lugar de quedar "waiting" hasta que se cierren todas las pestañas/PWAs.
// Sin esto, en PWAs instaladas el SW viejo persiste durante semanas.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDew-CFyPQ8fIUPQf_vnInM9-JZEuV1zi8",
  authDomain: "mantenimiento-app-170e5.firebaseapp.com",
  projectId: "mantenimiento-app-170e5",
  storageBucket: "mantenimiento-app-170e5.firebasestorage.app",
  messagingSenderId: "555398253444",
  appId: "1:555398253444:web:565d98dbbe52844b5bebd1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Payload data-only desde la Cloud Function: el título y el cuerpo vienen como
  // strings dentro de payload.data. Esto evita la doble notificación que ocurre
  // cuando FCM auto-muestra el bloque "notification" Y además el SW dispara una.
  const data = payload.data || {};
  const title = data.title || "Mantenimiento";
  const body = data.body || "";

  self.registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    // El badge (small icon de Android, barra de estado) DEBE ser monocromático
    // con alpha. Si pasamos un PNG a color, Android dibuja un cuadrado vacío.
    badge: "icons/icon-badge.png",
    data,
    tag: data.ordenId || undefined
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.ordenId ? `./?orden=${encodeURIComponent(data.ordenId)}` : "./";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        c.focus();
        if ("navigate" in c) c.navigate(target).catch(() => {});
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
