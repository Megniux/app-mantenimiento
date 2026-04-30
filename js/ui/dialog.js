// Reemplazo de alert()/confirm() nativos por modales propios y manejo
// global de la tecla Escape para cerrar el modal visible más alto.
//
// Uso:
//   import { showAlert, showConfirm, bindGlobalDialogShortcuts, closeTopModal } from "../ui/dialog.js";
//   await showAlert("No se puede cerrar la orden: …");
//   if (!(await showConfirm("¿Eliminar repuesto?"))) return;

let _escListenerBound = false;

export function bindGlobalDialogShortcuts() {
  if (_escListenerBound) return;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeTopModal();
  });
  _escListenerBound = true;
}

// Cierra el modal visible con mayor z-index. Funciona tanto con los modales
// legacy del HTML (.modal con .is-hidden) como con los creados por show().
export function closeTopModal() {
  const visibles = Array.from(document.querySelectorAll(".modal"))
    .filter((el) => !el.classList.contains("is-hidden") && el.offsetParent !== null);
  if (!visibles.length) return;
  const top = visibles.reduce((acc, el) => {
    const accZ = parseInt(getComputedStyle(acc).zIndex, 10) || 0;
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    return z >= accZ ? el : acc;
  });
  if (typeof top.__onClose === "function") {
    top.__onClose();
    return;
  }
  top.classList.add("is-hidden");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function buildDialog({ title, message, kind, okLabel, cancelLabel }) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.style.zIndex = "2000"; // por encima de modales legacy
  overlay.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true" style="max-width:32rem">
      ${title ? `<h3 style="margin-top:0">${escapeHtml(title)}</h3>` : ""}
      <p style="white-space:pre-line;margin:0 0 1.25rem">${escapeHtml(message)}</p>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap">
        ${kind === "confirm" ? `<button type="button" class="btn-outline" data-action="cancel">${escapeHtml(cancelLabel)}</button>` : ""}
        <button type="button" data-action="ok">${escapeHtml(okLabel)}</button>
      </div>
    </div>`;
  return overlay;
}

function show(overlay, { dismissOnBackdrop }) {
  return new Promise((resolve) => {
    let lastFocus = document.activeElement;
    const cleanup = (result) => {
      overlay.removeEventListener("click", onClick);
      overlay.remove();
      try { lastFocus?.focus?.(); } catch (_) { /* noop */ }
      resolve(result);
    };
    overlay.__onClose = () => cleanup(false);

    const onClick = (e) => {
      if (e.target === overlay) {
        if (dismissOnBackdrop) cleanup(false);
        return;
      }
      const action = e.target.dataset?.action;
      if (action === "ok") cleanup(true);
      else if (action === "cancel") cleanup(false);
    };
    overlay.addEventListener("click", onClick);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="ok"]')?.focus();
  });
}

export function showAlert(message, { title = "" } = {}) {
  const overlay = buildDialog({ title, message, kind: "alert", okLabel: "OK" });
  return show(overlay, { dismissOnBackdrop: true }).then(() => undefined);
}

export function showConfirm(message, { title = "", okLabel = "Aceptar", cancelLabel = "Cancelar" } = {}) {
  const overlay = buildDialog({ title, message, kind: "confirm", okLabel, cancelLabel });
  return show(overlay, { dismissOnBackdrop: false }).then(Boolean);
}
