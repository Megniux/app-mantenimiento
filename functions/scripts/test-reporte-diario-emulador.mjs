// Prueba end-to-end del informe diario contra el emulador local. BORRA las
// colecciones clientes/users/ordenes/cambiosOrdenes/reportesDiarios del
// emulador; nunca toca producción (FIRESTORE_EMULATOR_HOST fuerza el emulador).
//
// Verifica: registro de cambios por el trigger registrarCambiosOrden,
// destinatarios (check por usuario + superadmins), aislamiento entre clientes,
// clientes sin cambios y que una segunda corrida no reenvíe.
//
// Uso (desde la raíz del repo):
//   1. Crear functions/.secret.local con valores falsos (BREVO_API_KEY=x,
//      BREVO_FROM_EMAIL=x@x.com, BREVO_FROM_NAME=x) y borrarlo al terminar.
//   2. firebase emulators:start --only firestore,functions --project demo-reporte
//   3. node functions/scripts/test-reporte-diario-emulador.mjs [salida.html]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const salidaHtml = process.argv[2] || join(tmpdir(), "reporte-diario-emulador.html");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-reporte";
process.env.FUNCTIONS_EMULATOR = "true";

const require = createRequire(join(functionsDir, "package.json"));
const { getFirestore } = require("firebase-admin/firestore");

// Importar index.js inicializa firebase-admin (initializeApp) apuntando al emulador.
const fns = await import(pathToFileURL(join(functionsDir, "index.js")).href);
const rd = await import(pathToFileURL(join(functionsDir, "reporteDiario.js")).href);
const db = getFirestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const check = (cond, msg) => { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) fallos++; };

// ── Limpieza ────────────────────────────────────────────────────────────────
for (const col of ["clientes", "users", "ordenes", "cambiosOrdenes", "reportesDiarios"]) {
  const s = await db.collection(col).get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
}
await sleep(4000);
for (const d of (await db.collection("cambiosOrdenes").get()).docs) await d.ref.delete();

// ── Seed ────────────────────────────────────────────────────────────────────
await db.doc("clientes/c1").set({ nombre: "Cliente Uno" });
await db.doc("clientes/c2").set({ nombre: "Cliente Dos" });
await db.doc("clientes/c3").set({ nombre: "Cliente Tres (sin cambios)" });
const users = {
  a1: { email: "admin1@c1.test", nombreCompleto: "Admin Uno", rol: "admin", clienteId: "c1", recibeReporteDiario: true },
  t1: { email: "tec1@c1.test", nombreCompleto: "Técnico Uno", rol: "tecnico", clienteId: "c1", recibeReporteDiario: false },
  u1: { email: "usu1@c1.test", nombreCompleto: "Usuario Uno", rol: "usuario", clienteId: "c1", recibeReporteDiario: true },
  x1: { email: "sincheck@c1.test", nombreCompleto: "Sin Check", rol: "supervisor", clienteId: "c1" },
  a2: { email: "admin2@c2.test", nombreCompleto: "Admin Dos", rol: "admin", clienteId: "c2", recibeReporteDiario: true },
  s1: { email: "super@app.test", nombreCompleto: "Super Admin", rol: "superadmin", clienteId: "" },
  s2: { email: "SUPER@app.test", nombreCompleto: "Super duplicado", rol: "superadmin", clienteId: "" }
};
for (const [id, u] of Object.entries(users)) await db.doc(`users/${id}`).set(u);

const base = { estado: "Nuevo", prioridad: "Media", fechaCreacion: new Date(), solicitanteUid: "u1" };
await db.doc("ordenes/o1").set({ ...base, clienteId: "c1", tipo: "Correctivo", numeroOrden: "OMC-0001", equipo: "Bomba 1", ubicacion: "Planta", descripcion: "Pierde agua", solicitante: "Usuario Uno", historial: [{ estado: "Nuevo", usuario: "Usuario Uno", fecha: new Date() }] });
await db.doc("ordenes/o2").set({ ...base, clienteId: "c1", tipo: "Preventivo", numeroOrden: "OMP-0001", equipo: "Tablero", ubicacion: "Sala", frecuencia: "Mensual", solicitante: "Admin Uno", historial: [{ estado: "Nuevo", usuario: "Admin Uno", fecha: new Date() }] });
await db.doc("ordenes/o3").set({ ...base, clienteId: "c2", tipo: "Correctivo", numeroOrden: "OMC-0001", equipo: "Secreto C2", ubicacion: "Depósito C2", solicitante: "Admin Dos", historial: [] });
await db.doc("ordenes/o4").set({ ...base, clienteId: "c1", tipo: "Correctivo", numeroOrden: "OMC-0000", importado: true, historial: [] });
await sleep(3000);
await db.doc("ordenes/o1").update({
  estado: "En proceso", tecnicoAsignado: "Técnico Uno",
  historial: [{ estado: "Nuevo", usuario: "Usuario Uno" }, { estado: "En proceso", usuario: "Técnico Uno", fecha: new Date() }]
});
await db.doc("ordenes/o1").update({ repuestosUtilizados: [{ nombre: "Sello" }] }); // no debe registrarse
await db.doc("ordenes/o4").update({ estado: "Cerrado" }); // importada pero modificación real: sí se registra
await db.doc("ordenes/o2").delete();
// Los triggers del emulador corren con demora: esperar a que estén los 6 registros.
for (let i = 0; i < 60 && (await db.collection("cambiosOrdenes").get()).size < 6; i++) await sleep(1000);
await sleep(3000); // margen para detectar registros de más (ej. el update de repuestos)

