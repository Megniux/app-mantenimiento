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
const VAPID_KEY = "BAUKk7uI1Yy_86IdeR2lHgtZ5TCw7WXiJcHNWPZOLaMoL0fPFC7c5RWCWWlSGJfcPHzpS6ebXEwbYBf5ODWAqTg";

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
  // El payload viene data-only desde la Cloud Function (ver functions/index.js).
  const data = payload.data || {};
  if (!data.title) return;
  if (Notification.permission !== "granted") return;
  // Cuando la app está abierta en foreground, mostramos una Notification simple.
  // El SW solo se activa cuando la app está en background/cerrada.
  try {
    new Notification(data.title, {
      body: data.body || "",
      icon: "icons/icon-192.png",
      tag: data.ordenId || undefined
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
  if (_registerInFlight) return _registerInFlight;
  _registerInFlight = (async () => {
    if (!uid) return null;
    if (!pushSupported()) return null;
    if (Notification.permission === "denied") return null;
    if (Notification.permission === "default") {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return null;
      } catch (err) {
        console.warn("[push] requestPermission tiró error:", err);
        return null;
      }
    }
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

// Banner #pushPrompt: se muestra cuando el usuario está logueado y el permiso
// está en "default". Esto es la única forma confiable de pedir permisos en iOS PWA
// y en Chrome Android cuando la sesión ya estaba persistida (no hay user gesture
// en el page-load).
let _pushUIWired = false;

export function refreshPushPrompt() {
  const banner = document.getElementById("pushPrompt");
  const btn = document.getElementById("activarPushBtn");
  if (!banner || !btn) return;

  if (!pushSupported()) { banner.classList.add("is-hidden"); return; }
  const uid = sessionStorage.getItem("userUid");
  if (!uid) { banner.classList.add("is-hidden"); return; }

  // Solo mostramos en estado "default". Si el usuario ya dio permiso o lo
  // denegó explícitamente, no insistimos con el banner.
  if (Notification.permission === "default" && !sessionStorage.getItem("pushPromptDismissed")) {
    banner.classList.remove("is-hidden");
  } else {
    banner.classList.add("is-hidden");
  }

  if (_pushUIWired) return;
  _pushUIWired = true;

  btn.addEventListener("click", async () => {
    const currentUid = sessionStorage.getItem("userUid");
    if (!currentUid) return;
    btn.disabled = true;
    btn.textContent = "Activando...";
    try {
      const result = await requestPushPermission(currentUid);
      if (result.ok) {
        banner.classList.add("is-hidden");
      } else if (result.reason === "denied") {
        btn.textContent = "Bloqueado por el navegador";
      } else {
        btn.textContent = "No se pudo activar";
      }
    } finally {
      // Reset visual del botón en caso de error transitorio.
      setTimeout(() => {
        btn.disabled = false;
        if (!banner.classList.contains("is-hidden")) btn.textContent = "Activar";
      }, 2000);
    }
  });

  const closeBtn = document.getElementById("cerrarPushPromptBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      sessionStorage.setItem("pushPromptDismissed", "1");
      banner.classList.add("is-hidden");
    });
  }
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
    await navigator.serviceWorker.register("firebase-messaging-sw.js");
    // serviceWorker.ready resuelve sólo cuando el SW pasó de "installing" a
    // "activated". Sin esta espera, getToken() falla con "no active Service Worker".
    const swReg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });
    if (!token) {
      console.warn("[push] FCM devolvió token vacío");
      return null;
    }
    _currentToken = token;
    await persistToken(uid, token);
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
