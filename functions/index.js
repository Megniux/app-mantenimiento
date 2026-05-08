// Cloud Functions del proyecto.
//
// Funciones incluidas:
//   - syncUserClaims        (rama Gestion-stock-panol): sincroniza rol y clienteId
//                           del doc users/{uid} con custom claims del JWT.
//   - backfillUserClaims    (rama Gestion-stock-panol): callable manual para
//                           popular claims iniciales en todos los users existentes.
//   - onOrdenCreated        (rama Notificaciones): trigger que envía push a
//                           técnicos del cliente y superadmins cuando se crea una
//                           orden Correctiva.
//   - onOrdenCreatedEmail   (rama Notificaciones): trigger que envía email al
//                           solicitante cuando se crea su orden.
//   - onOrdenUpdatedEmail   (rama Notificaciones): trigger que envía email al
//                           solicitante cuando hay cambios relevantes en su orden.
//
// IMPORTANTE: este archivo unifica deliberadamente funciones de varias ramas
// porque `firebase deploy --only functions` borra del proyecto las funciones que
// no estén en el código. Si removés una función de acá, la próxima vez que
// alguien deploye desaparece de producción. Antes de borrar algo, confirmá que
// también se borra del archivo en TODAS las ramas que se vayan a deployar.

import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten
} from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

initializeApp();

const REGION = "southamerica-east1";

// Secrets para envío de email vía Brevo. Se setean con:
//   firebase functions:secrets:set BREVO_API_KEY
//   firebase functions:secrets:set BREVO_FROM_EMAIL
//   firebase functions:secrets:set BREVO_FROM_NAME
const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const BREVO_FROM_EMAIL = defineSecret("BREVO_FROM_EMAIL");
const BREVO_FROM_NAME = defineSecret("BREVO_FROM_NAME");

// ════════════════════════════════════════════════════════════════════════════
// syncUserClaims (Gestion-stock-panol)
// Cualquier escritura sobre users/{uid} actualiza los custom claims del JWT.
// Las reglas de Firestore prefieren los claims (lectura gratuita) y caen al
// doc users/{uid} si los claims no están seteados.
// ════════════════════════════════════════════════════════════════════════════

