import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";
let _ubicaciones = [];

export async function initUbicacionesView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarUbicaciones();
  document.getElementById("agregarUbicacionBtn").addEventListener("click", agregarUbicacion);
}

async function cargarUbicaciones() {
  const snapshot = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const tbody = document.querySelector("#tablaUbicaciones tbody");
  tbody.innerHTML = "";

  _ubicaciones = [];
  snapshot.forEach((docSnap) => {
    _ubicaciones.push({ id: docSnap.id, nombre: docSnap.data().nombre || "" });
  });
  _ubicaciones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  _ubicaciones.forEach((ubicacion) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = ubicacion.nombre;
    const actions = row.insertCell(1);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-delete-icon";
    btn.setAttribute("aria-label", `Eliminar ${ubicacion.nombre}`);
    btn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btn.addEventListener("click", () => eliminarUbicacion(ubicacion.id));
    actions.appendChild(btn);
  });
}

async function agregarUbicacion() {
  const btn = document.getElementById("agregarUbicacionBtn");
  if (!btn || btn.disabled) return;

  const input = document.getElementById("nuevaUbicacion");
  const nombre = input.value.trim();
  if (!nombre) return alert("Ingrese un nombre");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "ubicaciones"), { nombre, clienteId: _clienteId });
    input.value = "";
    await cargarUbicaciones();
  } catch (error) {
    console.error(error);
    alert(`Error al agregar ubicación: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function eliminarUbicacion(id) {
  const ubicacion = _ubicaciones.find((item) => item.id === id);
  if (!ubicacion) return;

  const equiposVinculados = await obtenerEquiposVinculados(ubicacion);
  if (equiposVinculados.length) {
    const nombres = equiposVinculados.slice(0, 5).map((equipo) => equipo.nombre).join(", ");
    const sufijo = equiposVinculados.length > 5 ? "..." : "";
    return alert(`No se puede eliminar la ubicación porque hay equipos con ubicación actual allí: ${nombres}${sufijo}`);
  }

  if (!confirm("¿Eliminar ubicación?")) return;
  await deleteDoc(doc(db, "ubicaciones", id));
  await cargarUbicaciones();
}

async function obtenerEquiposVinculados(ubicacion) {
  const snapshot = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const equipos = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const legacyUbicaciones = Array.isArray(data.ubicaciones)
      ? data.ubicaciones.filter(Boolean)
      : (data.ubicacion ? [data.ubicacion] : []);

    const coincide = data.ubicacionActualId === ubicacion.id
      || data.ubicacionActualNombre === ubicacion.nombre
      || legacyUbicaciones.includes(ubicacion.nombre);

    if (coincide) {
      equipos.push({ id: docSnap.id, nombre: data.nombre || "Equipo sin nombre" });
    }
  });

  return equipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}
