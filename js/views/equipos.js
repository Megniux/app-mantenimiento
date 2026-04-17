import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";
let tenantContext = { clienteId: null, esSuperadmin: false };

export async function initEquiposView({ role, clienteId }) {
  tenantContext = resolverContextoTenant({ role, clienteId });
  await cargarEquipos();
  document.getElementById("agregarEquipoBtn").addEventListener("click", agregarEquipo);
}

function resolverContextoTenant({ role, clienteId }) {
  const rol = role || sessionStorage.getItem("userRole") || "usuario";
  const esSuperadmin = rol === "superadmin";
  const clienteFuente = (clienteId || sessionStorage.getItem("userClienteId") || "").trim();
  if (clienteFuente) return { clienteId: clienteFuente, esSuperadmin };
  if (!esSuperadmin) return { clienteId: CLIENTE_DEFAULT, esSuperadmin: false };
  return { clienteId: null, esSuperadmin: true };
}

function normalizarClienteId(valor) {
  const cliente = typeof valor === "string" ? valor.trim() : "";
  return cliente || CLIENTE_DEFAULT;
}

function puedeAccederDocumento(data) {
  if (tenantContext.esSuperadmin && !tenantContext.clienteId) return true;
  return normalizarClienteId(data?.clienteId) === normalizarClienteId(tenantContext.clienteId);
}

async function obtenerEquiposPorCliente() {
  const equipos = [];
  const vistos = new Set();

  if (tenantContext.esSuperadmin && !tenantContext.clienteId) {
    const snapshotGlobal = await getDocs(collection(db, "equipos"));
    snapshotGlobal.forEach((docSnap) => equipos.push({ id: docSnap.id, ...docSnap.data() }));
    return equipos;
  }

  const clienteId = normalizarClienteId(tenantContext.clienteId);
  const snapshotTenant = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", clienteId)));
  snapshotTenant.forEach((docSnap) => {
    vistos.add(docSnap.id);
    equipos.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (clienteId === CLIENTE_DEFAULT) {
    const snapshotCompleto = await getDocs(collection(db, "equipos"));
    snapshotCompleto.forEach((docSnap) => {
      if (vistos.has(docSnap.id)) return;
      const data = docSnap.data();
      if (data.clienteId) return;
      equipos.push({ id: docSnap.id, ...data, clienteId: CLIENTE_DEFAULT });
    });
  }

  return equipos;
}

async function cargarEquipos() {
  const snapshot = await obtenerEquiposPorCliente();
  const tbody = document.querySelector("#tablaEquipos tbody");
  tbody.innerHTML = "";

  snapshot.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" }));
  snapshot.forEach((equipo) => {
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

  const clienteId = tenantContext.clienteId ? normalizarClienteId(tenantContext.clienteId) : null;
  if (!clienteId) return alert("No se encontro clienteId para crear equipos.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "equipos"), { nombre, clienteId });
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
  const equipoSnap = await getDoc(doc(db, "equipos", id));
  if (!equipoSnap.exists() || !puedeAccederDocumento(equipoSnap.data())) {
    alert("No tienes permisos para eliminar este equipo.");
    return;
  }

  if (!confirm("¿Eliminar equipo? Se eliminara de todas las ordenes asociadas.")) return;
  await deleteDoc(doc(db, "equipos", id));
  await cargarEquipos();
}
