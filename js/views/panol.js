import {
  addDoc, collection, deleteDoc, doc, getDoc,
  getDocs, query, runTransaction, updateDoc, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { showAlert, showConfirm } from "../ui/dialog.js";

let _clienteId = "";
let _role = "";
let _equipos = [];
let _repuestos = [];
let _currentEditId = null;
let _currentAjusteId = null;

export async function initPanolView({ clienteId, role } = {}) {
  _clienteId = clienteId || "";
  _role = role || "";

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

  renderEquiposSelector("repEquiposCheck", []);

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

// ── Selector de equipos (tags + búsqueda) ─────────────────────────────────

function renderEquiposSelector(containerId, seleccionados = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const selectedMap = new Map();
  seleccionados.forEach((id) => {
    const eq = _equipos.find((e) => e.id === id);
    if (eq) selectedMap.set(id, eq.nombre);
  });

  container.innerHTML = `
    <div class="equipos-selector-wrap">
      <div class="equipos-tags-row" id="${containerId}-tags"></div>
      <input type="text" class="equipos-search-input" id="${containerId}-input"
             placeholder="${_equipos.length ? "Buscar y agregar equipo…" : "No hay equipos cargados"}"
             ${_equipos.length ? "" : "disabled"}>
      <div class="equipos-dropdown is-hidden" id="${containerId}-dropdown"></div>
    </div>`;

  renderTags();
  setupSelectorEvents();

  function renderTags() {
    const row = document.getElementById(`${containerId}-tags`);
    if (!row) return;
    row.innerHTML = [...selectedMap.entries()].map(([id, nombre]) =>
      `<span class="equipo-tag" data-id="${id}" data-nombre="${escHtml(nombre)}">
        ${escHtml(nombre)}
        <button type="button" class="equipo-tag-remove" data-id="${id}" aria-label="Quitar">×</button>
      </span>`
    ).join("");
    row.querySelectorAll(".equipo-tag-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedMap.delete(btn.dataset.id);
        renderTags();
        actualizarDropdown();
      });
    });
  }

  function actualizarDropdown() {
    const input = document.getElementById(`${containerId}-input`);
    const dropdown = document.getElementById(`${containerId}-dropdown`);
    if (!dropdown || dropdown.classList.contains("is-hidden")) return;
    renderDropdown(input?.value || "");
  }

  function renderDropdown(filtro) {
    const dropdown = document.getElementById(`${containerId}-dropdown`);
    if (!dropdown) return;
    const term = filtro.toLowerCase().trim();
    const visibles = _equipos.filter((e) => !term || e.nombre.toLowerCase().includes(term));

    if (!visibles.length) {
      dropdown.innerHTML = `<div class="equipos-dropdown-empty">${term ? "Sin resultados" : "No hay equipos"}</div>`;
    } else {
      dropdown.innerHTML = visibles.map((e) => {
        const sel = selectedMap.has(e.id);
        return `<div class="equipos-dropdown-item${sel ? " selected" : ""}" data-id="${e.id}" data-nombre="${escHtml(e.nombre)}">
          <span class="equipos-check-icon">${sel ? "✓" : ""}</span>
          ${escHtml(e.nombre)}
        </div>`;
      }).join("");
      dropdown.querySelectorAll(".equipos-dropdown-item").forEach((item) => {
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const { id, nombre } = item.dataset;
          if (selectedMap.has(id)) selectedMap.delete(id);
          else selectedMap.set(id, nombre);
          renderTags();
          renderDropdown(document.getElementById(`${containerId}-input`)?.value || "");
        });
      });
    }
    dropdown.classList.remove("is-hidden");
  }

  function setupSelectorEvents() {
    const input = document.getElementById(`${containerId}-input`);
    const dropdown = document.getElementById(`${containerId}-dropdown`);
    if (!input || !dropdown) return;

    input.addEventListener("focus", () => renderDropdown(input.value));
    input.addEventListener("input", () => renderDropdown(input.value));
    input.addEventListener("blur", () => {
      setTimeout(() => {
        dropdown.classList.add("is-hidden");
        input.value = "";
      }, 150);
    });
  }
}

function leerEquiposSeleccionados(containerId) {
  const row = document.getElementById(`${containerId}-tags`);
  if (!row) return [];
  return [...row.querySelectorAll(".equipo-tag")].map((tag) => ({
    equipoId: tag.dataset.id,
    equipoNombre: tag.dataset.nombre
  }));
}

// ── Agregar repuesto ───────────────────────────────────────────────────────

async function agregarRepuesto() {
  const btn = document.getElementById("agregarRepuestoBtn");
  if (!btn || btn.disabled) return;

  const nombre = document.getElementById("repNombre").value.trim();
  const stockInicial = parseFloat(document.getElementById("repStockInicial").value);
  const stockMinimo = parseFloat(document.getElementById("repStockMinimo").value);

  if (!nombre) { await showAlert("El nombre es obligatorio."); return; }
  if (isNaN(stockInicial) || stockInicial < 0) { await showAlert("Ingrese un stock inicial válido."); return; }
  if (isNaN(stockMinimo) || stockMinimo < 0) { await showAlert("Ingrese un stock mínimo válido."); return; }

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
    await showAlert(`Error: ${err.message}`);
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
  renderEquiposSelector("repEquiposCheck", []);
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
  renderEquiposSelector("editRepEquiposCheck", selIds);

  const aprobVal = r.requiereAprobacion ? "si" : "no";
  const radioEdit = document.querySelector(`input[name='editRepAprobacion'][value='${aprobVal}']`);
  if (radioEdit) radioEdit.checked = true;

  toggleModal("modalEditarRepuesto", true);
}

