import { authState, watchAuth, login, logout, resetPassword } from "./auth.js";
import { initConsultaView } from "./views/consulta.js";
import { initSolicitudView } from "./views/solicitud.js";
import { initEquiposView } from "./views/equipos.js";
import { initUbicacionesView } from "./views/ubicaciones.js";
import { initUsuariosView } from "./views/usuarios.js";
import { initInformesView } from "./views/informes.js";
import { initPanolView } from "./views/panol.js";
import { initPanolMovimientosView } from "./views/panol-movimientos.js";
import { initClientesView } from "./views/clientes.js";
import { collection, getDocs, query, where, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

const routes = {
  login:             { template: "templates/login.html",             title: "Iniciar Sesión",             init: null,                      roles: ["usuario", "tecnico", "supervisor", "admin", "superadmin"] },
  consulta:          { template: "templates/consulta.html",          title: "Consulta de Órdenes",        init: initConsultaView,           roles: ["usuario", "tecnico", "supervisor", "admin", "superadmin"] },
  solicitud:         { template: "templates/solicitud.html",         title: "Nueva Solicitud",            init: initSolicitudView,          roles: ["usuario", "tecnico", "supervisor", "admin", "superadmin"] },
  informes:          { template: "templates/informes.html",          title: "KPIs (Indicadores Clave)",   init: initInformesView,           roles: ["tecnico", "supervisor", "admin", "superadmin"] },
  equipos:           { template: "templates/equipos.html",           title: "Gestionar Equipos",          init: initEquiposView,            roles: ["supervisor", "admin", "superadmin"] },
  ubicaciones:       { template: "templates/ubicaciones.html",       title: "Gestionar Ubicaciones",      init: initUbicacionesView,        roles: ["supervisor", "admin", "superadmin"] },
  usuarios:          { template: "templates/usuarios.html",          title: "Gestionar Usuarios",         init: initUsuariosView,           roles: ["admin", "superadmin"] },
  // ── Módulo Pañol (se muestra solo si el cliente tiene moduloPanol activo) ──
  panol:             { template: "templates/panol.html",             title: "Pañol — Inventario",         init: initPanolView,              roles: ["supervisor", "admin", "superadmin"] },
  "panol-movimientos": { template: "templates/panol-movimientos.html", title: "Pañol — Movimientos",      init: initPanolMovimientosView,   roles: ["supervisor", "admin", "superadmin"] },
  // ── Gestión de clientes (solo superadmin) ──
  clientes:          { template: "templates/clientes.html",          title: "Gestionar Clientes",         init: initClientesView,           roles: ["superadmin"] }
};

// menuByRole define el menú base SIN el pañol (se agrega dinámicamente si está activo)
const menuByRole = {
  usuario:    ["solicitud", "consulta"],
  tecnico:    ["solicitud", "consulta", "informes"],
  supervisor: ["solicitud", "consulta", "informes"],
  admin:      ["solicitud", "consulta", "informes", "equipos", "ubicaciones", "usuarios"],
  superadmin: ["solicitud", "consulta", "informes", "equipos", "ubicaciones", "usuarios", "clientes"]
};

const menuMeta = {
  solicitud:           { icon: "fa-plus-circle",    label: "Nueva Solicitud" },
  consulta:            { icon: "fa-list",            label: "Ver Solicitudes" },
  informes:            { icon: "fa-chart-line",      label: "Informes" },
  equipos:             { icon: "fa-gears",           label: "Gestionar Equipos" },
  ubicaciones:         { icon: "fa-location-dot",    label: "Gestionar Ubicaciones" },
  usuarios:            { icon: "fa-users",           label: "Gestionar Usuarios" },
  panol:               { icon: "fa-warehouse",       label: "Pañol — Inventario", badge: "panol-badge" },
  "panol-movimientos": { icon: "fa-arrows-rotate",   label: "Pañol — Movimientos" },
  clientes:            { icon: "fa-building",        label: "Gestionar Clientes" }
};

const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const nav = document.getElementById("sidebar-nav");
const appLayout = document.querySelector(".app-layout");
const sidebarToggle = document.getElementById("sidebarToggle");
const MOBILE_BREAKPOINT = 1024;

let activeClienteId = "";
let moduloPanolActivo = false; // se actualiza al cargar el cliente
let _viewAbortController = null; // listeners scoped a la vista activa

export function getActiveClienteId() { return activeClienteId; }
export function isModuloPanolActivo() { return moduloPanolActivo; }

// ── Sidebar ────────────────────────────────────────────────────────────────

function collapseSidebarOnMobile() {
  if (!appLayout || !sidebarToggle) return;
  if (window.innerWidth >= MOBILE_BREAKPOINT) return;
  appLayout.classList.remove("sidebar-expanded");
  sidebarToggle.setAttribute("aria-expanded", "false");
}

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash || (authState.profile ? "consulta" : "login");
}

