// cleanup-orphan-users.mjs
//
// Detecta y (opcionalmente) limpia desincronizaciones entre la colección
// Firestore `users/` y Firebase Authentication del proyecto.
//
// Dos tipos de huérfanos:
//   TIPO A — doc users/{uid} SIN cuenta en Auth.
//            Causa histórica: la importación de clientes creaba docs de usuario
//            con IDs nuevos sin cuenta Auth. Rompían syncUserClaims con
//            auth/user-not-found. (La importación ya no trae usuarios.)
//   TIPO B — cuenta en Auth SIN doc users/{uid}.
//            Causa histórica: borrar un usuario/cliente sólo borraba el doc, no
//            la cuenta Auth. (El trigger deleteAuthOnUserDeleted ya lo cubre.)
//
// Por defecto corre en DRY-RUN: sólo reporta, no borra nada.
//
// Uso:
//   # Credenciales: service account key (Firebase Console > Configuración >
//   # Cuentas de servicio > Generar nueva clave privada). NO la commitees.
//   #
//   # Opción 1 — variable de entorno (recomendada):
//   #   PowerShell:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\ruta\key.json"
//   #   bash:        export GOOGLE_APPLICATION_CREDENTIALS=/ruta/key.json
//   # Opción 2 — argumento:  --key C:\ruta\key.json
//
//   node scripts/cleanup-orphan-users.mjs                 # dry-run, reporta A y B
//   node scripts/cleanup-orphan-users.mjs --delete-docs   # borra docs tipo A
//   node scripts/cleanup-orphan-users.mjs --delete-auth   # borra cuentas tipo B
//   node scripts/cleanup-orphan-users.mjs --delete-docs --delete-auth
//
// Ejecutar desde el directorio functions/ (reutiliza su firebase-admin).

import { readFileSync } from "node:fs";
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

const DELETE_DOCS = flag("--delete-docs");
const DELETE_AUTH = flag("--delete-auth");
const DRY_RUN = !DELETE_DOCS && !DELETE_AUTH;

// ─── Credenciales ────────────────────────────────────────────────────────────
const keyPath = argValue("--key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
let credential;
if (argValue("--key")) {
  const json = JSON.parse(readFileSync(keyPath, "utf8"));
  credential = cert(json);
  console.log(`Credenciales: service account key (${keyPath})`);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = applicationDefault();
  console.log(`Credenciales: GOOGLE_APPLICATION_CREDENTIALS (${process.env.GOOGLE_APPLICATION_CREDENTIALS})`);
} else {
  console.error(
    "ERROR: faltan credenciales. Seteá GOOGLE_APPLICATION_CREDENTIALS o pasá --key <ruta-al-json>.\n" +
    "Descargá la key desde Firebase Console > Configuración > Cuentas de servicio."
  );
  process.exit(1);
}

initializeApp({ credential });
const auth = getAuth();
const db = getFirestore();

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function listAllAuthUids() {
  const uids = new Set();
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    res.users.forEach((u) => uids.add(u.uid));
    pageToken = res.pageToken;
  } while (pageToken);
  return uids;
}

async function deleteDocsInBatches(refs) {
  let batch = db.batch();
  let count = 0;
  let committed = 0;
  for (const ref of refs) {
    batch.delete(ref);
    count++;
    if (count === 450) {
      await batch.commit();
      committed += count;
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
    committed += count;
  }
  return committed;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(DRY_RUN ? "\n>>> MODO DRY-RUN (no se borra nada)\n" : "\n>>> MODO BORRADO\n");

  const [usersSnap, authUids] = await Promise.all([
    db.collection("users").get(),
    listAllAuthUids()
  ]);

  const docUids = new Set(usersSnap.docs.map((d) => d.id));
  console.log(`Docs en users/: ${docUids.size}`);
  console.log(`Cuentas en Auth: ${authUids.size}\n`);

  // TIPO A — docs sin cuenta Auth
  const orphanDocs = usersSnap.docs.filter((d) => !authUids.has(d.id));
  console.log(`── TIPO A: docs users/ SIN cuenta Auth → ${orphanDocs.length}`);
  for (const d of orphanDocs) {
    const u = d.data();
    console.log(`   ${d.id}  ${u.email || "(sin email)"}  rol=${u.rol || "-"}  cliente=${u.clienteId || "-"}`);
  }

  // TIPO B — cuentas Auth sin doc
  const orphanAuth = [...authUids].filter((uid) => !docUids.has(uid));
  console.log(`\n── TIPO B: cuentas Auth SIN doc users/ → ${orphanAuth.length}`);
  for (const uid of orphanAuth) {
    const rec = await auth.getUser(uid).catch(() => null);
    console.log(`   ${uid}  ${rec?.email || "(sin email)"}`);
  }

  if (DRY_RUN) {
    console.log("\nDry-run terminado. Para borrar:");
    console.log("  --delete-docs   borra los docs TIPO A");
    console.log("  --delete-auth   borra las cuentas TIPO B");
    return;
  }

  if (DELETE_DOCS) {
    if (orphanDocs.length === 0) {
      console.log("\nTIPO A: nada para borrar.");
    } else {
      const n = await deleteDocsInBatches(orphanDocs.map((d) => d.ref));
      console.log(`\nTIPO A: ${n} docs huérfanos borrados.`);
    }
  }

  if (DELETE_AUTH) {
    if (orphanAuth.length === 0) {
      console.log("TIPO B: nada para borrar.");
    } else {
      let ok = 0;
      const fallidos = [];
      for (const uid of orphanAuth) {
        try {
          await auth.deleteUser(uid);
          ok++;
        } catch (err) {
          fallidos.push({ uid, message: err.message });
        }
      }
      console.log(`TIPO B: ${ok} cuentas Auth borradas${fallidos.length ? `, ${fallidos.length} fallidas` : ""}.`);
      fallidos.forEach((f) => console.log(`   FALLO ${f.uid}: ${f.message}`));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error inesperado:", err);
    process.exit(1);
  });