async function guardarEdicionRepuesto() {
  const btn = document.getElementById("guardarEditRepuestoBtn");
  if (!btn || btn.disabled || !_currentEditId) return;

  const nombre = document.getElementById("editRepNombre").value.trim();
  if (!nombre) { await showAlert("El nombre es obligatorio."); return; }

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
    await showAlert(`Error: ${err.message}`);
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

  if (isNaN(cantidad) || cantidad <= 0) { await showAlert("Ingrese una cantidad válida."); return; }
  if (!observaciones) { await showAlert("El motivo del ajuste es obligatorio."); return; }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando…';

  try {
    const repuestoRef = doc(db, "repuestos", _currentAjusteId);
    const movimientoRef = doc(collection(db, "movimientosRepuestos"));
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(repuestoRef);
      if (!snap.exists()) throw new Error("Repuesto no encontrado.");
      const data = snap.data();
      let stock = Number(data.stockActual ?? 0);
      if (tipo === "ingreso") stock += cantidad;
      else if (tipo === "egreso") stock = Math.max(0, stock - cantidad);
      else if (tipo === "ajuste") stock = cantidad;
      tx.update(repuestoRef, { stockActual: stock });
      tx.set(movimientoRef, {
        clienteId: _clienteId || sessionStorage.getItem("userClienteId") || "",
        repuestoId: _currentAjusteId,
        repuestoNombre: data.nombre,
        tipo,
        cantidad,
        stockResultante: stock,
        ordenId: "",
        ordenNumero: "",
        usuario: sessionStorage.getItem("userName") || "",
        fecha: new Date(),
        observaciones
      });
    });
    toggleModal("modalAjusteStock", false);
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    await showAlert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

// ── Eliminar ───────────────────────────────────────────────────────────────

async function eliminarRepuesto(id) {
  if (!(await showConfirm("¿Eliminar este repuesto? El histórico de movimientos se conservará como registro de auditoría."))) return;
  try {
    await deleteDoc(doc(db, "repuestos", id));
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    await showAlert(`Error: ${err.message}`);
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
    const solicitudRef = doc(db, "solicitudesPanol", solicitudId);
    if (nuevoEstado === "aprobado") {
      const repuestoRef = doc(db, "repuestos", s.repuestoId);
      const movimientoRef = doc(collection(db, "movimientosRepuestos"));
      await runTransaction(db, async (tx) => {
        const repSnap = await tx.get(repuestoRef);
        tx.update(solicitudRef, { estado: nuevoEstado });
        if (!repSnap.exists()) return;
        const stockActual = Number(repSnap.data().stockActual ?? 0);
        const nuevoStock = Math.max(0, stockActual - Number(s.cantidad));
        tx.update(repuestoRef, { stockActual: nuevoStock });
        tx.set(movimientoRef, {
          clienteId: _clienteId || sessionStorage.getItem("userClienteId") || "",
          repuestoId: s.repuestoId,
          repuestoNombre: s.repuestoNombre,
          tipo: "egreso",
          cantidad: s.cantidad,
          stockResultante: nuevoStock,
          ordenId: s.ordenId || "",
          ordenNumero: s.ordenNumero || "",
          usuario: sessionStorage.getItem("userName") || "",
          fecha: new Date(),
          observaciones: `Aprobado por ${sessionStorage.getItem("userName") || "supervisor"}. Orden: ${s.ordenNumero || "-"}`
        });
      });
    } else {
      await updateDoc(solicitudRef, { estado: nuevoEstado });
    }

    // Sincronizar estado del repuesto en la orden
    if (s.ordenId) {
      const ordenRef = doc(db, "ordenes", s.ordenId);
      const ordenSnap = await getDoc(ordenRef);
      if (ordenSnap.exists()) {
        const repuestosUtilizados = (ordenSnap.data().repuestosUtilizados || []).map((r) =>
          r.solicitudId === solicitudId
            ? { ...r, estado: nuevoEstado === "aprobado" ? "aprobado" : "rechazado" }
            : r
        );
        await updateDoc(ordenRef, { repuestosUtilizados });
      }
    }

    // Refrescar
    await verificarSolicitudesPendientes();
    await abrirModalSolicitudes();
    await cargarRepuestos();
  } catch (err) {
    console.error(err);
    await showAlert(`Error: ${err.message}`);
  }
}

// ── Exportar CSV ───────────────────────────────────────────────────────────

async function exportarCSV() {
  if (!_repuestos.length) { await showAlert("No hay repuestos para exportar."); return; }
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
    const solicitudRef = await addDoc(collection(db, "solicitudesPanol"), {
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
    return { aprobacionPendiente: true, nombre: r.nombre, unidad: r.unidad || "unidad", solicitudId: solicitudRef.id };
  }

  // Descontar de forma transaccional
  const repuestoRef = doc(db, "repuestos", repuestoId);
  const movimientoRef = doc(collection(db, "movimientosRepuestos"));
  const { nombre, unidad, nuevoStock } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(repuestoRef);
    if (!snap.exists()) throw new Error("Repuesto no encontrado.");
    const data = snap.data();
    const stockActual = Math.max(0, Number(data.stockActual ?? 0) - cantidad);
    tx.update(repuestoRef, { stockActual });
    tx.set(movimientoRef, {
      clienteId,
      repuestoId,
      repuestoNombre: data.nombre,
      tipo: "egreso",
      cantidad,
      stockResultante: stockActual,
      ordenId,
      ordenNumero,
      usuario: solicitante,
      fecha: new Date(),
      observaciones: `Consumo en orden ${ordenNumero}`
    });
    return { nombre: data.nombre, unidad: data.unidad || "unidad", nuevoStock: stockActual };
  });
  return { aprobacionPendiente: false, nombre, unidad, stockResultante: nuevoStock };
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
