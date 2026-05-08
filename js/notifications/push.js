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
const VAPID_KEY = "REEMPLAZAR_CON_VAPID_KEY";

let _messaging = null;
let _foregroundBound = false;
let _currentToken = null;

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
// Si el permiso ya está otorgado, registra el token silenciosamente.
// Si está en "default", no pide permiso para no asustar al usuario en cada login —
// la solicitud se hace explícitamente con requestPushPermission() (ej. desde un botón).
export async function registerPushForUser(uid) {
  if (!uid || !pushSupported()) return null;
  if (Notification.permission !== "granted") return null;
  return await getAndSaveToken(uid);
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
  if (!messaging) return null;
  if (VAPID_KEY === "REEMPLAZAR_CON_VAPID_KEY") {
    console.warn("FCM: VAPID_KEY no configurada en js/notifications/push.js");
    return null;
  }
  try {
    const swReg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });
    if (!token) return null;
    _currentToken = token;
    await persistToken(uid, token);
    return token;
  } catch (err) {
    console.warn("FCM no se pudo registrar:", err);
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
