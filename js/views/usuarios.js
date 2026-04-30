import { connectAuthEmulator, createUserWithEmailAndPassword, deleteUser, getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getApp, getApps, initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { auth, db, firebaseConfig, isLocal } from "../firebase-config.js";
import { showAlert, showConfirm } from "../ui/dialog.js";

let _clienteId = "";
let _currentRole = "";
let _usuarios = [];

export async function initUsuariosView({ clienteId, role } = {}) {
  _clienteId = clienteId || "";
  _currentRole = role || "";
  await cargarUsuarios();
  configurarSelectorRol();
  document.getElementById("crearUsuarioBtn").addEventListener("click", crearUsuario);
  document.getElementById("busquedaUsuarios").addEventListener("input", renderUsuariosFiltrados);
}

// El select de rol solo muestra "superadmin" si quien crea es superadmin
function configurarSelectorRol() {
  const rolSelect = document.getElementById("rol");
  if (!rolSelect) return;

  // Remover opción superadmin si existe (para no duplicar en re-renders)
  const existente = rolSelect.querySelector('option[value="superadmin"]');
  if (existente) existente.remove();

  if (_currentRole === "superadmin") {
    const opt = document.createElement("option");
    opt.value = "superadmin";
    opt.textContent = "Superadmin";
    rolSelect.appendChild(opt);
  }
}

async function cargarUsuarios() {
  // superadmin ve todos los usuarios del cliente activo (o todos si clienteId está vacío)
  // admin y supervisor ven solo los de su cliente
  let snapshot;
  if (_clienteId) {
    snapshot = await getDocs(query(collection(db, "users"), where("clienteId", "==", _clienteId)));
  } else {
    snapshot = await getDocs(collection(db, "users"));
  }

  _usuarios = [];
  snapshot.forEach((docSnap) => {
    _usuarios.push({ id: docSnap.id, ...docSnap.data() });
  });
  _usuarios.sort((a, b) => {
    const nombreA = a.nombreCompleto || a.email || "";
    const nombreB = b.nombreCompleto || b.email || "";
    return nombreA.localeCompare(nombreB, "es", { sensitivity: "base" });
  });
  renderUsuariosFiltrados();
}

function renderUsuariosFiltrados() {
  const tbody = document.querySelector("#tablaUsuarios tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const termino = (document.getElementById("busquedaUsuarios")?.value || "").trim().toLowerCase();
  const usuariosFiltrados = termino
    ? _usuarios.filter((data) => `${data.email || ""} ${data.nombreCompleto || ""} ${data.rol || ""}`.toLowerCase().includes(termino))
    : _usuarios;

  usuariosFiltrados.forEach((data) => {
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
  if (!email || !nombre || !password) { await showAlert("Complete todos los campos"); return; }

  // Solo superadmin puede crear usuarios con rol superadmin
  if (rol === "superadmin" && _currentRole !== "superadmin") {
    await showAlert("No tiene permisos para crear usuarios superadmin.");
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  // Reutilizar la instancia "secondary" si quedó huérfana de un intento previo fallido
  let secondaryApp;
  try {
    secondaryApp = getApps().some((a) => a.name === "secondary")
      ? getApp("secondary")
      : initializeApp(firebaseConfig, "secondary");
  } catch {
    secondaryApp = initializeApp(firebaseConfig, "secondary");
  }
  const secondaryAuth = getAuth(secondaryApp);
  if (isLocal) {
    try {
      connectAuthEmulator(secondaryAuth, "http://localhost:9099", { disableWarnings: true });
    } catch {
      // ya conectado a emulador en una invocación previa: ignorar
    }
  }

  let createdUser = null;
  try {
    const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdUser = userCred.user;
    try {
      await setDoc(doc(db, "users", createdUser.uid), {
        email,
        nombreCompleto: nombre,
        rol,
        clienteId: rol === "superadmin" ? "" : _clienteId
      });
    } catch (firestoreErr) {
      // Rollback: borrar el usuario de Auth para no dejar registro huérfano
      try { await deleteUser(createdUser); } catch (e) { console.error("No se pudo revertir el usuario en Auth:", e); }
      throw firestoreErr;
    }

    await showAlert("Usuario creado exitosamente");
    document.getElementById("email").value = "";
    document.getElementById("nombre").value = "";
    document.getElementById("password").value = "";
    await cargarUsuarios();
  } catch (error) {
    console.error(error);
    await showAlert(`Error al crear usuario: ${error.message}`);
  } finally {
    try { await secondaryAuth.signOut(); } catch (e) { console.error(e); }
    try { await deleteApp(secondaryApp); } catch (e) { console.error(e); }
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

async function eliminarUsuario(uid) {
  if (!(await showConfirm("¿Eliminar usuario? (No se elimina autenticación, solo Firestore)"))) return;
  await deleteDoc(doc(db, "users", uid));
  await cargarUsuarios();
}
