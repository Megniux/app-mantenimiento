import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async ({ collection, getDocs, updateDoc, doc }) => {

  // ─── CONFIGURACIÓN ───────────────────────────────────────────
  const CLIENT_ID = "g4xS7ZlCDA8URvSQgmvV"; // Pegá acá el ID del documento en la colección clientes
  // ─────────────────────────────────────────────────────────────

  if (!CLIENT_ID) {
    console.error("❌ Faltá completar CLIENT_ID antes de correr el script.");
    return;
  }

  const db = window._firebaseDb; // usa la instancia ya inicializada por la app
  const colecciones = ["users", "equipos", "ubicaciones", "ordenes"];
  let totalActualizados = 0;
  let totalOmitidos = 0;

  for (const nombre of colecciones) {
    console.log(`⏳ Procesando colección: ${nombre}...`);
    const snapshot = await getDocs(collection(db, nombre));
    let actualizados = 0;
    let omitidos = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (data.clienteId) {
        omitidos++;
        continue; // ya tiene clienteId, no tocar
      }
      await updateDoc(doc(db, nombre, docSnap.id), { clienteId: CLIENT_ID });
      actualizados++;
    }

    console.log(`✅ ${nombre}: ${actualizados} actualizados, ${omitidos} omitidos (ya tenían clienteId).`);
    totalActualizados += actualizados;
    totalOmitidos += omitidos;
  }

  console.log(`\n🎉 Listo. Total actualizados: ${totalActualizados} | Total omitidos: ${totalOmitidos}`);
});