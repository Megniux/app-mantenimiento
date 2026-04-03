import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function initInformesView() {
  const ordenesSnap = await getDocs(collection(db, "ordenes"));
  const ordenes = [];
  ordenesSnap.forEach((d) => ordenes.push({ id: d.id, ...d.data() }));

  const total = ordenes.length;
  const cerradas = ordenes.filter((o) => o.estado === "Cerrado").length;
  document.getElementById("resumen").innerHTML = `<p>Total: ${total}</p><p>Cerradas: ${cerradas}</p>`;

  let sumaCierre = 0;
  let countCierre = 0;
  ordenes.forEach((o) => {
    if (o.estado === "Cerrado" && o.fechaCreacion && o.fechaCierre) {
      let totalMin = (o.fechaCierre.toDate() - o.fechaCreacion.toDate()) / (1000 * 60);
      totalMin -= (o.tiempoTotalEspera || 0);
      sumaCierre += Math.max(totalMin, 0) / 60;
      countCierre++;
    }
  });

  document.getElementById("tiempoCierre").textContent = `${countCierre ? (sumaCierre / countCierre).toFixed(2) : "N/A"} horas`;
  document.getElementById("porcCierre").textContent = `${total ? ((cerradas / total) * 100).toFixed(2) : 0}%`;

  const estados = {};
  ordenes.forEach((o) => { estados[o.estado] = (estados[o.estado] || 0) + 1; });
  let html = "<table><tr><th>Estado</th><th>Cantidad</th></tr>";
  Object.entries(estados).forEach(([e, c]) => { html += `<tr><td>${e}</td><td>${c}</td></tr>`; });
  html += "</table>";
  document.getElementById("estados").innerHTML = html;
}
