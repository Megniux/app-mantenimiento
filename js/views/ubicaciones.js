import { collection, getDocs, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function initUbicacionesView() {
  await cargarUbicaciones();
  document.getElementById("agregarUbicacionBtn").addEventListener("click", agregarUbicacion);
}

async function cargarUbicaciones() {
  const snapshot = await getDocs(collection(db, "ubicaciones"));
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
  const input = document.getElementById("nuevaUbicacion");
  const nombre = input.value.trim();
  if (!nombre) return alert("Ingrese un nombre");
  await addDoc(collection(db, "ubicaciones"), { nombre });
  input.value = "";
  await cargarUbicaciones();
}

async function eliminarUbicacion(id) {
  if (!confirm("¿Eliminar ubicación? Se eliminará de todas las órdenes asociadas.")) return;
  await deleteDoc(doc(db, "ubicaciones", id));
  await cargarUbicaciones();
}
