import { collection, getDocs, doc, updateDoc, getDoc, addDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let userRole = null;
let _clienteId = "";
let todasOrdenes = [];
let currentOrderId = null;
let listaTecnicos = [];
const ESTADOS = ["Nuevo", "Pendiente", "En proceso", "Esperando proveedor", "Cerrado"];
const MOBILE_BREAKPOINT = 1024;
let listenerCierreMenuRegistrado = false;
const CAMPOS_RESUMEN_EDICION = [
  { label: "N° Orden", getValue: (orden) => orden.numeroOrden },
  { label: "Tipo", getValue: (orden) => orden.tipo },
  { label: "Solicitante", getValue: (orden) => orden.solicitante },
  { label: "Ubicación", getValue: (orden) => orden.ubicacion },
  { label: "Equipo", getValue: (orden) => orden.equipo },
  { label: "Prioridad", getValue: (orden) => orden.prioridad },
  { label: "Frecuencia", getValue: (orden) => orden.frecuencia || "-" },
  { label: "Descripción", getValue: (orden) => orden.descripcion || "-" },
  { label: "Fecha creación", getValue: (orden) => formatearFechaLarga(orden.fechaCreacion) }
];

const CAMPOS_DETALLE_ORDEN = [
  { label: "N° Orden", getValue: (orden) => orden.numeroOrden },
  { label: "Tipo", getValue: (orden) => orden.tipo },
  { label: "Estado", getValue: (orden) => orden.estado },
  { label: "Solicitante", getValue: (orden) => orden.solicitante },
  { label: "Ubicación", getValue: (orden) => orden.ubicacion },
  { label: "Equipo", getValue: (orden) => orden.equipo },
  { label: "Prioridad", getValue: (orden) => orden.prioridad },
  { label: "Frecuencia", getValue: (orden) => orden.frecuencia || "-" },
  { label: "Técnico asignado", getValue: (orden) => orden.tecnicoAsignado || "-" },
  { label: "Descripción", getValue: (orden) => orden.descripcion || "-" },
  { label: "Comentario mantenimiento", getValue: (orden) => orden.comentarioMantenimiento || "-" },
  { label: "Informe de cierre", getValue: (orden) => orden.informeCierre || "-" },
  { label: "Fecha creación", getValue: (orden) => formatearFechaLarga(orden.fechaCreacion) },
  { label: "Fecha programada", getValue: (orden) => formatearFechaCorta(orden.fechaProgramada) },
  { label: "Fecha cierre", getValue: (orden) => formatearFechaLarga(orden.fechaCierre) },
  { label: "Tiempo estimado (hs)", getValue: (orden) => orden.tiempoEstimado ?? "-" },
  { label: "Tiempo real (hs)", getValue: (orden) => orden.tiempoReal ?? "-" }
];

export async function initConsultaView({ role, clienteId }) {
  userRole = role;
  _clienteId = clienteId || "";
  await cargarListasFiltros();
  await cargarTecnicos();
  await cargarTodasOrdenes();
  configurarOrdenPredeterminado();
  await cargar();
  inicializarToolbarMovil();

  document.getElementById("limpiarFiltrosBtn").addEventListener("click", limpiarFiltros);
  document.getElementById("aplicarOrdenBtn").addEventListener("click", cargar);
  document.getElementById("exportBtn").addEventListener("click", exportarCSV);
  document.getElementById("busqueda").addEventListener("input", cargar);
  document.getElementById("editEstado").addEventListener("change", actualizarCamposEstadoCierre);

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) {
      toggleModal(e.target.dataset.modal, false);
    }
    if (e.target.matches(".modal")) {
      toggleModal(e.target.id, false);
    }
  });

  if (!listenerCierreMenuRegistrado) {
    document.addEventListener("click", (e) => {
      if (e.target.closest(".actions-menu")) return;
      cerrarMenusDesplegables();
    });
    listenerCierreMenuRegistrado = true;
  }
}

function cerrarMenusDesplegables() {
  document.querySelectorAll(".dropdown-menu.show").forEach((menu) => menu.classList.remove("show"));
}

function inicializarToolbarMovil() {
  const toolbar = document.querySelector(".table-toolbar");
  const toggleBtn = document.getElementById("toolbarToggleBtn");
  if (!toolbar || !toggleBtn) return;

  const closeToolbar = () => {
    toolbar.classList.remove("mobile-open");
    toggleBtn.setAttribute("aria-expanded", "false");
  };

  const toggleToolbar = () => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) return;
    const abierto = toolbar.classList.toggle("mobile-open");
    toggleBtn.setAttribute("aria-expanded", String(abierto));
  };

  toggleBtn.addEventListener("click", toggleToolbar);

  const cierrePorAccionIds = ["limpiarFiltrosBtn", "aplicarOrdenBtn"];
  cierrePorAccionIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.tagName === "BUTTON" ? "click" : "change";
    el.addEventListener(eventName, () => {
      if (window.innerWidth < MOBILE_BREAKPOINT) closeToolbar();
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) closeToolbar();
  });
}