export const syncUserClaims = onDocumentWritten(
  { document: "users/{uid}", region: REGION },
  async (event) => {
    const { uid } = event.params;
    const after = event.data?.after?.data();

    try {
      if (!after) {
        // Documento borrado: limpiar claims para revocar acceso vía token
        await getAuth().setCustomUserClaims(uid, null);
        logger.info(`Claims cleared for ${uid}`);
        return;
      }

      const claims = {
        rol: after.rol || "usuario",
        clienteId: after.clienteId || ""
      };

      // Evitar trabajo si los claims ya están sincronizados
      const userRecord = await getAuth().getUser(uid).catch(() => null);
      const current = userRecord?.customClaims || {};
      if (current.rol === claims.rol && current.clienteId === claims.clienteId) {
        return;
      }

      await getAuth().setCustomUserClaims(uid, claims);
      logger.info(`Claims set for ${uid}`, claims);
    } catch (err) {
      logger.error(`Failed to set claims for ${uid}`, err);
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// backfillUserClaims (Gestion-stock-panol)
// Callable manual para setear claims en todos los users existentes.
// Llamar una sola vez tras desplegar (solo superadmin).
//   const fn = httpsCallable(getFunctions(app, "southamerica-east1"), "backfillUserClaims");
//   await fn();
// ════════════════════════════════════════════════════════════════════════════

export const backfillUserClaims = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login requerido.");
    }
    // Aceptar superadmin tanto desde claims como desde el doc (primer run, antes de
    // que cualquier claim esté seteado).
    let esSuperadmin = request.auth.token.rol === "superadmin";
    if (!esSuperadmin) {
      const callerDoc = await getFirestore().collection("users").doc(request.auth.uid).get();
      esSuperadmin = callerDoc.exists && callerDoc.data().rol === "superadmin";
    }
    if (!esSuperadmin) {
      throw new HttpsError("permission-denied", "Solo superadmin puede ejecutar el backfill.");
    }

    const snap = await getFirestore().collection("users").get();
    let actualizados = 0;
    let saltados = 0;
    const errores = [];

    for (const docSnap of snap.docs) {
      const uid = docSnap.id;
      const data = docSnap.data();
      const claims = {
        rol: data.rol || "usuario",
        clienteId: data.clienteId || ""
      };
      try {
        const userRecord = await getAuth().getUser(uid).catch(() => null);
        if (!userRecord) { saltados++; continue; }
        const current = userRecord.customClaims || {};
        if (current.rol === claims.rol && current.clienteId === claims.clienteId) {
          saltados++;
          continue;
        }
        await getAuth().setCustomUserClaims(uid, claims);
        actualizados++;
      } catch (err) {
        errores.push({ uid, message: err.message });
      }
    }

    logger.info("Backfill completado", { actualizados, saltados, errores: errores.length });
    return { actualizados, saltados, errores };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// onOrdenCreated (Notificaciones)
// Trigger: cuando se crea una orden, si es Correctiva, envía push a:
//   - todos los técnicos / supervisores / admin del cliente,
//   - todos los superadmin (de cualquier cliente).
// Respeta la preferencia opt-out `notificacionesPush == false` en el doc del usuario.
// ════════════════════════════════════════════════════════════════════════════

export const onOrdenCreated = onDocumentCreated(
  { document: "ordenes/{ordenId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const orden = snap.data() || {};
    const ordenId = event.params.ordenId;

    // Por ahora solo notificamos correctivas. Si más adelante se quieren preventivas
    // u otros tipos, ajustar este filtro o eliminarlo.
    if (orden.tipo !== "Correctivo") {
      logger.info(`Orden ${ordenId}: tipo ${orden.tipo}, sin push`);
      return;
    }

    const clienteId = orden.clienteId;
    if (!clienteId) {
      logger.warn(`Orden ${ordenId}: sin clienteId, abortando`);
      return;
    }

    const db = getFirestore();
    const messaging = getMessaging();

    // Destinatarios: técnicos del cliente + superadmins globales.
    // Nota: Firestore no soporta OR de cláusulas where con campos distintos en una sola query,
    // por eso disparamos dos queries en paralelo y deduplicamos.
    const [tecnicosSnap, superadminsSnap] = await Promise.all([
      db.collection("users")
        .where("clienteId", "==", clienteId)
        .where("rol", "in", ["tecnico", "supervisor", "admin"])
        .get(),
      db.collection("users").where("rol", "==", "superadmin").get()
    ]);

    const seen = new Set();
    const targets = [];
    for (const docSnap of [...tecnicosSnap.docs, ...superadminsSnap.docs]) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);
      const data = docSnap.data();
      if (data.notificacionesPush === false) continue;
      targets.push(docSnap);
    }

    if (!targets.length) {
      logger.info(`Orden ${ordenId}: sin destinatarios`);
      return;
    }

    // Recolectar tokens FCM de cada destinatario (un usuario puede tener varios dispositivos).
    const tokenEntries = [];
    await Promise.all(targets.map(async (userDoc) => {
      const tokensSnap = await userDoc.ref.collection("fcmTokens").get();
      tokensSnap.forEach((tokenDoc) => {
        const tokenValue = tokenDoc.data().token || tokenDoc.id;
        if (!tokenValue) return;
        tokenEntries.push({
          uid: userDoc.id,
          tokenId: tokenDoc.id,
          token: tokenValue
        });
      });
    }));

    if (!tokenEntries.length) {
      logger.info(`Orden ${ordenId}: sin tokens registrados (${targets.length} destinatarios)`);
      return;
    }

    const titulo = `Nueva orden ${orden.numeroOrden || ordenId}`;
    const cuerpo = [
      orden.equipo ? `Equipo: ${orden.equipo}` : null,
      orden.ubicacion ? `Ubicación: ${orden.ubicacion}` : null,
      orden.prioridad ? `Prioridad: ${orden.prioridad}` : null
    ].filter(Boolean).join(" · ");

    const tokens = tokenEntries.map((t) => t.token);

    // Payload SOLO data: si incluyéramos `notification`, FCM auto-mostraría el push
    // en la bandeja del SO Y además nuestro Service Worker mostraría otro mediante
    // onBackgroundMessage → notificación duplicada en Android. Mandando solo data
    // queda en manos del SW renderizar una única notificación.
    const response = await messaging.sendEachForMulticast({
      tokens,
      data: {
        title: titulo,
        body: cuerpo,
        ordenId,
        numeroOrden: String(orden.numeroOrden || ""),
        equipo: String(orden.equipo || ""),
        ubicacion: String(orden.ubicacion || ""),
        descripcion: String(orden.descripcion || "").slice(0, 200),
        prioridad: String(orden.prioridad || ""),
        solicitante: String(orden.solicitante || ""),
        tipo: "orden_creada"
      }
    });

    logger.info(
      `Orden ${ordenId}: ${response.successCount}/${tokens.length} push enviados`
    );

    // Limpieza de tokens muertos: si FCM dice que un token no está registrado,
    // lo borramos de Firestore para no acumular basura ni reintentar.
    const cleanups = [];
    response.responses.forEach((res, idx) => {
      if (res.success) return;
      const code = res.error?.code || "";
      if (
        code === "messaging/registration-token-not-registered"
        || code === "messaging/invalid-registration-token"
        || code === "messaging/invalid-argument"
      ) {
        const t = tokenEntries[idx];
        cleanups.push(
          db.doc(`users/${t.uid}/fcmTokens/${t.tokenId}`).delete().catch(() => {})
        );
      } else if (res.error) {
        logger.warn(`Error enviando a ${tokenEntries[idx].uid}: ${code}`);
      }
    });
    if (cleanups.length) {
      await Promise.allSettled(cleanups);
      logger.info(`Orden ${ordenId}: ${cleanups.length} tokens inválidos limpiados`);
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// Helpers de email (Brevo)
// ════════════════════════════════════════════════════════════════════════════

// Campos que disparan email cuando cambian en una update. Si solo cambian
// campos fuera de esta lista (ej. historial, fechaInicioEspera), no enviamos.
const CAMPOS_EMAIL_RELEVANTES = [
  ["estado", "Estado"],
  ["tecnicoAsignado", "Técnico asignado"],
  ["fechaProgramada", "Fecha programada"],
  ["fechaCierre", "Fecha cierre"],
  ["comentarioMantenimiento", "Comentario mantenimiento"],
  ["informeCierre", "Informe de cierre"],
  ["prioridad", "Prioridad"],
  ["descripcion", "Descripción"],
  ["equipo", "Equipo"],
  ["ubicacion", "Ubicación"],
  ["tiempoEstimado", "Tiempo estimado (hs)"],
  ["tiempoReal", "Tiempo real (hs)"]
];

// Mismo orden que CAMPOS_DETALLE_ORDEN del modal "detalles" en js/views/consulta.js.
const CAMPOS_DETALLE_EMAIL = [
  ["N° Orden", (o) => o.numeroOrden],
  ["Tipo", (o) => o.tipo],
  ["Estado", (o) => o.estado],
  ["Solicitante", (o) => o.solicitante],
  ["Ubicación", (o) => o.ubicacion],
  ["Equipo", (o) => o.equipo],
  ["Prioridad", (o) => o.prioridad],
  ["Frecuencia", (o) => o.frecuencia || "-"],
  ["Técnico asignado", (o) => o.tecnicoAsignado || "-"],
  ["Descripción", (o) => o.descripcion || "-"],
  ["Comentario mantenimiento", (o) => o.comentarioMantenimiento || "-"],
  ["Informe de cierre", (o) => o.informeCierre || "-"],
  ["Fecha creación", (o) => formatearFechaLarga(o.fechaCreacion)],
  ["Fecha programada", (o) => formatearFechaCorta(o.fechaProgramada)],
  ["Fecha cierre", (o) => formatearFechaLarga(o.fechaCierre)],
  ["Tiempo estimado (hs)", (o) => o.tiempoEstimado ?? "-"],
  ["Tiempo real (hs)", (o) => o.tiempoReal ?? "-"]
];

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && typeof v._seconds === "number") {
    return new Date(v._seconds * 1000);
  }
  return null;
}

function formatearFechaLarga(v) {
  const d = toDate(v);
  if (!d) return "-";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

function formatearFechaCorta(v) {
  const d = toDate(v);
  if (!d) return "-";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires"
  });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function obtenerEmailUsuario(uid) {
  if (!uid) return null;
  try {
    const userDoc = await getFirestore().collection("users").doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data() || {};
      if (data.email) return { email: data.email, nombre: data.nombreCompleto || data.email };
    }
  } catch (err) {
    logger.warn(`No se pudo leer users/${uid}: ${err.message}`);
  }
  // Fallback: traer de Firebase Auth.
  try {
    const userRecord = await getAuth().getUser(uid);
    if (userRecord.email) {
      return { email: userRecord.email, nombre: userRecord.displayName || userRecord.email };
    }
  } catch (err) {
    logger.warn(`No se pudo obtener Auth user ${uid}: ${err.message}`);
  }
  return null;
}

