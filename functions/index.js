// Cloud Functions: sincroniza rol y clienteId del documento users/{uid}
// con custom claims del JWT. Las reglas de Firestore prefieren los claims
// (lectura gratuita) y caen al doc users/{uid} si los claims no están seteados.

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

initializeApp();

const REGION = "southamerica-east1";

// ── Trigger: cualquier escritura sobre users/{uid} actualiza claims ─────────
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

// ── Backfill manual: setea claims para todos los users existentes ────────────
// Llamar una sola vez tras desplegar (solo superadmin).
//   const fn = httpsCallable(getFunctions(app, "southamerica-east1"), "backfillUserClaims");
//   await fn();
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
