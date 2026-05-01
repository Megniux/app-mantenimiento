import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { showAlert, showConfirm } from "../ui/dialog.js";

// ─── JSZip (cargado bajo demanda) ────────────────────────────────────────────
async function getJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.JSZip;
}

// ─── Estado del módulo ───────────────────────────────────────────────────────
let _clientes = [];
let _currentClienteId = null;

// ─── Inicialización ──────────────────────────────────────────────────────────
export async function initClientesView({ signal } = {}) {
  await cargarClientes();

  document.getElementById("busquedaClientes").addEventListener("input", renderClientesFiltrados);
  document.getElementById("agregarClienteBtn").addEventListener("click", () => abrirModalCrear());

  // Mostrar/ocultar sección de aprobación al cambiar checkbox de pañol
  document.getElementById("editClientePanol")?.addEventListener("change", toggleAprobacionGrupo);

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) toggleModal(e.target.dataset.modal, false);
    if (e.target.matches(".modal")) toggleModal(e.target.id, false);
  }, signal ? { signal } : undefined);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".actions-menu")) cerrarMenusDesplegables();
  }, signal ? { signal } : undefined);
}

// ─── Carga y render de tabla ─────────────────────────────────────────────────
async function cargarClientes() {
  const snap = await getDocs(collection(db, "clientes"));
  _clientes = [];
  snap.forEach((d) => _clientes.push({ id: d.id, ...d.data() }));
  _clientes.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" }));
  renderClientesFiltrados();
}

function renderClientesFiltrados() {
  const tbody = document.querySelector("#tablaClientes tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const term = (document.getElementById("busquedaClientes")?.value || "").trim().toLowerCase();
  const lista = term
    ? _clientes.filter((c) =>
        `${c.nombre || ""} ${c.contactoPrincipal?.email || ""} ${c.cuit || ""}`.toLowerCase().includes(term)
      )
    : _clientes;

  lista.forEach((cliente) => {
    const row = tbody.insertRow();
    row.style.cursor = "pointer";

    row.insertCell(0).textContent = cliente.nombre || "-";
    row.insertCell(1).textContent = cliente.contactoPrincipal?.email || "-";
    // ── NUEVO: columna módulo pañol ──
    row.insertCell(2).textContent = cliente.moduloPanol ? "✅ Activo" : "—";

    const tdActions = row.insertCell(3);
    tdActions.className = "actions-menu";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "menu-trigger";
    trigger.dataset.id = cliente.id;
    trigger.setAttribute("aria-label", "Acciones");
    trigger.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
    tdActions.appendChild(trigger);

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const existing = document.getElementById("floatingDropdownClientes");
      if (existing) {
        const prevId = existing.dataset.triggerId;
        existing.remove();
        if (prevId === cliente.id) return;
      }
      mostrarMenuCliente(cliente.id, trigger);
    });

    row.addEventListener("click", (e) => {
      if (e.target.closest(".actions-menu")) return;
      verDetallesCliente(cliente.id);
    });
  });
}

function mostrarMenuCliente(clienteId, trigger) {
  const menu = document.createElement("div");
  menu.id = "floatingDropdownClientes";
  menu.className = "dropdown-menu show";
  menu.dataset.triggerId = clienteId;

  const addOpt = (text, onClick) => {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.onclick = (e) => { e.stopPropagation(); onClick(); cerrarMenusDesplegables(); };
    menu.appendChild(btn);
  };

  addOpt("Ver detalles", () => verDetallesCliente(clienteId));
  addOpt("Editar", () => abrirModalEditar(clienteId));
  addOpt("Exportar datos", () => exportarCliente(clienteId));
  addOpt("Eliminar", () => abrirModalEliminar(clienteId));

  document.body.appendChild(menu);

  const rect = trigger.getBoundingClientRect();
  const menuH = menu.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  menu.style.position = "absolute";
  menu.style.zIndex = "9999";
  menu.style.top = spaceBelow < menuH
    ? `${rect.top + window.scrollY - menuH}px`
    : `${rect.bottom + window.scrollY}px`;
  menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;
}

function cerrarMenusDesplegables() {
  document.getElementById("floatingDropdownClientes")?.remove();
}

