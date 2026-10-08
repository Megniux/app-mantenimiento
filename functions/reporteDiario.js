// Lógica pura del informe diario de órdenes (sin dependencias de Firebase):
// cálculo de la ventana a reportar, agrupado de los registros de
// `cambiosOrdenes` por orden y render del email. La usan reporteDiarioOrdenes
// y reporteDiarioPrueba (index.js) y el preview local
// (scripts/preview-reporte-diario.mjs).

import { TZ_ART, toDate, escapeHtml } from "./utils.js";

// Argentina no usa horario de verano desde 2009: offset fijo -03:00. Lo usamos
// para construir medianoches ART como instantes UTC sin depender del runtime.
const ART_OFFSET = "-03:00";
const DIA_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" del día calendario ART de un instante.
export function fechaISOART(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_ART, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

// Instante UTC de las 00:00 ART de un día calendario "YYYY-MM-DD".
export function medianocheART(isoDate) {
  return new Date(`${isoDate}T00:00:00${ART_OFFSET}`);
}

// Día de la semana ART: 0=domingo … 6=sábado.
function diaSemanaART(date) {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ_ART, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Ventana [desde, fin) a reportar. `fin` es siempre hoy 00:00 ART: lo cargado
// entre la medianoche y la corrida de las 8:00 sale en el informe siguiente.
// `desde` es donde terminó el informe anterior del cliente (`ultimoHasta`), así
// un día que falló el envío se recupera en el siguiente. Sin informe anterior
// (primera corrida) se toma el día anterior, o viernes+sábado+domingo si hoy es
// lunes.
// Si el informe anterior ya cubrió hasta hoy (segunda corrida del mismo día),
// la ventana queda vacía (desde == fin).
export function calcularVentana(ahora = new Date(), ultimoHasta = null) {
  const fin = medianocheART(fechaISOART(ahora));
  const previo = toDate(ultimoHasta);
  if (previo) return { desde: previo < fin ? previo : fin, fin };
  const diasAtras = diaSemanaART(ahora) === 1 ? 3 : 1;
  return { desde: new Date(fin.getTime() - diasAtras * DIA_MS), fin };
}

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Partes de fecha/hora ART armadas a mano: el separador de toLocaleString
// ("/" o "-") varía según la versión de ICU del runtime.
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function partesART(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_ART, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { dd: p.day, mm: p.month, hh: p.hour, min: p.minute, dow: diaSemanaART(date) };
}

// "lunes 05/10"
function etiquetaDia(date) {
  const { dd, mm, dow } = partesART(date);
  return `${DIAS_SEMANA[dow]} ${dd}/${mm}`;
}

// Texto del período cubierto: "lunes 05/10" o "viernes 02/10 al domingo 04/10".
export function textoPeriodo(desde, fin) {
  const ultimoDia = new Date(fin.getTime() - 1);
  if (fechaISOART(desde) === fechaISOART(ultimoDia)) return etiquetaDia(desde);
  return `${etiquetaDia(desde)} al ${etiquetaDia(ultimoDia)}`;
}

// "05/10 14:32"
function fechaHoraCorta(v) {
  const d = toDate(v);
  if (!d) return "-";
  const { dd, mm, hh, min } = partesART(d);
  return `${dd}/${mm} ${hh}:${min}`;
}

// Agrupa los registros de cambiosOrdenes por orden. Devuelve una lista de
// { ordenId, orden, eventos[], creada, eliminada } ordenada por tipo y número,
// con los eventos de cada orden en orden cronológico. `orden` es el snapshot
// del evento más reciente (estado actual al cierre de la ventana).
export function agruparPorOrden(registros) {
  const porOrden = new Map();
  const ordenados = [...registros].sort((a, b) => toDate(a.fecha) - toDate(b.fecha));
  for (const r of ordenados) {
    if (!porOrden.has(r.ordenId)) porOrden.set(r.ordenId, { ordenId: r.ordenId, eventos: [] });
    const g = porOrden.get(r.ordenId);
    g.eventos.push(r);
    g.orden = r.orden || {};
  }
  const grupos = [...porOrden.values()].map((g) => ({
    ...g,
    creada: g.eventos.some((e) => e.evento === "creada"),
    eliminada: g.eventos[g.eventos.length - 1].evento === "eliminada"
  }));
  return grupos.sort((a, b) =>
    String(a.orden.tipo).localeCompare(String(b.orden.tipo), "es")
    || String(a.orden.numeroOrden).localeCompare(String(b.orden.numeroOrden), "es", { numeric: true })
  );
}

const ESTILOS_CAJA = {
  creada: { fondo: "#e8f5e9", borde: "#2e7d32", etiqueta: "NUEVA" },
  modificada: { fondo: "#fff8e1", borde: "#f5b400", etiqueta: "" },
  eliminada: { fondo: "#fdecea", borde: "#c62828", etiqueta: "ELIMINADA" }
};

const MAX_LARGO_VALOR = 500;

function valorCorto(v) {
  const s = v == null || v === "" ? "-" : String(v);
  return s.length > MAX_LARGO_VALOR ? `${s.slice(0, MAX_LARGO_VALOR)}…` : s;
}

function renderEvento(e) {
  const accion = { creada: "Creada", modificada: "Modificada", eliminada: "Eliminada" }[e.evento] || e.evento;
  const encabezado = `<div style="color:#666;font-size:13px;margin:8px 0 4px 0;">
      <strong style="color:#333;">${escapeHtml(accion)}</strong> por ${escapeHtml(e.usuario || "-")} · ${escapeHtml(fechaHoraCorta(e.fecha))}
    </div>`;

  let items = "";
  if (e.evento === "modificada") {
    items = (e.cambios || []).map(({ label, antes, despues }) => `
      <li style="margin-bottom:4px;">
        <strong>${escapeHtml(label)}:</strong>
        <span style="color:#999;text-decoration:line-through;">${escapeHtml(valorCorto(antes))}</span>
        &nbsp;→&nbsp;
        <span style="color:#222;font-weight:600;">${escapeHtml(valorCorto(despues))}</span>
      </li>`).join("");
  } else if (e.evento === "creada") {
    items = (e.detalle || []).map(({ label, valor }) => `
      <li style="margin-bottom:4px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(valorCorto(valor))}</li>`).join("");
  }
  const lista = items ? `<ul style="margin:0;padding-left:20px;">${items}</ul>` : "";
  return encabezado + lista;
}

function renderCajaOrden(g) {
  const tipoCaja = g.eliminada ? "eliminada" : g.creada ? "creada" : "modificada";
  const estilo = ESTILOS_CAJA[tipoCaja];
  const o = g.orden;
  const etiqueta = estilo.etiqueta
    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;background:${estilo.borde};color:#fff;font-size:11px;font-weight:600;vertical-align:middle;">${estilo.etiqueta}</span>`
    : "";
  // Contexto fijo de la orden (aunque no haya cambiado), para que un cambio
  // aislado (ej. solo la fecha programada) se entienda sin abrir la app.
  const contexto = [
    ["Solicitante", o.solicitante],
    ["Equipo", o.equipo],
    ["Ubicación", o.ubicacion],
    ["Descripción", o.descripcion ? valorCorto(o.descripcion) : ""],
    [g.eliminada ? "Último estado" : "Estado actual", o.estado]
  ].filter(([, v]) => v);
  const filasContexto = contexto.map(([label, valor]) => `<tr>
      <td style="padding:2px 10px 2px 0;color:#666;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:2px 0;color:#222;">${escapeHtml(valor)}</td>
    </tr>`).join("");
  const tablaContexto = filasContexto
    ? `<table style="border-collapse:collapse;margin:6px 0 4px 0;font-family:Arial,sans-serif;font-size:13px;">${filasContexto}</table>`
    : "";
  return `<div style="margin:0 0 14px 0;padding:12px;background:${estilo.fondo};border-left:4px solid ${estilo.borde};font-family:Arial,sans-serif;font-size:14px;">
    <div style="font-weight:600;font-size:15px;">Orden ${escapeHtml(o.numeroOrden || g.ordenId)}${etiqueta}</div>
    ${tablaContexto}
    <div style="border-top:1px solid rgba(0,0,0,0.08);margin-top:6px;"></div>
    ${g.eventos.map(renderEvento).join("")}
  </div>`;
}

function plural(n, singular, pluralTxt) {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

// Arma el email del informe de un cliente. `grupos` = salida de agruparPorOrden.
export function renderReporteDiario({ clienteNombre, desde, fin, grupos }) {
  const periodo = textoPeriodo(desde, fin);
  const subject = `Informe diario de órdenes · ${clienteNombre} · ${capitalizar(periodo)}`;

  const creadas = grupos.filter((g) => g.creada && !g.eliminada).length;
  const eliminadas = grupos.filter((g) => g.eliminada).length;
  const modificadas = grupos.length - creadas - eliminadas;
  const resumen = [
    creadas ? plural(creadas, "orden nueva", "órdenes nuevas") : null,
    modificadas ? plural(modificadas, "orden modificada", "órdenes modificadas") : null,
    eliminadas ? plural(eliminadas, "orden eliminada", "órdenes eliminadas") : null
  ].filter(Boolean).join(" · ");

  const secciones = [["Correctivo", "Correctivas"], ["Preventivo", "Preventivas"]]
    .map(([tipo, titulo]) => [titulo, grupos.filter((g) => g.orden.tipo === tipo)]);
  const otras = grupos.filter((g) => !["Correctivo", "Preventivo"].includes(g.orden.tipo));
  if (otras.length) secciones.push(["Otras", otras]);

  const cuerpo = secciones
    .filter(([, lista]) => lista.length)
    .map(([titulo, lista]) => `
    <h3 style="margin:24px 0 10px 0;color:#0b6cb8;font-family:Arial,sans-serif;">${escapeHtml(titulo)} (${lista.length})</h3>
    ${lista.map(renderCajaOrden).join("")}`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#222;">
    <h2 style="margin:0 0 4px 0;color:#0b6cb8;">${escapeHtml(clienteNombre)}</h2>
    <p style="margin:0 0 4px 0;color:#555;">Informe diario de órdenes · ${escapeHtml(capitalizar(periodo))}</p>
    <p style="margin:0;color:#555;font-weight:600;">${escapeHtml(resumen)}</p>
    ${cuerpo}
    <p style="margin-top:28px;color:#999;font-size:12px;">
      Informe automático de Mantenimiento-app. No respondas a este mensaje.<br>
      Si no querés recibirlo más, pedile a un administrador que desactive la opción
      "Recibe informe diario" en Gestionar Usuarios.
    </p>
  </div>
</body></html>`;
  return { subject, html };
}
