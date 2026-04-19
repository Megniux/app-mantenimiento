import { collection, getDocs, addDoc, deleteDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";

export async function initEquiposView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarEquipos();
  document.getElementById("agregarEquipoBtn").addEventListener("click", agregarEquipo);
}

async function cargarEquipos() {
  const snapshot = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const tbody = document.querySelector("#tablaEquipos tbody");
  tbody.innerHTML = "";
  const equipos = [];
  snapshot.forEach((docSnap) => {
    equipos.push({ id: docSnap.id, nombre: docSnap.data().nombre });
  });
  equipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  equipos.forEach((equipo) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = equipo.nombre;
    const actions = row.insertCell(1);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-delete-icon";
    btn.setAttribute("aria-label", `Eliminar ${equipo.nombre}`);
    btn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btn.addEventListener("click", () => eliminarEquipo(equipo.id));
    actions.appendChild(btn);
  });
}

async function agregarEquipo() {
  const btn = document.getElementById("agregarEquipoBtn");
  if (!btn || btn.disabled) return;

  const input = document.getElementById("nuevoEquipo");
  const nombre = input.value.trim();
  if (!nombre) return alert("Ingrese un nombre");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "equipos"), { nombre, clienteId: _clienteId });
    input.value = "";
    await cargarEquipos();
  } catch (error) {
    console.error(error);
    alert(`Error al agregar equipo: ${error.message}`);
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