// ─── Ver detalles ────────────────────────────────────────────────────────────
function verDetallesCliente(clienteId) {
  const c = _clientes.find((x) => x.id === clienteId);
  if (!c) return;

  const tel = (c.telefonos || []).map((t) => `${t.label}: ${t.numero}`).join(", ") || "-";

  const campos = [
    ["Nombre", c.nombre],
    ["CUIT", c.cuit],
    ["Dirección", c.direccion],
    ["Contacto — Nombre", c.contactoPrincipal?.nombre],
    ["Contacto — Email", c.contactoPrincipal?.email],
    ["Contacto — Teléfono", c.contactoPrincipal?.telefono],
    ["Contador OMC (próxima)", c.contadorOMC ?? 1],
    ["Contador OMP (próxima)", c.contadorOMP ?? 1],
    ["Teléfonos sidebar", tel],
    // ── NUEVO ──
    ["Módulo Pañol", c.moduloPanol ? "Activo" : "Inactivo"],
    ["Aprobación de egresos", c.moduloPanol ? (c.panolAprobacionDefault === "si" ? "Requiere aprobación" : "No requiere") : "-"],
  ];

  document.getElementById("clienteDetallesContenido").innerHTML = campos
    .map(([label, val]) =>
      `<div class="detalle-linea"><span class="detalle-label">${label}:</span> ${val || "-"}</div>`
    )
    .join("");

  toggleModal("modalClienteDetalles", true);
}

// ─── Editar ──────────────────────────────────────────────────────────────────
function abrirModalEditar(clienteId) {
  const c = _clientes.find((x) => x.id === clienteId);
  if (!c) return;
  _currentClienteId = clienteId;

  document.getElementById("editClienteNombre").value = c.nombre || "";
  document.getElementById("editClienteCuit").value = c.cuit || "";
  document.getElementById("editClienteDireccion").value = c.direccion || "";
  document.getElementById("editContactoNombre").value = c.contactoPrincipal?.nombre || "";
  document.getElementById("editContactoEmail").value = c.contactoPrincipal?.email || "";
  document.getElementById("editContactoTelefono").value = c.contactoPrincipal?.telefono || "";
  document.getElementById("editContadorOMC").value = c.contadorOMC ?? 1;
  document.getElementById("editContadorOMP").value = c.contadorOMP ?? 1;

  // ── NUEVO: campos pañol ──
  const chkPanol = document.getElementById("editClientePanol");
  if (chkPanol) chkPanol.checked = !!c.moduloPanol;

  const aprobVal = c.panolAprobacionDefault || "no";
  const radioAprobacion = document.querySelector(`input[name="editClienteAprobacion"][value="${aprobVal}"]`);
  if (radioAprobacion) radioAprobacion.checked = true;

  toggleAprobacionGrupo();

  renderEditorTelefonos(c.telefonos || []);

  document.getElementById("agregarTelefonoBtn").onclick = () => agregarFilaTelefono();
  document.getElementById("guardarClienteBtn").onclick = guardarEdicionCliente;

  toggleModal("modalClienteEditar", true);
}

function renderEditorTelefonos(telefonos) {
  const container = document.getElementById("editTelefonosContainer");
  container.innerHTML = "";
  telefonos.forEach((t) => agregarFilaTelefono(t.label, t.numero));
}

