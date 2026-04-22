import { collection, addDoc, doc, getDoc, getDocs, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";
let _todosEquipos = []; // cache de todos los equipos del cliente

export async function initSolicitudView({ role, userName, clienteId }) {
  _clienteId = clienteId || "";
  document.getElementById("solicitante").value = userName;
  if (role === "usuario" || role === "supervisor") {
    document.getElementById("tipoGrupo").classList.add("is-hidden");
    document.getElementById("tipo").value = "Correctivo";
  }

  await cargarOpciones();

  document.getElementById("tipo").addEventListener("change", mostrarFrecuencia);
  document.getElementById("ubicacion").addEventListener("change", filtrarEquiposPorUbicacion);
  document.getElementById("guardarSolicitudBtn").addEventListener("click", guardar);
}

async function cargarOpciones() {
  // Ubicaciones
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

  // Equipos: cargar todos y cachear
  const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  _todosEquipos = [];
  equiposSnap.forEach((d) => {
    _todosEquipos.push({ nombre: d.data().nombre, ubicacion: d.data().ubicacion || "" });
  });
  _todosEquipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  // Mostrar todos los equipos inicialmente
  renderEquipos(_todosEquipos);
}

function renderEquipos(equipos) {
  const equipoSelect = document.getElementById("equipo");
  equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';
  equipos.forEach(({ nombre }) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    equipoSelect.appendChild(opt);
  });
}

function filtrarEquiposPorUbicacion() {
  const ubicacionSeleccionada = document.getElementById("ubicacion").value;
  if (!ubicacionSeleccionada) {
    // Sin filtro: mostrar todos
    renderEquipos(_todosEquipos);
  } else {
    const filtrados = _todosEquipos.filter(
      (e) => e.ubicacion === ubicacionSeleccionada
    );
    renderEquipos(filtrados);
  }
  // Limpiar selección de equipo al cambiar ubicación
  document.getElementById("equipo").value = "";
}

function mostrarFrecuencia() {
  const tipo = document.getElementById("tipo").value;
  const grupoFrecuencia = document.getElementById("grupoFrecuencia");
  grupoFrecuencia.classList.toggle("is-hidden", tipo !== "Preventivo");
}

async function generarNumero(tipo) {
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
    // Restaurar lista completa de equipos tras el reset
    renderEquipos(_todosEquipos);
    mostrarFrecuencia();
  } catch (error) {
    console.error(error);
    alert(`Error al guardar: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
