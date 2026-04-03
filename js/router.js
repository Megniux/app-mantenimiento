import { authState, watchAuth, login, logout } from "./auth.js";
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
  informes: { template: "templates/informes.html", title: "Informes", init: initInformesView, roles: ["tecnico", "supervisor", "admin"] },
  equipos: { template: "templates/equipos.html", title: "Gestionar Equipos", init: initEquiposView, roles: ["supervisor", "admin"] },
  ubicaciones: { template: "templates/ubicaciones.html", title: "Gestionar Ubicaciones", init: initUbicacionesView, roles: ["supervisor", "admin"] },
  usuarios: { template: "templates/usuarios.html", title: "Gestionar Usuarios", init: initUsuariosView, roles: ["admin"] }
};

const menuByRole = {
  guest: ["solicitud", "consulta"],
  usuario: ["solicitud", "consulta"],
  tecnico: ["solicitud", "consulta", "informes"],
  supervisor: ["solicitud", "consulta", "informes", "equipos", "ubicaciones"],
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
        navigate("login");
        return;
      }
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
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value;
      const password = document.getElementById("loginPassword").value;
      try {
        await login(email, password);
        navigate("consulta");
      } catch (err) {
        alert(`Error de login: ${err.message}`);
      }
    });
    return;
  }

  await route.init?.({ role: authState.profile.rol, userName: authState.profile.nombre });
}

export function navigate(routeKey) {
  cargarContenido(routeKey, true);
}

export function initRouter() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
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