async function cargarTecnicos() {
  const usersSnap = await getDocs(query(collection(db, "users"), where("clienteId", "==", _clienteId)));
  listaTecnicos = [];
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.rol === "tecnico" || data.rol === "admin") {
      listaTecnicos.push({ uid: docSnap.id, nombre: data.nombreCompleto || data.email });
    }
  });
  listaTecnicos.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function cargarListasFiltros() {
  const usersSnap = await getDocs(query(collection(db, "users"), where("clienteId", "==", _clienteId)));
  const selectUsuario = document.getElementById("filtroUsuario");
  selectUsuario.innerHTML = '<option value="">Todos</option>';
  const usuarios = [];
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const nombre = data.nombreCompleto || data.email;
    usuarios.push(nombre);
  });
  usuarios.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  usuarios.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectUsuario.appendChild(opt);
  });

  const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const selectUbicacion = document.getElementById("filtroUbicacion");
  selectUbicacion.innerHTML = '<option value="">Todas</option>';
  const ubicaciones = [];
  ubicacionesSnap.forEach((docSnap) => {
    ubicaciones.push(docSnap.data().nombre);
  });
  ubicaciones.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  ubicaciones.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectUbicacion.appendChild(opt);
  });

  const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const selectEquipo = document.getElementById("filtroEquipo");
  selectEquipo.innerHTML = '<option value="">Todos</option>';
  const equipos = [];
  equiposSnap.forEach((docSnap) => {
    equipos.push(docSnap.data().nombre);
  });
  equipos.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  equipos.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectEquipo.appendChild(opt);
  });
}

async function cargarTodasOrdenes() {
  const querySnapshot = await getDocs(query(collection(db, "ordenes"), where("clienteId", "==", _clienteId)));
  todasOrdenes = [];
  querySnapshot.forEach((docSnap) => todasOrdenes.push({ id: docSnap.id, ...docSnap.data() }));
}

function configurarOrdenPredeterminado() {
  const campoOrden = document.getElementById("ordenCampo");
  const direccionOrden = document.getElementById("ordenDireccion");
  const filtroEstado = document.getElementById("filtroEstado");
  const filtroTipo = document.getElementById("filtroTipo");
  if (userRole === "tecnico" || userRole === "admin" || userRole === "usuario" || userRole === "supervisor" || userRole === "superadmin") {
    campoOrden.value = "fechaProgramada";
    direccionOrden.value = "asc";
    filtroEstado.value = "noCerrado";
    filtroTipo.value = "";
  }
}

