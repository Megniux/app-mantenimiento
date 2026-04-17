import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "../firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";
let tenantContext = { clienteId: null, esSuperadmin: false };
let rolActual = "";

export async function initUsuariosView({ role, clienteId }) {
  tenantContext = resolverContextoTenant({ role, clienteId });
  rolActual = role || sessionStorage.getItem("userRole") || "";

  prepararSelectorRoles();
  await cargarUsuarios();
  document.getElementById("crearUsuarioBtn").addEventListener("click", crearUsuario);
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

function prepararSelectorRoles() {
  const selectRol = document.getElementById("rol");
  if (!selectRol) return;

  const optionSuperadmin = selectRol.querySelector('option[value="superadmin"]');
  if (tenantContext.esSuperadmin) {
    if (!optionSuperadmin) {
      const opt = document.createElement("option");
      opt.value = "superadmin";
      opt.textContent = "Superadmin";
      selectRol.appendChild(opt);
    }
    return;
  }

  if (optionSuperadmin) optionSuperadmin.remove();
}

async function obtenerUsuariosPorCliente() {
  const usuarios = [];
  const vistos = new Set();

  if (tenantContext.esSuperadmin && !tenantContext.clienteId) {
    const snapshotGlobal = await getDocs(collection(db, "users"));
    snapshotGlobal.forEach((docSnap) => usuarios.push({ id: docSnap.id, ...docSnap.data() }));
    return usuarios;
  }

  const clienteId = normalizarClienteId(tenantContext.clienteId);
  const snapshotTenant = await getDocs(query(collection(db, "users"), where("clienteId", "==", clienteId)));
  snapshotTenant.forEach((docSnap) => {
    vistos.add(docSnap.id);
    usuarios.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (clienteId === CLIENTE_DEFAULT) {
    const snapshotCompleto = await getDocs(collection(db, "users"));
    snapshotCompleto.forEach((docSnap) => {
      if (vistos.has(docSnap.id)) return;
      const data = docSnap.data();
      if (data.clienteId || data.rol === "superadmin") return;
      usuarios.push({ id: docSnap.id, ...data, clienteId: CLIENTE_DEFAULT });
    });
  }

  return usuarios;
}

async function cargarUsuarios() {
  const usuarios = await obtenerUsuariosPorCliente();
  const tbody = document.querySelector("#tablaUsuarios tbody");
  tbody.innerHTML = "";

  usuarios.sort((a, b) => {
    const nombreA = a.nombreCompleto || a.email || "";
    const nombreB = b.nombreCompleto || b.email || "";
    return nombreA.localeCompare(nombreB, "es", { sensitivity: "base" });
  });

  usuarios.forEach((data) => {
    const row = tbody.insertRow();
    row.insertCell(0).textContent = data.email;
    row.insertCell(1).textContent = data.nombreCompleto;
    row.insertCell(2).textContent = data.rol;
    const actions = row.insertCell(3);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-delete-icon";
    btn.setAttribute("aria-label", `Eliminar ${data.email || "usuario"}`);
    btn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btn.addEventListener("click", () => eliminarUsuario(data.id));
    actions.appendChild(btn);
  });
}

async function crearUsuario() {
  const btn = document.getElementById("crearUsuarioBtn");
  if (!btn || btn.disabled) return;

  const email = document.getElementById("email").value.trim();
  const nombre = document.getElementById("nombre").value.trim();
  const password = document.getElementById("password").value;
  const rol = document.getElementById("rol").value;
  if (!email || !nombre || !password) return alert("Complete todos los campos");

  if (rol === "superadmin" && rolActual !== "superadmin") {
    return alert("Solo un superadmin puede crear usuarios superadmin.");
  }

  let clienteId = null;
  if (rol !== "superadmin") {
    clienteId = tenantContext.clienteId ? normalizarClienteId(tenantContext.clienteId) : null;
    if (!clienteId) {
      return alert("No se encontro clienteId para crear este usuario.");
    }
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const payload = { email, nombreCompleto: nombre, rol };
    if (rol !== "superadmin") payload.clienteId = clienteId;
    await setDoc(doc(db, "users", userCred.user.uid), payload);
    alert("Usuario creado exitosamente");

    document.getElementById("email").value = "";
    document.getElementById("nombre").value = "";
    document.getElementById("password").value = "";
    await cargarUsuarios();
  } catch (error) {
    console.error(error);
    alert(`Error al crear usuario: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function eliminarUsuario(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    alert("El usuario ya no existe.");
    return;
  }

  const data = snap.data();
  if (!puedeAccederDocumento(data)) {
    alert("No tienes permisos para eliminar este usuario.");
    return;
  }

  if (data.rol === "superadmin" && rolActual !== "superadmin") {
    alert("Solo un superadmin puede eliminar otro superadmin.");
    return;
  }

  if (!confirm("¿Eliminar usuario? (No se elimina autenticacion, solo Firestore)")) return;
  await deleteDoc(doc(db, "users", uid));
  await cargarUsuarios();
}
