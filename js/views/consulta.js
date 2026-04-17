import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

const CLIENTE_DEFAULT = "cliente_principal";
let userRole = null;
let tenantContext = { clienteId: null, esSuperadmin: false };
let todasOrdenes = [];
let ordenesFiltradasActuales = [];
let currentOrderId = null;
let listaTecnicos = [];
const ESTADOS = ["Nuevo", "Pendiente", "En proceso", "Esperando proveedor", "Cerrado"];
const MOBILE_BREAKPOINT = 1024;
let listenerCierreMenuRegistrado = false;

const CAMPOS_RESUMEN_EDICION = [
  { label: "N° Orden", getValue: (orden) => orden.numeroOrden },
  { label: "Tipo", getValue: (orden) => orden.tipo },
  { label: "Solicitante", getValue: (orden) => orden.solicitante },
  { label: "Ubicacion", getValue: (orden) => orden.ubicacion },
  { label: "Equipo", getValue: (orden) => orden.equipo },
  { label: "Prioridad", getValue: (orden) => orden.prioridad },
  { label: "Frecuencia", getValue: (orden) => orden.frecuencia || "-" },
  { label: "Descripcion", getValue: (orden) => orden.descripcion || "-" },
  { label: "Fecha creacion", getValue: (orden) => formatearFechaLarga(orden.fechaCreacion) }
];

const CAMPOS_DETALLE_ORDEN = [
  { label: "N° Orden", getValue: (orden) => orden.numeroOrden },
  { label: "Tipo", getValue: (orden) => orden.tipo },
  { label: "Estado", getValue: (orden) => orden.estado },
  { label: "Solicitante", getValue: (orden) => orden.solicitante },
  { label: "Ubicacion", getValue: (orden) => orden.ubicacion },
  { label: "Equipo", getValue: (orden) => orden.equipo },
  { label: "Prioridad", getValue: (orden) => orden.prioridad },
  { label: "Frecuencia", getValue: (orden) => orden.frecuencia || "-" },
  { label: "Tecnico asignado", getValue: (orden) => orden.tecnicoAsignado || "-" },
  { label: "Descripcion", getValue: (orden) => orden.descripcion || "-" },
  { label: "Comentario mantenimiento", getValue: (orden) => orden.comentarioMantenimiento || "-" },
  { label: "Informe de cierre", getValue: (orden) => orden.informeCierre || "-" },
  { label: "Fecha creacion", getValue: (orden) => formatearFechaLarga(orden.fechaCreacion) },
  { label: "Fecha programada", getValue: (orden) => formatearFechaCorta(orden.fechaProgramada) },
  { label: "Fecha cierre", getValue: (orden) => formatearFechaLarga(orden.fechaCierre) },
  { label: "Tiempo estimado (hs)", getValue: (orden) => orden.tiempoEstimado ?? "-" },
  { label: "Tiempo real (hs)", getValue: (orden) => orden.tiempoReal ?? "-" }
];

export async function initConsultaView({ role, clienteId }) {
  userRole = role;
  tenantContext = resolverContextoTenant({ role, clienteId });

  await cargarListasFiltros();
  await cargarTecnicos();
  await cargarTodasOrdenes();
  configurarOrdenPredeterminado();
  await cargar();
  inicializarToolbarMovil();

  document.getElementById("limpiarFiltrosBtn").addEventListener("click", limpiarFiltros);
  document.getElementById("aplicarOrdenBtn").addEventListener("click", cargar);
  document.getElementById("exportBtn").addEventListener("click", exportarCSV);
  document.getElementById("busqueda").addEventListener("input", cargar);
  document.getElementById("editEstado").addEventListener("change", actualizarCamposEstadoCierre);

  document.getElementById("mainContent").addEventListener("click", (e) => {
    if (e.target.matches(".close-modal")) cerrarModal(e.target.dataset.modal);
  });

  if (!listenerCierreMenuRegistrado) {
    document.addEventListener("click", (e) => {
      if (e.target.closest(".actions-menu")) return;
      cerrarMenusDesplegables();
    });
    listenerCierreMenuRegistrado = true;
  }
}

