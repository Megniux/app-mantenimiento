import { collection, getDocs, doc, updateDoc, getDoc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let userRole = null;
let todasOrdenes = [];
let currentOrderId = null;
let listaTecnicos = [];

export async function initConsultaView({ role }) {
  userRole = role;
  await cargarListasFiltros();
  await cargarTecnicos();
  await cargarTodasOrdenes();
  configurarOrdenPredeterminado();
  await cargar();

  document.getElementById("filtrarBtn").addEventListener("click", cargar);
  document.getElementById("aplicarOrdenBtn").addEventListener("click", cargar);
  document.getElementById("exportBtn").addEventListener("click", exportarCSV);
  document.getElementById("busqueda").addEventListener("input", cargar);

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) cerrarModal(e.target.dataset.modal);
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
    return ordenDireccion === "asc" ? valA - valB : valB - valA;
  });

  filtradas.forEach((orden) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `<td>${orden.numeroOrden}</td><td>${orden.tipo}</td><td>${orden.estado}</td><td>${orden.equipo}</td><td>${orden.descripcion}</td>
      <td class="actions-menu"><div class="menu-trigger" data-id="${orden.id}"><i class="fas fa-ellipsis-v"></i></div><div class="dropdown-menu" data-id="${orden.id}"></div></td>`;
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
        if (orden.estado === "Cerrado" && userRole !== "admin") addOption("Editar (solo admin)", () => alert("Solo administradores"));
        else addOption("Editar", () => abrirModal(id));
      }
      if (userRole === "admin") addOption("Eliminar", () => eliminarOrden(id));
      document.querySelectorAll(".dropdown-menu.show").forEach((m) => m.classList.remove("show"));
      menu.classList.add("show");
    });
  });

  document.addEventListener("click", () => document.querySelectorAll(".dropdown-menu.show").forEach((m) => m.classList.remove("show")), { once: true });
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
  document.getElementById("detallesContenido").innerHTML = `<div class="detalle-linea"><span class="detalle-label">N° Orden:</span> ${d.numeroOrden}</div>
  <div class="detalle-linea"><span class="detalle-label">Estado:</span> ${d.estado}</div>
  <div class="detalle-linea"><span class="detalle-label">Descripción:</span> ${d.descripcion}</div>`;
  document.getElementById("modalDetalles").style.display = "block";
}

async function abrirModal(id) {
  currentOrderId = id;
  const snap = await getDoc(doc(db, "ordenes", id));
  const data = snap.data();
  const estados = ["Nuevo", "Pendiente", "En proceso", "Esperando proveedor", "Cerrado"];
  const selectEstado = document.getElementById("editEstado");
  selectEstado.innerHTML = "";
  estados.forEach((est) => {
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

  document.getElementById("editFechaProgramada").value = data.fechaProgramada ? new Date(data.fechaProgramada.seconds * 1000).toISOString().slice(0, 16) : "";
  document.getElementById("editTiempoEstimado").value = data.tiempoEstimado || "";
  document.getElementById("editTiempoReal").value = data.tiempoReal || "";
  document.getElementById("editComentario").value = data.comentarioMantenimiento || "";
  document.getElementById("editInformeCierre").value = data.informeCierre || "";

  document.getElementById("guardarEdicionBtn").onclick = guardarEdicion;
  document.getElementById("modalEditar").style.display = "block";
}

async function guardarEdicion() {
  const docRef = doc(db, "ordenes", currentOrderId);
  const snap = await getDoc(docRef);
  const data = snap.data();
  const nuevoEstado = document.getElementById("editEstado").value;

  const updateData = {
    tecnicoAsignado: document.getElementById("editTecnico").value,
    tiempoEstimado: parseFloat(document.getElementById("editTiempoEstimado").value) || null,
    tiempoReal: parseFloat(document.getElementById("editTiempoReal").value) || null,
    comentarioMantenimiento: document.getElementById("editComentario").value,
    informeCierre: document.getElementById("editInformeCierre").value
  };
  if (document.getElementById("editFechaProgramada").value) updateData.fechaProgramada = new Date(document.getElementById("editFechaProgramada").value);

  if (nuevoEstado !== data.estado) {
    updateData.estado = nuevoEstado;
    const historial = data.historial || [];
    historial.push({ estado: nuevoEstado, fecha: new Date(), usuario: sessionStorage.getItem("userName") });
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
