// Preview local del email del informe diario con datos de ejemplo. No toca
// Firestore ni Brevo: renderiza el HTML y lo escribe en un archivo para abrirlo
// en el navegador.
//
// Uso (desde functions/):
//   node scripts/preview-reporte-diario.mjs [salida.html]
// Sin argumento escribe en la carpeta temporal del sistema (no dentro de
// functions/, para no subirlo en el deploy).

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agruparPorOrden, calcularVentana, renderReporteDiario } from "../reporteDiario.js";

const salida = process.argv[2] || join(tmpdir(), "preview-reporte-diario.html");

// Ventana de un lunes: abarca viernes + sábado + domingo.
const { desde, fin } = calcularVentana(new Date("2026-10-05T11:00:00Z"));
const t = (iso) => new Date(`${iso}-03:00`);

const registros = [
  {
    ordenId: "a1", evento: "modificada", fecha: t("2026-10-02T09:15:00"), usuario: "Juan Pérez",
    orden: { numeroOrden: "OMC-0142", tipo: "Correctivo", solicitante: "Ana López", descripcion: "Ruido fuerte al arrancar.", equipo: "Compresor 3", ubicacion: "Planta Norte", estado: "En proceso" },
    cambios: [
      { label: "Estado", antes: "Nuevo", despues: "En proceso" },
      { label: "Técnico asignado", antes: "-", despues: "Carlos Gómez" }
    ]
  },
  {
    ordenId: "a1", evento: "modificada", fecha: t("2026-10-03T16:40:00"), usuario: "Carlos Gómez",
    orden: { numeroOrden: "OMC-0142", tipo: "Correctivo", solicitante: "Ana López", descripcion: "Ruido fuerte al arrancar.", equipo: "Compresor 3", ubicacion: "Planta Norte", estado: "Cerrado" },
    cambios: [
      { label: "Estado", antes: "En proceso", despues: "Cerrado" },
      { label: "Informe de cierre", antes: "-", despues: "Se reemplazó la correa y se ajustó la tensión." },
      { label: "Tiempo real (hs)", antes: "-", despues: "2.5" }
    ]
  },
  {
    ordenId: "b2", evento: "creada", fecha: t("2026-10-04T08:05:00"), usuario: "Ana López",
    orden: { numeroOrden: "OMC-0143", tipo: "Correctivo", solicitante: "Ana López", descripcion: "Pierde agua por el sello mecánico.", equipo: "Bomba de agua 1", ubicacion: "Sala de máquinas", estado: "Nuevo" },
    detalle: [
      { label: "Prioridad", valor: "Alta" }
    ]
  },
  {
    ordenId: "c3", evento: "modificada", fecha: t("2026-10-02T11:00:00"), usuario: "Supervisor Demo",
    orden: { numeroOrden: "OMP-0031", tipo: "Preventivo", solicitante: "Supervisor Demo", descripcion: "Ajuste de borneras y termografía.", equipo: "Tablero general", ubicacion: "Planta Sur", estado: "Pendiente" },
    cambios: [{ label: "Fecha programada", antes: "06/10/2026", despues: "09/10/2026" }]
  },
  {
    ordenId: "d4", evento: "eliminada", fecha: t("2026-10-02T12:30:00"), usuario: "Admin Demo",
    orden: { numeroOrden: "OMC-0139", tipo: "Correctivo", solicitante: "Juan Pérez", descripcion: "Orden duplicada.", equipo: "Autoelevador", ubicacion: "Depósito", estado: "Nuevo" }
  }
];

const { subject, html } = renderReporteDiario({
  clienteNombre: "Cliente de ejemplo",
  desde,
  fin,
  grupos: agruparPorOrden(registros)
});

writeFileSync(salida, html, "utf-8");
console.log(`Asunto: ${subject}`);
console.log(`Ventana: ${desde.toISOString()} → ${fin.toISOString()}`);
console.log(`HTML escrito en ${salida}`);