async function cargar() {
  const tabla = document.getElementById("tabla");
  tabla.innerHTML = "";

  const busqueda = document.getElementById("busqueda").value.toLowerCase();
  const tipo = document.getElementById("filtroTipo").value;
  const estado = document.getElementById("filtroEstado").value;
  const usuario = document.getElementById("filtroUsuario").value;
  const ubicacion = document.getElementById("filtroUbicacion").value;
  const equipo = document.getElementById("filtroEquipo").value;
  const ordenCampo = document.getElementById("ordenCampo").value;
  const ordenDireccion = document.getElementById("ordenDireccion").value;

  let filtradas = todasOrdenes.filter((orden) => {
    if (busqueda) {
      const coincide = orden.numeroOrden?.toLowerCase().includes(busqueda)
        || orden.ubicacion?.toLowerCase().includes(busqueda)
        || orden.equipo?.toLowerCase().includes(busqueda)
        || orden.descripcion?.toLowerCase().includes(busqueda);
      if (!coincide) return false;
    }
    if (tipo && orden.tipo !== tipo) return false;
    if (estado === "noCerrado" && orden.estado === "Cerrado") return false;
    if (estado && estado !== "noCerrado" && orden.estado !== estado) return false;
    if (usuario && orden.solicitante !== usuario) return false;
    if (ubicacion && orden.ubicacion !== ubicacion) return false;
    if (equipo && orden.equipo !== equipo) return false;
    return true;
  });

  filtradas.sort((a, b) => {
    const valA = obtenerValorOrden(a, ordenCampo);
    const valB = obtenerValorOrden(b, ordenCampo);
    if (valA !== valB) {
      return ordenDireccion === "asc" ? valA - valB : valB - valA;
    }
    const equipoA = (a.equipo || "").toLowerCase();
    const equipoB = (b.equipo || "").toLowerCase();
    if (equipoA < equipoB) return -1;
    if (equipoA > equipoB) return 1;
    return 0;
  });

  filtradas.forEach((orden) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `<td class="nowrap-col">${orden.numeroOrden || ""}</td>
      <td class="nowrap-col">${orden.tipo || ""}</td>
      <td class="nowrap-col">${orden.estado || ""}</td>
      <td class="wrap-col">${orden.equipo || ""}</td>
      <td class="wrap-col">${orden.descripcion || ""}</td>
      <td class="nowrap-col">${formatearFechaCorta(orden.fechaProgramada)}</td>
      <td class="actions-menu"><button type="button" class="menu-trigger" data-id="${orden.id}" aria-label="Acciones"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu" data-id="${orden.id}"></div></td>`;
    tabla.appendChild(fila);
  });

  document.querySelectorAll(".menu-trigger").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = trigger.dataset.id;
      const menu = trigger.parentElement.querySelector(".dropdown-menu");
      menu.innerHTML = "";
      const addOption = (text, onClick) => {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.onclick = (ev) => { ev.stopPropagation(); onClick(); menu.classList.remove("show"); };
        menu.appendChild(btn);
      };
      addOption("Ver detalles", () => verDetalles(id));
      const orden = todasOrdenes.find((o) => o.id === id);
      if (userRole !== "usuario" && userRole !== "supervisor") {
        if (!(orden.estado === "Cerrado" && userRole !== "admin" && userRole !== "superadmin")) addOption("Editar", () => abrirModal(id));
      }
      if (userRole === "admin" || userRole === "superadmin") addOption("Eliminar", () => eliminarOrden(id));
      cerrarMenusDesplegables();
      menu.classList.add("show");
    });
  });
}

function obtenerValorOrden(orden, campoOrden) {
  if (campoOrden === "numero") {
    return parseInt(orden.numeroOrden?.split("-")[1], 10) || 0;
  }
  if (campoOrden === "fechaCierre") {
    return orden.fechaCierre?.seconds || 0;
  }
  return orden.fechaProgramada?.seconds || 0;
}

async function eliminarOrden(id) {
  if (!confirm("¿Está seguro de eliminar esta orden?")) return;
  await deleteDoc(doc(db, "ordenes", id));
  await cargarTodasOrdenes();
  await cargar();
}