function canAccess(routeKey, role) {
  const route = routes[routeKey];
  if (!route) return false;
  // Login siempre accesible (incluye usuarios sin rol asignado todavía)
  if (routeKey === "login") return true;
  // Rutas de pañol requieren además que el módulo esté activo
  if ((routeKey === "panol" || routeKey === "panol-movimientos") && !moduloPanolActivo) return false;
  if (!role) return false;
  return route.roles.includes(role);
}

function updateUserPanel() {
  const profile = authState.profile;
  const name = profile?.nombre || "Invitado";
  const role = profile?.rol || "No autenticado";
  document.getElementById("userName").textContent = name;
  document.getElementById("userRole").textContent = role.charAt(0).toUpperCase() + role.slice(1);
  document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
}

function renderSidebar(activeRoute) {
  const role = authState.profile?.rol || "";
  nav.innerHTML = "";

  // Construir lista de ítems: base + pañol si activo
  const baseItems = menuByRole[role] || [];
  const items = [...baseItems];

  // Insertar ítems de pañol para supervisor/admin/superadmin si el módulo está activo
  if (moduloPanolActivo && ["supervisor", "admin", "superadmin"].includes(role)) {
    // Insertar después de "informes" si existe, sino al final
    const idxInformes = items.indexOf("informes");
    const insertPos = idxInformes >= 0 ? idxInformes + 1 : items.length;
    items.splice(insertPos, 0, "panol", "panol-movimientos");
  }

  for (const routeKey of items) {
    const meta = menuMeta[routeKey];
    if (!meta) continue;

    const item = document.createElement("a");
    item.href = `#/${routeKey}`;
    item.className = `nav-item ${activeRoute === routeKey ? "active" : ""}`;
    if (!authState.profile) item.classList.add("disabled");
    item.title = meta.label;

    let badgeHtml = "";
    if (routeKey === "panol" && moduloPanolActivo) {
      badgeHtml = `<span class="panol-nav-badge is-hidden" id="panol-nav-badge-count"></span>`;
    }

    item.innerHTML = `<i class="fas ${meta.icon}"></i><span>${meta.label}</span>${badgeHtml}`;
    item.addEventListener("click", (e) => {
      e.preventDefault();
      if (!authState.profile) { collapseSidebarOnMobile(); navigate("login"); return; }
      collapseSidebarOnMobile();
      navigate(routeKey);
    });
    nav.appendChild(item);
  }

  // Actualizar badge de solicitudes pendientes si el módulo está activo
  if (moduloPanolActivo && ["supervisor", "admin", "superadmin"].includes(role)) {
    actualizarBadgePanol();
  }
}

async function actualizarBadgePanol() {
  try {
    const snap = await getDocs(query(
      collection(db, "solicitudesPanol"),
      where("clienteId", "==", activeClienteId),
      where("estado", "==", "pendiente")
    ));
    const total = snap.size;
    const badge = document.getElementById("panol-nav-badge-count");
    if (!badge) return;
    if (total > 0) {
      badge.textContent = total > 9 ? "9+" : String(total);
      badge.classList.remove("is-hidden");
    } else {
      badge.classList.add("is-hidden");
    }
  } catch (_) { /* silencioso */ }
}

