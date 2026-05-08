// Service Worker de Firebase Cloud Messaging.
// Vive en la raíz porque Firebase Messaging exige que el SW tenga scope raíz.
// Usa la versión "compat" del SDK porque los Service Workers todavía no soportan
// import maps de manera consistente entre navegadores.

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
  const notif = payload.notification || {};
  const data = payload.data || {};
  const title = notif.title || "Mantenimiento";
  const body = notif.body || "";

  self.registration.showNotification(title, {
    body,
    icon: "logo.jpg",
    badge: "logo.jpg",
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