function exportarCSV() {
  if (!todasOrdenes.length) {
    alert("No hay órdenes para exportar.");
    return;
  }

  const headers = CAMPOS_DETALLE_ORDEN.map((campo) => campo.label);
  const serializarValor = (valor) => {
    if (valor == null) return "";
    if (typeof valor === "object") return JSON.stringify(valor);
    return String(valor);
  };

  const rows = todasOrdenes.map((orden) => CAMPOS_DETALLE_ORDEN.map((campo) => serializarValor(campo.getValue(orden))));
  const csv = [headers, ...rows]
    .map((row) => row.map((col) => `"${col.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", "ordenes_mantenimiento.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function verDetalles(id) {
  const snap = await getDoc(doc(db, "ordenes", id));
  if (!snap.exists()) return;
  const d = snap.data();
  const fields = CAMPOS_DETALLE_ORDEN.map((campo) => [campo.label, campo.getValue(d)]);
  const detallesHtml = fields.map(([label, value]) => `<div class="detalle-linea"><span class="detalle-label">${label}:</span> ${value || "-"}</div>`).join("");
  const historialRows = (d.historial || []).map((h) => `<tr>
      <td>${formatearFechaLarga(h.fecha)}</td>
      <td>${h.usuario || "-"}</td>
      <td>${h.estado || "-"}</td>
      <td>${h.camposModificados || "-"}</td>
    </tr>`).join("");
  document.getElementById("detallesContenido").innerHTML = `${detallesHtml}
    <div class="form-section">
      <h3>Historial</h3>
      <table class="management-table historial-table">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Estado</th><th>Campos modificados</th></tr></thead>
        <tbody>${historialRows || '<tr><td colspan="4">Sin historial</td></tr>'}</tbody>
      </table>
    </div>`;
  toggleModal("modalDetalles", true);
}

async function abrirModal(id) {
  currentOrderId = id;
  const snap = await getDoc(doc(db, "ordenes", id));
  const data = snap.data();
  const resumenEdicionHtml = CAMPOS_RESUMEN_EDICION
    .map((campo) => `<div class="detalle-linea"><span class="detalle-label">${campo.label}:</span> ${campo.getValue(data) || "-"}</div>`)
    .join("");
  document.getElementById("detallesContenidoEditar").innerHTML = resumenEdicionHtml;

  const selectEstado = document.getElementById("editEstado");
  selectEstado.innerHTML = "";
  ESTADOS.forEach((est) => {
    const opt = document.createElement("option");
    opt.value = est;
    opt.textContent = est;
    opt.selected = data.estado === est;
    selectEstado.appendChild(opt);
  });

  const selectTecnico = document.getElementById("editTecnico");
  selectTecnico.innerHTML = '<option value="">Seleccionar técnico</option>';
  listaTecnicos.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.nombre;
    opt.textContent = t.nombre;
    opt.selected = data.tecnicoAsignado === t.nombre;
    selectTecnico.appendChild(opt);
  });

  document.getElementById("editFechaProgramada").value = formatearFechaInput(data.fechaProgramada);
  document.getElementById("editTiempoEstimado").value = data.tiempoEstimado || "";
  document.getElementById("editTiempoReal").value = data.tiempoReal || "";
  document.getElementById("editComentario").value = data.comentarioMantenimiento || "";
  document.getElementById("editInformeCierre").value = data.informeCierre || "";
  actualizarCamposEstadoCierre();

  document.getElementById("guardarEdicionBtn").onclick = guardarEdicion;
  toggleModal("modalEditar", true);
}

async function guardarEdicion() {
  const btn = document.getElementById("guardarEdicionBtn");
  if (!btn || btn.disabled) return;

  const docRef = doc(db, "ordenes", currentOrderId);
  const snap = await getDoc(docRef);
  const data = snap.data();
  const nuevoEstado = document.getElementById("editEstado").value;
  const tecnicoAsignado = document.getElementById("editTecnico").value;
  const fechaProgramada = document.getElementById("editFechaProgramada").value;
  const tiempoEstimado = parseFloat(document.getElementById("editTiempoEstimado").value) || null;
  const tiempoReal = parseFloat(document.getElementById("editTiempoReal").value) || null;
  const comentarioMantenimiento = document.getElementById("editComentario").value.trim();
  const informeCierre = document.getElementById("editInformeCierre").value.trim();

  if ((nuevoEstado === "Pendiente" || nuevoEstado === "En proceso") && (!tecnicoAsignado || !fechaProgramada)) {
    return alert("Para pasar a Pendiente o En proceso debe indicar fecha programada y técnico asignado.");
  }
  if (nuevoEstado === "Cerrado" && (!tecnicoAsignado || !fechaProgramada || !tiempoEstimado || !tiempoReal || !comentarioMantenimiento || !informeCierre)) {
    return alert("Para pasar a Cerrado debe completar todos los campos.");
  }

  const updateData = {
    tecnicoAsignado,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : ""
  };
  if (fechaProgramada) updateData.fechaProgramada = parsearFechaInput(fechaProgramada);

  const estadoCambio = nuevoEstado !== data.estado;
  const cambiosDetectados = obtenerCamposModificadosAnteriores(data, {
    tecnicoAsignado,
    fechaProgramada: fechaProgramada || null,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : ""
  });
  const camposModificados = obtenerCamposModificadosAnteriores(data, {
    tecnicoAsignado,
    fechaProgramada: fechaProgramada || null,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : ""
  }, ["tiempoReal", "informeCierre"]);

  if (!cambiosDetectados.length && !estadoCambio) {
    return alert("No hay cambios para guardar.");
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const historial = data.historial || [];
    historial.push({
      estado: nuevoEstado,
      fecha: new Date(),
      usuario: sessionStorage.getItem("userName"),
      camposModificados: camposModificados.join(" | ") || "-"
    });
    updateData.historial = historial;

    if (nuevoEstado !== data.estado) {
      updateData.estado = nuevoEstado;
      if (nuevoEstado === "Cerrado") {
        updateData.fechaCierre = new Date();
        if (data.tipo === "Preventivo" && data.frecuencia) {
          const ordenCerrada = { ...data, ...updateData, estado: nuevoEstado };
          await generarPreventivaRecurrente(ordenCerrada);
        }
      }
    }

    await updateDoc(docRef, updateData);
    toggleModal("modalEditar", false);
    await cargarTodasOrdenes();
    await cargar();
  } catch (error) {
    console.error(error);
    alert(`Error al guardar cambios: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function obtenerCamposModificadosAnteriores(actual, actualizado, camposOcultosHistorial = []) {
  const mapeo = {
    tecnicoAsignado: "Técnico asignado",
    fechaProgramada: "Fecha programada",
    tiempoEstimado: "Tiempo estimado",
    tiempoReal: "Tiempo real",
    comentarioMantenimiento: "Comentario mantenimiento",
    informeCierre: "Informe de cierre"
  };

  return Object.keys(mapeo).flatMap((campo) => {
    if (camposOcultosHistorial.includes(campo)) return [];
    const valorActual = normalizarValorComparacion(campo, actual[campo]);
    const valorActualizado = normalizarValorComparacion(campo, actualizado[campo]);
    if (valorActual === valorActualizado) return [];
    return `${mapeo[campo]} anterior: "${normalizarValorVisual(campo, actual[campo])}"`;
  });
}

function normalizarValorComparacion(campo, valor) {
  if (campo === "fechaProgramada") {
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      return valor;
    }
    const fecha = formatearFechaInput(valor);
    return fecha || "";
  }
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function normalizarValorVisual(campo, valor) {
  if (campo === "fechaProgramada") {
    return formatearFechaCorta(valor) || "-";
  }
  if (valor === null || valor === undefined || valor === "") return "-";
  return String(valor).trim();
}

async function generarPreventivaRecurrente(original) {
  // El contador está en clientes/{clienteId}
  const refCont = doc(db, "clientes", _clienteId);
  const snapCont = await getDoc(refCont);
  const cont = snapCont.data() || {};
  const contadorOMP = cont.contadorOMP || 1;
  const numeroOrden = `OMP-${String(contadorOMP).padStart(4, "0")}`;
  await updateDoc(refCont, { contadorOMP: contadorOMP + 1 });

  const nueva = {
    ...original,
    clienteId: _clienteId,
    numeroOrden,
    estado: "Pendiente",
    fechaCreacion: new Date(),
    fechaProgramada: calcularProximaFechaProgramada(original.frecuencia),
    fechaCierre: null,
    tiempoReal: null,
    informeCierre: "",
    historial: [{
      estado: "Pendiente",
      fecha: new Date(),
      usuario: "Sistema",
      camposModificados: "Creación automática por cierre de preventiva recurrente"
    }]
  };
  delete nueva.id;
  await addDoc(collection(db, "ordenes"), nueva);
}

function toggleModal(id, visible) {
  document.getElementById(id)?.classList.toggle("is-hidden", !visible);
}

function formatearFechaCorta(fecha) {
  if (!fecha) return "";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatearFechaLarga(fecha) {
  if (!fecha) return "-";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR");
}

function formatearFechaInput(fecha) {
  if (!fecha) return "";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parsearFechaInput(fechaInput) {
  const [yyyy, mm, dd] = fechaInput.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd, 23, 59, 0, 0);
}

function calcularProximaFechaProgramada(frecuencia) {
  const proxima = new Date();
  proxima.setHours(23, 59, 0, 0);
  const ajustes = {
    Diaria: { dias: 1 },
    Interdiaria: { dias: 2 },
    Semanal: { dias: 7 },
    Quincenal: { dias: 15 },
    Mensual: { meses: 1 },
    Bimestral: { meses: 2 },
    Trimestral: { meses: 3 },
    Semestral: { meses: 6 },
    Anual: { anios: 1 },
    Bienal: { anios: 2 }
  };
  const ajuste = ajustes[frecuencia] || {};
  if (ajuste.dias) proxima.setDate(proxima.getDate() + ajuste.dias);
  if (ajuste.meses) proxima.setMonth(proxima.getMonth() + ajuste.meses);
  if (ajuste.anios) proxima.setFullYear(proxima.getFullYear() + ajuste.anios);
  return proxima;
}

function actualizarCamposEstadoCierre() {
  const esCerrado = document.getElementById("editEstado").value === "Cerrado";
  const tiempoRealGroup = document.getElementById("editTiempoRealGroup");
  const informeCierreGroup = document.getElementById("editInformeCierreGroup");
  tiempoRealGroup.classList.toggle("is-hidden", !esCerrado);
  informeCierreGroup.classList.toggle("is-hidden", !esCerrado);
}

async function limpiarFiltros() {
  document.getElementById("busqueda").value = "";
  document.getElementById("filtroTipo").value = "";
  document.getElementById("filtroEstado").value = "";
  document.getElementById("filtroUsuario").value = "";
  document.getElementById("filtroUbicacion").value = "";
  document.getElementById("filtroEquipo").value = "";
  document.getElementById("ordenCampo").value = "numero";
  document.getElementById("ordenDireccion").value = "desc";
  await cargar();
}
