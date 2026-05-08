// Cloud Functions para notificaciones push.
// Trigger: cuando se crea una orden, si es Correctiva, envía push a:
//   - todos los técnicos / supervisores / admin del cliente,
//   - todos los superadmin (de cualquier cliente).
// Respeta la preferencia opt-out `notificacionesPush == false` en el doc del usuario.

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

initializeApp();

const REGION = "southamerica-east1";

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
