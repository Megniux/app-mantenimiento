// Registro de tokens FCM por dispositivo y listener foreground.
// El SDK reusa la app por defecto inicializada en firebase-config.js.

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
  deleteToken
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

// ⚠️ ACCIÓN REQUERIDA: reemplazar con la VAPID key generada en
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates.
const VAPID_KEY = "grWnoTiHtOOG9e6ynb-vxZLKi0y9vOFIMBcADamIY_k";

let _messaging = null;
let _foregroundBound = false;
let _currentToken = null;
// Deduplica registraciones concurrentes: login() y watchAuth() pueden disparar
// registerPushForUser casi al mismo tiempo, y dos navigator.serviceWorker.register
// en paralelo dejan al SW en estado inconsistente.
let _registerInFlight = null;

async function ensureMessaging() {
  if (_messaging) return _messaging;
  try {
    if (!(await isSupported())) return null;
  } catch (_) {
    return null;
  }
  _messaging = getMessaging(getApp());
  if (!_foregroundBound) {
    onMessage(_messaging, handleForegroundMessage);
    _foregroundBound = true;
  }
  return _messaging;
}

function handleForegroundMessage(payload) {
  const notif = payload.notification || {};
  if (!notif.title) return;
  if (Notification.permission !== "granted") return;
  // Cuando la app está abierta en foreground, mostramos una Notification simple.
  // El SW solo se activa cuando la app está en background/cerrada.
  try {
    new Notification(notif.title, {
      body: notif.body || "",
      icon: "logo.jpg",
      tag: payload.data?.ordenId || undefined
    });
  } catch (_) { /* algunos navegadores móviles solo permiten via SW */ }
}

export function pushSupported() {
  return (
    typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator
  );
}

export function pushPermissionState() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

// Llamado desde auth.js después de un login exitoso.
// - Si el permiso ya está concedido → registra el token en silencio.
// - Si está en "default" → muestra el prompt nativo del navegador. Al ser
//   disparado durante un login (acción del usuario), iOS Safari/Chrome lo
//   permiten siempre que la PWA esté instalada en pantalla de inicio.
// - Si está en "denied" → no insiste; el usuario tiene que reactivar
//   manualmente desde la config del navegador.
export async function registerPushForUser(uid) {
  if (_registerInFlight) {
    console.log("[push] registro ya en curso, reusando promesa");
    return _registerInFlight;
  }
  _registerInFlight = (async () => {
    console.log("[push] registerPushForUser invocado", { uid });
    if (!uid) {
      console.log("[push] sin uid, abortando");
      return null;
    }
    if (!pushSupported()) {
      console.log("[push] navegador no soporta push (Notification/SW)");
      return null;
    }
    console.log("[push] estado inicial del permiso:", Notification.permission);
    if (Notification.permission === "denied") {
      console.log("[push] permiso denegado por el usuario, no se insiste");
      return null;
    }
    if (Notification.permission === "default") {
      try {
        console.log("[push] pidiendo permiso de notificaciones...");
        const permission = await Notification.requestPermission();
        console.log("[push] respuesta del prompt:", permission);
        if (permission !== "granted") return null;
      } catch (err) {
        console.warn("[push] requestPermission tiró error:", err);
        return null;
      }
    }
    console.log("[push] permiso concedido, registrando token...");
    return await getAndSaveToken(uid);
  })().finally(() => {
    _registerInFlight = null;
  });
  return _registerInFlight;
}

// Llamado desde un botón "Activar notificaciones" para forzar el prompt.
export async function requestPushPermission(uid) {
  if (!uid || !pushSupported()) return { ok: false, reason: "unsupported" };
  if (Notification.permission === "denied") {
    return { ok: false, reason: "denied" };
  }
  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return { ok: false, reason: result };
  }
  const token = await getAndSaveToken(uid);
  return token ? { ok: true, token } : { ok: false, reason: "token_failed" };
}

async function getAndSaveToken(uid) {
  const messaging = await ensureMessaging();
  if (!messaging) {
    console.warn("[push] messaging no disponible (isSupported devolvió false)");
    return null;
  }
  if (VAPID_KEY === "REEMPLAZAR_CON_VAPID_KEY") {
    console.warn("[push] VAPID_KEY no configurada en js/notifications/push.js");
    return null;
  }
  try {
    console.log("[push] registrando service worker...");
    await navigator.serviceWorker.register("firebase-messaging-sw.js");
    // serviceWorker.ready resuelve sólo cuando el SW pasó de "installing" a
    // "activated". Sin esta espera, getToken() falla con "no active Service Worker".
    console.log("[push] esperando que el SW esté activo...");
    const swReg = await navigator.serviceWorker.ready;
    console.log("[push] SW activo, pidiendo token a FCM...");
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });
    if (!token) {
      console.warn("[push] FCM devolvió token vacío");
      return null;
    }
    _currentToken = token;
    console.log("[push] token obtenido, guardando en Firestore...", token.slice(0, 20) + "...");
    await persistToken(uid, token);
    console.log("[push] token persistido en users/" + uid + "/fcmTokens/" + token.slice(0, 20) + "...");
    return token;
  } catch (err) {
    console.warn("[push] error registrando token FCM:", err);
    return null;
  }
}

async function persistToken(uid, token) {
  const ref = doc(db, "users", uid, "fcmTokens", token);
  await setDoc(ref, {
    token,
    creadoEn: serverTimestamp(),
    userAgent: (navigator.userAgent || "").slice(0, 200),
    plataforma: navigator.platform || ""
  }, { merge: true });
}

// Llamado al hacer logout: borra el token de Firestore y de FCM
// para que ese dispositivo no siga recibiendo push de un usuario que ya no está logueado.
export async function unregisterPushForUser(uid) {
  const token = _currentToken;
  _currentToken = null;
  if (!uid || !token) return;
  try {
    await deleteDoc(doc(db, "users", uid, "fcmTokens", token));
  } catch (_) { /* ignorar */ }
  try {
    if (_messaging) await deleteToken(_messaging);
  } catch (_) { /* ignorar */ }
}
