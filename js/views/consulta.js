import { collection, getDocs, doc, updateDoc, getDoc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let userRole = null;
let todasOrdenes = [];
let currentOrderId = null;
let listaTecnicos = [];
const ESTADOS = ["Nuevo", "Pendiente", "En proceso", "Esperando proveedor", "Cerrado"];
const MOBILE_BREAKPOINT = 1024;
let listenerCierreMenuRegistrado = false;

export async function initConsultaView({ role }) {
  userRole = role;
  await cargarListasFiltros();
  await cargarTecnicos();
  await cargarTodasOrdenes();
  configurarOrdenPredeterminado();
  await cargar();
  inicializarToolbarMovil();

  document.getElementById("filtrarBtn").addEventListener("click", cargar);
  document.getElementById("limpiarFiltrosBtn").addEventListener("click", limpiarFiltros);
  document.getElementById("aplicarOrdenBtn").addEventListener("click", cargar);
  document.getElementById("exportBtn").addEventListener("click", exportarCSV);
  document.getElementById("busqueda").addEventListener("input", cargar);
  document.getElementById("editEstado").addEventListener("change", actualizarCamposEstadoCierre);

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) cerrarModal(e.target.dataset.modal);
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

  const cierrePorAccionIds = [
    "filtrarBtn",
    "limpiarFiltrosBtn",
    "aplicarOrdenBtn"
  ];

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
  const usersSnap = await getDocs(collection(db, "users"));
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
  const usersSnap = await getDocs(collection(db, "users"));
  const selectUsuario = document.getElementById("filtroUsuario");
  selectUsuario.innerHTML = '<option value="">Todos</option>';
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const nombre = data.nombreCompleto || data.email;
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectUsuario.appendChild(opt);
  });

  const ubicacionesSnap = await getDocs(collection(db, "ubicaciones"));
  const selectUbicacion = document.getElementById("filtroUbicacion");
  selectUbicacion.innerHTML = '<option value="">Todas</option>';
  ubicacionesSnap.forEach((docSnap) => {
    const opt = document.createElement("option");
    opt.value = docSnap.data().nombre;
    opt.textContent = docSnap.data().nombre;
    selectUbicacion.appendChild(opt);
  });

  const equiposSnap = await getDocs(collection(db, "equipos"));
  const selectEquipo = document.getElementById("filtroEquipo");
  selectEquipo.innerHTML = '<option value="">Todos</option>';
  equiposSnap.forEach((docSnap) => {
    const opt = document.createElement("option");
    opt.value = docSnap.data().nombre;
    opt.textContent = docSnap.data().nombre;
    selectEquipo.appendChild(opt);
  });
}

async function cargarTodasOrdenes() {
  const querySnapshot = await getDocs(collection(db, "ordenes"));
  todasOrdenes = [];
  querySnapshot.forEach((docSnap) => todasOrdenes.push({ id: docSnap.id, ...docSnap.data() }));
}

function configurarOrdenPredeterminado() {
  const campoOrden = document.getElementById("ordenCampo");
  const direccionOrden = document.getElementById("ordenDireccion");
  const filtroEstado = document.getElementById("filtroEstado");
  if (userRole === "tecnico" || userRole === "admin") {
    campoOrden.value = "fechaProgramada";
    direccionOrden.value = "asc";
    filtroEstado.value = "noCerrado";
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
        || orden.equipo?.toLowerCase().includes(busqueda);
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
    const valA = ordenCampo === "numero" ? (parseInt(a.numeroOrden.split("-")[1]) || 0) : (a.fechaProgramada?.seconds || 0);
    const valB = ordenCampo === "numero" ? (parseInt(b.numeroOrden.split("-")[1]) || 0) : (b.fechaProgramada?.seconds || 0);
    return ordenDireccion === "desc" ? valA - valB : valB - valA;
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
      if (userRole !== "usuario") {
        if (!(orden.estado === "Cerrado" && userRole !== "admin")) addOption("Editar", () => abrirModal(id));
      }
      if (userRole === "admin") addOption("Eliminar", () => eliminarOrden(id));
      cerrarMenusDesplegables();
      menu.classList.add("show");
    });
  });
}

async function eliminarOrden(id) {
  if (!confirm("¿Está seguro de eliminar esta orden?")) return;
  await deleteDoc(doc(db, "ordenes", id));
  await cargarTodasOrdenes();
  await cargar();
}