function resolverContextoTenant({ role, clienteId }) {
  const rol = role || sessionStorage.getItem("userRole") || "usuario";
  const esSuperadmin = rol === "superadmin";
  const clienteFuente = (clienteId || sessionStorage.getItem("userClienteId") || "").trim();

  if (clienteFuente) return { clienteId: clienteFuente, esSuperadmin };
  if (!esSuperadmin) return { clienteId: CLIENTE_DEFAULT, esSuperadmin: false };
  return { clienteId: null, esSuperadmin: true };
}

function normalizarClienteId(valor) {
  const cliente = typeof valor === "string" ? valor.trim() : "";
  return cliente || CLIENTE_DEFAULT;
}

function puedeAccederDocumento(data) {
  if (tenantContext.esSuperadmin && !tenantContext.clienteId) return true;
  return normalizarClienteId(data?.clienteId) === normalizarClienteId(tenantContext.clienteId);
}

function contadorRefPorCliente(clienteId) {
  return doc(collection(doc(db, "config", "contadores"), "clientes"), clienteId);
}

async function obtenerDocsPorCliente(nombreColeccion) {
  const items = [];
  const vistos = new Set();

  if (tenantContext.esSuperadmin && !tenantContext.clienteId) {
    const snapGlobal = await getDocs(collection(db, nombreColeccion));
    snapGlobal.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
    return items;
  }

  const clienteId = normalizarClienteId(tenantContext.clienteId);
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

async function obtenerOrdenValida(id) {
  const snap = await getDoc(doc(db, "ordenes", id));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!puedeAccederDocumento(data)) return null;
  return { id: snap.id, ...data };
}

function cerrarMenusDesplegables() {
  document.querySelectorAll(".dropdown-menu.show").forEach((menu) => menu.classList.remove("show"));
}

function inicializarToolbarMovil() {
  const toolbar = document.querySelector(".table-toolbar");
  const toggleBtn = document.getElementById("toolbarToggleBtn");
  if (!toolbar || !toggleBtn) return;

  const closeToolbar = () => {
    toolbar.classList.remove("mobile-open");
    toggleBtn.setAttribute("aria-expanded", "false");
  };

  const toggleToolbar = () => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) return;
    const abierto = toolbar.classList.toggle("mobile-open");
    toggleBtn.setAttribute("aria-expanded", String(abierto));
  };

  toggleBtn.addEventListener("click", toggleToolbar);

  const cierrePorAccionIds = ["limpiarFiltrosBtn", "aplicarOrdenBtn"];

  cierrePorAccionIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.tagName === "BUTTON" ? "click" : "change";
    el.addEventListener(eventName, () => {
      if (window.innerWidth < MOBILE_BREAKPOINT) closeToolbar();
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) closeToolbar();
  });
}

async function cargarTecnicos() {
  const users = await obtenerDocsPorCliente("users");
  listaTecnicos = users
    .filter((data) => data.rol === "tecnico" || data.rol === "admin" || data.rol === "superadmin")
    .map((data) => ({ uid: data.id, nombre: data.nombreCompleto || data.email }));

  listaTecnicos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

async function cargarListasFiltros() {
  const selectUsuario = document.getElementById("filtroUsuario");
  selectUsuario.innerHTML = '<option value="">Todos</option>';
  const usuarios = (await obtenerDocsPorCliente("users"))
    .map((data) => data.nombreCompleto || data.email)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  usuarios.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectUsuario.appendChild(opt);
  });

  const selectUbicacion = document.getElementById("filtroUbicacion");
  selectUbicacion.innerHTML = '<option value="">Todas</option>';
  const ubicaciones = (await obtenerDocsPorCliente("ubicaciones"))
    .map((data) => data.nombre)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  ubicaciones.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectUbicacion.appendChild(opt);
  });

  const selectEquipo = document.getElementById("filtroEquipo");
  selectEquipo.innerHTML = '<option value="">Todos</option>';
  const equipos = (await obtenerDocsPorCliente("equipos"))
    .map((data) => data.nombre)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  equipos.forEach((nombre) => {
    const opt = document.createElement("option");
    opt.value = nombre;
    opt.textContent = nombre;
    selectEquipo.appendChild(opt);
  });
}

async function cargarTodasOrdenes() {
  todasOrdenes = await obtenerDocsPorCliente("ordenes");
}