// ── Carga del cliente activo (módulo pañol) ────────────────────────────────

async function resolverModulosPanol(clienteId) {
  if (!clienteId) { moduloPanolActivo = false; return; }
  try {
    const snap = await getDoc(doc(db, "clientes", clienteId));
    moduloPanolActivo = snap.exists() ? !!snap.data().moduloPanol : false;
  } catch (_) {
    moduloPanolActivo = false;
  }
}

// ── Selector de cliente (superadmin) ──────────────────────────────────────

async function renderClienteSelector(selectedId = "") {
  const container = document.getElementById("clienteSelectorContainer");
  if (!container) return;

  const role = authState.profile?.rol;
  if (role !== "superadmin") {
    container.innerHTML = "";
    container.classList.add("is-hidden");
    return;
  }

  container.classList.remove("is-hidden");

  const snap = await getDocs(query(collection(db, "clientes"), orderBy("nombre")));
  const clientes = [];
  snap.forEach((d) => clientes.push({ id: d.id, nombre: d.data().nombre }));

  if (!clientes.length) {
    container.innerHTML = `<span class="cliente-selector-label">Sin clientes</span>`;
    activeClienteId = "";
    return;
  }

  const storedId = sessionStorage.getItem("superadminClienteId");
  const resolvedId = selectedId || storedId || clientes[0].id;
  const clienteExiste = clientes.find((c) => c.id === resolvedId);
  activeClienteId = clienteExiste ? resolvedId : clientes[0].id;
  sessionStorage.setItem("superadminClienteId", activeClienteId);

  const select = document.createElement("select");
  select.id = "clienteSelect";
  select.className = "cliente-select";
  clientes.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    opt.selected = c.id === activeClienteId;
    select.appendChild(opt);
  });

  select.addEventListener("change", async () => {
    activeClienteId = select.value;
    sessionStorage.setItem("superadminClienteId", activeClienteId);
    await cargarContenido(currentRoute(), false);
  });

  container.innerHTML = "";
  const label = document.createElement("span");
  label.className = "cliente-selector-label";
  label.textContent = "Cliente:";
  container.appendChild(label);
  container.appendChild(select);
}

// ── Carga de contenido ─────────────────────────────────────────────────────

export async function cargarContenido(routeKey, push = true) {
  // Cortar listeners de la vista anterior antes de montar la nueva
  if (_viewAbortController) _viewAbortController.abort();
  _viewAbortController = new AbortController();
  const viewSignal = _viewAbortController.signal;

  const role = authState.profile?.rol || "";

  if (role === "superadmin") {
    await renderClienteSelector(activeClienteId);
  } else {
    const container = document.getElementById("clienteSelectorContainer");
    if (container) { container.innerHTML = ""; container.classList.add("is-hidden"); }
    activeClienteId = authState.profile?.clienteId || "";
  }

  // Resolver módulo pañol ANTES de decidir si puede acceder a la ruta
  await resolverModulosPanol(activeClienteId);

  const finalRoute = canAccess(routeKey, role) ? routeKey : (authState.profile ? "consulta" : "login");
  const route = routes[finalRoute];

  const response = await fetch(route.template, { cache: "no-store" });
  mainContent.innerHTML = await response.text();
  pageTitle.textContent = route.title;

  renderSidebar(finalRoute);
  updateUserPanel();

  if (push) history.pushState({ route: finalRoute }, "", `#/${finalRoute}`);

  // ── Login ──
  if (finalRoute === "login") {
    bindLoginEvents();
    return;
  }

  await renderTelefonos(activeClienteId);

  // ── Pasar clienteId activo y role a cada vista ──
  const ctx = { role, userName: authState.profile.nombre, clienteId: activeClienteId, signal: viewSignal };
  await route.init?.(ctx);
}

