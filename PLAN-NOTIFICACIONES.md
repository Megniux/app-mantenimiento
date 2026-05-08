# Plan — Rama Notificaciones

Documento vivo. Se actualiza al final de cada sesión. Para retomar: leer este archivo + `git log --oneline` + sección "Próximo paso".

## Contexto

- Rama: `Notificaciones` (creada desde `origin/main`).
- Worktree: `C:/Users/maxim/OneDrive/Documentos/GitHub/app-mantenimiento-notif`.
- Rama paralela: `Gestion-stock-panol` (otro worktree). Esta rama se mergea ANTES que stock.
- Estrategia anti-conflicto: NO modificar `js/views/solicitud.js` ni `js/views/consulta.js`. Disparar notificaciones desde Cloud Functions (`onDocumentCreated`) para desacoplar.

## Decisiones de producto

- **Canales**: FCM Push (PWA) + Email.
- **Push al crear orden CORRECTIVA** → todos los técnicos del cliente + superadmin(es).
- **Email al crear orden** → solicitante (quien creó la orden).
- **Email en modificaciones** → solicitante (fase 2).
- **Detalle push**: N° orden, solicitante, ubicación, equipo, descripción corta, prioridad.
- **Detalle email**: igual al modal "detalles" en consulta.
- **Superadmin**: mismo canal que técnicos; arquitectura escalable (busca por `rol == "superadmin"`, no UID hardcoded).

## Decisiones técnicas

- **Tokens FCM** en subcolección `users/{uid}/fcmTokens/{tokenId}` (multi-dispositivo).
- **Preferencia** `notificacionesPush: true/false` en doc de usuario.
- **Idempotencia**: dedupe por `ordenId` para evitar doble envío de un mismo trigger.
- **Cloud Function**: `onDocumentCreated("ordenes/{ordenId}")` filtrando `tipo == "Correctivo"`.
- **Service Worker**: `firebase-messaging-sw.js` en raíz para recibir push en background.
- **Manifest PWA**: agregar `manifest.webmanifest` + `<link rel=manifest>` en `index.html`.

## Mapa de archivos (planificado)

### Archivos NUEVOS (sin riesgo de conflicto con stock)
- `manifest.webmanifest` — declaración PWA.
- `firebase-messaging-sw.js` — service worker para push en background.
- `icons/icon-192.png`, `icons/icon-512.png` — íconos PWA.
- `js/notifications/push.js` — lógica cliente: pedir permiso, registrar token, escuchar foreground.
- `js/notifications/preferences.js` — UI/lógica para activar/desactivar push.
- `templates/notificaciones-pref.html` (si hace falta vista propia).
- `functions/index.js` — Cloud Function `onOrdenCreated`. ⚠️ Stock branch crea este mismo archivo → conflicto trivial al mergear stock (mantener ambos exports).
- `functions/package.json`, `functions/.eslintrc.js` — ⚠️ stock branch también los crea, mismo conflicto trivial.

### Archivos MODIFICADOS (riesgo)
- `index.html` — agregar `<link manifest>`, registrar SW. Stock NO lo toca → seguro.
- `js/auth.js` — al login, registrar token FCM del dispositivo. Stock lo toca 3 líneas → conflicto trivial.
- `js/router.js` — registrar ruta de preferencias de notificaciones (si la agregamos). Stock lo toca pesado → mantener cambio mínimo y aditivo.
- `firestore.rules` — reglas para `users/{uid}/fcmTokens/*`. Stock lo toca → bloque aditivo al final.
- `firebase.json` (si existe en main; lo crea stock) — config de hosting/SW. Posible conflicto.

## Fases

### Fase 1 — Push (en curso)
1. Setup PWA básico (manifest, SW, íconos placeholder).
2. Activar Cloud Messaging en Firebase + obtener VAPID key.
3. Cliente: pedir permiso, registrar token al login, guardar en Firestore.
4. UI mínima de "activar notificaciones" (botón en perfil o aviso al loguearse).
5. Cloud Function `onOrdenCreated` que filtra `tipo == "Correctivo"` y dispara push a técnicos + superadmin del cliente.
6. Manejo de tokens inválidos (limpieza al fallar envío).
7. Pruebas end-to-end.

### Fase 2 — Email
1. Servicio de envío (Cloud Functions + SendGrid/Mailgun/SMTP).
2. Template HTML con todos los campos del modal "detalles".
3. Email al crear orden (al solicitante).
4. Email en cambios de estado/edición de orden (al solicitante).

### Fase 3 — Configuración avanzada (opcional)
- Vista para que el superadmin elija un canal distinto si crece el negocio.
- Logs de notificaciones enviadas para auditoría.