function agregarFilaTelefono(label = "", numero = "") {
  const container = document.getElementById("editTelefonosContainer");
  const row = document.createElement("div");
  row.className = "telefono-row";
  row.style.cssText = "display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;";
  row.innerHTML = `
    <div class="input-with-icon" style="flex:1;">
      <i class="fa-solid fa-tag"></i>
      <input type="text" class="tel-label" placeholder="Etiqueta (ej: Guardia)" value="${escapeAttr(label)}">
    </div>
    <div class="input-with-icon" style="flex:1;">
      <i class="fa-solid fa-phone"></i>
      <input type="text" class="tel-numero" placeholder="Número" value="${escapeAttr(numero)}">
    </div>
    <button type="button" class="btn-delete-icon" title="Eliminar" style="flex-shrink:0;">
      <i class="fa-solid fa-trash-can"></i>
    </button>`;
  row.querySelector(".btn-delete-icon").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function leerTelefonos() {
  return [...document.querySelectorAll("#editTelefonosContainer .telefono-row")].map((row) => ({
    label: row.querySelector(".tel-label").value.trim(),
    numero: row.querySelector(".tel-numero").value.trim()
  })).filter((t) => t.label || t.numero);
}

async function guardarEdicionCliente() {
  const btn = document.getElementById("guardarClienteBtn");
  if (!btn || btn.disabled) return;

  const nombre = document.getElementById("editClienteNombre").value.trim();
  if (!nombre) { await showAlert("El nombre es obligatorio."); return; }

  // ── NUEVO: leer campos pañol ──
  const moduloPanol = document.getElementById("editClientePanol")?.checked || false;
  const panolAprobacionDefault = document.querySelector("input[name='editClienteAprobacion']:checked")?.value || "no";

  const data = {
    nombre,
    cuit: document.getElementById("editClienteCuit").value.trim(),
    direccion: document.getElementById("editClienteDireccion").value.trim(),
    contactoPrincipal: {
      nombre: document.getElementById("editContactoNombre").value.trim(),
      email: document.getElementById("editContactoEmail").value.trim(),
      telefono: document.getElementById("editContactoTelefono").value.trim()
    },
    contadorOMC: parseInt(document.getElementById("editContadorOMC").value, 10) || 1,
    contadorOMP: parseInt(document.getElementById("editContadorOMP").value, 10) || 1,
    telefonos: leerTelefonos(),
    // ── NUEVO ──
    moduloPanol,
    panolAprobacionDefault: moduloPanol ? panolAprobacionDefault : "no"
  };

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await updateDoc(doc(db, "clientes", _currentClienteId), data);
    toggleModal("modalClienteEditar", false);
    await cargarClientes();
  } catch (err) {
    await showAlert(`Error al guardar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ─── NUEVO: toggle visibilidad grupo aprobación ───────────────────────────────
function toggleAprobacionGrupo() {
  const activo = document.getElementById("editClientePanol")?.checked;
  document.getElementById("editClienteAprobacionGrupo")?.classList.toggle("is-hidden", !activo);
}

// ─── Crear cliente ───────────────────────────────────────────────────────────
function abrirModalCrear() {
  document.getElementById("crearClienteOpciones").classList.remove("is-hidden");
  document.getElementById("crearClienteFormVacio").classList.add("is-hidden");
  document.getElementById("crearClienteFormImportar").classList.add("is-hidden");

  ["nuevoNombre", "nuevoCuit", "nuevaDireccion", "nuevoContactoNombre", "nuevoContactoEmail", "nuevoContactoTelefono"]
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const zipInput = document.getElementById("importarZipInput");
  if (zipInput) zipInput.value = "";
  const nombreImportar = document.getElementById("importarNombreCliente");
  if (nombreImportar) nombreImportar.value = "";
  document.getElementById("importarPreview").classList.add("is-hidden");

  document.getElementById("crearClienteVacioBtn").onclick = () => {
    document.getElementById("crearClienteOpciones").classList.add("is-hidden");
    document.getElementById("crearClienteFormVacio").classList.remove("is-hidden");
  };
  document.getElementById("crearClienteImportarBtn").onclick = () => {
    document.getElementById("crearClienteOpciones").classList.add("is-hidden");
    document.getElementById("crearClienteFormImportar").classList.remove("is-hidden");
  };
  document.getElementById("cancelarCrearVacioBtn").onclick = () => {
    document.getElementById("crearClienteFormVacio").classList.add("is-hidden");
    document.getElementById("crearClienteOpciones").classList.remove("is-hidden");
  };
  document.getElementById("cancelarImportarBtn").onclick = () => {
    document.getElementById("crearClienteFormImportar").classList.add("is-hidden");
    document.getElementById("crearClienteOpciones").classList.remove("is-hidden");
  };
  document.getElementById("confirmarCrearVacioBtn").onclick = crearClienteVacio;
  document.getElementById("confirmarImportarBtn").onclick = importarClienteDesdeZip;

  document.getElementById("importarZipInput").addEventListener("change", previsualizarZip);

  toggleModal("modalClienteCrear", true);
}

async function crearClienteVacio() {
  const btn = document.getElementById("confirmarCrearVacioBtn");
  if (!btn || btn.disabled) return;

  const nombre = document.getElementById("nuevoNombre").value.trim();
  if (!nombre) { await showAlert("El nombre es obligatorio."); return; }

  const data = {
    nombre,
    cuit: document.getElementById("nuevoCuit").value.trim(),
    direccion: document.getElementById("nuevaDireccion").value.trim(),
    contactoPrincipal: {
      nombre: document.getElementById("nuevoContactoNombre").value.trim(),
      email: document.getElementById("nuevoContactoEmail").value.trim(),
      telefono: document.getElementById("nuevoContactoTelefono").value.trim()
    },
    contadorOMC: 1,
    contadorOMP: 1,
    telefonos: [],
    // ── NUEVO: valores por defecto ──
    moduloPanol: false,
    panolAprobacionDefault: "no"
  };

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "clientes"), data);
    toggleModal("modalClienteCrear", false);
    await cargarClientes();
  } catch (err) {
    await showAlert(`Error al crear cliente: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ─── Eliminar cliente ────────────────────────────────────────────────────────
function abrirModalEliminar(clienteId) {
  const c = _clientes.find((x) => x.id === clienteId);
  if (!c) return;
  _currentClienteId = clienteId;

  document.getElementById("eliminarClienteNombreTexto").textContent = `Cliente: ${c.nombre}`;

  document.getElementById("eliminarConDatosBtn").onclick = async () => {
    if (!(await showConfirm(`¿Confirmar eliminación TOTAL de "${c.nombre}" y todos sus datos? Esta acción no se puede deshacer.`))) return;
    await eliminarCliente(clienteId, true);
  };
  document.getElementById("eliminarSoloDatosBtn").onclick = async () => {
    if (!(await showConfirm(`¿Eliminar solo el registro de "${c.nombre}" en la colección clientes? Los datos (órdenes, usuarios, etc.) se conservarán.`))) return;
    await eliminarCliente(clienteId, false);
  };
  document.getElementById("cancelarEliminarBtn").onclick = () => toggleModal("modalClienteEliminar", false);

  toggleModal("modalClienteEliminar", true);
}

async function eliminarCliente(clienteId, conDatos) {
  const btn = document.getElementById("eliminarConDatosBtn");
  const btn2 = document.getElementById("eliminarSoloDatosBtn");
  [btn, btn2].forEach((b) => { if (b) b.disabled = true; });

  try {
    if (conDatos) {
      // ── NUEVO: incluir colecciones del módulo pañol ──
      const colecciones = ["ordenes", "usuarios", "equipos", "ubicaciones", "repuestos", "movimientosRepuestos", "solicitudesPanol"];
      for (const col of colecciones) {
        const colName = col === "usuarios" ? "users" : col;
        const snaps = await getDocs(query(collection(db, colName), where("clienteId", "==", clienteId)));
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snaps.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 499) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }
    }
    await deleteDoc(doc(db, "clientes", clienteId));
    toggleModal("modalClienteEliminar", false);
    await cargarClientes();
    await showAlert("Cliente eliminado correctamente.");
  } catch (err) {
    await showAlert(`Error al eliminar: ${err.message}`);
  } finally {
    [btn, btn2].forEach((b) => { if (b) b.disabled = false; });
  }
}

// ─── Exportar cliente ────────────────────────────────────────────────────────
async function exportarCliente(clienteId) {
  const c = _clientes.find((x) => x.id === clienteId);
  if (!c) return;

  try {
    const JSZip = await getJSZip();
    const zip = new JSZip();

    // 1. cliente.csv
    const clienteData = {
      id: c.id, nombre: c.nombre, cuit: c.cuit || "", direccion: c.direccion || "",
      contactoNombre: c.contactoPrincipal?.nombre || "", contactoEmail: c.contactoPrincipal?.email || "",
      contactoTelefono: c.contactoPrincipal?.telefono || "",
      contadorOMC: c.contadorOMC ?? 1, contadorOMP: c.contadorOMP ?? 1,
      telefonos: JSON.stringify(c.telefonos || []),
      // ── NUEVO ──
      moduloPanol: c.moduloPanol ? "true" : "false",
      panolAprobacionDefault: c.panolAprobacionDefault || "no"
    };
    zip.file("cliente.csv", objetosACSV([clienteData]));

    // 2. ordenes.csv
    const ordenesSnap = await getDocs(query(collection(db, "ordenes"), where("clienteId", "==", clienteId)));
    zip.file("ordenes.csv", objetosACSV(ordenesSnap.docs.map(serializarDocumento)));

    // 3. usuarios.csv
    const usersSnap = await getDocs(query(collection(db, "users"), where("clienteId", "==", clienteId)));
    zip.file("usuarios.csv", objetosACSV(usersSnap.docs.map(serializarDocumento)));

    // 4. equipos.csv
    const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", clienteId)));
    zip.file("equipos.csv", objetosACSV(equiposSnap.docs.map(serializarDocumento)));

    // 5. ubicaciones.csv
    const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", clienteId)));
    zip.file("ubicaciones.csv", objetosACSV(ubicacionesSnap.docs.map(serializarDocumento)));

    // ── NUEVO: 6. repuestos.csv ──
    const repuestosSnap = await getDocs(query(collection(db, "repuestos"), where("clienteId", "==", clienteId)));
    zip.file("repuestos.csv", objetosACSV(repuestosSnap.docs.map(serializarDocumento)));

    const blob = await zip.generateAsync({ type: "blob" });
    descargarBlob(blob, `backup_${slugify(c.nombre)}_${fechaHoy()}.zip`);
  } catch (err) {
    await showAlert(`Error al exportar: ${err.message}`);
  }
}

// ─── Importar desde ZIP ──────────────────────────────────────────────────────
async function previsualizarZip() {
  const file = document.getElementById("importarZipInput").files[0];
  const preview = document.getElementById("importarPreview");
  if (!file) { preview.classList.add("is-hidden"); return; }

  try {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(file);
    const archivos = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    preview.textContent = `Archivos detectados: ${archivos.join(", ")}`;
    preview.classList.remove("is-hidden");

    const clienteFile = zip.file("cliente.csv");
    if (clienteFile) {
      const csvText = await clienteFile.async("string");
      const lineas = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      if (lineas.length >= 2) {
        const headers = lineas[0].split(";").map((h) => h.replace(/^"|"$/g, ""));
        const vals = lineas[1].split(";").map((v) => v.replace(/^"|"$/g, ""));
        const nombreIdx = headers.indexOf("nombre");
        const nombreInput = document.getElementById("importarNombreCliente");
        if (nombreIdx !== -1 && nombreInput && !nombreInput.value.trim()) {
          nombreInput.value = vals[nombreIdx] || "";
        }
      }
    }
  } catch {
    preview.textContent = "No se pudo leer el ZIP.";
    preview.classList.remove("is-hidden");
  }
}

async function importarClienteDesdeZip() {
  const btn = document.getElementById("confirmarImportarBtn");
  if (!btn || btn.disabled) return;

  const file = document.getElementById("importarZipInput").files[0];
  if (!file) { await showAlert("Seleccioná un archivo ZIP."); return; }

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando...';

  try {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(file);

    const clienteCSV = await leerArchivoZip(zip, "cliente.csv");
    if (!clienteCSV) throw new Error("El ZIP no contiene cliente.csv");

    const clienteRows = parsearCSV(clienteCSV);
    if (!clienteRows.length) throw new Error("cliente.csv está vacío");
    const clienteRow = clienteRows[0];

    const nombreOverride = document.getElementById("importarNombreCliente")?.value.trim();
    if (!nombreOverride) throw new Error("Ingresá un nombre para el cliente.");
    clienteRow.nombre = nombreOverride;

    let telefonos = [];
    try { telefonos = JSON.parse(clienteRow.telefonos || "[]"); } catch { telefonos = []; }

    const nuevoClienteData = {
      nombre: clienteRow.nombre,
      cuit: clienteRow.cuit || "",
      direccion: clienteRow.direccion || "",
      contactoPrincipal: {
        nombre: clienteRow.contactoNombre || "",
        email: clienteRow.contactoEmail || "",
        telefono: clienteRow.contactoTelefono || ""
      },
      contadorOMC: parseInt(clienteRow.contadorOMC, 10) || 1,
      contadorOMP: parseInt(clienteRow.contadorOMP, 10) || 1,
      telefonos,
      // ── NUEVO ──
      moduloPanol: clienteRow.moduloPanol === "true",
      panolAprobacionDefault: clienteRow.panolAprobacionDefault || "no"
    };

    const nuevoClienteRef = await addDoc(collection(db, "clientes"), nuevoClienteData);
    const nuevoClienteId = nuevoClienteRef.id;
    const oldClienteId = clienteRow.id || null;

    // Mapas oldId → newId. Las colecciones que se importan después usan estos
    // mapas para remapear sus referencias cruzadas (ej. equipos.ubicacionActualId).
    const idMaps = {};
    idMaps.ubicaciones = await importarColeccion(zip, "ubicaciones.csv", "ubicaciones", nuevoClienteId, oldClienteId, idMaps);
    idMaps.equipos     = await importarColeccion(zip, "equipos.csv",     "equipos",     nuevoClienteId, oldClienteId, idMaps);
    await importarColeccion(zip, "usuarios.csv", "users",     nuevoClienteId, oldClienteId, idMaps);
    await importarColeccion(zip, "ordenes.csv",  "ordenes",   nuevoClienteId, oldClienteId, idMaps);
    await importarColeccion(zip, "repuestos.csv","repuestos", nuevoClienteId, oldClienteId, idMaps);

    toggleModal("modalClienteCrear", false);
    await cargarClientes();
    await showAlert(`Cliente "${nuevoClienteData.nombre}" importado correctamente.`);
  } catch (err) {
    await showAlert(`Error al importar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// Configuración de referencias cruzadas a remapear por colección importada.
// path: nombre del campo. Soporta "campo.subcampo" para objetos anidados y
// "campo[].subcampo" para arrays de objetos. mapa: nombre del idMap a usar.
const REMAP_CONFIG = {
  equipos: [
    { path: "ubicacionActualId",                mapa: "ubicaciones" },
    { path: "historialUbicaciones[].desdeId",   mapa: "ubicaciones" },
    { path: "historialUbicaciones[].haciaId",   mapa: "ubicaciones" }
  ],
  ordenes: [
    { path: "ubicacionId", mapa: "ubicaciones" },
    { path: "equipoId",    mapa: "equipos" }
  ],
  repuestos: [
    { path: "equiposAsociados[].equipoId", mapa: "equipos" }
  ]
};

function remapearCampo(row, path, idMap) {
  if (!idMap) return;
  if (path.includes("[].")) {
    const [arrKey, sub] = path.split("[].");
    const arr = row[arrKey];
    if (!Array.isArray(arr)) return;
    row[arrKey] = arr.map((item) => {
      if (!item || typeof item !== "object") return item;
      const valor = item[sub];
      return (valor && idMap[valor]) ? { ...item, [sub]: idMap[valor] } : item;
    });
    return;
  }
  const valor = row[path];
  if (valor && idMap[valor]) row[path] = idMap[valor];
}

async function importarColeccion(zip, archivoCSV, coleccion, nuevoClienteId, oldClienteId, idMaps = {}) {
  const csv = await leerArchivoZip(zip, archivoCSV);
  if (!csv) return {};

  const rows = parsearCSV(csv);
  if (!rows.length) return {};

  const CAMPOS_FECHA = ["fechaCreacion", "fechaProgramada", "fechaCierre", "fechaInicioEspera"];
  const CAMPOS_NUMERICOS = ["contadorOMC", "contadorOMP", "tiempoEstimado", "tiempoReal",
    "tiempoTotalEspera", "stockActual", "stockMinimo", "stockMaximo", "precioReferencia"];
  const CAMPOS_NULOS_SI_VACIO = ["tiempoEstimado", "tiempoReal", "stockMaximo", "precioReferencia"];
  const CAMPOS_ARRAY_CON_FECHA = ["historial", "historialUbicaciones"];

  // Pre-generar refs ANTES de transformar para construir oldId → newId.
  // Eso permite que la propia colección, o las siguientes, remapeen referencias
  // cruzadas usando el mapa.
  const refs = rows.map(() => doc(collection(db, coleccion)));
  const idMap = {};
  rows.forEach((row, i) => {
    if (row.id) idMap[row.id] = refs[i].id;
  });

  const remaps = REMAP_CONFIG[coleccion] || [];

  const docsParaGuardar = rows.map((row) => {
    delete row.id;
    row.clienteId = nuevoClienteId;

    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string" && (val.startsWith("[") || val.startsWith("{"))) {
        try { row[key] = JSON.parse(val); } catch { /* mantener como string */ }
      }
      if (typeof val === "string" && val !== "" && !Number.isNaN(Number(val)) && CAMPOS_NUMERICOS.includes(key)) {
        row[key] = Number(val);
      }
      if (val === "" && CAMPOS_NULOS_SI_VACIO.includes(key)) {
        row[key] = null;
      }
    }

    for (const campo of CAMPOS_FECHA) {
      if (!(campo in row)) continue;
      const val = row[campo];
      if (typeof val === "string" && val !== "") {
        const d = new Date(val);
        if (!Number.isNaN(d.getTime())) row[campo] = d;
      } else if (val === "" || val == null) {
        row[campo] = null;
      }
    }

    for (const campo of CAMPOS_ARRAY_CON_FECHA) {
      if (!Array.isArray(row[campo])) continue;
      row[campo] = row[campo].map((item) => {
        if (item && typeof item === "object" && item.fecha &&
            "seconds" in item.fecha && "nanoseconds" in item.fecha) {
          return { ...item, fecha: new Date(item.fecha.seconds * 1000 + Math.round(item.fecha.nanoseconds / 1e6)) };
        }
        return item;
      });
    }

    // Aplicar remaps de referencias cruzadas (oldId → newId) usando los mapas
    // de las colecciones importadas previamente.
    for (const { path, mapa } of remaps) {
      remapearCampo(row, path, idMaps[mapa]);
    }

    return row;
  });

  const BATCH_SIZE = 400;
  let batch = writeBatch(db);
  let count = 0;

  for (let i = 0; i < docsParaGuardar.length; i++) {
    batch.set(refs[i], docsParaGuardar[i]);
    count++;
    if (count === BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();

  return idMap;
}

async function leerArchivoZip(zip, nombre) {
  const file = zip.file(nombre);
  if (!file) return null;
  return file.async("string");
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────
function objetosACSV(objetos) {
  if (!objetos.length) return "";
  const headers = [...new Set(objetos.flatMap((o) => Object.keys(o)))];
  const escapar = (v) => {
    if (v == null) return '""';
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [headers.join(";"), ...objetos.map((o) => headers.map((h) => escapar(o[h])).join(";"))];
  return "\uFEFF" + rows.join("\r\n");
}

function serializarDocumento(docSnap) {
  const data = docSnap.data();
  const result = { id: docSnap.id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === "function") {
      result[k] = v.toDate().toISOString();
    } else if (Array.isArray(v) || (v && typeof v === "object")) {
      result[k] = JSON.stringify(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function parsearCSV(texto) {
  texto = texto.replace(/^﻿/, "");

  // Parseo caracter a caracter para manejar correctamente campos con saltos de linea internos
  const filas = [];
  let campoActual = [];
  let filaActual = [];
  let dentroComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"') {
      if (dentroComillas && texto[i + 1] === '"') { campoActual.push('"'); i++; }
      else dentroComillas = !dentroComillas;
    } else if (ch === ";" && !dentroComillas) {
      filaActual.push(campoActual.join(""));
      campoActual = [];
    } else if ((ch === "\r" || ch === "\n") && !dentroComillas) {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      filaActual.push(campoActual.join(""));
      campoActual = [];
      if (filaActual.some((f) => f !== "")) filas.push(filaActual);
      filaActual = [];
    } else {
      campoActual.push(ch);
    }
  }
  if (campoActual.length > 0 || filaActual.length > 0) {
    filaActual.push(campoActual.join(""));
    if (filaActual.some((f) => f !== "")) filas.push(filaActual);
  }

  if (filas.length < 2) return [];
  const headers = filas[0];
  return filas.slice(1).map((vals) =>
    Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]))
  );
}
function toggleModal(id, visible) {
  document.getElementById(id)?.classList.toggle("is-hidden", !visible);
  if (!visible) _currentClienteId = null;
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(str) {
  return (str || "cliente").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function fechaHoy() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