function configurarOrdenPredeterminado() {
  const campoOrden = document.getElementById("ordenCampo");
  const direccionOrden = document.getElementById("ordenDireccion");
  const filtroEstado = document.getElementById("filtroEstado");
  const filtroTipo = document.getElementById("filtroTipo");

  if (["tecnico", "admin", "usuario", "supervisor", "superadmin"].includes(userRole)) {
    campoOrden.value = "fechaProgramada";
    direccionOrden.value = "asc";
    filtroEstado.value = "noCerrado";
    filtroTipo.value = "";
  }
}

async function cargar() {
  const tabla = document.getElementById("tabla");
  tabla.innerHTML = "";

  const busqueda = document.getElementById("busqueda").value.toLowerCase();
  const tipo = document.getElementById("filtroTipo").value;
  const estado = document.getElementById("filtroEstado").value;
  const usuario = document.getElementById("filtroUsuario").value;
  const ubicacion = document.getElementById("filtroUbicacion").value;
  const equipo = document.getElementById("filtroEquipo").value;
  const ordenCampo = document.getElementById("ordenCampo").value;
  const ordenDireccion = document.getElementById("ordenDireccion").value;

  let filtradas = todasOrdenes.filter((orden) => {
    if (busqueda) {
      const coincide = orden.numeroOrden?.toLowerCase().includes(busqueda)
        || orden.ubicacion?.toLowerCase().includes(busqueda)
        || orden.equipo?.toLowerCase().includes(busqueda)
        || orden.descripcion?.toLowerCase().includes(busqueda);
      if (!coincide) return false;
    }
    if (tipo && orden.tipo !== tipo) return false;
    if (estado === "noCerrado" && orden.estado === "Cerrado") return false;
    if (estado && estado !== "noCerrado" && orden.estado !== estado) return false;
    if (usuario && orden.solicitante !== usuario) return false;
    if (ubicacion && orden.ubicacion !== ubicacion) return false;
    if (equipo && orden.equipo !== equipo) return false;
    return true;
  });

  filtradas.sort((a, b) => {
    const valA = obtenerValorOrden(a, ordenCampo);
    const valB = obtenerValorOrden(b, ordenCampo);

    if (valA !== valB) {
      return ordenDireccion === "asc" ? valA - valB : valB - valA;
    }

    const equipoA = (a.equipo || "").toLowerCase();
    const equipoB = (b.equipo || "").toLowerCase();
    if (equipoA < equipoB) return -1;
    if (equipoA > equipoB) return 1;
    return 0;
  });

  ordenesFiltradasActuales = filtradas;

  filtradas.forEach((orden) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `<td class="nowrap-col">${orden.numeroOrden || ""}</td>
      <td class="nowrap-col">${orden.tipo || ""}</td>
      <td class="nowrap-col">${orden.estado || ""}</td>
      <td class="wrap-col">${orden.equipo || ""}</td>
      <td class="wrap-col">${orden.descripcion || ""}</td>
      <td class="nowrap-col">${formatearFechaCorta(orden.fechaProgramada)}</td>
      <td class="actions-menu"><button type="button" class="menu-trigger" data-id="${orden.id}" aria-label="Acciones"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu" data-id="${orden.id}"></div></td>`;
    tabla.appendChild(fila);
  });

  document.querySelectorAll(".menu-trigger").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = trigger.dataset.id;
      const menu = trigger.parentElement.querySelector(".dropdown-menu");
      menu.innerHTML = "";
      const addOption = (text, onClick) => {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.onclick = (ev) => {
          ev.stopPropagation();
          onClick();
          menu.classList.remove("show");
        };
        menu.appendChild(btn);
      };
      addOption("Ver detalles", () => verDetalles(id));
      const orden = todasOrdenes.find((o) => o.id === id);
      if (userRole !== "usuario" && userRole !== "supervisor") {
        if (!(orden.estado === "Cerrado" && userRole !== "admin" && userRole !== "superadmin")) {
          addOption("Editar", () => abrirModal(id));
        }
      }
      if (userRole === "admin" || userRole === "superadmin") addOption("Eliminar", () => eliminarOrden(id));
      cerrarMenusDesplegables();
      menu.classList.add("show");
    });
  });
}

