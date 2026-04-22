import { collection, getDocs, addDoc, deleteDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";

export async function initEquiposView({ clienteId } = {}) {
  _clienteId = clienteId || "";
  await cargarUbicacionesCheckboxes();
  await cargarEquipos();
  document.getElementById("agregarEquipoBtn").addEventListener("click", agregarEquipo);
}

async function cargarUbicacionesCheckboxes() {
  const snapshot = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const container = document.getElementById("checkboxUbicaciones");
  container.innerHTML = "";
  const ubicaciones = [];
  snapshot.forEach((docSnap) => ubicaciones.push(docSnap.data().nombre));
  ubicaciones.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  if (!ubicaciones.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.85rem;color:var(--color-muted)">No hay ubicaciones cargadas.</p>';
    return;
  }

  ubicaciones.forEach((nombre) => {
    const label = document.createElement("label");
    label.className = "checkbox-ubicacion-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = nombre;
    cb.name = "ubicacionesEquipo";
    label.appendChild(cb);
    label.append(` ${nombre}`);
    container.appendChild(label);
  });
}

async function cargarEquipos() {
  const snapshot = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const tbody = document.querySelector("#tablaEquipos tbody");
  tbody.innerHTML = "";
  const equipos = [];
  snapshot.forEach((docSnap) => equipos.push({ id: docSnap.id, ...docSnap.data() }));
  equipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  equipos.forEach((equipo) => {
    const ubicaciones = Array.isArray(equipo.ubicaciones) ? equipo.ubicaciones : (equipo.ubicacion ? [equipo.ubicacion] : []);
    const row = tbody.insertRow();
    row.insertCell(0).textContent = equipo.nombre;
    row.insertCell(1).textContent = ubicaciones.join(", ") || "-";
    const actions = row.insertCell(2);
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

  const checkboxes = document.querySelectorAll('input[name="ubicacionesEquipo"]:checked');
  const ubicaciones = Array.from(checkboxes).map((cb) => cb.value);

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "equipos"), { nombre, ubicaciones, clienteId: _clienteId });
    input.value = "";
    document.querySelectorAll('input[name="ubicacionesEquipo"]').forEach((cb) => { cb.checked = false; });
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
