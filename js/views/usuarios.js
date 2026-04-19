import { createUserWithEmailAndPassword, getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { auth, db, firebaseConfig } from "../firebase-config.js";

let _clienteId = "";
let _currentRole = "";

export async function initUsuariosView({ clienteId, role } = {}) {
  _clienteId = clienteId || "";
  _currentRole = role || "";
  await cargarUsuarios();
  configurarSelectorRol();
  document.getElementById("crearUsuarioBtn").addEventListener("click", crearUsuario);
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

  const tbody = document.querySelector("#tablaUsuarios tbody");
  tbody.innerHTML = "";
  const usuarios = [];
  snapshot.forEach((docSnap) => {
    usuarios.push({ id: docSnap.id, ...docSnap.data() });
  });
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

  // Solo superadmin puede crear usuarios con rol superadmin
  if (rol === "superadmin" && _currentRole !== "superadmin") {
    return alert("No tiene permisos para crear usuarios superadmin.");
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    // Segunda instancia de Auth para no pisar la sesión activa
    const secondaryApp = initializeApp(firebaseConfig, "secondary");
    const secondaryAuth = getAuth(secondaryApp);

    const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, "users", userCred.user.uid), {
      email,
      nombreCompleto: nombre,
      rol,
      clienteId: rol === "superadmin" ? "" : _clienteId
    });

    // Cerrar la sesión de la instancia secundaria y eliminarla
    await secondaryAuth.signOut();
    await deleteApp(secondaryApp);
    
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
  if (!confirm("¿Eliminar usuario? (No se elimina autenticación, solo Firestore)")) return;
  await deleteDoc(doc(db, "users", uid));
  await cargarUsuarios();
}
