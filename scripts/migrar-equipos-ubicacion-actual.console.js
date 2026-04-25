// Script de migracion para ejecutar en la consola del navegador.
// Uso:
// 1. Abrir la app con sesion iniciada.
// 2. Abrir DevTools > Console.
// 3. Pegar este archivo completo.
// 4. Revisar el resumen con aplicarCambios = false.
// 5. Cambiar aplicarCambios a true y volver a ejecutar para aplicar.

const MIGRACION_EQUIPOS_UBICACION_ACTUAL = {
  clienteId: sessionStorage.getItem("superadminClienteId") || sessionStorage.getItem("userClienteId") || "",
  aplicarCambios: false,
  borrarCamposLegacy: false,
  inicializarHistorialSiFalta: true
};

(async () => {
  const config = MIGRACION_EQUIPOS_UBICACION_ACTUAL;
  if (!config.clienteId) {
    throw new Error("No se pudo resolver clienteId. Definilo en MIGRACION_EQUIPOS_UBICACION_ACTUAL.clienteId antes de ejecutar.");
  }

  const [{ getApp, getApps, initializeApp }, firestore] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
  ]);

  const {
    collection,
    deleteField,
    doc,
    getDocs,
    getFirestore,
    query,
    updateDoc,
    where
  } = firestore;

  const firebaseConfig = {
    apiKey: "AIzaSyDew-CFyPQ8fIUPQf_vnInM9-JZEuV1zi8",
    authDomain: "mantenimiento-app-170e5.firebaseapp.com",
    projectId: "mantenimiento-app-170e5",
    storageBucket: "mantenimiento-app-170e5.firebasestorage.app",
    messagingSenderId: "555398253444",
    appId: "1:555398253444:web:565d98dbbe52844b5bebd1"
  };

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const normalizarTexto = (valor) => String(valor || "").trim().toLocaleLowerCase("es");

  const ubicacionesSnap = await getDocs(query(collection(db, "ubicaciones"), where("clienteId", "==", config.clienteId)));
  const equiposSnap = await getDocs(query(collection(db, "equipos"), where("clienteId", "==", config.clienteId)));

  const ubicaciones = [];
  ubicacionesSnap.forEach((docSnap) => {
    const data = docSnap.data();
    ubicaciones.push({ id: docSnap.id, nombre: data.nombre || "" });
  });

  const ubicacionesPorId = new Map(ubicaciones.map((ubicacion) => [ubicacion.id, ubicacion]));
  const ubicacionesPorNombre = new Map();
  for (const ubicacion of ubicaciones) {
    const key = normalizarTexto(ubicacion.nombre);
    if (!ubicacionesPorNombre.has(key)) ubicacionesPorNombre.set(key, []);
    ubicacionesPorNombre.get(key).push(ubicacion);
  }

  const resultados = {
    listos: [],
    sinCambios: [],
    sinUbicacionResuelta: [],
    ambiguos: [],
    actualizados: [],
    errores: []
  };

  function buscarUbicacionPorNombre(nombre) {
    const coincidencias = ubicacionesPorNombre.get(normalizarTexto(nombre)) || [];
    if (coincidencias.length === 1) return { tipo: "ok", ubicacion: coincidencias[0] };
    if (coincidencias.length > 1) return { tipo: "ambiguo", coincidencias };
    return { tipo: "sin_match", coincidencias: [] };
  }

  function resolverUbicacionObjetivo(equipo) {
    if (equipo.ubicacionActualId && ubicacionesPorId.has(equipo.ubicacionActualId)) {
      return { origen: "ubicacionActualId", ubicacion: ubicacionesPorId.get(equipo.ubicacionActualId) };
    }

    if (equipo.ubicacionActualNombre) {
      const match = buscarUbicacionPorNombre(equipo.ubicacionActualNombre);
      if (match.tipo === "ok") return { origen: "ubicacionActualNombre", ubicacion: match.ubicacion };
      if (match.tipo === "ambiguo") return { origen: "ubicacionActualNombre", ambiguo: true, coincidencias: match.coincidencias };
    }

    const legacyUbicaciones = Array.isArray(equipo.ubicaciones)
      ? equipo.ubicaciones.filter(Boolean)
      : (equipo.ubicacion ? [equipo.ubicacion] : []);

    if (!legacyUbicaciones.length) return null;

    const nombreLegacy = legacyUbicaciones[0];
    const matchLegacy = buscarUbicacionPorNombre(nombreLegacy);
    if (matchLegacy.tipo === "ok") return { origen: "legacy", ubicacion: matchLegacy.ubicacion };
    if (matchLegacy.tipo === "ambiguo") return { origen: "legacy", ambiguo: true, coincidencias: matchLegacy.coincidencias };
    return null;
  }

  for (const docSnap of equiposSnap.docs) {
    const equipo = { id: docSnap.id, ...docSnap.data() };
    const resolucion = resolverUbicacionObjetivo(equipo);

    if (!resolucion) {
      resultados.sinUbicacionResuelta.push({
        id: equipo.id,
        nombre: equipo.nombre || "",
        ubicacion: equipo.ubicacion || "",
        ubicaciones: Array.isArray(equipo.ubicaciones) ? equipo.ubicaciones.join(", ") : ""
      });
      continue;
    }

    if (resolucion.ambiguo) {
      resultados.ambiguos.push({
        id: equipo.id,
        nombre: equipo.nombre || "",
        origen: resolucion.origen,
        coincidencias: resolucion.coincidencias.map((ubicacion) => `${ubicacion.nombre} (${ubicacion.id})`).join(" | ")
      });
      continue;
    }

    const { ubicacion } = resolucion;
    const payload = {};
    if (equipo.ubicacionActualId !== ubicacion.id) payload.ubicacionActualId = ubicacion.id;
    if (equipo.ubicacionActualNombre !== ubicacion.nombre) payload.ubicacionActualNombre = ubicacion.nombre;

    if (config.inicializarHistorialSiFalta && (!Array.isArray(equipo.historialUbicaciones) || !equipo.historialUbicaciones.length)) {
      payload.historialUbicaciones = [{
        fecha: new Date(),
        usuario: "migracion-consola",
        haciaId: ubicacion.id,
        haciaNombre: ubicacion.nombre
      }];
    }

    if (config.borrarCamposLegacy) {
      payload.ubicacion = deleteField();
      payload.ubicaciones = deleteField();
    }

    const resumen = {
      id: equipo.id,
      nombre: equipo.nombre || "",
      origen: resolucion.origen,
      ubicacionObjetivo: ubicacion.nombre,
      ubicacionObjetivoId: ubicacion.id,
      cambios: Object.keys(payload).join(", ") || "(sin cambios)"
    };

    if (!Object.keys(payload).length) {
      resultados.sinCambios.push(resumen);
      continue;
    }

    resultados.listos.push({ ...resumen, payload });

    if (!config.aplicarCambios) continue;

    try {
      await updateDoc(doc(db, "equipos", equipo.id), payload);
      resultados.actualizados.push(resumen);
    } catch (error) {
      resultados.errores.push({
        id: equipo.id,
        nombre: equipo.nombre || "",
        error: error.message
      });
    }
  }

  console.log(`Cliente: ${config.clienteId}`);
  console.log(`Aplicar cambios: ${config.aplicarCambios}`);
  console.log(`Borrar campos legacy: ${config.borrarCamposLegacy}`);
  console.log(`Inicializar historial si falta: ${config.inicializarHistorialSiFalta}`);
  console.log(`Ubicaciones encontradas: ${ubicaciones.length}`);
  console.log(`Equipos encontrados: ${equiposSnap.size}`);

  if (resultados.listos.length) {
    console.group("Equipos listos para migrar");
    console.table(resultados.listos.map(({ payload, ...row }) => row));
    console.groupEnd();
  }

  if (resultados.sinCambios.length) {
    console.group("Equipos ya normalizados");
    console.table(resultados.sinCambios);
    console.groupEnd();
  }

  if (resultados.sinUbicacionResuelta.length) {
    console.group("Equipos sin ubicacion resoluble");
    console.table(resultados.sinUbicacionResuelta);
    console.groupEnd();
  }

  if (resultados.ambiguos.length) {
    console.group("Equipos con ubicacion ambigua");
    console.table(resultados.ambiguos);
    console.groupEnd();
  }

  if (resultados.actualizados.length) {
    console.group("Equipos actualizados");
    console.table(resultados.actualizados);
    console.groupEnd();
  }

  if (resultados.errores.length) {
    console.group("Errores");
    console.table(resultados.errores);
    console.groupEnd();
  }

  console.log("Migracion finalizada.");
})();