## Acciones que requieren al usuario (Maxi)

Estas no las puedo hacer yo, te aviso cuando lleguemos a cada una:

1. **Crear API Key VAPID en Firebase Console** → Project Settings → Cloud Messaging → Web configuration → Generate key pair.
2. **Habilitar Cloud Messaging API** en Google Cloud Console (puede que ya esté).
3. **Subir íconos PWA reales** (192x192 y 512x512) si no querés usar placeholders.
4. **Aprobar primer push de prueba** desde tu propio celular.
5. **Configurar billing en Firebase si hace falta** para Cloud Functions (plan Blaze). Cloud Messaging es gratis pero las Functions requieren Blaze.
6. **Push final + apertura de PR** cuando esté todo verificado.

## Estado actual

### Fase 1 — Push (✅ TERMINADA y FUNCIONANDO)
- [x] Worktree y rama creados.
- [x] Setup PWA: manifest, service worker FCM, meta tags en index.html.
- [x] Cliente FCM (`js/notifications/push.js`) con dedup de registros concurrentes y espera del SW activo.
- [x] Hook en `auth.js` (login + watchAuth + logout).
- [x] VAPID key configurada.
- [x] Cloud Function `onOrdenCreated` deployada y andando.
- [x] Reglas Firestore para `users/{uid}/fcmTokens/*` deployadas.
- [x] Convivencia con stock: funciones (`syncUserClaims`, `backfillUserClaims`) y reglas (`repuestos`, `movimientosRepuestos`, `solicitudesPanol`) fusionadas en este archivo para no borrarlas en deploy.
- [x] Configs de Firebase traídas de stock (`firebase.json`, `.firebaserc`, `firestore.indexes.json`, `.gitignore`).
- [x] Banner "Activar notificaciones" para destrabar permiso en celu (iOS PWA + Android Chrome con sesión persistida).
- [x] Payload data-only para evitar duplicado en Android.
- [x] `skipWaiting` + `clients.claim` en SW para que actualizaciones futuras se apliquen sin reinstalar PWA.
- [x] **Probado end-to-end**: push llega correctamente al celu con título y cuerpo.

### Pendiente

#### Pulido cosmético (rápido, baja prioridad)
- [ ] Sacar `console.log('[push] ...')` de diagnóstico (o dejarlos opt-in con un flag).
- [ ] Cambiar `<meta name="apple-mobile-web-app-capable">` por el moderno `<meta name="mobile-web-app-capable">` para sacar el warning de DevTools.
- [ ] Reemplazar íconos PWA placeholder (`logo.jpg`) por PNG real 192x192 y 512x512.

#### Fase 2 — Email (próxima sesión)
- [ ] Decidir proveedor de envío (SendGrid / Mailgun / Brevo / Resend / SMTP propio).
- [ ] Configurar credenciales en Cloud Functions secrets.
- [ ] Template HTML con todos los campos del modal "detalles" de la orden.
- [ ] Cloud Function `onOrdenCreatedEmail` → envía mail al solicitante.
- [ ] Cloud Function `onOrdenUpdatedEmail` → envía mail al solicitante en cambios de estado o edición.

#### Edge case conocido (no urgente)
- [ ] Token huérfano: si user A cierra el navegador sin logout y user B se loguea después, el token de A queda en `users/A/fcmTokens` aunque ese dispositivo ya no le corresponda. Solución posible: al registrar un token nuevo, una Cloud Function limpia ese mismo token de cualquier otro `users/*/fcmTokens`.

#### Cierre de la rama
- [ ] Decidir si mergear Notificaciones a `main` ahora (con solo push) o esperar a tener email también.
- [ ] Cuando se mergee: PR + revisar diff + merge a main + deploy de hosting desde main.

## Próximo paso

Pulido cosmético de la fase 1 + arrancar **Fase 2 (email)**. Antes de empezar email, decidir el proveedor:
- **SendGrid**: clásico, plan gratis 100 mails/día. Requiere verificar dominio.
- **Brevo (ex Sendinblue)**: 300 mails/día gratis. Más simple de setup.
- **Resend**: el más nuevo y prolijo para developers. 3000/mes gratis. Requiere dominio.
- **SMTP de Gmail**: gratis pero limitado y poco recomendado para producción.

Mi recomendación: **Brevo** o **Resend** para arrancar.

## Cómo retomar después de un parate

1. Abrir esta carpeta en VS Code: `C:/Users/maxim/OneDrive/Documentos/GitHub/app-mantenimiento-notif`.
2. Decirle a Claude: "seguí el plan de notificaciones desde donde quedó".
3. Claude lee este archivo, hace `git log --oneline` para ver últimos commits, y arranca en "Próximo paso".
