# Multi-tenencia (clientes independientes)

## 1) Migrar datos existentes (una sola vez)

1. Configura credenciales de Firebase Admin:
- Opcion A: `GOOGLE_APPLICATION_CREDENTIALS` con ruta al JSON de service account.
- Opcion B: ADC (`gcloud auth application-default login`).

2. (Opcional) Define cliente por defecto:
- PowerShell: `$env:CLIENTE_ID_DEFAULT="cliente_principal"`

3. Ejecuta migracion:
- `node scripts/migrar-multitenencia.js`

Este script hace:
- Agrega `clienteId` faltante en `ordenes`, `equipos`, `ubicaciones`, `users`.
- Mantiene usuarios `superadmin` sin `clienteId`.
- Crea contadores por cliente en `config/contadores/clientes/{clienteId}`.
- Toma `config/contador` como base para `cliente_principal`.

## 2) Publicar reglas de Firestore

1. Revisa `firestore.rules`.
2. Despliega reglas:
- `firebase deploy --only firestore:rules`

## 3) Prueba de aislamiento entre clientes

1. Crea dos clientes de prueba:
- `cliente_a`
- `cliente_b`

2. Crea usuarios:
- Admin A: rol `admin`, `clienteId=cliente_a`
- Tecnico A: rol `tecnico`, `clienteId=cliente_a`
- Admin B: rol `admin`, `clienteId=cliente_b`

3. Con Admin A:
- Crea equipo/ubicacion/orden.
- Verifica que solo vea datos `cliente_a`.

4. Con Admin B:
- Verifica que no vea datos de `cliente_a`.
- Crea sus propios datos y verifica que Admin A no los vea.

5. Verifica numeracion:
- Crear ordenes en A y B.
- Confirmar que cada cliente incremente su propio contador independiente.

6. (Opcional) Superadmin:
- Crea un usuario con rol `superadmin` y sin `clienteId`.
- Debe poder consultar datos globalmente (segun reglas).

## 4) Nota de compatibilidad

Durante transicion, el frontend contempla registros legacy sin `clienteId` como `cliente_principal` para no cortar operacion antes de terminar la migracion.
