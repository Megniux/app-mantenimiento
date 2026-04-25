import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

let _clienteId = "";
let _todosEquipos = [];
let _ubicaciones = [];

export async function initSolicitudView({ role, userName, clienteId }) {
  _clienteId = clienteId || "";
  document.getElementById("solicitante").value = userName;
  if (role === "usuario" || role === "supervisor") {
    document.getElementById("tipoGrupo").classList.add("is-hidden");
    document.getElementById("tipo").value = "Correctivo";
  }

  await cargarOpciones();

  document.getElementById("tipo").addEventListener("change", mostrarFrecuencia);
  document.getElementById("ubicacion").addEventListener("change", actualizarEquiposDisponibles);
  document.getElementById("equipo").addEventListener("change", sincronizarUbicacionConEquipo);
  document.getElementById("guardarSolicitudBtn").addEventListener("click", guardar);
}

async function cargarOpciones() {
  const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", _clienteId)));
  const ubicacionSelect = document.getElementById("ubicacion");
  ubicacionSelect.innerHTML = '<option value="">Seleccionar ubicación</option>';

  _ubicaciones = [];
  ubicacionesSnap.forEach((docSnap) => {
    _ubicaciones.push({ id: docSnap.id, nombre: docSnap.data().nombre || "" });
  });
  _ubicaciones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  _ubicaciones.forEach((ubicacion) => {
    const opt = document.createElement("option");
    opt.value = ubicacion.id;
    opt.textContent = ubicacion.nombre;
    ubicacionSelect.appendChild(opt);
  });

  const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", _clienteId)));
  _todosEquipos = [];
  equiposSnap.forEach((docSnap) => _todosEquipos.push(normalizarEquipo(docSnap)));
  _todosEquipos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  actualizarEquiposDisponibles();
}

function normalizarEquipo(docSnap) {
  const data = docSnap.data();
  const legacyUbicaciones = Array.isArray(data.ubicaciones)
    ? data.ubicaciones.filter(Boolean)
    : (data.ubicacion ? [data.ubicacion] : []);

  const ubicacionMatch = _ubicaciones.find((ubicacion) =>
    ubicacion.id === data.ubicacionActualId
    || (!data.ubicacionActualId && (ubicacion.nombre === data.ubicacionActualNombre || ubicacion.nombre === legacyUbicaciones[0]))
  );

  return {
    id: docSnap.id,
    nombre: data.nombre || "",
    ubicacionActualId: ubicacionMatch?.id || data.ubicacionActualId || "",
    ubicacionActualNombre: ubicacionMatch?.nombre || data.ubicacionActualNombre || legacyUbicaciones[0] || ""
  };
}

function actualizarEquiposDisponibles() {
  const ubicacionSeleccionada = document.getElementById("ubicacion").value;
  const equipoActual = document.getElementById("equipo").value;

  const equipos = ubicacionSeleccionada
    ? _todosEquipos.filter((equipo) => equipo.ubicacionActualId === ubicacionSeleccionada)
    : _todosEquipos;

  renderEquipos(equipos, { equipoSeleccionado: equipoActual, ubicacionSeleccionada });
}

function renderEquipos(equipos, { equipoSeleccionado = "", ubicacionSeleccionada = "" } = {}) {
  const equipoSelect = document.getElementById("equipo");
  equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';

  equipos.forEach((equipo) => {
    const opt = document.createElement("option");
    opt.value = equipo.id;
    opt.textContent = !ubicacionSeleccionada
      ? `${equipo.nombre}${equipo.ubicacionActualNombre ? ` (${equipo.ubicacionActualNombre})` : ""}`
      : equipo.nombre;
    opt.selected = equipo.id === equipoSeleccionado;
    equipoSelect.appendChild(opt);
  });

  // Opción virtual "Otro": no existe en Firestore, se inserta siempre al final
  const optOtro = document.createElement("option");
  optOtro.value = "__otro__";
  optOtro.textContent = "Otro";
  optOtro.selected = equipoSeleccionado === "__otro__";
  equipoSelect.appendChild(optOtro);

  if (equipoSeleccionado && equipoSeleccionado !== "__otro__" && !equipos.some((equipo) => equipo.id === equipoSeleccionado)) {
    equipoSelect.value = "";
  }
}

function sincronizarUbicacionConEquipo() {
  const equipo = obtenerEquipoSeleccionado();
  if (!equipo) return;

  if (equipo.ubicacionActualId) {
    document.getElementById("ubicacion").value = equipo.ubicacionActualId;
  }
}

function obtenerEquipoSeleccionado() {
  const equipoId = document.getElementById("equipo").value;
  if (equipoId === "__otro__") {
    // Objeto virtual: no existe en Firestore, usa la ubicación seleccionada
    const ubicacionId = document.getElementById("ubicacion").value;
    const ubicacion = _ubicaciones.find((u) => u.id === ubicacionId);
    return {
      id: "",
      nombre: "Otro",
      ubicacionActualId: ubicacion?.id || "",
      ubicacionActualNombre: ubicacion?.nombre || ""
    };
  }
  return _todosEquipos.find((equipo) => equipo.id === equipoId) || null;
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
  const equipoSeleccionado = obtenerEquipoSeleccionado();
  const descripcion = document.getElementById("descripcion").value;
  const prioridad = document.getElementById("prioridad").value;
  const frecuencia = document.getElementById("frecuencia").value;
  const uid = sessionStorage.getItem("userUid");

  if (!equipoSeleccionado) {
    return alert("Seleccione un equipo.");
  }
  if (!equipoSeleccionado.ubicacionActualNombre) {
    return alert("Seleccione una ubicación antes de elegir 'Otro'.");
  }
  if (!descripcion) {
    return alert("Complete todos los campos.");
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const numeroOrden = await generarNumero(tipo);
    await addDoc(collection(db, "ordenes"), {
      clienteId: _clienteId,
      numeroOrden,
      tipo,
      estado: "Nuevo",
      fechaCreacion: new Date(),
      fechaProgramada: null,
      fechaCierre: null,
      solicitante,
      solicitanteUid: uid,
      ubicacion: equipoSeleccionado.ubicacionActualNombre,
      ubicacionId: equipoSeleccionado.ubicacionActualId || "",
      equipo: equipoSeleccionado.nombre,
      equipoId: equipoSeleccionado.id,
      descripcion,
      prioridad,
      frecuencia: tipo === "Preventivo" ? frecuencia : "",
      tecnicoAsignado: "",
      tiempoEstimado: null,
      tiempoReal: null,
      comentarioMantenimiento: "",
      informeCierre: "",
      fechaInicioEspera: null,
      tiempoTotalEspera: 0,
      historial: [{ estado: "Nuevo", fecha: new Date(), usuario: solicitante }]
    });

    alert(`Orden creada: ${numeroOrden}`);
    document.getElementById("solicitudForm").reset();
    document.getElementById("solicitante").value = solicitante;
    actualizarEquiposDisponibles();
    mostrarFrecuencia();
  } catch (error) {
    console.error(error);
    alert(`Error al guardar: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
