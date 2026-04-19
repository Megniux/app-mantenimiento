import { collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";

export async function initSolicitudView({ role, userName, clienteId }) {
  _clienteId = clienteId || "";
  document.getElementById("solicitante").value = userName;
  if (role === "usuario" || role === "supervisor") {
    document.getElementById("tipoGrupo").classList.add("is-hidden");
    document.getElementById("tipo").value = "Correctivo";
  }

  await cargarOpciones();

  document.getElementById("tipo").addEventListener("change", mostrarFrecuencia);
  document.getElementById("guardarSolicitudBtn").addEventListener("click", guardar);
}

async function cargarOpciones() {
  const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const ubicacionSelect = document.getElementById("ubicacion");
  ubicacionSelect.innerHTML = '<option value="">Seleccionar ubicación</option>';
  const ubicaciones = [];
  ubicacionesSnap.forEach((d) => {
    ubicaciones.push(d.data().nombre);
  });
  ubicaciones.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  ubicaciones.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    ubicacionSelect.appendChild(opt);
  });

  const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  const equipoSelect = document.getElementById("equipo");
  equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';
  const equipos = [];
  equiposSnap.forEach((d) => {
    equipos.push(d.data().nombre);
  });
  equipos.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  equipos.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    equipoSelect.appendChild(opt);
  });
}

function mostrarFrecuencia() {
  const tipo = document.getElementById("tipo").value;
  const grupoFrecuencia = document.getElementById("grupoFrecuencia");
  grupoFrecuencia.classList.toggle("is-hidden", tipo !== "Preventivo");
}

async function generarNumero(tipo) {
  // El contador está en clientes/{clienteId}
  const ref = doc(db, "clientes", _clienteId);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  let numero;
  if (tipo === "Correctivo") {
    const contadorOMC = data.contadorOMC || 1;
    numero = `OMC-${String(contadorOMC).padStart(4, "0")}`;
    await updateDoc(ref, { contadorOMC: contadorOMC + 1 });
  } else {
    const contadorOMP = data.contadorOMP || 1;
    numero = `OMP-${String(contadorOMP).padStart(4, "0")}`;
    await updateDoc(ref, { contadorOMP: contadorOMP + 1 });
  }
  return numero;
}

async function guardar() {
  const btn = document.getElementById("guardarSolicitudBtn");
  if (!btn || btn.disabled) return;

  const solicitante = document.getElementById("solicitante").value;
  const tipo = document.getElementById("tipo").value;
  const ubicacion = document.getElementById("ubicacion").value;
  const equipo = document.getElementById("equipo").value;
  const descripcion = document.getElementById("descripcion").value;
  const prioridad = document.getElementById("prioridad").value;
  const frecuencia = document.getElementById("frecuencia").value;
  const uid = sessionStorage.getItem("userUid");

  if (!ubicacion || !equipo || !descripcion) return alert("Complete todos los campos.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const numeroOrden = await generarNumero(tipo);
    await addDoc(collection(db, "ordenes"), {
      clienteId: _clienteId,
      numeroOrden, tipo, estado: "Nuevo", fechaCreacion: new Date(),
      fechaProgramada: null, fechaCierre: null, solicitante, solicitanteUid: uid,
      ubicacion, equipo, descripcion, prioridad,
      frecuencia: tipo === "Preventivo" ? frecuencia : "",
      tecnicoAsignado: "", tiempoEstimado: null, tiempoReal: null,
      comentarioMantenimiento: "", informeCierre: "",
      fechaInicioEspera: null, tiempoTotalEspera: 0,
      historial: [{ estado: "Nuevo", fecha: new Date(), usuario: solicitante }]
    });

    alert(`Orden creada: ${numeroOrden}`);
    document.getElementById("solicitudForm").reset();
    document.getElementById("solicitante").value = solicitante;
    mostrarFrecuencia();
  } catch (error) {
    console.error(error);
    alert(`Error al guardar: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
