import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function initInformesView({ clienteId } = {}) {
  const _clienteId = clienteId || "";
  const ordenesSnap = await getDocs(query(collection(db, "ordenes"), where("clienteId", "==", _clienteId)));
  const ordenes = [];
  ordenesSnap.forEach((d) => ordenes.push({ id: d.id, ...d.data() }));
  renderCorrectivos(ordenes.filter((o) => o.tipo === "Correctivo"));
  renderPreventivos(ordenes.filter((o) => o.tipo === "Preventivo"), ordenes);
}

function renderCorrectivos(correctivos) {
  const total = correctivos.length;
  const cerradas = correctivos.filter((o) => o.estado === "Cerrado");
  const abiertas = total - cerradas.length;

  const tiempoRespuestaHoras = promedio(correctivos
    .map((o) => minutosEntre(o.fechaCreacion, primeraFechaHistorial(o.historial)) / 60)
    .filter((v) => v >= 0));

  const tiempoFinalizacionHoras = promedio(cerradas
    .map((o) => {
      const horasTotales = minutosEntre(o.fechaCreacion, o.fechaCierre) / 60;
      const horasEspera = (o.tiempoTotalEspera || 0) / 60;
      return Math.max(horasTotales - horasEspera, 0);
    })
    .filter((v) => v >= 0));

  const cerradasEnTiempo = cerradas.filter((o) => cumpleFechaProgramada(o)).length;
  const tasaCerradas = porcentaje(cerradas.length, total);
  const tasaAbiertas = porcentaje(abiertas, total);
  const tasaEnTiempo = porcentaje(cerradasEnTiempo, cerradas.length);

  document.getElementById("kpiCorrectivos").innerHTML = `
    ${kpiItem("Tiempo medio de respuesta", `${formatoNumero(tiempoRespuestaHoras)} hs`)}
    ${kpiItem("Tiempo medio de finalización", `${formatoNumero(tiempoFinalizacionHoras)} hs`)}
    ${kpiItem("Tasa de finalización", `Abiertas: ${abiertas} (${tasaAbiertas}%) | Cerradas: ${cerradas.length} (${tasaCerradas}%)`)}
    ${kpiItem("Tasa de finalización en tiempo", `${cerradasEnTiempo} de ${cerradas.length} (${tasaEnTiempo}%)`)}
  `;
}

function renderPreventivos(preventivos, todas) {
  const cerradas = preventivos.filter((o) => o.estado === "Cerrado");
  const cerradasEnTiempo = cerradas.filter((o) => cumpleFechaProgramada(o)).length;
  const tasaEnTiempo = porcentaje(cerradasEnTiempo, cerradas.length);

  const horasPreventivas = sumaHoras(preventivos);
  const horasTotales = sumaHoras(todas);
  const planificado = porcentaje(horasPreventivas, horasTotales);

  document.getElementById("kpiPreventivos").innerHTML = `
    ${kpiItem("Tasa de finalización en tiempo", `${cerradasEnTiempo} de ${cerradas.length} (${tasaEnTiempo}%)`)}
    ${kpiItem("% mantenimiento planificado", `${formatoNumero(horasPreventivas)} hs preventivas de ${formatoNumero(horasTotales)} hs totales (${planificado}%)`)}
  `;
}

function kpiItem(titulo, valor) {
  return `<div class="kpi-item"><p class="kpi-title">${titulo}</p><p class="kpi-value">${valor}</p></div>`;
}

function primeraFechaHistorial(historial = []) {
  if (!historial.length) return null;
  const ordenado = [...historial].sort((a, b) => toDate(a.fecha) - toDate(b.fecha));
  return ordenado[1]?.fecha || ordenado[0]?.fecha || null;
}

function minutosEntre(inicio, fin) {
  const i = toDate(inicio);
  const f = toDate(fin);
  if (!i || !f) return -1;
  return (f - i) / (1000 * 60);
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function promedio(arr) {
  if (!arr.length) return 0;
  return arr.reduce((acc, n) => acc + n, 0) / arr.length;
}

function porcentaje(parte, total) {
  if (!total) return "0.00";
  return ((parte / total) * 100).toFixed(2);
}

function formatoNumero(value) {
  return Number(value || 0).toFixed(2);
}

function cumpleFechaProgramada(orden) {
  const prog = toDate(orden.fechaProgramada);
  const cierre = toDate(orden.fechaCierre);
  if (!prog || !cierre) return false;
  return cierre <= prog;
}

function sumaHoras(ordenes) {
  return ordenes.reduce((acc, o) => acc + (Number(o.tiempoReal) || 0), 0);
}