// ── Verificación del trigger ────────────────────────────────────────────────
const cambios = (await db.collection("cambiosOrdenes").get()).docs.map((d) => d.data());
const resumen = cambios.map((c) => `${c.clienteId}/${c.ordenId}:${c.evento}`).sort();
console.log("cambiosOrdenes:", resumen.join(", "));
check(resumen.includes("c1/o1:creada") && resumen.includes("c1/o1:modificada"), "o1 creada + modificada");
check(cambios.filter((c) => c.ordenId === "o1" && c.evento === "modificada").length === 1, "update solo de repuestos NO se registra");
check(resumen.includes("c1/o2:creada") && resumen.includes("c1/o2:eliminada"), "o2 creada + eliminada");
check(resumen.includes("c2/o3:creada"), "o3 (cliente 2) creada");
check(!resumen.includes("c1/o4:creada"), "o4 importada: alta NO se registra");
check(resumen.includes("c1/o4:modificada"), "o4 importada: modificación posterior sí se registra");
const mod = cambios.find((c) => c.ordenId === "o1" && c.evento === "modificada");
check(mod?.usuario === "Técnico Uno", `autor de la modificación = "${mod?.usuario}"`);
check(JSON.stringify(mod?.cambios) === JSON.stringify([
  { label: "Estado", antes: "Nuevo", despues: "En proceso" },
  { label: "Técnico asignado", antes: "-", despues: "Técnico Uno" }
]), "cambios antes → después correctos");
check(cambios.every((c) => c.expiraEn && c.expiraEn.toDate() > new Date()), "todos tienen expiraEn futuro");

// ── Correr informe ──────────────────────────────────────────────────────────
// Los registros son de "hoy"; los movemos 1 día atrás para que caigan en la ventana.
for (const d of (await db.collection("cambiosOrdenes").get()).docs) {
  await d.ref.update({ fecha: new Date(d.data().fecha.toDate().getTime() - 24 * 3600 * 1000) });
}

const logs = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => { logs.push(String(chunk)); return true; };
await fns.reporteDiarioOrdenes.run({});
process.stdout.write = origWrite;
const envios = logs.map((l) => { try { return JSON.parse(l).message; } catch { return l; } })
  .filter((m) => /sendEmail skip/.test(m));
console.log("Emails (corrida 1):\n  " + envios.join("\n  "));
const a = (to, cli) => envios.some((m) => m.includes(`to=${to}`) && m.includes(cli));
check(a("admin1@c1.test", "Cliente Uno") && a("usu1@c1.test", "Cliente Uno"), "c1 → usuarios con check");
check(!envios.some((m) => m.includes("tec1@c1.test") || m.includes("sincheck@c1.test")), "c1 → sin check NO reciben");
check(a("super@app.test", "Cliente Uno") && a("super@app.test", "Cliente Dos"), "superadmin recibe un mail por cliente");
check(!envios.some((m) => m.includes("SUPER@app.test")), "superadmin duplicado por email no se repite");
check(a("admin2@c2.test", "Cliente Dos") && !a("admin2@c2.test", "Cliente Uno"), "admin c2 solo recibe c2");
check(!envios.some((m) => m.includes("Cliente Tres")), "cliente sin cambios no envía");
check(envios.length === 5, `total emails = ${envios.length} (esperado 5)`);
const estados = Object.fromEntries((await db.collection("reportesDiarios").get()).docs.map((d) => [d.id, d.data()]));
check(["c1", "c2", "c3"].every((id) => estados[id]?.hasta), "estado guardado para los 3 clientes");

const logs2 = [];
process.stdout.write = (chunk) => { logs2.push(String(chunk)); return true; };
await fns.reporteDiarioOrdenes.run({});
process.stdout.write = origWrite;
check(!logs2.some((l) => l.includes("sendEmail skip")), "segunda corrida el mismo día no reenvía");

// ── HTML real del cliente 1 ─────────────────────────────────────────────────
const regs = (await db.collection("cambiosOrdenes").where("clienteId", "==", "c1").get()).docs.map((d) => d.data());
const { desde, fin } = rd.calcularVentana(new Date(), null);
const { html } = rd.renderReporteDiario({ clienteNombre: "Cliente Uno", desde, fin, grupos: rd.agruparPorOrden(regs) });
check(!html.includes("Secreto C2"), "HTML de c1 no contiene datos de c2");
writeFileSync(salidaHtml, html, "utf-8");
console.log(`HTML del cliente 1 en ${salidaHtml}`);

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
