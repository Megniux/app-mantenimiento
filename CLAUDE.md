# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**app-mantenimiento** is a client-side SPA for managing maintenance orders, equipment, and inventory for multiple industrial clients. It is written in vanilla JavaScript (ES modules, no build step), backed by Google Cloud Firestore and Firebase Authentication, and deployed to Firebase Hosting.

## Development & Deployment Commands

There is no `package.json` or build toolchain. The app uses ES modules loaded directly in the browser via `<script type="module">`. All Firebase SDK imports use CDN URLs.

```bash
# Install Firebase CLI (once)
npm install -g firebase-tools

# Authenticate with Firebase
firebase login

# Deploy everything (hosting + Firestore rules + indexes)
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Local development: open index.html directly in a browser
# No dev server needed — ES modules work with file:// in most modern browsers,
# but Firebase Auth may require a real origin. Use a simple static server:
npx serve .
```

**Firebase project**: `mantenimiento-app-170e5`  
**Firestore region**: `southamerica-east1`

## Architecture

### SPA with Hash-Based Routing

`js/app.js` → `js/router.js` → loads `templates/<view>.html` into `#mainContent` → calls `init<View>()` from `js/views/<view>.js`.

Navigation is done via `window.location.hash` (e.g., `#/consulta`, `#/solicitud`). The router listens to `hashchange` events and re-renders the view on each navigation.

```
index.html                  # Shell: sidebar + #mainContent container
js/app.js                   # Entry point — imports router
js/router.js                # Hash router, sidebar, role-based access, template loader
js/auth.js                  # Firebase Auth helpers (login, logout, password reset)
js/firebase-config.js       # Firebase SDK init + config
js/views/<view>.js          # One module per route; exports initViewName()
templates/<view>.html       # HTML template string fetched and injected into #mainContent
```

### Session & Auth State

After login, user data is stored in `sessionStorage`:
- `userName`, `userRole`, `userUid`, `userClienteId`
- `superadminClienteId` (superadmin-only: the currently selected client)

The router reads these on every navigation to enforce role gates and build the sidebar menu.

### Multi-Tenant Data Isolation

Every Firestore query includes a `where("clienteId", "==", userClienteId)` clause. Firestore security rules enforce the same isolation server-side. The superadmin can switch the active client via a dropdown in the sidebar, which updates `superadminClienteId` in sessionStorage and re-renders the current view.

### Optional Pañol Module

The "pañol" (inventory/spare parts) module is toggled per client via the `moduloPanol` boolean on the client document. If enabled and the user is supervisor or higher, two extra routes appear: `#/panol` (inventory) and `#/panol-movimientos` (requests/approvals).

## Role-Based Access Control

Six roles with escalating permissions:

| Role | Key capabilities |
|------|----------------|
| `guest` | Create and view orders |
| `usuario` | Same as guest |
| `tecnico` | + Reports |
| `supervisor` | + Equipment, locations, pañol |
| `admin` | + User management |
| `superadmin` | + Client management, client selector |

The sidebar menu is built from the `menuByRole` object in `router.js`. Role checks inside view modules use `sessionStorage.getItem("userRole")`.

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `clientes/{clienteId}` | Tenants; contains `moduloPanol`, `panolAprobacionDefault`, `telefonos[]` |
| `ordenes/{docId}` | Maintenance orders; `clienteId` scoped |
| `equipos/{docId}` | Equipment catalog with `ubicacionActualId/Nombre` |
| `ubicaciones/{docId}` | Locations |
| `users/{uid}` | User profiles with `rol` and `clienteId` |
| `repuestos/{docId}` | Spare parts inventory items |
| `solicitudesPanol/{docId}` | Spare parts requests/approvals |

Composite indexes required for complex queries are defined in `firestore.indexes.json`.

## Key Implementation Notes

- **Race condition guard**: `consulta.js` uses a `consultaLoadToken` counter to discard stale async results when the user navigates away and back quickly.
- **Equipment legacy normalization**: `equipos.js` normalizes older documents that stored location as a plain string instead of an ID/name pair.
- **Pañol badge**: The sidebar shows a real-time pending-request count badge on the pañol-movimientos link, updated via a Firestore listener in `router.js`.
- **Mobile breakpoint**: 1024 px. Sidebar collapses to a hamburger menu below this width; clicking outside closes it.
- **CSV export**: Available in `consulta.js` (orders) and `panol.js` (inventory). Uses a `<a download>` blob URL pattern.
- **Virtual equipment option**: The order form includes an "Otro" option when the target equipment isn't in the catalog.
