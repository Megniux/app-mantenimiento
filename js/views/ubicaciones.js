import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";
let tenantContext = { clienteId: null, esSuperadmin: false };

export async function initUbicacionesView({ role, clienteId }) {
  tenantContext = resolverContextoTenant({ role, clienteId });
  await cargarUbicaciones();
  document.getElementById("agregarUbicacionBtn").addEventListener("click", agregarUbicacion);
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

async function obtenerUbicacionesPorCliente() {
  const ubicaciones = [];
  const vistos = new Set();

  if (tenantContext.esSuperadmin && !tenantContext.clienteId) {
    const snapshotGlobal = await getDocs(collection(db, "ubicaciones"));
    snapshotGlobal.forEach((docSnap) => ubicaciones.push({ id: docSnap.id, ...docSnap.data() }));
    return ubicaciones;
  }

  const clienteId = normalizarClienteId(tenantContext.clienteId);
  const snapshotTenant = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", clienteId)));
  snapshotTenant.forEach((docSnap) => {
    vistos.add(docSnap.id);
    ubicaciones.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (clienteId === CLIENTE_DEFAULT) {
    const snapshotCompleto = await getDocs(collection(db, "ubicaciones"));
    snapshotCompleto.forEach((docSnap) => {
      if (vistos.has(docSnap.id)) return;
      const data = docSnap.data();
      if (data.clienteId) return;
      ubicaciones.push({ id: docSnap.id, ...data, clienteId: CLIENTE_DEFAULT });
    });
  }

  return ubicaciones;
}

async function cargarUbicaciones() {
  const snapshot = await obtenerUbicacionesPorCliente();
  const tbody = document.querySelector("#tablaUbicaciones tbody");
  tbody.innerHTML = "";

  snapshot.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" }));
  snapshot.forEach((ubicacion) => {
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

  const clienteId = tenantContext.clienteId ? normalizarClienteId(tenantContext.clienteId) : null;
  if (!clienteId) return alert("No se encontro clienteId para crear ubicaciones.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    await addDoc(collection(db, "ubicaciones"), { nombre, clienteId });
    input.value = "";
    await cargarUbicaciones();
  } catch (error) {
    console.error(error);
    alert(`Error al agregar ubicacion: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function eliminarUbicacion(id) {
  const ubicacionSnap = await getDoc(doc(db, "ubicaciones", id));
  if (!ubicacionSnap.exists() || !puedeAccederDocumento(ubicacionSnap.data())) {
    alert("No tienes permisos para eliminar esta ubicacion.");
    return;
  }

  if (!confirm("¿Eliminar ubicacion? Se eliminara de todas las ordenes asociadas.")) return;
  await deleteDoc(doc(db, "ubicaciones", id));
  await cargarUbicaciones();
}