function exportarCSV() {
  const headers = ["N° Orden", "Tipo", "Estado", "Solicitante", "Ubicación", "Equipo", "Descripción"];
  const rows = todasOrdenes.map((o) => [o.numeroOrden, o.tipo, o.estado, o.solicitante, o.ubicacion, o.equipo, o.descripcion]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
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
  const fields = [
    ["N° Orden", d.numeroOrden], ["Tipo", d.tipo], ["Estado", d.estado], ["Solicitante", d.solicitante],
    ["Ubicación", d.ubicacion], ["Equipo", d.equipo], ["Prioridad", d.prioridad], ["Frecuencia", d.frecuencia || "-"],
    ["Técnico asignado", d.tecnicoAsignado || "-"], ["Descripción", d.descripcion || "-"],
    ["Comentario mantenimiento", d.comentarioMantenimiento || "-"], ["Informe de cierre", d.informeCierre || "-"],
    ["Fecha creación", formatearFechaLarga(d.fechaCreacion)], ["Fecha programada", formatearFechaCorta(d.fechaProgramada)],
    ["Fecha cierre", formatearFechaLarga(d.fechaCierre)], ["Tiempo estimado (hs)", d.tiempoEstimado ?? "-"],
    ["Tiempo real (hs)", d.tiempoReal ?? "-"]
  ];
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
  document.getElementById("modalDetalles").style.display = "block";
}

async function abrirModal(id) {
  currentOrderId = id;
  const snap = await getDoc(doc(db, "ordenes", id));
  const data = snap.data();
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
  document.getElementById("modalEditar").style.display = "block";
}

async function guardarEdicion() {
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

  if (nuevoEstado !== data.estado) {
    updateData.estado = nuevoEstado;
    const historial = data.historial || [];
    historial.push({ estado: nuevoEstado, fecha: new Date(), usuario: sessionStorage.getItem("userName"), camposModificados: "Estado y datos de mantenimiento" });
    updateData.historial = historial;
    if (nuevoEstado === "Cerrado") {
      updateData.fechaCierre = new Date();
      if (data.tipo === "Preventivo" && data.frecuencia) await generarPreventivaRecurrente(data);
    }
  }
  await updateDoc(docRef, updateData);
  cerrarModal("modalEditar");
  await cargarTodasOrdenes();
  await cargar();
}

async function generarPreventivaRecurrente(original) {
  const refCont = doc(db, "config", "contador");
  const snapCont = await getDoc(refCont);
  const cont = snapCont.data();
  const numeroOrden = `OMP-${String(cont.contadorOMP).padStart(4, "0")}`;
  await updateDoc(refCont, { contadorOMP: cont.contadorOMP + 1 });

  const nueva = {
    ...original,
    numeroOrden,
    estado: "Nuevo",
    fechaCreacion: new Date(),
    fechaProgramada: calcularProximaFechaProgramada(original.frecuencia),
    fechaCierre: null,
    historial: [{ estado: "Nuevo", fecha: new Date(), usuario: "Sistema" }]
  };
  delete nueva.id;
  await addDoc(collection(db, "ordenes"), nueva);
}

function cerrarModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = "none";
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
  return new Date(yyyy, mm - 1, dd);
}

function calcularProximaFechaProgramada(frecuencia) {
  const proxima = new Date();
  proxima.setHours(0, 0, 0, 0);
  const ajustes = {
    Diaria: { dias: 1 },
    Semanal: { dias: 7 },
    Quincenal: { dias: 15 },
    Mensual: { meses: 1 },
    Bimestral: { meses: 2 },
    Trimestral: { meses: 3 },
    Semestral: { meses: 6 },
    Anual: { anios: 1 }
  };
  const ajuste = ajustes[frecuencia] || {};
  if (ajuste.dias) proxima.setDate(proxima.getDate() + ajuste.dias);
  if (ajuste.meses) proxima.setMonth(proxima.getMonth() + ajuste.meses);
  if (ajuste.anios) proxima.setFullYear(proxima.getFullYear() + ajuste.anios);
  return proxima;
}

function actualizarCamposEstadoCierre() {
  const esCerrado = document.getElementById("editEstado").value === "Cerrado";
  document.getElementById("editTiempoRealGroup").style.display = esCerrado ? "block" : "none";
  document.getElementById("editInformeCierreGroup").style.display = esCerrado ? "block" : "none";
}

async function limpiarFiltros() {
  document.getElementById("busqueda").value = "";
  document.getElementById("filtroTipo").value = "";
  document.getElementById("filtroEstado").value = "";
  document.getElementById("filtroUsuario").value = "";
  document.getElementById("filtroUbicacion").value = "";
  document.getElementById("filtroEquipo").value = "";
  await cargar();
}
