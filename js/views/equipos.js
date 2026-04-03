import { collection, getDocs, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function initEquiposView() {
  await cargarEquipos();
  document.getElementById("agregarEquipoBtn").addEventListener("click", agregarEquipo);
}

async function cargarEquipos() {
  const snapshot = await getDocs(collection(db, "equipos"));
  const tbody = document.querySelector("#tablaEquipos tbody");
  tbody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = docSnap.data().nombre;
    const actions = row.insertCell(1);
    const btn = document.createElement("button");
    btn.textContent = "Eliminar";
    btn.style.background = "#dc3545";
    btn.addEventListener("click", () => eliminarEquipo(docSnap.id));
    actions.appendChild(btn);
  });
}

async function agregarEquipo() {
  const input = document.getElementById("nuevoEquipo");
  const nombre = input.value.trim();
  if (!nombre) return alert("Ingrese un nombre");
  await addDoc(collection(db, "equipos"), { nombre });
  input.value = "";
  await cargarEquipos();
}

async function eliminarEquipo(id) {
  if (!confirm("¿Eliminar equipo? Se eliminará de todas las órdenes asociadas.")) return;
  await deleteDoc(doc(db, "equipos", id));
  await cargarEquipos();
}