function renderTablaDetalle(orden) {
  const filas = CAMPOS_DETALLE_EMAIL.map(([label, getter]) => {
    const valor = getter(orden);
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;color:#555;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(valor)}</td>
    </tr>`;
  }).join("");
  return `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">${filas}</table>`;
}

function renderListaCambios(cambios) {
  if (!cambios.length) return "";
  const items = cambios.map(({ label, antes, despues }) => `
    <li style="margin-bottom:6px;">
      <strong>${escapeHtml(label)}:</strong>
      <span style="color:#999;text-decoration:line-through;">${escapeHtml(antes ?? "-")}</span>
      &nbsp;→&nbsp;
      <span style="color:#222;font-weight:600;">${escapeHtml(despues ?? "-")}</span>
    </li>`).join("");
  return `<div style="margin:16px 0;padding:12px;background:#fff8e1;border-left:4px solid #f5b400;font-family:Arial,sans-serif;font-size:14px;">
    <div style="font-weight:600;margin-bottom:8px;">Cambios:</div>
    <ul style="margin:0;padding-left:20px;">${items}</ul>
  </div>`;
}

function renderOrdenEmail(orden, ordenId, modo, cambios = []) {
  const numero = orden.numeroOrden || ordenId;
  const subject = modo === "creada"
    ? `Tu orden ${numero} fue creada`
    : `Actualización de tu orden ${numero}`;
  const headline = modo === "creada"
    ? "Tu orden fue creada con éxito."
    : "Hubo cambios en tu orden.";
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#222;">
    <h2 style="margin:0 0 8px 0;color:#0b6cb8;">Orden ${escapeHtml(numero)}</h2>
    <p style="margin:0 0 16px 0;color:#555;">${escapeHtml(headline)}</p>
    ${renderListaCambios(cambios)}
    ${renderTablaDetalle(orden)}
    <p style="margin-top:24px;color:#999;font-size:12px;">
      Email automático de App Mantenimiento. No respondas a este mensaje.
    </p>
  </div>
</body></html>`;
  return { subject, html };
}

async function sendEmail({ to, toName, subject, html }) {
  const apiKey = BREVO_API_KEY.value();
  const fromEmail = BREVO_FROM_EMAIL.value();
  const fromName = BREVO_FROM_NAME.value() || "App Mantenimiento";

  if (!apiKey || !fromEmail) {
    logger.error("Brevo no configurado: faltan BREVO_API_KEY o BREVO_FROM_EMAIL");
    return { ok: false, reason: "config-missing" };
  }
  if (!to) {
    logger.warn("sendEmail llamado sin destinatario");
    return { ok: false, reason: "no-recipient" };
  }

  const body = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to, name: toName || to }],
    subject,
    htmlContent: html
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(`Brevo respondió ${res.status}: ${text.slice(0, 500)}`);
      return { ok: false, reason: `http-${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.error(`Error enviando email vía Brevo: ${err.message}`);
    return { ok: false, reason: "exception" };
  }
}

function valoresEquivalentes(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const da = toDate(a);
  const db = toDate(b);
  if (da && db) return da.getTime() === db.getTime();
  return String(a) === String(b);
}

function formatearValorParaEmail(label, valor) {
  if (valor == null || valor === "") return "-";
  if (label.startsWith("Fecha cierre") || label.startsWith("Estado") || label === "Comentario mantenimiento" || label === "Informe de cierre") {
    // Para campos con fechas, usar formato largo si parece fecha.
    const d = toDate(valor);
    if (d) return formatearFechaLarga(d);
  }
  if (label === "Fecha programada") {
    const d = toDate(valor);
    if (d) return formatearFechaCorta(d);
  }
  return String(valor);
}

function detectarCambios(before, after) {
  const cambios = [];
  for (const [campo, label] of CAMPOS_EMAIL_RELEVANTES) {
    if (!valoresEquivalentes(before?.[campo], after?.[campo])) {
      cambios.push({
        label,
        antes: formatearValorParaEmail(label, before?.[campo]),
        despues: formatearValorParaEmail(label, after?.[campo])
      });
    }
  }
  return cambios;
}

// ════════════════════════════════════════════════════════════════════════════
// onOrdenCreatedEmail (Notificaciones)
// Trigger: cuando se crea una orden, envía email al solicitante con el detalle
// completo (mismos campos que el modal "Ver detalles").
// ════════════════════════════════════════════════════════════════════════════

export const onOrdenCreatedEmail = onDocumentCreated(
  {
    document: "ordenes/{ordenId}",
    region: REGION,
    secrets: [BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME]
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const orden = snap.data() || {};
    const ordenId = event.params.ordenId;

    // Mismo criterio que onOrdenCreated (push): solo correctivas.
    if (orden.tipo !== "Correctivo") {
      logger.info(`Orden ${ordenId}: tipo ${orden.tipo}, sin email de creación`);
      return;
    }

    const destinatario = await obtenerEmailUsuario(orden.solicitanteUid);
    if (!destinatario) {
      logger.warn(`Orden ${ordenId}: solicitante sin email (uid=${orden.solicitanteUid}), no se envía mail`);
      return;
    }

    const { subject, html } = renderOrdenEmail(orden, ordenId, "creada");
    const result = await sendEmail({
      to: destinatario.email,
      toName: destinatario.nombre,
      subject,
      html
    });
    logger.info(`Orden ${ordenId}: email creación a ${destinatario.email} → ${result.ok ? "OK" : "FAIL " + result.reason}`);
  }
);

// ════════════════════════════════════════════════════════════════════════════
// onOrdenUpdatedEmail (Notificaciones)
// Trigger: cuando una orden cambia, si el cambio toca campos relevantes
// (estado, técnico, fechas, descripción, etc.), envía email al solicitante con
// la lista de cambios + el detalle actualizado.
// ════════════════════════════════════════════════════════════════════════════

export const onOrdenUpdatedEmail = onDocumentUpdated(
  {
    document: "ordenes/{ordenId}",
    region: REGION,
    secrets: [BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME]
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    const ordenId = event.params.ordenId;

    // Solo correctivas. Si la orden no es (o pasó a no ser) correctiva, no mandamos.
    if (after.tipo !== "Correctivo") {
      return;
    }

    const cambios = detectarCambios(before, after);
    if (!cambios.length) {
      // Solo cambiaron campos no relevantes (historial, contadores internos, etc.)
      return;
    }

    const destinatario = await obtenerEmailUsuario(after.solicitanteUid);
    if (!destinatario) {
      logger.warn(`Orden ${ordenId}: solicitante sin email (uid=${after.solicitanteUid}), no se envía mail`);
      return;
    }

    const { subject, html } = renderOrdenEmail(after, ordenId, "actualizada", cambios);
    const result = await sendEmail({
      to: destinatario.email,
      toName: destinatario.nombre,
      subject,
      html
    });
    logger.info(`Orden ${ordenId}: email update a ${destinatario.email} (${cambios.length} cambios) → ${result.ok ? "OK" : "FAIL " + result.reason}`);
  }
);
