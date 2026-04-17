import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";

export const authState = {
  user: null,
  profile: null
};

function normalizarClienteId(userData, rol) {
  if (rol === "superadmin") return null;
  const clienteId = typeof userData?.clienteId === "string" ? userData.clienteId.trim() : "";
  return clienteId || CLIENTE_DEFAULT;
}

function construirPerfil(uid, userData, fallbackEmail) {
  const rol = userData?.rol || "usuario";
  return {
    uid,
    nombre: userData?.nombreCompleto || userData?.email || fallbackEmail,
    rol,
    email: userData?.email || fallbackEmail,
    clienteId: normalizarClienteId(userData, rol)
  };
}

function persistirSesion(profile) {
  sessionStorage.setItem("userName", profile.nombre);
  sessionStorage.setItem("userRole", profile.rol);
  sessionStorage.setItem("userUid", profile.uid);

  if (profile.clienteId) {
    sessionStorage.setItem("userClienteId", profile.clienteId);
  } else {
    sessionStorage.removeItem("userClienteId");
  }
}

async function cargarPerfil(uid, fallbackEmail) {
  const userDoc = await getDoc(doc(db, "users", uid));
  const userData = userDoc.exists()
    ? userDoc.data()
    : { nombreCompleto: fallbackEmail, rol: "usuario", email: fallbackEmail };

  return construirPerfil(uid, userData, fallbackEmail);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const profile = await cargarPerfil(cred.user.uid, cred.user.email);

  persistirSesion(profile);
  authState.user = cred.user;
  authState.profile = profile;
  return profile;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  sessionStorage.clear();
  authState.user = null;
  authState.profile = null;
}

function cargarPerfilDesdeSesion(user) {
  const uid = sessionStorage.getItem("userUid");
  const nombre = sessionStorage.getItem("userName");
  const rol = sessionStorage.getItem("userRole");

  if (!uid || uid !== user.uid || !nombre || !rol) return null;

  const clienteIdSesion = (sessionStorage.getItem("userClienteId") || "").trim();
  const clienteId = rol === "superadmin" ? null : (clienteIdSesion || CLIENTE_DEFAULT);

  return {
    uid: user.uid,
    nombre,
    rol,
    email: user.email,
    clienteId
  };
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      authState.user = null;
      authState.profile = null;
      callback(null);
      return;
    }

    let profile = cargarPerfilDesdeSesion(user);
    if (!profile) {
      profile = await cargarPerfil(user.uid, user.email);
      persistirSesion(profile);
    }

    authState.user = user;
    authState.profile = profile;
    callback(authState.profile);
  });
}