export function navigate(routeKey) {
  cargarContenido(routeKey, true);
}

// ── Init del router ────────────────────────────────────────────────────────

export function initRouter() {
  if (appLayout && sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const expanded = appLayout.classList.toggle("sidebar-expanded");
      sidebarToggle.setAttribute("aria-expanded", String(expanded));
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        appLayout.classList.remove("sidebar-expanded");
        sidebarToggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("click", (e) => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) return;
      if (!appLayout.classList.contains("sidebar-expanded")) return;
      const sidebar = document.getElementById("sidebar");
      if (sidebar.contains(e.target)) return;
      if (sidebarToggle.contains(e.target)) return;
      collapseSidebarOnMobile();
    });
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    collapseSidebarOnMobile();
    await logout();
    await cargarContenido("login", true);
  });

  window.addEventListener("popstate", () => cargarContenido(currentRoute(), false));

  watchAuth(async () => {
    updateUserPanel();
    await cargarContenido(currentRoute(), false);
  });
}

// ── Login events ───────────────────────────────────────────────────────────

function bindLoginEvents() {
  const form = document.getElementById("loginForm");
  const loginTitle = document.getElementById("loginTitle");
  const passwordInput = document.getElementById("loginPassword");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const loginMessage = document.getElementById("loginMessage");
  const resetActions = document.getElementById("resetActions");
  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  const cancelResetBtn = document.getElementById("cancelResetBtn");

  const enableResetMode = () => {
    loginTitle.textContent = "Reestablecer Contraseña";
    passwordInput?.classList.add("is-hidden");
    loginSubmitBtn?.classList.add("is-hidden");
    forgotPasswordLink?.classList.add("is-hidden");
    resetActions?.classList.remove("is-hidden");
    if (loginMessage) loginMessage.textContent = "Ingresa el correo con el que estás registrado en la aplicación y luego haz clic en reestablecer contraseña.";
  };

  const disableResetMode = () => {
    loginTitle.textContent = "Iniciar Sesión";
    passwordInput?.classList.remove("is-hidden");
    loginSubmitBtn?.classList.remove("is-hidden");
    forgotPasswordLink?.classList.remove("is-hidden");
    resetActions?.classList.add("is-hidden");
    if (loginMessage) loginMessage.textContent = "";
  };

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    if (loginMessage) loginMessage.textContent = "";
    try {
      await login(email, password);
      navigate("consulta");
    } catch (err) {
      alert(`Error de login: ${err.message}`);
    }
  });

  forgotPasswordLink?.addEventListener("click", enableResetMode);

  resetPasswordBtn?.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail")?.value.trim();
    if (!email) {
      if (loginMessage) loginMessage.textContent = "Ingresa el correo con el que estás registrado.";
      return;
    }
    try {
      await resetPassword(email);
      disableResetMode();
      forgotPasswordLink?.classList.add("is-hidden");
      if (loginMessage) loginMessage.textContent = "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.";
    } catch (err) {
      if (loginMessage) loginMessage.textContent = `No se pudo enviar el correo: ${err.message}`;
    }
  });

  cancelResetBtn?.addEventListener("click", disableResetMode);
}

// ── Teléfonos sidebar ──────────────────────────────────────────────────────

async function renderTelefonos(clienteId) {
  const container = document.querySelector(".sidebar-contacts");
  if (!container) return;
  if (!clienteId) { container.innerHTML = ""; return; }

  const snap = await getDoc(doc(db, "clientes", clienteId));
  const telefonos = snap.exists() ? (snap.data().telefonos || []) : [];
  if (!telefonos.length) { container.innerHTML = ""; return; }

  container.innerHTML = `<h3>Teléfonos de contacto</h3>
    ${telefonos.map((t) => `<a class="sidebar-contact-link" href="tel:${t.numero}">${t.label}</a>`).join("")}`;
}
