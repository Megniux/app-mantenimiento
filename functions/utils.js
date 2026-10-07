// Helpers puros (sin dependencias de Firebase) compartidos por index.js y
// reporteDiario.js. Al no importar nada de firebase-admin se pueden usar desde
// scripts locales (ej. scripts/preview-reporte-diario.mjs) sin credenciales.

export const TZ_ART = "America/Argentina/Buenos_Aires";

export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && typeof v._seconds === "number") {
    return new Date(v._seconds * 1000);
  }
  return null;
}

export function formatearFechaLarga(v) {
  const d = toDate(v);
  if (!d) return "-";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: TZ_ART
  });
}

export function formatearFechaCorta(v) {
  const d = toDate(v);
  if (!d) return "-";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    timeZone: TZ_ART
  });
}

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
