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

- [x] Worktree y rama creados.
- [x] Plan documentado.
- [ ] Fase 1.1 — Setup PWA básico (PRÓXIMO).

## Próximo paso

Crear `manifest.webmanifest` + `firebase-messaging-sw.js` (esqueleto) + agregar links en `index.html`. Esto NO requiere claves de Firebase aún, solo deja la PWA instalable.

## Cómo retomar después de un parate

1. Abrir esta carpeta en VS Code: `C:/Users/maxim/OneDrive/Documentos/GitHub/app-mantenimiento-notif`.
2. Decirle a Claude: "seguí el plan de notificaciones desde donde quedó".
3. Claude lee este archivo, hace `git log --oneline` para ver últimos commits, y arranca en "Próximo paso".
