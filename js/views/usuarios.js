import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, getDocs, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "../firebase-config.js";

export async function initUsuariosView() {
  await cargarUsuarios();
  document.getElementById("crearUsuarioBtn").addEventListener("click", crearUsuario);
}

async function cargarUsuarios() {
  const snapshot = await getDocs(collection(db, "users"));
  const tbody = document.querySelector("#tablaUsuarios tbody");
  tbody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
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
    btn.addEventListener("click", () => eliminarUsuario(docSnap.id));
    actions.appendChild(btn);
  });
}

async function crearUsuario() {
  const email = document.getElementById("email").value.trim();
  const nombre = document.getElementById("nombre").value.trim();
  const password = document.getElementById("password").value;
  const rol = document.getElementById("rol").value;
  if (!email || !nombre || !password) return alert("Complete todos los campos");

  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", userCred.user.uid), { email, nombreCompleto: nombre, rol });
  alert("Usuario creado exitosamente");
  document.getElementById("email").value = "";
  document.getElementById("nombre").value = "";
  document.getElementById("password").value = "";
  await cargarUsuarios();
}

async function eliminarUsuario(uid) {
  if (!confirm("¿Eliminar usuario? (No se elimina autenticación, solo Firestore)")) return;
  await deleteDoc(doc(db, "users", uid));
  await cargarUsuarios();
}
