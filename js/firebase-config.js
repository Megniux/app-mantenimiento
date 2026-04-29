import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDew-CFyPQ8fIUPQf_vnInM9-JZEuV1zi8",
  authDomain: "mantenimiento-app-170e5.firebaseapp.com",
  projectId: "mantenimiento-app-170e5",
  storageBucket: "mantenimiento-app-170e5.firebasestorage.app",
  messagingSenderId: "555398253444",
  appId: "1:555398253444:web:565d98dbbe52844b5bebd1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (isLocal) {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}