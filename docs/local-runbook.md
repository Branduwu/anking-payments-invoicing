# Runbook Local

Fecha de referencia: 2026-03-16

## Objetivo

Este documento explica como levantar la plataforma localmente, que valida cada script y como probar los endpoints principales sin depender de memoria o comandos sueltos.

## Componentes locales

### PostgreSQL

- guarda usuarios, credenciales, roles, pagos, facturas y auditoria.
- escucha en `localhost:5432`.

### Redis

- guarda sesiones stateful y datos efimeros de MFA.
- escucha en `localhost:6379`.

### API NestJS

- escucha en `http://localhost:4000`.
- expone rutas bajo `/api`.

## Scripts de trabajo

### `npm run infra:up`

Hace esto:

1. asegura `.env` y `apps/api/.env`
2. levanta `postgres` y `redis` con Docker si hace falta
3. espera a que `5432` y `6379` esten disponibles
4. ejecuta `prisma:migrate:deploy`
5. ejecuta `seed:admin`

Usalo cuando quieras preparar infraestructura sin arrancar la API.

### `npm start`

Hace esto:

1. asegura archivos `.env`
2. si faltan dependencias y Docker existe, llama `infra:up`
3. si faltan dependencias y Docker no existe, levanta en modo degradado
4. arranca la API en modo desarrollo

### `npm run smoke:test`

Hace esto contra una API ya levantada:

1. valida `GET /api/health/live`
2. valida `GET /api/health/ready`
3. hace login con el admin del `.env`
4. consulta `/api/auth/me`
5. consulta `/api/sessions`
6. crea un pago
7. lista pagos
8. crea una factura ligada al pago
9. lista facturas
10. timbra la factura
11. cancela la factura
12. hace logout

Si el usuario configurado tiene MFA habilitado, el script intenta completar `POST /api/auth/mfa/verify` usando:

- `ADMIN_MFA_TOTP_CODE`
- o `ADMIN_MFA_RECOVERY_CODE`

Si no existe alguno de esos valores, el smoke test falla de forma explicita para evitar una falsa validacion.

El script ya contempla compatibilidad con Windows PowerShell 5.1 para las llamadas HTTP, asi que no depende del motor viejo de Internet Explorer.

### `npm run validate:local`

Hace esto de punta a punta:

1. ejecuta `npm run verify`
2. ejecuta `npm run infra:up`
3. falla si ya hay algo escuchando en `localhost:4000`, salvo que se use `-UseRunningApi`
4. levanta la API compilada si aun no esta arriba
5. corre `npm run smoke:test`

Si el proceso de la API termina antes de responder `health/live`, el script falla con el `ExitCode` del proceso para acelerar el diagnostico.

Es el mejor script para correr despues de cambios importantes.

### `npm run verify`

Hace esto:

1. intenta regenerar Prisma Client
2. si el engine esta bloqueado por una API corriendo y el cliente ya esta fresco, continua
3. ejecuta `build`
4. ejecuta `test`

Si cambiaste `schema.prisma` o migraciones, usa `npm run verify:full` con la API detenida.

`verify` y `infra:up` validan explicitamente el codigo de salida de `npm`, Prisma y Docker Compose. Si algo falla, el script termina en rojo en vez de seguir silenciosamente.

### `npm run lint`

Corre `ESLint` sobre el backend con reglas TypeScript y sirve como puerta rapida para errores de mantenibilidad antes del smoke test.

### `npm run audit:deps`

Ejecuta `npm audit --audit-level=moderate` para detectar advisories antes de mergear o desplegar.

### `npm run prisma:migrate:controlled`

Ejecuta migraciones de forma mas segura:

1. valida `DATABASE_URL`
2. corre `prisma generate`
3. corre `prisma migrate status`
4. corre `prisma migrate deploy`

## Flujo recomendado de desarrollo

### Flujo rapido

```powershell
npm.cmd start
```

### Flujo controlado

```powershell
npm.cmd run verify
npm.cmd run lint
npm.cmd run audit:deps
npm.cmd run infra:up
npm.cmd run validate:local
```

## Variables clave

### Infraestructura

- `DATABASE_URL`
- `REDIS_URL`
- `ALLOW_DEGRADED_STARTUP`
- `AUDIT_FAIL_CLOSED_SUCCESS_ACTION_PREFIXES`
- `AUDIT_FAIL_CLOSED_FAILURE_ACTION_PREFIXES`
- `AUDIT_FAIL_CLOSED_DENIED_ACTION_PREFIXES`

### Admin bootstrap

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `ADMIN_MFA_TOTP_CODE`
- `ADMIN_MFA_RECOVERY_CODE`

### Timbrado

