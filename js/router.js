import { authState, watchAuth, login, logout, resetPassword } from "./auth.js";
import { initConsultaView } from "./views/consulta.js";
import { initSolicitudView } from "./views/solicitud.js";
import { initEquiposView } from "./views/equipos.js";
import { initUbicacionesView } from "./views/ubicaciones.js";
import { initUsuariosView } from "./views/usuarios.js";
import { initInformesView } from "./views/informes.js";

const routes = {
  login: { template: "templates/login.html", title: "Iniciar Sesión", init: null, roles: ["guest", "usuario", "tecnico", "supervisor", "admin"] },
  consulta: { template: "templates/consulta.html", title: "Consulta de Órdenes", init: initConsultaView, roles: ["usuario", "tecnico", "supervisor", "admin"] },
  solicitud: { template: "templates/solicitud.html", title: "Nueva Solicitud", init: initSolicitudView, roles: ["usuario", "tecnico", "supervisor", "admin"] },
  informes: { template: "templates/informes.html", title: "KPIs (Indicadores Clave)", init: initInformesView, roles: ["tecnico", "supervisor", "admin"] },
  equipos: { template: "templates/equipos.html", title: "Gestionar Equipos", init: initEquiposView, roles: ["supervisor", "admin"] },
  ubicaciones: { template: "templates/ubicaciones.html", title: "Gestionar Ubicaciones", init: initUbicacionesView, roles: ["supervisor", "admin"] },
  usuarios: { template: "templates/usuarios.html", title: "Gestionar Usuarios", init: initUsuariosView, roles: ["admin"] }
};

const menuByRole = {
  guest: ["solicitud", "consulta"],
  usuario: ["solicitud", "consulta"],
  tecnico: ["solicitud", "consulta", "informes"],
  supervisor: ["solicitud", "consulta", "informes"],
  admin: ["solicitud", "consulta", "informes", "equipos", "ubicaciones", "usuarios"]
};

const menuMeta = {
  solicitud: { icon: "fa-plus-circle", label: "Nueva Solicitud" },
  consulta: { icon: "fa-list", label: "Ver Solicitudes" },
  informes: { icon: "fa-chart-line", label: "Informes" },
  equipos: { icon: "fa-gears", label: "Gestionar Equipos" },
  ubicaciones: { icon: "fa-location-dot", label: "Gestionar Ubicaciones" },
  usuarios: { icon: "fa-users", label: "Gestionar Usuarios" }
};

const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const nav = document.getElementById("sidebar-nav");
const appLayout = document.querySelector(".app-layout");
const sidebarToggle = document.getElementById("sidebarToggle");
const MOBILE_BREAKPOINT = 1024;

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
  return route.roles.includes(role || "guest");
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
  const role = authState.profile?.rol || "guest";
  nav.innerHTML = "";

  for (const routeKey of menuByRole[role]) {
    const item = document.createElement("a");
    item.href = `#/${routeKey}`;
    item.className = `nav-item ${activeRoute === routeKey ? "active" : ""}`;
    if (!authState.profile) item.classList.add("disabled");
    item.title = menuMeta[routeKey].label;
    item.innerHTML = `<i class="fas ${menuMeta[routeKey].icon}"></i><span>${menuMeta[routeKey].label}</span>`;
    item.addEventListener("click", (e) => {
      e.preventDefault();
      if (!authState.profile) {
        collapseSidebarOnMobile();
        navigate("login");
        return;
      }
      collapseSidebarOnMobile();
      navigate(routeKey);
    });
    nav.appendChild(item);
  }
}

export async function cargarContenido(routeKey, push = true) {
  const role = authState.profile?.rol || "guest";
  const finalRoute = canAccess(routeKey, role) ? routeKey : (authState.profile ? "consulta" : "login");
  const route = routes[finalRoute];

  const response = await fetch(route.template, { cache: "no-store" });
  mainContent.innerHTML = await response.text();
  pageTitle.textContent = route.title;

  renderSidebar(finalRoute);
  updateUserPanel();

  if (push) {
    history.pushState({ route: finalRoute }, "", `#/${finalRoute}`);
  }

  if (finalRoute === "login") {
    const form = document.getElementById("loginForm");
    const passwordInput = document.getElementById("loginPassword");
    const loginSubmitBtn = document.getElementById("loginSubmitBtn");
    const forgotPasswordLink = document.getElementById("forgotPasswordLink");
    const loginMessage = document.getElementById("loginMessage");
    const resetActions = document.getElementById("resetActions");
    const resetPasswordBtn = document.getElementById("resetPasswordBtn");
    const cancelResetBtn = document.getElementById("cancelResetBtn");

    const enableResetMode = () => {
      passwordInput?.classList.add("is-hidden");
      loginSubmitBtn?.classList.add("is-hidden");
      forgotPasswordLink?.classList.add("is-hidden");
      resetActions?.classList.remove("is-hidden");
      if (loginMessage) {
        loginMessage.textContent = "Ingresa tu correo y luego haz clic en reestablecer contraseña.";
      }
    };

    const disableResetMode = () => {
      passwordInput?.classList.remove("is-hidden");
      loginSubmitBtn?.classList.remove("is-hidden");
      forgotPasswordLink?.classList.remove("is-hidden");
      resetActions?.classList.add("is-hidden");
      if (loginMessage) {
        loginMessage.textContent = "";
      }
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

    forgotPasswordLink?.addEventListener("click", () => {
      enableResetMode();
    });

    resetPasswordBtn?.addEventListener("click", async () => {
      const email = document.getElementById("loginEmail")?.value.trim();
      if (!email) {
        if (loginMessage) {
          loginMessage.textContent = "Ingresa tu correo y luego haz clic en reestablecer contraseña.";
        }
        return;
      }

      try {
        await resetPassword(email);
        if (loginMessage) {
          loginMessage.textContent = "Te enviamos un correo para reestablecer tu contraseña.";
        }
      } catch (err) {
        if (loginMessage) {
          loginMessage.textContent = `No se pudo enviar el correo: ${err.message}`;
        }
      }
    });

    cancelResetBtn?.addEventListener("click", () => {
      disableResetMode();
    });

    return;
  }

  await route.init?.({ role: authState.profile.rol, userName: authState.profile.nombre });
}

export function navigate(routeKey) {
  cargarContenido(routeKey, true);
}

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
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    collapseSidebarOnMobile();
    await logout();
    await cargarContenido("login", true);
  });

  window.addEventListener("popstate", () => cargarContenido(currentRoute(), false));

  watchAuth(async () => {
    updateUserPanel();
    const route = currentRoute();
    await cargarContenido(route, false);
  });
}
