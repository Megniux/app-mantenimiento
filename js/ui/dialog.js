// Reemplazo de alert()/confirm() nativos por modales propios y manejo
// global de teclas y clicks de cierre según el tipo de modal.
//
// Cada modal lleva un atributo data-modal-kind con uno de estos valores:
//   - "alert"   : un solo botón OK. ESC no cierra. Enter dispara OK. Click fuera no cierra.
//   - "confirm" : OK + Cancel. ESC cancela. Enter dispara OK. Click fuera no cierra.
//   - "info"    : modal informativo sin botones de acción. ESC cierra. Click fuera cierra.
//   - "edit"    : modal de edición con form + Guardar. ESC cierra. Enter no hace nada
//                 (para no enviar accidentalmente mientras se tipea). Click fuera no cierra.
// La X (`.close-modal`) siempre cierra cualquier kind.
//
// Uso:
//   import { showAlert, showConfirm, bindGlobalDialogShortcuts } from "../ui/dialog.js";
//   await showAlert("No se puede cerrar la orden: …");
//   if (!(await showConfirm("¿Eliminar repuesto?"))) return;

import { escapeHtml } from "./format.js";

let _listenersBound = false;

export function bindGlobalDialogShortcuts() {
  if (_listenersBound) return;
  document.addEventListener("keydown", onKey);
  document.body.addEventListener("click", onBodyClick);
  _listenersBound = true;
}

function onKey(e) {
  if (e.key === "Escape") return handleEscape();
  if (e.key === "Enter") return handleEnter(e);
}

function onBodyClick(e) {
  // Click sobre el backdrop: el target es el overlay con clase "modal".
  if (e.target.classList.contains("modal")) {
    handleBackdropClick(e.target);
    return;
  }
  // X de cierre (span.close.close-modal en modales legacy del template).
  if (e.target.classList.contains("close-modal")) {
    const id = e.target.dataset.modal;
    const modal = id ? document.getElementById(id) : e.target.closest(".modal");
    if (modal) closeModal(modal);
  }
}

function getTopModal() {
  const visibles = Array.from(document.querySelectorAll(".modal"))
    .filter((el) => !el.classList.contains("is-hidden"));
  if (!visibles.length) return null;
  // No usar offsetParent: los modales son position:fixed, offsetParent siempre es null.
  return visibles.reduce((acc, el) => {
    const accZ = parseInt(getComputedStyle(acc).zIndex, 10) || 0;
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    return z >= accZ ? el : acc;
  });
}

function closeModal(modal) {
  if (typeof modal.__onClose === "function") {
    modal.__onClose();
    return;
  }
  modal.classList.add("is-hidden");
}

function handleEscape() {
  const top = getTopModal();
  if (!top) return;
  const kind = top.dataset.modalKind || "info";
  if (kind === "alert") return; // ESC no cierra alerts (decisión obligatoria)
  closeModal(top);
}

function handleEnter(e) {
  const top = getTopModal();
  if (!top) return;
  const kind = top.dataset.modalKind;
  if (kind !== "alert" && kind !== "confirm") return;
  // No interferir si el foco está en textarea (Enter es salto de línea ahí).
  if (e.target.tagName === "TEXTAREA") return;
  const ok = top.querySelector('[data-action="ok"]');
  if (ok) { e.preventDefault(); ok.click(); }
}

function handleBackdropClick(modal) {
  const kind = modal.dataset.modalKind || "info";
  // Solo los informativos cierran al click fuera. Los demás (alert/confirm/edit)
  // requieren acción explícita del usuario (botón o tecla).
  if (kind === "info") closeModal(modal);
}

// Legacy export — el listener global ya cubre los casos de uso pero algunos
// callers podrían seguir importándolo. Cierra el modal superior respetando kind.
export function closeTopModal() {
  const top = getTopModal();
  if (!top) return;
  const kind = top.dataset.modalKind || "info";
  if (kind === "alert") return;
  closeModal(top);
}

function buildDialog({ title, message, kind, okLabel, cancelLabel }) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.dataset.modalKind = kind;
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

function show(overlay) {
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
      const action = e.target.dataset?.action;
      if (action === "ok") cleanup(true);
      else if (action === "cancel") cleanup(false);
      // El backdrop click lo maneja el listener global según data-modal-kind.
    };
    overlay.addEventListener("click", onClick);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="ok"]')?.focus();
  });
}

export function showAlert(message, { title = "" } = {}) {
  const overlay = buildDialog({ title, message, kind: "alert", okLabel: "OK" });
  return show(overlay).then(() => undefined);
}

export function showConfirm(message, { title = "", okLabel = "Aceptar", cancelLabel = "Cancelar" } = {}) {
  const overlay = buildDialog({ title, message, kind: "confirm", okLabel, cancelLabel });
  return show(overlay).then(Boolean);
}
