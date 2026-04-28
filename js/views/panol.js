import {
  addDoc, collection, deleteDoc, doc, getDoc,
  getDocs, query, updateDoc, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";
let _role = "";
let _equipos = [];
let _repuestos = [];
let _currentEditId = null;
let _currentAjusteId = null;
let _panolAprobacionDefault = "no"; // valor del cliente

export async function initPanolView({ clienteId, role } = {}) {
  _clienteId = clienteId || "";
  _role = role || "";

  // Leer config del cliente (aprobación default)
  const clienteSnap = await getDoc(doc(db, "clientes", _clienteId));
  _panolAprobacionDefault = clienteSnap.data()?.panolAprobacionDefault || "no";

  _equipos = await cargarEquipos();
  await cargarRepuestos();
  await verificarSolicitudesPendientes();

  document.getElementById("agregarRepuestoBtn").addEventListener("click", agregarRepuesto);
  document.getElementById("guardarEditRepuestoBtn").addEventListener("click", guardarEdicionRepuesto);
  document.getElementById("guardarAjusteBtn").addEventListener("click", confirmarAjuste);
  document.getElementById("exportRepuestosBtn").addEventListener("click", exportarCSV);
  document.getElementById("busquedaRepuestos").addEventListener("input", renderRepuestosFiltrados);
  document.getElementById("filtroCriticos").addEventListener("change", renderRepuestosFiltrados);
  document.getElementById("panol-pendientes-link").addEventListener("click", (e) => {
    e.preventDefault();
    abrirModalSolicitudes();
  });

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) toggleModal(e.target.dataset.modal, false);
    if (e.target.matches(".modal")) toggleModal(e.target.id, false);
  });

  renderEquiposCheckboxes("repEquiposCheck", []);

  // Solo supervisor puede agregar repuestos; admin también
  if (_role === "tecnico") {
    document.getElementById("seccionAgregarRepuesto")?.classList.add("is-hidden");
  }
}

// ── Carga ──────────────────────────────────────────────────────────────────

async function cargarEquipos() {
  const snap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const equipos = [];
  snap.forEach((d) => equipos.push({ id: d.id, nombre: d.data().nombre || "" }));
  return equipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

async function cargarRepuestos() {
  const snap = await getDocs(query(
    collection(db, "repuestos"),
    where("clienteId", "==", _clienteId),
    orderBy("nombre")
  ));
  _repuestos = [];
  snap.forEach((d) => _repuestos.push({ id: d.id, ...d.data() }));
  renderRepuestosFiltrados();
}

// ── Render tabla ───────────────────────────────────────────────────────────

function renderRepuestosFiltrados() {
  const tbody = document.getElementById("tbodyRepuestos");
  if (!tbody) return;

  const termino = (document.getElementById("busquedaRepuestos")?.value || "").trim().toLowerCase();
  const soloCriticos = document.getElementById("filtroCriticos")?.checked || false;

  let lista = _repuestos;
  if (termino) {
    lista = lista.filter((r) => {
      const equiposStr = (r.equiposAsociados || []).map((e) => e.equipoNombre).join(" ").toLowerCase();
      return `${r.nombre} ${r.codigoInterno || ""} ${equiposStr}`.toLowerCase().includes(termino);
    });
  }
  if (soloCriticos) {
    lista = lista.filter((r) => Number(r.stockActual) <= Number(r.stockMinimo || 0));
  }

  tbody.innerHTML = "";
  lista.forEach((r) => {
    const nivel = nivelStock(r);
    const row = tbody.insertRow();
    row.innerHTML = `
      <td>${escHtml(r.codigoInterno || "-")}</td>
      <td>
        <span class="panol-stock-badge panol-stock-${nivel}" title="${labelNivel(nivel)}"></span>
        ${escHtml(r.nombre)}
        ${r.equiposAsociados?.length ? `<br><small class="panol-equipos-tag">${r.equiposAsociados.map((e) => escHtml(e.equipoNombre)).join(", ")}</small>` : ""}
      </td>
      <td class="panol-stock-num panol-num-${nivel}">${r.stockActual ?? 0} ${escHtml(r.unidad || "")}</td>
      <td>${r.stockMinimo ?? "-"}</td>
      <td>${r.stockMaximo ?? "-"}</td>
      <td>${escHtml(r.ubicacionPanol || "-")}</td>
      <td class="actions-cell">
        <div class="table-action-group">
          <button type="button" class="btn-row-action" data-action="ajuste" data-id="${r.id}" title="Ajuste de stock"><i class="fas fa-right-left"></i></button>
          ${_role !== "tecnico" ? `<button type="button" class="btn-row-action" data-action="editar" data-id="${r.id}" title="Editar"><i class="fas fa-pen"></i></button>
          <button type="button" class="btn-delete-icon" data-action="eliminar" data-id="${r.id}" title="Eliminar"><i class="fas fa-trash-can"></i></button>` : ""}
        </div>
      </td>`;
  });

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { action, id } = btn.dataset;
      if (action === "ajuste") abrirAjuste(id);
      if (action === "editar") abrirEdicion(id);
      if (action === "eliminar") eliminarRepuesto(id);
    });
  });
}