function obtenerValorOrden(orden, campoOrden) {
  if (campoOrden === "numero") {
    return parseInt(orden.numeroOrden?.split("-")[1], 10) || 0;
  }
  if (campoOrden === "fechaCierre") {
    return orden.fechaCierre?.seconds || 0;
  }
  return orden.fechaProgramada?.seconds || 0;
}

async function eliminarOrden(id) {
  const orden = await obtenerOrdenValida(id);
  if (!orden) {
    alert("No tienes permisos para eliminar esta orden.");
    return;
  }

  if (!confirm("¿Esta seguro de eliminar esta orden?")) return;
  await deleteDoc(doc(db, "ordenes", id));
  await cargarTodasOrdenes();
  await cargar();
}

function exportarCSV() {
  if (!ordenesFiltradasActuales.length) {
    alert("No hay ordenes para exportar.");
    return;
  }

  const headers = CAMPOS_DETALLE_ORDEN.map((campo) => campo.label);
  const serializarValor = (valor) => {
    if (valor == null) return "";
    if (typeof valor === "object") return JSON.stringify(valor);
    return String(valor);
  };

  const rows = ordenesFiltradasActuales.map((orden) => CAMPOS_DETALLE_ORDEN.map((campo) => serializarValor(campo.getValue(orden))));
  const csv = [headers, ...rows]
    .map((row) => row.map((col) => `"${col.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", "ordenes_mantenimiento.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function verDetalles(id) {
  const orden = await obtenerOrdenValida(id);
  if (!orden) {
    alert("No tienes permisos para ver esta orden.");
    return;
  }

  const fields = CAMPOS_DETALLE_ORDEN.map((campo) => [campo.label, campo.getValue(orden)]);
  const detallesHtml = fields.map(([label, value]) => `<div class="detalle-linea"><span class="detalle-label">${label}:</span> ${value || "-"}</div>`).join("");
  const historialRows = (orden.historial || []).map((h) => `<tr>
      <td>${formatearFechaLarga(h.fecha)}</td>
      <td>${h.usuario || "-"}</td>
      <td>${h.estado || "-"}</td>
      <td>${h.camposModificados || "-"}</td>
    </tr>`).join("");
  document.getElementById("detallesContenido").innerHTML = `${detallesHtml}
    <div class="form-section">
      <h3>Historial</h3>
      <table class="management-table historial-table">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Estado</th><th>Campos modificados</th></tr></thead>
        <tbody>${historialRows || '<tr><td colspan="4">Sin historial</td></tr>'}</tbody>
      </table>
    </div>`;
  document.getElementById("modalDetalles").style.display = "block";
}

async function abrirModal(id) {
  const orden = await obtenerOrdenValida(id);
  if (!orden) {
    alert("No tienes permisos para editar esta orden.");
    return;
  }

  currentOrderId = id;
  const resumenEdicionHtml = CAMPOS_RESUMEN_EDICION
    .map((campo) => `<div class="detalle-linea"><span class="detalle-label">${campo.label}:</span> ${campo.getValue(orden) || "-"}</div>`)
    .join("");
  document.getElementById("detallesContenidoEditar").innerHTML = resumenEdicionHtml;

  const selectEstado = document.getElementById("editEstado");
  selectEstado.innerHTML = "";
  ESTADOS.forEach((est) => {
    const opt = document.createElement("option");
    opt.value = est;
    opt.textContent = est;
    opt.selected = orden.estado === est;
    selectEstado.appendChild(opt);
  });

  const selectTecnico = document.getElementById("editTecnico");
  selectTecnico.innerHTML = '<option value="">Seleccionar tecnico</option>';
  listaTecnicos.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.nombre;
    opt.textContent = t.nombre;
    opt.selected = orden.tecnicoAsignado === t.nombre;
    selectTecnico.appendChild(opt);
  });

  document.getElementById("editFechaProgramada").value = formatearFechaInput(orden.fechaProgramada);
  document.getElementById("editTiempoEstimado").value = orden.tiempoEstimado || "";
  document.getElementById("editTiempoReal").value = orden.tiempoReal || "";
  document.getElementById("editComentario").value = orden.comentarioMantenimiento || "";
  document.getElementById("editInformeCierre").value = orden.informeCierre || "";
  actualizarCamposEstadoCierre();

  document.getElementById("guardarEdicionBtn").onclick = guardarEdicion;
  document.getElementById("modalEditar").style.display = "block";
}

async function guardarEdicion() {
  const btn = document.getElementById("guardarEdicionBtn");
  if (!btn || btn.disabled) return;

  const docRef = doc(db, "ordenes", currentOrderId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    alert("La orden ya no existe.");
    return;
  }

  const data = snap.data();
  if (!puedeAccederDocumento(data)) {
    alert("No tienes permisos para modificar esta orden.");
    return;
  }

  const nuevoEstado = document.getElementById("editEstado").value;
  const tecnicoAsignado = document.getElementById("editTecnico").value;
  const fechaProgramada = document.getElementById("editFechaProgramada").value;
  const tiempoEstimado = parseFloat(document.getElementById("editTiempoEstimado").value) || null;
  const tiempoReal = parseFloat(document.getElementById("editTiempoReal").value) || null;
  const comentarioMantenimiento = document.getElementById("editComentario").value.trim();
  const informeCierre = document.getElementById("editInformeCierre").value.trim();

  if ((nuevoEstado === "Pendiente" || nuevoEstado === "En proceso") && (!tecnicoAsignado || !fechaProgramada)) {
    return alert("Para pasar a Pendiente o En proceso debe indicar fecha programada y tecnico asignado.");
  }
  if (nuevoEstado === "Cerrado" && (!tecnicoAsignado || !fechaProgramada || !tiempoEstimado || !tiempoReal || !comentarioMantenimiento || !informeCierre)) {
    return alert("Para pasar a Cerrado debe completar todos los campos.");
  }

  const updateData = {
    tecnicoAsignado,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : "",
    clienteId: normalizarClienteId(data.clienteId)
  };
  if (fechaProgramada) updateData.fechaProgramada = parsearFechaInput(fechaProgramada);

  const estadoCambio = nuevoEstado !== data.estado;
  const cambiosDetectados = obtenerCamposModificadosAnteriores(data, {
    tecnicoAsignado,
    fechaProgramada: fechaProgramada || null,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : ""
  });

  const camposModificados = obtenerCamposModificadosAnteriores(data, {
    tecnicoAsignado,
    fechaProgramada: fechaProgramada || null,
    tiempoEstimado,
    tiempoReal: nuevoEstado === "Cerrado" ? tiempoReal : null,
    comentarioMantenimiento,
    informeCierre: nuevoEstado === "Cerrado" ? informeCierre : ""
  }, ["tiempoReal", "informeCierre"]);

  if (!cambiosDetectados.length && !estadoCambio) {
    return alert("No hay cambios para guardar.");
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const historial = data.historial || [];
    historial.push({
      estado: nuevoEstado,
      fecha: new Date(),
      usuario: sessionStorage.getItem("userName"),
      camposModificados: camposModificados.join(" | ") || "-"
    });
    updateData.historial = historial;

    if (nuevoEstado !== data.estado) {
      updateData.estado = nuevoEstado;
      if (nuevoEstado === "Cerrado") {
        updateData.fechaCierre = new Date();
        if (data.tipo === "Preventivo" && data.frecuencia) {
          const ordenCerrada = {
            ...data,
            ...updateData,
            estado: nuevoEstado,
            clienteId: normalizarClienteId(data.clienteId)
          };
          await generarPreventivaRecurrente(ordenCerrada);
        }
      }
    }

    await updateDoc(docRef, updateData);
    cerrarModal("modalEditar");
    await cargarTodasOrdenes();
    await cargar();
  } catch (error) {
    console.error(error);
    alert(`Error al guardar cambios: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function obtenerCamposModificadosAnteriores(actual, actualizado, camposOcultosHistorial = []) {
  const mapeo = {
    tecnicoAsignado: "Tecnico asignado",
    fechaProgramada: "Fecha programada",
    tiempoEstimado: "Tiempo estimado",
    tiempoReal: "Tiempo real",
    comentarioMantenimiento: "Comentario mantenimiento",
    informeCierre: "Informe de cierre"
  };

  return Object.keys(mapeo).flatMap((campo) => {
    if (camposOcultosHistorial.includes(campo)) return [];
    const valorActual = normalizarValorComparacion(campo, actual[campo]);
    const valorActualizado = normalizarValorComparacion(campo, actualizado[campo]);
    if (valorActual === valorActualizado) return [];
    return `${mapeo[campo]} anterior: "${normalizarValorVisual(campo, actual[campo])}"`;
  });
}

function normalizarValorComparacion(campo, valor) {
  if (campo === "fechaProgramada") {
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      return valor;
    }
    const fecha = formatearFechaInput(valor);
    return fecha || "";
  }
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function normalizarValorVisual(campo, valor) {
  if (campo === "fechaProgramada") {
    return formatearFechaCorta(valor) || "-";
  }
  if (valor === null || valor === undefined || valor === "") return "-";
  return String(valor).trim();
}

async function generarPreventivaRecurrente(original) {
  const clienteId = normalizarClienteId(original.clienteId);
  const refCont = contadorRefPorCliente(clienteId);
  const refContLegacy = doc(db, "config", "contador");

  const numeroOrden = await runTransaction(db, async (trx) => {
    const contSnap = await trx.get(refCont);
    let data = contSnap.exists() ? contSnap.data() : null;

    if (!data) {
      const legacySnap = await trx.get(refContLegacy);
      const legacyData = legacySnap.exists() ? legacySnap.data() : {};
      data = {
        contadorOMC: Number(legacyData.contadorOMC) || 1,
        contadorOMP: Number(legacyData.contadorOMP) || 1
      };
    }

    const contadorOMC = Number(data.contadorOMC) || 1;
    const contadorOMP = Number(data.contadorOMP) || 1;
    trx.set(refCont, { contadorOMC, contadorOMP: contadorOMP + 1 }, { merge: true });
    return `OMP-${String(contadorOMP).padStart(4, "0")}`;
  });

  const nueva = {
    ...original,
    numeroOrden,
    estado: "Pendiente",
    fechaCreacion: new Date(),
    fechaProgramada: calcularProximaFechaProgramada(original.frecuencia),
    fechaCierre: null,
    tiempoReal: null,
    informeCierre: "",
    clienteId,
    historial: [{
      estado: "Pendiente",
      fecha: new Date(),
      usuario: "Sistema",
      camposModificados: "Creacion automatica por cierre de preventiva recurrente"
    }]
  };
  delete nueva.id;
  await addDoc(collection(db, "ordenes"), nueva);
}

function cerrarModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = "none";
}

function formatearFechaCorta(fecha) {
  if (!fecha) return "";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatearFechaLarga(fecha) {
  if (!fecha) return "-";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR");
}

function formatearFechaInput(fecha) {
  if (!fecha) return "";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parsearFechaInput(fechaInput) {
  const [yyyy, mm, dd] = fechaInput.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd, 23, 59, 0, 0);
}

function calcularProximaFechaProgramada(frecuencia) {
  const proxima = new Date();
  proxima.setHours(23, 59, 0, 0);
  const ajustes = {
    Diaria: { dias: 1 },
    Interdiaria: { dias: 2 },
    Semanal: { dias: 7 },
    Quincenal: { dias: 15 },
    Mensual: { meses: 1 },
    Bimestral: { meses: 2 },
    Trimestral: { meses: 3 },
    Semestral: { meses: 6 },
    Anual: { anios: 1 },
    Bienal: { anios: 2 }
  };
  const ajuste = ajustes[frecuencia] || {};
  if (ajuste.dias) proxima.setDate(proxima.getDate() + ajuste.dias);
  if (ajuste.meses) proxima.setMonth(proxima.getMonth() + ajuste.meses);
  if (ajuste.anios) proxima.setFullYear(proxima.getFullYear() + ajuste.anios);
  return proxima;
}

function actualizarCamposEstadoCierre() {
  const esCerrado = document.getElementById("editEstado").value === "Cerrado";
  document.getElementById("editTiempoRealGroup").style.display = esCerrado ? "block" : "none";
  document.getElementById("editInformeCierreGroup").style.display = esCerrado ? "block" : "none";
}

async function limpiarFiltros() {
  document.getElementById("busqueda").value = "";
  document.getElementById("filtroTipo").value = "";
  document.getElementById("filtroEstado").value = "";
  document.getElementById("filtroUsuario").value = "";
  document.getElementById("filtroUbicacion").value = "";
  document.getElementById("filtroEquipo").value = "";
  document.getElementById("ordenCampo").value = "numero";
  document.getElementById("ordenDireccion").value = "desc";
  await cargar();
}
