# Redirector — repo viejo `megniux/app-mantenimiento`

Estos archivos reemplazan el contenido del repositorio viejo
`https://github.com/Megniux/app-mantenimiento` para que la URL antigua
`https://megniux.github.io/app-mantenimiento/` redirija a
`https://mantenimiento-app.com.ar/` y limpie cualquier PWA / Service Worker
instalado desde el origen viejo.

## Qué hacer

1. Cloná o abrí el repo `Megniux/app-mantenimiento` en otra carpeta.
2. Borrá **todo** el contenido del repo (excepto `.git/` y `.github/` si tiene
   workflows que querés conservar). Es decir: nada del código viejo de la app
   debe quedar publicado.
3. Copiá los tres archivos de esta carpeta (`index.html`,
   `firebase-messaging-sw.js`, `404.html`) a la **raíz** del repo viejo.
4. Commit + push a la rama que GitHub Pages está sirviendo (típicamente `main`
   o `gh-pages`).
5. Esperá 1-2 minutos a que GitHub Pages publique el cambio.
6. Verificá entrando a `https://megniux.github.io/app-mantenimiento/` — tenés
   que ver la página de mudanza con el botón "Ir ahora" y la cuenta regresiva.

## Qué hace cada archivo

- **`index.html`**: página de aterrizaje con el aviso de mudanza, el
  instructivo de 3 pasos y un redirect automático en 6 segundos. Limpia
  caches y desregistra el Service Worker desde el código de la página.
- **`firebase-messaging-sw.js`**: reemplaza el SW viejo. Cuando el navegador
  haga la actualización del SW, este nuevo se auto-desregistra, limpia las
  caches y fuerza el navigate de cualquier cliente abierto. Esto es lo que
  asegura que las PWA instaladas (la tuya, en particular) se "desinstalen"
  solas la próxima vez que se abran.
- **`404.html`**: por si alguien tiene un bookmark a una ruta interna del
  sitio viejo (ej. `/app-mantenimiento/usuarios.html`), GitHub Pages sirve
  este archivo y redirige al dominio nuevo.

## Cuándo hacerlo

Conviene subir esto **después** de confirmar que `mantenimiento-app.com.ar`
ya está respondiendo en HTTPS con el certificado emitido por Firebase
Hosting. Si lo subís antes, los clientes que entren por la URL vieja van a
ser redirigidos a un dominio que todavía no funciona.

## Cuánto tiempo mantenerlo activo

Mínimo 3-6 meses. Después se puede archivar el repo si el tráfico residual
es cero.
