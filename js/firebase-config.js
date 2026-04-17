import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC5eZDHD0Ui8n8LTlGeARnIjemKKfgBSH0",
  authDomain: "pruebas-ae2ce.firebaseapp.com",
  projectId: "pruebas-ae2ce",
  storageBucket: "pruebas-ae2ce.firebasestorage.app",
  messagingSenderId: "343975121135",
  appId: "1:343975121135:web:a40e056e457c275b3a4b1a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
