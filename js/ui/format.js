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

export function formatFecha(fecha) {
  if (!fecha) return "-";
  const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("es-AR");
}
