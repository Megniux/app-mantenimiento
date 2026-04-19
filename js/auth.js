import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

export const authState = {
  user: null,
  profile: null
};

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const userDoc = await getDoc(doc(db, "users", uid));
  const userData = userDoc.exists()
    ? userDoc.data()
    : { nombreCompleto: cred.user.email, rol: "usuario", email: cred.user.email, clienteId: "" };

  const profile = {
    uid,
    nombre: userData.nombreCompleto || userData.email || cred.user.email,
    rol: userData.rol || "usuario",
    email: userData.email || cred.user.email,
    clienteId: userData.clienteId || ""
  };

  sessionStorage.setItem("userName", profile.nombre);
  sessionStorage.setItem("userRole", profile.rol);
  sessionStorage.setItem("userUid", profile.uid);
  sessionStorage.setItem("userClienteId", profile.clienteId);

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

export function watchAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      authState.user = null;
      authState.profile = null;
      callback(null);
      return;
    }

    let nombre = sessionStorage.getItem("userName");
    let rol = sessionStorage.getItem("userRole");
    let clienteId = sessionStorage.getItem("userClienteId");
    const uid = user.uid;

    if (!nombre || !rol) {
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        nombre = data.nombreCompleto || data.email || user.email;
        rol = data.rol || "usuario";
        clienteId = data.clienteId || "";
      } else {
        nombre = user.email;
        rol = "usuario";
        clienteId = "";
      }
      sessionStorage.setItem("userName", nombre);
      sessionStorage.setItem("userRole", rol);
      sessionStorage.setItem("userUid", uid);
      sessionStorage.setItem("userClienteId", clienteId);
    }

    authState.user = user;
    authState.profile = { uid, nombre, rol, email: user.email, clienteId: clienteId || "" };
    callback(authState.profile);
  });
}