- `PAC_PROVIDER`
- `PAC_BASE_URL`
- `PAC_API_KEY`
- `PAC_TIMEOUT_MS`

## Endpoints clave

### Salud

- `GET /api/health/live`
- `GET /api/health/ready`

`health/live` ya devuelve metadata del servicio y `health/ready` devuelve checks por dependencia cuando algo falla.

### Auth

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/reauthenticate`
- `POST /api/auth/mfa/setup`
- `POST /api/auth/mfa/verify`
- `POST /api/auth/mfa/recovery-codes/regenerate`
- `POST /api/auth/mfa/disable`
- `POST /api/auth/mfa/admin/reset`

`login` y `reauthenticate` ya aplican rate limiting con contadores en `Redis`. Si el umbral configurado se supera, la API responde `429`.

### Sesiones

- `GET /api/sessions`
- `DELETE /api/sessions/:id`
- `DELETE /api/sessions/all`

### Pagos

- `POST /api/payments`
- `GET /api/payments`

### Facturas

- `POST /api/invoices`
- `GET /api/invoices`
- `POST /api/invoices/stamp`
- `POST /api/invoices/cancel`

## Pruebas manuales en PowerShell

### Salud

```powershell
Invoke-RestMethod http://localhost:4000/api/health/live
Invoke-RestMethod http://localhost:4000/api/health/ready
```

### Login y sesion

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:4000/api/auth/login `
  -SessionVariable session `
  -ContentType 'application/json' `
  -Body '{"email":"admin@example.com","password":"ChangeMeNow_123456789!"}'

Invoke-RestMethod -Method Get `
  -Uri http://localhost:4000/api/auth/me `
  -WebSession $session
```

### Crear pago

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:4000/api/payments `
  -WebSession $session `
  -ContentType 'application/json' `
  -Body '{"amount":125.50,"currency":"MXN","bankAccountRef":"acct_demo_001","concept":"Pago demo"}'
```

### Crear, timbrar y cancelar factura

```powershell
$invoice = Invoke-RestMethod -Method Post `
  -Uri http://localhost:4000/api/invoices `
  -WebSession $session `
  -ContentType 'application/json' `
  -Body '{"customerTaxId":"XAXX010101000","currency":"MXN","subtotal":100,"total":116}'

Invoke-RestMethod -Method Post `
  -Uri http://localhost:4000/api/invoices/stamp `
  -WebSession $session `
  -ContentType 'application/json' `
  -Body "{""invoiceId"":""$($invoice.invoice.id)""}"

Invoke-RestMethod -Method Post `
  -Uri http://localhost:4000/api/invoices/cancel `
  -WebSession $session `
  -ContentType 'application/json' `
  -Body "{""invoiceId"":""$($invoice.invoice.id)"",""reason"":""Cancelacion de prueba""}"
```

## Pruebas manuales con `curl`

### Login

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMeNow_123456789!"}' \
  http://localhost:4000/api/auth/login
```

### Perfil actual

```bash
curl -b cookies.txt http://localhost:4000/api/auth/me
```

### Pago

```bash
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"amount":125.50,"currency":"MXN","bankAccountRef":"acct_demo_001","concept":"Pago demo"}' \
  http://localhost:4000/api/payments
```

## Comportamiento esperado por modo

### Modo normal

- `health/live` devuelve `ok`
- `health/ready` devuelve `ready`
- login, sesiones, pagos y facturas funcionan

### Modo degradado

- `health/live` devuelve `ok`
- `health/ready` devuelve `503`
- la API levanta, pero Prisma y Redis reales no estan disponibles
- endpoints de negocio o sesion fallan con `503`

## Troubleshooting

### `Can't reach database server at localhost:5432`

- PostgreSQL no esta arriba
- corre `npm run infra:up`
- si usas Docker, confirma `docker compose ps` y que `migration-runner` haya terminado en `Exit 0`

### `Redis session store unavailable`

- Redis no esta arriba o la URL no es correcta
- valida `REDIS_URL`
- corre `npm run infra:up`

### `Too many login attempts. Try again later.`

- se alcanzo el rate limit de `login` o `reauthenticate`
- espera a que expire la ventana o limpia Redis en entorno de desarrollo
- revisa si el origen esta teniendo credenciales incorrectas repetidas o automatizacion no deseada

### `MFA verification required`

- la sesion existe, pero sigue pendiente de segundo factor
- completa `POST /api/auth/mfa/verify`
- para `smoke:test`, define `ADMIN_MFA_TOTP_CODE` o `ADMIN_MFA_RECOVERY_CODE`

### `Audit persistence unavailable`

- la ruta intento ejecutar una operacion con auditoria duradera y PostgreSQL no estaba disponible
- revisa `health/ready` y la conectividad de la base
