import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";
let _ubicaciones = [];
let _equipos = [];
let currentMoveEquipoId = null;
let listenerModalEquiposRegistrado = false;

export async function initEquiposView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  _ubicaciones = await cargarUbicaciones();
  await cargarEquipos();

  document.getElementById("agregarEquipoBtn").addEventListener("click", agregarEquipo);
  document.getElementById("guardarCambioUbicacionBtn").addEventListener("click", guardarCambioUbicacion);
  if (!listenerModalEquiposRegistrado) {
    document.getElementById("mainContent").addEventListener("click", (e) => {
      if (e.target.matches(".close-modal")) {
        toggleModal(e.target.dataset.modal, false);
      }
      if (e.target.matches(".modal")) {
        toggleModal(e.target.id, false);
      }
    });
    listenerModalEquiposRegistrado = true;
  }
}

async function cargarUbicaciones() {
  const snapshot = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const ubicaciones = [];
  snapshot.forEach((docSnap) => {
    ubicaciones.push({ id: docSnap.id, nombre: docSnap.data().nombre || "" });
  });
  ubicaciones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  renderUbicacionesSelect("ubicacionEquipo", ubicaciones, "Seleccionar ubicación");
  renderUbicacionesSelect("moverEquipoUbicacion", ubicaciones, "Seleccionar ubicación");
  return ubicaciones;
}

function renderUbicacionesSelect(selectId, ubicaciones, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  ubicaciones.forEach((ubicacion) => {
    const opt = document.createElement("option");
    opt.value = ubicacion.id;
    opt.textContent = ubicacion.nombre;
    select.appendChild(opt);
  });
}

function normalizarEquipo(docSnap) {
  const data = typeof docSnap.data === "function" ? docSnap.data() : docSnap;
  const legacyUbicaciones = Array.isArray(data.ubicaciones)
    ? data.ubicaciones.filter(Boolean)
    : (data.ubicacion ? [data.ubicacion] : []);

  const ubicacionMatch = _ubicaciones.find((ubicacion) =>
    ubicacion.id === data.ubicacionActualId
    || (!data.ubicacionActualId && (ubicacion.nombre === data.ubicacionActualNombre || ubicacion.nombre === legacyUbicaciones[0]))
  );

  return {
    id: docSnap.id || data.id,
    nombre: data.nombre || "",
    clienteId: data.clienteId || _clienteId,
    ubicacionActualId: ubicacionMatch?.id || data.ubicacionActualId || "",
    ubicacionActualNombre: ubicacionMatch?.nombre || data.ubicacionActualNombre || legacyUbicaciones[0] || "",
    historialUbicaciones: Array.isArray(data.historialUbicaciones) ? data.historialUbicaciones : []
  };
}

async function cargarEquipos() {
  const snapshot = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const tbody = document.querySelector("#tablaEquipos tbody");
  tbody.innerHTML = "";

  _equipos = [];
  snapshot.forEach((docSnap) => _equipos.push(normalizarEquipo(docSnap)));
  _equipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  _equipos.forEach((equipo) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = equipo.nombre;
    row.insertCell(1).textContent = equipo.ubicacionActualNombre || "-";

    const actions = row.insertCell(2);
    actions.className = "table-action-group";

    const moveBtn = document.createElement("button");
    moveBtn.type = "button";
    moveBtn.className = "btn-row-action";
    moveBtn.textContent = "Mover";
    moveBtn.addEventListener("click", () => abrirModalMover(equipo.id));
    actions.appendChild(moveBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-delete-icon";
    deleteBtn.setAttribute("aria-label", `Eliminar ${equipo.nombre}`);
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.addEventListener("click", () => eliminarEquipo(equipo.id));
    actions.appendChild(deleteBtn);
  });
}

async function agregarEquipo() {
  const btn = document.getElementById("agregarEquipoBtn");
  if (!btn || btn.disabled) return;

  const input = document.getElementById("nuevoEquipo");
  const nombre = input.value.trim();
  const ubicacionId = document.getElementById("ubicacionEquipo").value;
  const ubicacion = _ubicaciones.find((item) => item.id === ubicacionId);

  if (!nombre) return alert("Ingrese un nombre");
  if (!ubicacion) return alert("Seleccione una ubicación actual.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "equipos"), {
      nombre,
      clienteId: _clienteId,
      ubicacionActualId: ubicacion.id,
      ubicacionActualNombre: ubicacion.nombre,
      historialUbicaciones: [{
        fecha: new Date(),
        usuario: sessionStorage.getItem("userName") || "",
        haciaId: ubicacion.id,
        haciaNombre: ubicacion.nombre
      }]
    });

    input.value = "";
    document.getElementById("ubicacionEquipo").value = "";
    await cargarEquipos();
  } catch (error) {
    console.error(error);
    alert(`Error al agregar equipo: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function abrirModalMover(equipoId) {
  const equipo = _equipos.find((item) => item.id === equipoId);
  if (!equipo) return;

  currentMoveEquipoId = equipoId;
  document.getElementById("equipoMoverResumen").innerHTML = `<span class="detalle-label">Equipo:</span> ${escapeHtml(equipo.nombre)}<br><span class="detalle-label">Ubicación actual:</span> ${escapeHtml(equipo.ubicacionActualNombre || "-")}`;
  document.getElementById("moverEquipoUbicacion").value = equipo.ubicacionActualId || "";
  toggleModal("modalMoverEquipo", true);
}

async function guardarCambioUbicacion() {
  const btn = document.getElementById("guardarCambioUbicacionBtn");
  if (!btn || btn.disabled || !currentMoveEquipoId) return;

  const equipo = _equipos.find((item) => item.id === currentMoveEquipoId);
  const ubicacionId = document.getElementById("moverEquipoUbicacion").value;
  const nuevaUbicacion = _ubicaciones.find((item) => item.id === ubicacionId);
  if (!equipo || !nuevaUbicacion) return alert("Seleccione una ubicación válida.");

  if (equipo.ubicacionActualId === nuevaUbicacion.id) {
    toggleModal("modalMoverEquipo", false);
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const historialUbicaciones = [
      ...equipo.historialUbicaciones,
      {
        fecha: new Date(),
        usuario: sessionStorage.getItem("userName") || "",
        desdeId: equipo.ubicacionActualId || "",
        desdeNombre: equipo.ubicacionActualNombre || "",
        haciaId: nuevaUbicacion.id,
        haciaNombre: nuevaUbicacion.nombre
      }
    ];

    await updateDoc(doc(db, "equipos", currentMoveEquipoId), {
      ubicacionActualId: nuevaUbicacion.id,
      ubicacionActualNombre: nuevaUbicacion.nombre,
      historialUbicaciones,
      ubicacion: deleteField(),
      ubicaciones: deleteField()
    });

    toggleModal("modalMoverEquipo", false);
    await cargarEquipos();
  } catch (error) {
    console.error(error);
    alert(`Error al cambiar ubicación: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function eliminarEquipo(id) {
  if (!confirm("¿Eliminar equipo? Se eliminará de todas las órdenes asociadas.")) return;
  await deleteDoc(doc(db, "equipos", id));
  await cargarEquipos();
}

function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.toggle("is-hidden", !show);
  if (!show && id === "modalMoverEquipo") {
    currentMoveEquipoId = null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
