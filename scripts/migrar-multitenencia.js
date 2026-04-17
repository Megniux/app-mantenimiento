#!/usr/bin/env node
/*
  Script one-shot para migrar multi-tenencia.

  Uso:
    1) Configura credenciales de Firebase Admin (ADC o GOOGLE_APPLICATION_CREDENTIALS).
    2) Opcional: set CLIENTE_ID_DEFAULT=cliente_principal
    3) Ejecuta: node scripts/migrar-multitenencia.js
*/

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const DEFAULT_CLIENTE_ID = process.env.CLIENTE_ID_DEFAULT || "cliente_principal";
const COLECCIONES = ["ordenes", "equipos", "ubicaciones", "users"];

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    const absolutePath = path.resolve(credentialsPath);
    const raw = fs.readFileSync(absolutePath, "utf8");
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

function limpiarClienteId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function contadorRefPorCliente(db, clienteId) {
  return db.collection("config").doc("contadores").collection("clientes").doc(clienteId);
}

async function migrarColeccion(db, nombre, tenantIds) {
  const snapshot = await db.collection(nombre).get();
  let actualizados = 0;
  let batch = db.batch();
  let batchOps = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const updates = {};

    if (nombre === "users") {
      const rol = data.rol || "usuario";
      if (rol === "superadmin") {
        if ("clienteId" in data) {
          updates.clienteId = admin.firestore.FieldValue.delete();
        }
      } else {
        const clienteId = limpiarClienteId(data.clienteId) || DEFAULT_CLIENTE_ID;
        tenantIds.add(clienteId);
        if (clienteId !== data.clienteId) {
          updates.clienteId = clienteId;
        }
      }
    } else {
      const clienteId = limpiarClienteId(data.clienteId) || DEFAULT_CLIENTE_ID;
      tenantIds.add(clienteId);
      if (clienteId !== data.clienteId) {
        updates.clienteId = clienteId;
      }
    }

    if (Object.keys(updates).length) {
      batch.update(docSnap.ref, updates);
      batchOps += 1;
      actualizados += 1;
    }

    if (batchOps >= 400) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  return { total: snapshot.size, actualizados };
}

async function migrarContadores(db, tenantIds) {
  const legacyRef = db.collection("config").doc("contador");
  const legacySnap = await legacyRef.get();
  const legacyData = legacySnap.exists ? legacySnap.data() : {};

  const baseOMC = Number(legacyData.contadorOMC) || 1;
  const baseOMP = Number(legacyData.contadorOMP) || 1;

  if (!tenantIds.size) {
    tenantIds.add(DEFAULT_CLIENTE_ID);
  }

  let creados = 0;
  for (const tenantId of tenantIds) {
    const ref = contadorRefPorCliente(db, tenantId);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        contadorOMC: tenantId === DEFAULT_CLIENTE_ID ? baseOMC : 1,
        contadorOMP: tenantId === DEFAULT_CLIENTE_ID ? baseOMP : 1
      });
      creados += 1;
      continue;
    }

    const actual = snap.data() || {};
    const parche = {};
    if (!Number.isFinite(Number(actual.contadorOMC))) parche.contadorOMC = 1;
    if (!Number.isFinite(Number(actual.contadorOMP))) parche.contadorOMP = 1;

    if (Object.keys(parche).length) {
      await ref.set(parche, { merge: true });
    }
  }

  return {
    legacy: { contadorOMC: baseOMC, contadorOMP: baseOMP },
    creados,
    totalTenants: tenantIds.size
  };
}

async function run() {
  initFirebaseAdmin();
  const db = admin.firestore();
  const tenantIds = new Set();

  console.log("Iniciando migracion de multi-tenencia...");
  console.log(`Cliente por defecto: ${DEFAULT_CLIENTE_ID}`);

  for (const nombre of COLECCIONES) {
    const res = await migrarColeccion(db, nombre, tenantIds);
    console.log(`- ${nombre}: ${res.actualizados}/${res.total} documentos actualizados`);
  }

  const counters = await migrarContadores(db, tenantIds);
  console.log(`- contadores: ${counters.creados} docs creados (${counters.totalTenants} tenants detectados)`);
  console.log(`- contador legacy usado como base: OMC=${counters.legacy.contadorOMC}, OMP=${counters.legacy.contadorOMP}`);

  console.log("Migracion finalizada.");
}

run().catch((error) => {
  console.error("Error durante la migracion:", error);
  process.exitCode = 1;
});
