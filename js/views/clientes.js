import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

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
let _listenerMenuRegistrado = false;

// ─── Inicialización ──────────────────────────────────────────────────────────
export async function initClientesView() {
  await cargarClientes();

  document.getElementById("busquedaClientes").addEventListener("input", renderClientesFiltrados);
  document.getElementById("exportarTodosBtn").addEventListener("click", () => {
    // Exportar TODOS los clientes uno a uno no escala; exportamos el seleccionado o pedimos elegir
    alert("Usá el menú ⋮ de cada cliente para exportar sus datos.");
  });
  document.getElementById("agregarClienteBtn").addEventListener("click", () => abrirModalCrear());

  if (!_listenerMenuRegistrado) {
    document.getElementById("mainContent").addEventListener("click", (e) => {
      if (e.target.matches(".close-modal")) toggleModal(e.target.dataset.modal, false);
      if (e.target.matches(".modal")) toggleModal(e.target.id, false);
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".actions-menu")) cerrarMenusDesplegables();
    });
    _listenerMenuRegistrado = true;
  }
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

    const tdNombre = row.insertCell(0);
    tdNombre.textContent = cliente.nombre || "-";

    const tdEmail = row.insertCell(1);
    tdEmail.textContent = cliente.contactoPrincipal?.email || "-";

    // Acciones
    const tdActions = row.insertCell(2);
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

    // Click en fila → ver detalles
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
  if (!nombre) return alert("El nombre es obligatorio.");

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
    telefonos: leerTelefonos()
  };

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await updateDoc(doc(db, "clientes", _currentClienteId), data);
    toggleModal("modalClienteEditar", false);
    await cargarClientes();
  } catch (err) {
    alert(`Error al guardar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ─── Crear cliente ───────────────────────────────────────────────────────────
function abrirModalCrear() {
  // Resetear estado del modal
  document.getElementById("crearClienteOpciones").classList.remove("is-hidden");
  document.getElementById("crearClienteFormVacio").classList.add("is-hidden");
  document.getElementById("crearClienteFormImportar").classList.add("is-hidden");

  // Limpiar campos
  ["nuevoNombre", "nuevoCuit", "nuevaDireccion", "nuevoContactoNombre", "nuevoContactoEmail", "nuevoContactoTelefono"]
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const zipInput = document.getElementById("importarZipInput");
  if (zipInput) zipInput.value = "";
  const nombreImportar = document.getElementById("importarNombreCliente");
  if (nombreImportar) nombreImportar.value = "";
  document.getElementById("importarPreview").classList.add("is-hidden");

  // Botones de navegación interna
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
  if (!nombre) return alert("El nombre es obligatorio.");

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
    telefonos: []
  };

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "clientes"), data);
    toggleModal("modalClienteCrear", false);
    await cargarClientes();
  } catch (err) {
    alert(`Error al crear cliente: ${err.message}`);
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
    if (!confirm(`¿Confirmar eliminación TOTAL de "${c.nombre}" y todos sus datos? Esta acción no se puede deshacer.`)) return;
    await eliminarCliente(clienteId, true);
  };
  document.getElementById("eliminarSoloDatosBtn").onclick = async () => {
    if (!confirm(`¿Eliminar solo el registro de "${c.nombre}" en la colección clientes? Los datos (órdenes, usuarios, etc.) se conservarán.`)) return;
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
      const colecciones = ["ordenes", "usuarios", "equipos", "ubicaciones"];
      for (const col of colecciones) {
        const snaps = await getDocs(query(collection(db, col === "usuarios" ? "users" : col), where("clienteId", "==", clienteId)));
        // Firestore batch máximo 500 ops
        const batch = writeBatch(db);
        let count = 0;
        for (const d of snaps.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 499) {
            await batch.commit();
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }
    }
    await deleteDoc(doc(db, "clientes", clienteId));
    toggleModal("modalClienteEliminar", false);
    await cargarClientes();
    alert("Cliente eliminado correctamente.");
  } catch (err) {
    alert(`Error al eliminar: ${err.message}`);
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
    const clienteData = { id: c.id, nombre: c.nombre, cuit: c.cuit || "", direccion: c.direccion || "",
      contactoNombre: c.contactoPrincipal?.nombre || "", contactoEmail: c.contactoPrincipal?.email || "",
      contactoTelefono: c.contactoPrincipal?.telefono || "",
      contadorOMC: c.contadorOMC ?? 1, contadorOMP: c.contadorOMP ?? 1,
      telefonos: JSON.stringify(c.telefonos || []) };
    zip.file("cliente.csv", objetosACSV([clienteData]));

    // 2. ordenes.csv
    const ordenesSnap = await getDocs(query(collection(db, "ordenes"), where("clienteId", "==", clienteId)));
    const ordenes = ordenesSnap.docs.map((d) => serializarDocumento(d));
    zip.file("ordenes.csv", objetosACSV(ordenes));

    // 3. usuarios.csv
    const usersSnap = await getDocs(query(collection(db, "users"), where("clienteId", "==", clienteId)));
    const usuarios = usersSnap.docs.map((d) => serializarDocumento(d));
    zip.file("usuarios.csv", objetosACSV(usuarios));

    // 4. equipos.csv
    const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", clienteId)));
    const equipos = equiposSnap.docs.map((d) => serializarDocumento(d));
    zip.file("equipos.csv", objetosACSV(equipos));

    // 5. ubicaciones.csv
    const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", clienteId)));
    const ubicaciones = ubicacionesSnap.docs.map((d) => serializarDocumento(d));
    zip.file("ubicaciones.csv", objetosACSV(ubicaciones));

    const blob = await zip.generateAsync({ type: "blob" });
    descargarBlob(blob, `backup_${slugify(c.nombre)}_${fechaHoy()}.zip`);
  } catch (err) {
    alert(`Error al exportar: ${err.message}`);
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

    // Pre-completar nombre con el del cliente.csv si el campo está vacío
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
  if (!file) return alert("Seleccioná un archivo ZIP.");

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando...';

  try {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(file);

    // 1. Leer cliente.csv → crear nuevo doc en /clientes
    const clienteCSV = await leerArchivoZip(zip, "cliente.csv");
    if (!clienteCSV) throw new Error("El ZIP no contiene cliente.csv");

    const clienteRows = parsearCSV(clienteCSV);
    if (!clienteRows.length) throw new Error("cliente.csv está vacío");
    const clienteRow = clienteRows[0];

    const nombreOverride = document.getElementById("importarNombreCliente")?.value.trim();
    if (!nombreOverride) throw new Error("Ingresá un nombre para el cliente.");
    clienteRow.nombre = nombreOverride;

    // Parsear telefonos
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
      telefonos
    };

    const nuevoClienteRef = await addDoc(collection(db, "clientes"), nuevoClienteData);
    const nuevoClienteId = nuevoClienteRef.id;
    const oldClienteId = clienteRow.id || null;

    // 2. Importar colecciones relacionadas
    await importarColeccion(zip, "ubicaciones.csv", "ubicaciones", nuevoClienteId, oldClienteId);
    await importarColeccion(zip, "equipos.csv", "equipos", nuevoClienteId, oldClienteId);
    await importarColeccion(zip, "usuarios.csv", "users", nuevoClienteId, oldClienteId);
    await importarColeccion(zip, "ordenes.csv", "ordenes", nuevoClienteId, oldClienteId);

    toggleModal("modalClienteCrear", false);
    await cargarClientes();
    alert(`Cliente "${nuevoClienteData.nombre}" importado correctamente.`);
  } catch (err) {
    alert(`Error al importar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function importarColeccion(zip, archivoCSV, coleccion, nuevoClienteId, oldClienteId) {
  const csv = await leerArchivoZip(zip, archivoCSV);
  if (!csv) return; // Archivo opcional

  const rows = parsearCSV(csv);
  if (!rows.length) return;

  // Mapa oldId → newId para referencias cruzadas (ej: equipoId en órdenes)
  const idMap = {};

  for (const row of rows) {
    const oldId = row.id;
    delete row.id; // No usar el id original como doc id

    // Reemplazar clienteId
    if (oldClienteId && row.clienteId === oldClienteId) {
      row.clienteId = nuevoClienteId;
    } else {
      row.clienteId = nuevoClienteId;
    }

    // Deserializar campos JSON (historial, historialUbicaciones, etc.)
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === "string" && (val.startsWith("[") || val.startsWith("{"))) {
        try { row[key] = JSON.parse(val); } catch { /* mantener como string */ }
      }
      // Convertir números
      if (typeof val === "string" && val !== "" && !Number.isNaN(Number(val)) &&
          ["contadorOMC", "contadorOMP", "tiempoEstimado", "tiempoReal", "tiempoTotalEspera"].includes(key)) {
        row[key] = Number(val);
      }
      // Limpiar strings vacíos en campos numéricos
      if (val === "" && ["tiempoEstimado", "tiempoReal"].includes(key)) {
        row[key] = null;
      }
    }

    const newRef = await addDoc(collection(db, coleccion), row);
    if (oldId) idMap[oldId] = newRef.id;
  }
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
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lineas.length < 2) return [];

  const separarCampos = (linea) => {
    const campos = [];
    let actual = "";
    let dentroComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (ch === '"') {
        if (dentroComillas && linea[i + 1] === '"') { actual += '"'; i++; }
        else dentroComillas = !dentroComillas;
      } else if (ch === ";" && !dentroComillas) {
        campos.push(actual); actual = "";
      } else {
        actual += ch;
      }
    }
    campos.push(actual);
    return campos;
  };

  const headers = separarCampos(lineas[0]);
  return lineas.slice(1).map((l) => {
    const vals = separarCampos(l);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
function toggleModal(id, visible) {
  document.getElementById(id)?.classList.toggle("is-hidden", !visible);
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