function nivelStock(r) {
  const actual = Number(r.stockActual ?? 0);
  const minimo = Number(r.stockMinimo ?? 0);
  if (actual <= minimo) return "critico";
  if (actual <= minimo * 1.5 + 1) return "bajo";
  return "ok";
}

function labelNivel(nivel) {
  return { critico: "Stock crítico", bajo: "Stock bajo", ok: "Stock OK" }[nivel] || "";
}

// ── Checkboxes equipos ─────────────────────────────────────────────────────

function renderEquiposCheckboxes(containerId, seleccionados = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = _equipos.length
    ? _equipos.map((e) => `
        <label class="checkbox-ubicacion-item">
          <input type="checkbox" name="equipo-check" value="${e.id}" data-nombre="${escHtml(e.nombre)}"
            ${seleccionados.includes(e.id) ? "checked" : ""}>
          ${escHtml(e.nombre)}
        </label>`).join("")
    : "<small>No hay equipos cargados.</small>";
}

function leerEquiposSeleccionados(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return [...container.querySelectorAll("input[name='equipo-check']:checked")].map((cb) => ({
    equipoId: cb.value,
    equipoNombre: cb.dataset.nombre
  }));
}

// ── Agregar repuesto ───────────────────────────────────────────────────────

async function agregarRepuesto() {
  const btn = document.getElementById("agregarRepuestoBtn");
  if (!btn || btn.disabled) return;

  const nombre = document.getElementById("repNombre").value.trim();
  const stockInicial = parseFloat(document.getElementById("repStockInicial").value);
  const stockMinimo = parseFloat(document.getElementById("repStockMinimo").value);

  if (!nombre) return alert("El nombre es obligatorio.");
  if (isNaN(stockInicial) || stockInicial < 0) return alert("Ingrese un stock inicial válido.");
  if (isNaN(stockMinimo) || stockMinimo < 0) return alert("Ingrese un stock mínimo válido.");

  const equiposAsociados = leerEquiposSeleccionados("repEquiposCheck");
  const aprobacion = document.querySelector("input[name='repAprobacion']:checked")?.value || "no";

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…';

  try {
    const docRef = await addDoc(collection(db, "repuestos"), {
      clienteId: _clienteId,
      codigoInterno: document.getElementById("repCodigo").value.trim(),
      nombre,
      descripcion: document.getElementById("repDescripcion").value.trim(),
      unidad: document.getElementById("repUnidad").value.trim() || "unidad",
      ubicacionPanol: document.getElementById("repUbicacion").value.trim(),
      stockActual: stockInicial,
      stockMinimo,
      stockMaximo: parseFloat(document.getElementById("repStockMaximo").value) || null,
      precioReferencia: parseFloat(document.getElementById("repPrecio").value) || null,
      equiposAsociados,
      requiereAprobacion: aprobacion === "si",
      fechaCreacion: new Date()
    });

    // Movimiento de ingreso inicial
    if (stockInicial > 0) {
      await registrarMovimiento({
        repuestoId: docRef.id,
        repuestoNombre: nombre,
        tipo: "ingreso",
        cantidad: stockInicial,
        stockResultante: stockInicial,
        observaciones: "Stock inicial al crear repuesto"
      });
    }

    limpiarFormularioNuevo();
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function limpiarFormularioNuevo() {
  ["repCodigo", "repNombre", "repDescripcion", "repUnidad", "repUbicacion",
   "repStockInicial", "repStockMinimo", "repStockMaximo", "repPrecio"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderEquiposCheckboxes("repEquiposCheck", []);
  const radio = document.querySelector("input[name='repAprobacion'][value='no']");
  if (radio) radio.checked = true;
}

// ── Edición ────────────────────────────────────────────────────────────────

function abrirEdicion(id) {
  const r = _repuestos.find((x) => x.id === id);
  if (!r) return;
  _currentEditId = id;

  document.getElementById("editRepCodigo").value = r.codigoInterno || "";
  document.getElementById("editRepNombre").value = r.nombre || "";
  document.getElementById("editRepDescripcion").value = r.descripcion || "";
  document.getElementById("editRepUnidad").value = r.unidad || "";
  document.getElementById("editRepUbicacion").value = r.ubicacionPanol || "";
  document.getElementById("editRepStockMinimo").value = r.stockMinimo ?? "";
  document.getElementById("editRepStockMaximo").value = r.stockMaximo ?? "";
  document.getElementById("editRepPrecio").value = r.precioReferencia ?? "";

  const selIds = (r.equiposAsociados || []).map((e) => e.equipoId);
  renderEquiposCheckboxes("editRepEquiposCheck", selIds);

  const aprobVal = r.requiereAprobacion ? "si" : "no";
  const radioEdit = document.querySelector(`input[name='editRepAprobacion'][value='${aprobVal}']`);
  if (radioEdit) radioEdit.checked = true;

  toggleModal("modalEditarRepuesto", true);
}

async function guardarEdicionRepuesto() {
  const btn = document.getElementById("guardarEditRepuestoBtn");
  if (!btn || btn.disabled || !_currentEditId) return;

  const nombre = document.getElementById("editRepNombre").value.trim();
  if (!nombre) return alert("El nombre es obligatorio.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…';

  try {
    const equiposAsociados = leerEquiposSeleccionados("editRepEquiposCheck");
    const aprobacion = document.querySelector("input[name='editRepAprobacion']:checked")?.value || "no";

    await updateDoc(doc(db, "repuestos", _currentEditId), {
      codigoInterno: document.getElementById("editRepCodigo").value.trim(),
      nombre,
      descripcion: document.getElementById("editRepDescripcion").value.trim(),
      unidad: document.getElementById("editRepUnidad").value.trim() || "unidad",
      ubicacionPanol: document.getElementById("editRepUbicacion").value.trim(),
      stockMinimo: parseFloat(document.getElementById("editRepStockMinimo").value) || 0,
      stockMaximo: parseFloat(document.getElementById("editRepStockMaximo").value) || null,
      precioReferencia: parseFloat(document.getElementById("editRepPrecio").value) || null,
      equiposAsociados,
      requiereAprobacion: aprobacion === "si"
    });

    toggleModal("modalEditarRepuesto", false);
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

// ── Ajuste de stock ────────────────────────────────────────────────────────

function abrirAjuste(id) {
  const r = _repuestos.find((x) => x.id === id);
  if (!r) return;
  _currentAjusteId = id;

  document.getElementById("ajusteRepuestoInfo").innerHTML =
    `<span class="detalle-label">Repuesto:</span> ${escHtml(r.nombre)}<br>
     <span class="detalle-label">Stock actual:</span> ${r.stockActual ?? 0} ${escHtml(r.unidad || "")}`;
  document.getElementById("ajusteCantidad").value = "";
  document.getElementById("ajusteObservaciones").value = "";
  toggleModal("modalAjusteStock", true);
}

async function confirmarAjuste() {
  const btn = document.getElementById("guardarAjusteBtn");
  if (!btn || btn.disabled || !_currentAjusteId) return;

  const cantidad = parseFloat(document.getElementById("ajusteCantidad").value);
  const tipo = document.getElementById("ajusteTipo").value;
  const observaciones = document.getElementById("ajusteObservaciones").value.trim();

  if (isNaN(cantidad) || cantidad <= 0) return alert("Ingrese una cantidad válida.");
  if (!observaciones) return alert("El motivo del ajuste es obligatorio.");

  const r = _repuestos.find((x) => x.id === _currentAjusteId);
  if (!r) return;

  let nuevoStock = Number(r.stockActual ?? 0);
  if (tipo === "ingreso") nuevoStock += cantidad;
  else if (tipo === "egreso") nuevoStock = Math.max(0, nuevoStock - cantidad);
  else if (tipo === "ajuste") nuevoStock = cantidad; // ajuste = setear a valor exacto

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…';

  try {
    await updateDoc(doc(db, "repuestos", _currentAjusteId), { stockActual: nuevoStock });
    await registrarMovimiento({
      repuestoId: _currentAjusteId,
      repuestoNombre: r.nombre,
      tipo,
      cantidad,
      stockResultante: nuevoStock,
      observaciones
    });
    toggleModal("modalAjusteStock", false);
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

// ── Eliminar ───────────────────────────────────────────────────────────────

async function eliminarRepuesto(id) {
  if (!confirm("¿Eliminar este repuesto? Se eliminarán también sus movimientos.")) return;
  try {
    // Borrar movimientos asociados
    const movSnap = await getDocs(query(collection(db, "movimientosRepuestos"), where("repuestoId", "==", id)));
    const borrados = movSnap.docs.map((d) => deleteDoc(doc(db, "movimientosRepuestos", d.id)));
    await Promise.all(borrados);
    await deleteDoc(doc(db, "repuestos", id));
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  }
}

// ── Solicitudes pendientes ─────────────────────────────────────────────────

async function verificarSolicitudesPendientes() {
  if (_role === "tecnico") return; // técnicos no ven el banner de pendientes

  const snap = await getDocs(query(
    collection(db, "solicitudesPanol"),
    where("clienteId", "==", _clienteId),
    where("estado", "==", "pendiente")
  ));

  const total = snap.size;
  const banner = document.getElementById("panol-pendientes-banner");
  const texto = document.getElementById("panol-pendientes-texto");
  if (!banner || !texto) return;

  if (total > 0) {
    texto.textContent = `Hay ${total} solicitud${total > 1 ? "es" : ""} de egreso pendiente${total > 1 ? "s" : ""} de aprobación.`;
    banner.classList.remove("is-hidden");
  } else {
    banner.classList.add("is-hidden");
  }
}

async function abrirModalSolicitudes() {
  const snap = await getDocs(query(
    collection(db, "solicitudesPanol"),
    where("clienteId", "==", _clienteId),
    where("estado", "==", "pendiente")
  ));

  const solicitudes = [];
  snap.forEach((d) => solicitudes.push({ id: d.id, ...d.data() }));

  const tbody = document.getElementById("tbodySolicitudesPanol");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!solicitudes.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Sin solicitudes pendientes</td></tr>';
  } else {
    solicitudes.forEach((s) => {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${escHtml(s.repuestoNombre || "-")}</td>
        <td>${s.cantidad ?? "-"}</td>
        <td>${escHtml(s.solicitante || "-")}</td>
        <td>${escHtml(s.ordenNumero || "-")}</td>
        <td>${formatFecha(s.fecha)}</td>
        <td class="actions-cell">
          <div class="table-action-group">
            <button type="button" class="btn-row-action panol-aprobar-btn" data-id="${s.id}" title="Aprobar"><i class="fas fa-check"></i></button>
            <button type="button" class="btn-delete-icon panol-rechazar-btn" data-id="${s.id}" title="Rechazar"><i class="fas fa-xmark"></i></button>
          </div>
        </td>`;
    });

    tbody.querySelectorAll(".panol-aprobar-btn").forEach((btn) => {
      btn.addEventListener("click", () => procesarSolicitud(btn.dataset.id, "aprobado", solicitudes));
    });
    tbody.querySelectorAll(".panol-rechazar-btn").forEach((btn) => {
      btn.addEventListener("click", () => procesarSolicitud(btn.dataset.id, "rechazado", solicitudes));
    });
  }

  toggleModal("modalSolicitudesPanol", true);
}

async function procesarSolicitud(solicitudId, nuevoEstado, solicitudes) {
  const s = solicitudes.find((x) => x.id === solicitudId);
  if (!s) return;

  try {
    await updateDoc(doc(db, "solicitudesPanol", solicitudId), { estado: nuevoEstado });

    if (nuevoEstado === "aprobado") {
      // Descontar stock
      const repSnap = await getDoc(doc(db, "repuestos", s.repuestoId));
      if (repSnap.exists()) {
        const stockActual = Number(repSnap.data().stockActual ?? 0);
        const nuevoStock = Math.max(0, stockActual - Number(s.cantidad));
        await updateDoc(doc(db, "repuestos", s.repuestoId), { stockActual: nuevoStock });
        await registrarMovimiento({
          repuestoId: s.repuestoId,
          repuestoNombre: s.repuestoNombre,
          tipo: "egreso",
          cantidad: s.cantidad,
          stockResultante: nuevoStock,
          ordenId: s.ordenId || "",
          ordenNumero: s.ordenNumero || "",
          observaciones: `Aprobado por ${sessionStorage.getItem("userName") || "supervisor"}. Orden: ${s.ordenNumero || "-"}`
        });
      }
    }

    // Refrescar
    await verificarSolicitudesPendientes();
    await abrirModalSolicitudes();
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  }
}

// ── Exportar CSV ───────────────────────────────────────────────────────────

function exportarCSV() {
  if (!_repuestos.length) return alert("No hay repuestos para exportar.");
  const headers = ["Código", "Nombre", "Descripción", "Unidad", "Ubicación pañol", "Stock actual", "Stock mínimo", "Stock máximo", "Precio ref.", "Equipos", "Requiere aprobación"];
  const rows = _repuestos.map((r) => [
    r.codigoInterno || "", r.nombre || "", r.descripcion || "", r.unidad || "",
    r.ubicacionPanol || "", r.stockActual ?? 0, r.stockMinimo ?? 0, r.stockMaximo ?? "",
    r.precioReferencia ?? "", (r.equiposAsociados || []).map((e) => e.equipoNombre).join(" / "),
    r.requiereAprobacion ? "Sí" : "No"
  ]);
  descargarCSV([headers, ...rows], "repuestos_panol.csv");
}

function descargarCSV(filas, nombre) {
  const csv = filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Helpers ────────────────────────────────────────────────────────────────

export async function registrarMovimiento({ repuestoId, repuestoNombre, tipo, cantidad, stockResultante, ordenId = "", ordenNumero = "", observaciones = "" }) {
  await addDoc(collection(db, "movimientosRepuestos"), {
    clienteId: _clienteId || sessionStorage.getItem("userClienteId") || "",
    repuestoId,
    repuestoNombre,
    tipo,
    cantidad,
    stockResultante,
    ordenId,
    ordenNumero,
    usuario: sessionStorage.getItem("userName") || "",
    fecha: new Date(),
    observaciones
  });
}

export async function registrarEgresoDesdeOrden({ clienteId, repuestoId, cantidad, ordenId, ordenNumero, solicitante }) {
  // Función llamada desde consulta.js al cerrar una OT
  const repSnap = await getDoc(doc(db, "repuestos", repuestoId));
  if (!repSnap.exists()) throw new Error("Repuesto no encontrado.");

  const r = repSnap.data();

  if (r.requiereAprobacion) {
    // Crear solicitud pendiente en vez de descontar
    await addDoc(collection(db, "solicitudesPanol"), {
      clienteId,
      repuestoId,
      repuestoNombre: r.nombre,
      cantidad,
      solicitante,
      ordenId,
      ordenNumero,
      estado: "pendiente",
      fecha: new Date()
    });
    return { aprobacionPendiente: true, nombre: r.nombre };
  }

  // Descontar directamente
  const nuevoStock = Math.max(0, Number(r.stockActual ?? 0) - cantidad);
  await updateDoc(doc(db, "repuestos", repuestoId), { stockActual: nuevoStock });
  await addDoc(collection(db, "movimientosRepuestos"), {
    clienteId,
    repuestoId,
    repuestoNombre: r.nombre,
    tipo: "egreso",
    cantidad,
    stockResultante: nuevoStock,
    ordenId,
    ordenNumero,
    usuario: solicitante,
    fecha: new Date(),
    observaciones: `Consumo en orden ${ordenNumero}`
  });
  return { aprobacionPendiente: false, nombre: r.nombre, stockResultante: nuevoStock };
}

export async function cargarRepuestosParaOrden(clienteId) {
  const snap = await getDocs(query(
    collection(db, "repuestos"),
    where("clienteId", "==", clienteId),
    orderBy("nombre")
  ));
  const lista = [];
  snap.forEach((d) => lista.push({ id: d.id, ...d.data() }));
  return lista;
}

function toggleModal(id, show) {
  document.getElementById(id)?.classList.toggle("is-hidden", !show);
  if (!show && id === "modalAjusteStock") _currentAjusteId = null;
  if (!show && id === "modalEditarRepuesto") _currentEditId = null;
}

function formatFecha(fecha) {
  if (!fecha) return "-";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR");
}

function escHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
