# Scripts admin

Scripts puntuales que corren con el Admin SDK contra el proyecto real. Se
ejecutan desde el directorio `functions/` para reutilizar su `firebase-admin`.

## Credenciales

Necesitan una **service account key**:

1. Firebase Console → ⚙ Configuración del proyecto → **Cuentas de servicio**.
2. **Generar nueva clave privada** → descarga un `.json`.
3. Guardalo en `functions/scripts/` (ya está en `.gitignore`: `scripts/*.json`)
   o en cualquier ruta fuera del repo.

> ⚠ La key da acceso total al proyecto. No la commitees ni la compartas.

Pasala por variable de entorno (recomendado) o por argumento `--key`:

```powershell
# PowerShell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\ruta\a\serviceAccountKey.json"
```

```bash
# bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/serviceAccountKey.json
```

## cleanup-orphan-users.mjs

Detecta desincronizaciones entre `users/` (Firestore) y Firebase Auth:

- **Tipo A** — doc `users/{uid}` sin cuenta Auth (huérfanos de imports viejos).
- **Tipo B** — cuenta Auth sin doc `users/{uid}` (borrados previos al trigger).

```bash
cd functions

# Dry-run: reporta A y B, no borra nada
node scripts/cleanup-orphan-users.mjs

# Borra los docs huérfanos (tipo A)
node scripts/cleanup-orphan-users.mjs --delete-docs

# Borra las cuentas Auth huérfanas (tipo B)
node scripts/cleanup-orphan-users.mjs --delete-auth

# Ambos
node scripts/cleanup-orphan-users.mjs --delete-docs --delete-auth

# Con key por argumento en vez de env var
node scripts/cleanup-orphan-users.mjs --key C:\ruta\key.json
```

Siempre corré primero el dry-run y revisá la lista antes de borrar.
