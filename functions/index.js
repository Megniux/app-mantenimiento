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
//
// IMPORTANTE: este archivo unifica deliberadamente funciones de varias ramas
// porque `firebase deploy --only functions` borra del proyecto las funciones que
// no estén en el código. Si removés una función de acá, la próxima vez que
// alguien deploye desaparece de producción. Antes de borrar algo, confirmá que
// también se borra del archivo en TODAS las ramas que se vayan a deployar.

import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

initializeApp();

const REGION = "southamerica-east1";

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

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: titulo, body: cuerpo },
      data: {
        ordenId,
        numeroOrden: String(orden.numeroOrden || ""),
        equipo: String(orden.equipo || ""),
        ubicacion: String(orden.ubicacion || ""),
        descripcion: String(orden.descripcion || "").slice(0, 200),
        prioridad: String(orden.prioridad || ""),
        solicitante: String(orden.solicitante || ""),
        tipo: "orden_creada"
      },
      webpush: {
        fcmOptions: {
          // Cuando el usuario clickea la notificación abre la app en la raíz.
          // El SW se encarga de redirigir a la orden específica si está corriendo.
          link: "/"
        }
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
