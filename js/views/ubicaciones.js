import { collection, getDocs, addDoc, deleteDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";

export async function initUbicacionesView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarUbicaciones();
  document.getElementById("agregarUbicacionBtn").addEventListener("click", agregarUbicacion);
}

async function cargarUbicaciones() {
  const snapshot = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const tbody = document.querySelector("#tablaUbicaciones tbody");
  tbody.innerHTML = "";
  const ubicaciones = [];
  snapshot.forEach((docSnap) => {
    ubicaciones.push({ id: docSnap.id, nombre: docSnap.data().nombre });
  });
  ubicaciones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  ubicaciones.forEach((ubicacion) => {
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
  if (!confirm("¿Eliminar ubicación? Se eliminará de todas las órdenes asociadas.")) return;
  await deleteDoc(doc(db, "ubicaciones", id));
  await cargarUbicaciones();
}
