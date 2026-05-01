import {
  collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { showAlert } from "../ui/dialog.js";

let _clienteId = "";
let _movimientosTodos = [];   // dataset completo, fetched una vez al iniciar
let _movimientosFiltrados = []; // resultado del último filtrado (para exportar)

export async function initPanolMovimientosView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarMovimientos();

  // Cada filtro solo re-renderiza desde el dataset cacheado en memoria — no
  // refetch a Firestore. Esto evita la race condition que hacía duplicar filas
  // cuando el usuario tipeaba rápido en el buscador.
  document.getElementById("busquedaMovimientos").addEventListener("input", aplicarFiltrosYRender);
  document.getElementById("filtroMovTipo").addEventListener("change", aplicarFiltrosYRender);
  document.getElementById("filtroMovDesde").addEventListener("change", aplicarFiltrosYRender);
  document.getElementById("filtroMovHasta").addEventListener("change", aplicarFiltrosYRender);
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

  _movimientosTodos = [];
  snap.forEach((d) => _movimientosTodos.push({ id: d.id, ...d.data() }));

  if (cargando) cargando.style.display = "none";
  aplicarFiltrosYRender();
}

function aplicarFiltrosYRender() {
  const tbody = document.getElementById("tbodyMovimientos");
  if (!tbody) return;

  const termino = (document.getElementById("busquedaMovimientos")?.value || "").trim().toLowerCase();
  const tipo = document.getElementById("filtroMovTipo")?.value || "";
  const desde = document.getElementById("filtroMovDesde")?.value;
  const hasta = document.getElementById("filtroMovHasta")?.value;

  let movimientos = _movimientosTodos.slice();
  if (termino) {
    movimientos = movimientos.filter((m) =>
      `${m.repuestoNombre || ""} ${m.usuario || ""} ${m.ordenNumero || ""}`.toLowerCase().includes(termino)
    );
  }
  if (tipo) movimientos = movimientos.filter((m) => m.tipo === tipo);
  if (desde) {
    const desdeDate = parseFechaInputLocal(desde);
    if (desdeDate) movimientos = movimientos.filter((m) => {
      const f = toDate(m.fecha);
      return f && f >= desdeDate;
    });
  }
  if (hasta) {
    const hastaDate = parseFechaInputLocal(hasta);
    if (hastaDate) {
      hastaDate.setHours(23, 59, 59, 999);
      movimientos = movimientos.filter((m) => {
        const f = toDate(m.fecha);
        return f && f <= hastaDate;
      });
    }
  }

  // Render — siempre limpia tbody primero (sin awaits intermedios, no hay race)
  tbody.innerHTML = "";
  if (!movimientos.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">Sin movimientos</td></tr>';
    _movimientosFiltrados = [];
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

  _movimientosFiltrados = movimientos;
}

// Parsea "YYYY-MM-DD" del input type="date" como medianoche local (no UTC).
// new Date("2026-04-29") parsea como UTC, lo que en Argentina (UTC-3) es
// 2026-04-28 21:00 local — eso "cuela" eventos del día anterior por la tarde.
function parseFechaInputLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

async function exportarCSV() {
  const movimientos = _movimientosFiltrados;
  if (!movimientos.length) { await showAlert("No hay movimientos para exportar."); return; }
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
