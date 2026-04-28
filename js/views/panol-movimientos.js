import {
  collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";

export async function initPanolMovimientosView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarMovimientos();

  document.getElementById("busquedaMovimientos").addEventListener("input", cargarMovimientos);
  document.getElementById("filtroMovTipo").addEventListener("change", cargarMovimientos);
  document.getElementById("filtroMovDesde").addEventListener("change", cargarMovimientos);
  document.getElementById("filtroMovHasta").addEventListener("change", cargarMovimientos);
  document.getElementById("exportMovBtn").addEventListener("click", exportarCSV);
}

async function cargarMovimientos() {
  const cargando = document.getElementById("movimientosCargando");
  const tbody = document.getElementById("tbodyMovimientos");
  if (!tbody) return;
  if (cargando) cargando.style.display = "block";
  tbody.innerHTML = "";

  const snap = await getDocs(query(
    collection(db, "movimientosRepuestos"),
    where("clienteId", "==", _clienteId),
    orderBy("fecha", "desc")
  ));

  let movimientos = [];
  snap.forEach((d) => movimientos.push({ id: d.id, ...d.data() }));

  // Filtros en cliente
  const termino = (document.getElementById("busquedaMovimientos")?.value || "").trim().toLowerCase();
  const tipo = document.getElementById("filtroMovTipo")?.value || "";
  const desde = document.getElementById("filtroMovDesde")?.value;
  const hasta = document.getElementById("filtroMovHasta")?.value;

  if (termino) {
    movimientos = movimientos.filter((m) =>
      `${m.repuestoNombre} ${m.usuario} ${m.ordenNumero || ""}`.toLowerCase().includes(termino)
    );
  }
  if (tipo) movimientos = movimientos.filter((m) => m.tipo === tipo);
  if (desde) movimientos = movimientos.filter((m) => toDate(m.fecha) >= new Date(desde));
  if (hasta) {
    const hastaDate = new Date(hasta);
    hastaDate.setHours(23, 59, 59, 999);
    movimientos = movimientos.filter((m) => toDate(m.fecha) <= hastaDate);
  }

  if (cargando) cargando.style.display = "none";

  if (!movimientos.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">Sin movimientos</td></tr>';
    return;
  }

  movimientos.forEach((m) => {
    const row = tbody.insertRow();
    const tipoClass = m.tipo === "ingreso" ? "panol-mov-ingreso" : m.tipo === "egreso" ? "panol-mov-egreso" : "panol-mov-ajuste";
    row.innerHTML = `
      <td>${formatFecha(m.fecha)}</td>
      <td>${escHtml(m.repuestoNombre || "-")}</td>
      <td><span class="panol-tipo-badge ${tipoClass}">${capitalizar(m.tipo)}</span></td>
      <td>${m.cantidad ?? "-"}</td>
      <td>${m.stockResultante ?? "-"}</td>
      <td>${escHtml(m.ordenNumero || "-")}</td>
      <td>${escHtml(m.usuario || "-")}</td>
      <td>${escHtml(m.observaciones || "-")}</td>`;
  });

  // Guardar para exportar
  window._movimientosPanol = movimientos;
}

function exportarCSV() {
  const movimientos = window._movimientosPanol || [];
  if (!movimientos.length) return alert("No hay movimientos para exportar.");
  const headers = ["Fecha", "Repuesto", "Tipo", "Cantidad", "Stock resultante", "Orden", "Usuario", "Observaciones"];
  const rows = movimientos.map((m) => [
    formatFecha(m.fecha), m.repuestoNombre || "", m.tipo || "",
    m.cantidad ?? "", m.stockResultante ?? "", m.ordenNumero || "",
    m.usuario || "", m.observaciones || ""
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "movimientos_panol.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  return new Date(value);
}

function formatFecha(fecha) {
  if (!fecha) return "-";
  const d = toDate(fecha);
  return !d || isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR");
}

function capitalizar(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function escHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
