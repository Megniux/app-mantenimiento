// Escapa los 5 caracteres relevantes para inyectarse seguro en HTML (tanto en
// text content como en attribute value). Las versiones anteriores en cada
// vista escapaban subconjuntos distintos (panol-movimientos.js no escapaba `"`
// ni `'`, consulta.js no escapaba `'`), lo cual era un foot-gun si el mismo
// helper se reusaba en contexto de atributo.
export function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// Fecha y hora como "23/06/2026 17:48" (24 h). Se arma a mano porque
// toLocaleString("es-AR") depende del navegador: algunos muestran 12 h sin
// "a. m."/"p. m.", y una orden de las 17:48 aparecía como "05:48:53".
export function formatFecha(fecha) {
  if (!fecha) return "-";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  if (isNaN(d.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
