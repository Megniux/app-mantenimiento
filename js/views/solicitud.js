import { collection, addDoc, doc, getDocs, query, runTransaction, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";
let tenantContext = { clienteId: null, esSuperadmin: false };

export async function initSolicitudView({ role, userName, clienteId }) {
  tenantContext = resolverContextoTenant({ role, clienteId });

  document.getElementById("solicitante").value = userName;
  if (role === "usuario" || role === "supervisor") {
    document.getElementById("tipoGrupo").style.display = "none";
    document.getElementById("tipo").value = "Correctivo";
  }

  if (!tenantContext.clienteId) {
    const btnGuardar = document.getElementById("guardarSolicitudBtn");
    if (btnGuardar) btnGuardar.disabled = true;
    alert("El perfil actual no tiene clienteId. Asigna un cliente para poder crear ordenes.");
    return;
  }

  await cargarOpciones();

  document.getElementById("tipo").addEventListener("change", mostrarFrecuencia);
  document.getElementById("guardarSolicitudBtn").addEventListener("click", guardar);
}

function resolverContextoTenant({ role, clienteId }) {
  const rol = role || sessionStorage.getItem("userRole") || "usuario";
  const esSuperadmin = rol === "superadmin";
  const clienteFuente = (clienteId || sessionStorage.getItem("userClienteId") || "").trim();
  if (clienteFuente) return { clienteId: clienteFuente, esSuperadmin };
  if (!esSuperadmin) return { clienteId: CLIENTE_DEFAULT, esSuperadmin: false };
  return { clienteId: null, esSuperadmin: true };
}

function normalizarClienteId(data) {
  const cliente = typeof data?.clienteId === "string" ? data.clienteId.trim() : "";
  return cliente || CLIENTE_DEFAULT;
}

function contadorRefPorCliente(clienteId) {
  return doc(collection(doc(db, "config", "contadores"), "clientes"), clienteId);
}

async function obtenerDocsPorCliente(nombreColeccion) {
  const clienteId = tenantContext.clienteId;
  const items = [];
  const vistos = new Set();

  const tenantSnap = await getDocs(query(collection(db, nombreColeccion), where("clienteId", "==", clienteId)));
  tenantSnap.forEach((docSnap) => {
    vistos.add(docSnap.id);
    items.push({ id: docSnap.id, ...docSnap.data() });
  });

  if (clienteId === CLIENTE_DEFAULT) {
    const snapshotCompleto = await getDocs(collection(db, nombreColeccion));
    snapshotCompleto.forEach((docSnap) => {
      if (vistos.has(docSnap.id)) return;
      const data = docSnap.data();
      if (data.clienteId) return;
      items.push({ id: docSnap.id, ...data, clienteId: CLIENTE_DEFAULT });
    });
  }

  return items;
}

async function cargarOpciones() {
  const ubicacionSelect = document.getElementById("ubicacion");
  ubicacionSelect.innerHTML = '<option value="">Seleccionar ubicacion</option>';
  const ubicaciones = (await obtenerDocsPorCliente("ubicaciones"))
    .map((d) => d.nombre)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  ubicaciones.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    ubicacionSelect.appendChild(opt);
  });

  const equipoSelect = document.getElementById("equipo");
  equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';
  const equipos = (await obtenerDocsPorCliente("equipos"))
    .map((d) => d.nombre)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  equipos.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    equipoSelect.appendChild(opt);
  });
}

function mostrarFrecuencia() {
  const tipo = document.getElementById("tipo").value;
  document.getElementById("grupoFrecuencia").style.display = tipo === "Preventivo" ? "block" : "none";
}

async function generarNumero(tipo) {
  const clienteId = tenantContext.clienteId;
  const contadorRef = contadorRefPorCliente(clienteId);
  const contadorLegacyRef = doc(db, "config", "contador");

  return runTransaction(db, async (trx) => {
    const contadorSnap = await trx.get(contadorRef);
    let data = contadorSnap.exists() ? contadorSnap.data() : null;

    if (!data) {
      const legacySnap = await trx.get(contadorLegacyRef);
      const legacyData = legacySnap.exists() ? legacySnap.data() : {};
      data = {
        contadorOMC: Number(legacyData.contadorOMC) || 1,
        contadorOMP: Number(legacyData.contadorOMP) || 1
      };
    }

    const contadorOMC = Number(data.contadorOMC) || 1;
    const contadorOMP = Number(data.contadorOMP) || 1;

    let numero;
    if (tipo === "Correctivo") {
      numero = `OMC-${String(contadorOMC).padStart(4, "0")}`;
      trx.set(contadorRef, { contadorOMC: contadorOMC + 1, contadorOMP }, { merge: true });
    } else {
      numero = `OMP-${String(contadorOMP).padStart(4, "0")}`;
      trx.set(contadorRef, { contadorOMC, contadorOMP: contadorOMP + 1 }, { merge: true });
    }

    return numero;
  });
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
  if (!tenantContext.clienteId) return alert("No se encontro clienteId para crear la orden.");

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const numeroOrden = await generarNumero(tipo);
    await addDoc(collection(db, "ordenes"), {
      numeroOrden,
      tipo,
      estado: "Nuevo",
      fechaCreacion: new Date(),
      fechaProgramada: null,
      fechaCierre: null,
      solicitante,
      solicitanteUid: uid,
      ubicacion,
      equipo,
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
      clienteId: normalizarClienteId({ clienteId: tenantContext.clienteId }),
      historial: [{ estado: "Nuevo", fecha: new Date(), usuario: solicitante }]
    });

    alert(`Orden creada: ${numeroOrden}`);
    document.getElementById("solicitudForm").reset();
    document.getElementById("solicitante").value = solicitante;
  } catch (error) {
    console.error(error);
    alert(`Error al guardar: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
