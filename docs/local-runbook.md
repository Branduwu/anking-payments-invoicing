# Runbook Local

Fecha de referencia: 2026-03-16

## Objetivo

Este documento explica como levantar la plataforma localmente, que valida cada script y como probar los endpoints principales sin depender de memoria o comandos sueltos.

## Componentes locales

### PostgreSQL

- guarda usuarios, credenciales, roles, pagos, facturas y auditoria.
- escucha en `localhost:5432`.

### Redis

- guarda sesiones stateful, challenges WebAuthn y datos efimeros de MFA.
- guarda tambien rate limiting de auth y actividad de sesion persistida por ventana configurable.
- escucha en `localhost:6379`.

### API NestJS

- escucha en `http://localhost:4000`.
- expone rutas bajo `/api`.

## Scripts de trabajo

### `npm run setup:workstation`

Bootstrap para una PC nueva en Windows:

1. verifica `Git`, `Node.js`, `npm`, `Docker Desktop` y `GitHub CLI`
2. opcionalmente instala prerequisitos faltantes con `winget`
3. crea `.env` desde `.env.example`
4. sincroniza `apps/api/.env`
5. ejecuta `npm ci`
6. genera Prisma Client
7. opcionalmente instala Chromium para `Playwright`

Version mas completa:

```powershell
npm run setup:workstation:full
```

Esa variante intenta instalar prerequisitos faltantes y deja el repo en mejor estado para correr `verify` y el laboratorio WebAuthn.

### `npm run infra:up`

Hace esto:

1. asegura `.env` y `apps/api/.env`
   el archivo `apps/api/.env` se sincroniza desde el `.env` raiz para evitar drift
2. levanta `postgres` y `redis` con Docker solo si sus URLs siguen apuntando a `localhost`
3. espera a que `5432` y `6379` esten disponibles y, si uso Docker, valida health de contenedores
4. ejecuta `prisma:migrate:deploy`
5. ejecuta `seed:admin`

Si migraciones o seed fallan despues de levantar Docker, el script imprime logs recientes de `postgres` y `redis`.

`seed:admin` asume que Prisma Client ya fue generado por `verify`, `infra:up` o `npm run prisma:generate`.

Si `DATABASE_URL`/`DIRECT_DATABASE_URL` apuntan a Neon o `REDIS_URL` apunta a un Redis remoto, `infra:up` no intentara crear esos servicios por Docker; solo comprobara conectividad.

Usalo cuando quieras preparar infraestructura sin arrancar la API.

### `npm start`

Hace esto:

1. asegura archivos `.env`
2. si faltan dependencias y Docker existe, llama `infra:up`
3. si faltan dependencias y Docker no existe, levanta en modo degradado
4. arranca la API en modo desarrollo

`start` no se guia solo por `localhost:5432/6379`: revisa `DIRECT_DATABASE_URL` y `REDIS_URL`, asi que funciona igual con Neon y Redis remoto.
Si Redis arranco degradado y luego vuelve, las rutas de sesiones, MFA, WebAuthn y rate limiting ya intentan recuperar conectividad tambien bajo trafico normal.

### `npm run smoke:test`

Hace esto contra una API ya levantada:

1. valida `GET /api/health/live`
2. valida `GET /api/health/ready`
3. hace login con el admin del `.env`
4. consulta `/api/auth/me`
5. consulta `/api/sessions`
6. crea un customer
7. lista customers
8. consulta un customer por id
9. actualiza el customer
10. crea un pago
11. lista pagos
12. crea una factura ligada al pago
13. lista facturas
14. timbra la factura
15. cancela la factura
16. elimina el customer
17. hace logout

Si el usuario configurado tiene MFA habilitado, el script intenta completar `POST /api/auth/mfa/verify` usando:

- `ADMIN_MFA_TOTP_CODE`
- o `ADMIN_MFA_RECOVERY_CODE`

Si no existe alguno de esos valores, el smoke test falla de forma explicita para evitar una falsa validacion.

El script ya contempla compatibilidad con Windows PowerShell 5.1 para las llamadas HTTP, asi que no depende del motor viejo de Internet Explorer.

El smoke test no automatiza WebAuthn/passkeys porque la ceremonia requiere navegador real, `origin` valido y APIs del browser. Ese tramo ahora se cubre con:

- frontend minimo en `apps/web`
- `Playwright` con autenticador virtual en `tests/e2e/webauthn.spec.ts`

El CRUD de `customers` esta pensado como verificacion util de orquestacion:

- Prisma persiste en PostgreSQL o Neon
- Redis cachea `GET /customers` y `GET /customers/:id`, y el smoke lo hace visible con un segundo hit `database -> cache`
- las mutaciones invalidan cache
- auditoria registra altas, cambios, bajas y denegaciones

### `npm run validate:local`

Hace esto de punta a punta:

1. ejecuta `npm run verify`
2. ejecuta `npm run lint`
3. ejecuta `npm run infra:up`
4. falla si ya hay algo escuchando en `localhost:4000`, salvo que se use `-UseRunningApi`
5. levanta la API compilada si aun no esta arriba y guarda logs de salida
6. espera `health/live.status=ok` y `health/ready.status=ready`
7. corre `npm run smoke:test`

Si el proceso de la API termina antes de responder `health/live` o `health/ready`, el script falla con el `ExitCode` del proceso e imprime logs recientes para acelerar el diagnostico.

Si `validate:local` fue quien arranco la API y algo falla despues, tambien limpia el proceso para no dejar `localhost:4000` ocupado para el siguiente intento.

Es el mejor script para correr despues de cambios importantes.

`npm run validate:full` es un alias de este mismo flujo.

### `npm run dev:web`

Levanta el frontend minimo de navegador en `http://localhost:3000`.

Sirve para validar:

1. login con cookie de sesion
2. registro de passkey
3. login MFA con passkey
4. reautenticacion critica con passkey
5. listado y revocacion de credenciales WebAuthn

El panel ahora:

1. detecta el `origin` del navegador
2. propone la API equivalente en `localhost` o `127.0.0.1`
3. deja botones para fijar rapido `localhost` y `127.0.0.1`
4. deja probar `health/live` y `health/ready`
5. muestra una pista si frontend y API quedaron con hosts mezclados
6. mantiene un feedback visible de exito o error
7. va sugiriendo el siguiente paso del flujo y deshabilita acciones que aun no toca usar
8. mejora estados vacios para recovery codes y credenciales
9. ya no muestra ni precarga credenciales demo en pantalla
10. bloquea la reautenticacion con password cuando la cuenta ya tiene MFA activo
11. deja usar TOTP o recovery code para reautenticacion critica cuando la cuenta no usa passkeys

Puedes abrirlo en:

- `http://localhost:3000`
- `http://127.0.0.1:3000`

Y debes mantener la pareja consistente:

- `localhost -> localhost`
- `127.0.0.1 -> 127.0.0.1`

Si mezclas hosts, la ceremonia WebAuthn y las mutaciones browser-based pueden fallar por `origin`.

### `npm run webauthn:demo`

Levanta de una sola vez el laboratorio local de passkeys:

1. sincroniza `.env` y `apps/api/.env`
2. fuerza una infraestructura local aislada para `PostgreSQL` y `Redis` salvo que se use `-UseCurrentEnvironment`
3. prepara el usuario demo reproducible
4. levanta la API en `:4000` si no estaba ya arriba
5. levanta el frontend en `:3000`
6. valida el frontend con un health check dedicado
7. imprime URLs y rutas de logs sin exponer credenciales demo

Para abrir el navegador al terminar:

```powershell
npm run webauthn:demo:open
```

Para apagar procesos levantados por ese flujo:

```powershell
npm run webauthn:demo:stop
```

Ese comando no intenta matar procesos previos que no haya iniciado el propio laboratorio. Si `:4000` o `:3000` ya estan arriba y sanos, los reutiliza.
Si quieres personalizar el usuario demo, define `WEBAUTHN_DEMO_EMAIL` y `WEBAUTHN_DEMO_PASSWORD` en el proceso local antes de ejecutar el script.

### `npm run seed:webauthn-demo`

Resetea un usuario reproducible para pruebas de passkeys:

- usando `WEBAUTHN_DEMO_EMAIL`
- usando `WEBAUTHN_DEMO_PASSWORD`

Tambien limpia credenciales WebAuthn previas del usuario para que el flujo de registro y login MFA sea repetible.

### `npm run e2e:webauthn`

Corre la prueba browser-based real con `Playwright`:

1. prepara infraestructura local aislada
2. resetea el usuario demo de WebAuthn
3. levanta API y frontend
4. registra passkey con autenticador virtual
5. completa login MFA con passkey
6. ejecuta reautenticacion con passkey
7. lista y revoca la credencial
8. cubre tanto `localhost` como `127.0.0.1` para evitar huecos de loopback/origin

Nota operativa:

- `npm run e2e:webauthn` ahora levanta la infraestructura aislada antes de invocar Playwright
- `globalSetup` ya no intenta arrancar `PostgreSQL` y `Redis`; solo reseedea el usuario demo
- esto evita que el `webServer` de Playwright intente levantar la API antes de que exista la base local

Requisito operativo:

- Docker Desktop debe estar arriba para que `PostgreSQL` y `Redis` locales puedan levantarse durante el setup aislado

Si vas a correrlo por primera vez en una maquina nueva, antes instala Chromium:

### `npm run observability:up`

Levanta un stack local de observabilidad:

1. `Prometheus` en `http://localhost:9090`
2. `Alertmanager` en `http://localhost:9093`
3. scrape contra `http://host.docker.internal:4000/api/metrics` por defecto
4. reglas locales para disponibilidad, error rate, latencia y dependencias

Variables utiles:

- `PROMETHEUS_METRICS_TARGET`
- `PROMETHEUS_METRICS_BEARER_TOKEN`

Ejemplo:

```powershell
$env:PROMETHEUS_METRICS_TARGET='host.docker.internal:4000'
$env:PROMETHEUS_METRICS_BEARER_TOKEN='tu-token-largo'
npm run observability:up
```

Para apagarlo:

```powershell
npm run observability:down
```

```powershell
npm run e2e:install
```

### `npm run verify`

Hace esto:

1. intenta regenerar Prisma Client
2. reintenta bloqueos transitorios del engine de Prisma en Windows
3. si el engine sigue bloqueado y el cliente ya esta fresco, continua
4. ejecuta `build`
5. ejecuta `test`

Si cambiaste `schema.prisma` o migraciones, usa `npm run verify:full` con la API detenida.

`verify` y `infra:up` validan explicitamente el codigo de salida de `npm`, Prisma y Docker Compose. Si algo falla, el script termina en rojo en vez de seguir silenciosamente.

### Cookies de sesion

- en local sobre HTTP usa `COOKIE_NAME=session`
- usa `__Host-session` solo con `COOKIE_SECURE=true` y HTTPS
- la validacion de entorno ya bloquea combinaciones invalidas como `__Host-session` con `COOKIE_SECURE=false`

### `npm run lint`

Corre `ESLint` sobre el backend y typecheck del frontend `apps/web`, y sirve como puerta rapida para errores de mantenibilidad antes del smoke test.

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
npm start
```

### Flujo controlado

```powershell
npm run verify
npm run lint
npm run audit:deps
npm run infra:up
npm run validate:local
```

## Variables clave

### Infraestructura

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `ALLOW_DEGRADED_STARTUP`
- `CSRF_TRUSTED_ORIGINS`
- `SESSION_TOUCH_INTERVAL_SECONDS`
- `AUDIT_FAIL_CLOSED_SUCCESS_ACTION_PREFIXES`
- `AUDIT_FAIL_CLOSED_FAILURE_ACTION_PREFIXES`
- `AUDIT_FAIL_CLOSED_DENIED_ACTION_PREFIXES`

### Admin bootstrap

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `ADMIN_MFA_TOTP_CODE`
- `ADMIN_MFA_RECOVERY_CODE`

### WebAuthn

- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_ORIGINS`
- `WEBAUTHN_TIMEOUT_MS`

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
Las mutaciones con cookie validan `Origin`, `Referer` y `Sec-Fetch-Site` siguiendo el `API_PREFIX` configurado, no una lista fija acoplada a `/api`.

### Auth

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/reauthenticate`
- `POST /api/auth/reauthenticate/mfa`
- `POST /api/auth/mfa/setup`
- `POST /api/auth/mfa/verify`
- `POST /api/auth/mfa/recovery-codes/regenerate`
- `POST /api/auth/mfa/disable`
- `POST /api/auth/mfa/admin/reset`
- `POST /api/auth/webauthn/registration/options`
- `POST /api/auth/webauthn/registration/verify`
- `POST /api/auth/webauthn/authentication/options`
- `POST /api/auth/webauthn/authentication/verify`
- `GET /api/auth/webauthn/credentials`
- `DELETE /api/auth/webauthn/credentials/:credentialId`

`login` y `reauthenticate` ya aplican rate limiting con contadores en `Redis`. Si el umbral configurado se supera, la API responde `429`.
`login` tambien devuelve `availableMfaMethods` para que el cliente sepa si debe pedir TOTP, recovery code o WebAuthn.
Si la cuenta ya tiene MFA activo y necesitas una nueva ventana critica sin passkeys, usa `POST /api/auth/reauthenticate/mfa`.
Ese camino ya queda auditado como `reauthenticate` y no solo como `mfa.verify`.

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

### WebAuthn

No hay ejemplo util con `PowerShell` o `curl` para registrar o verificar passkeys porque la ceremonia depende de APIs del navegador y del `origin`. Para probar WebAuthn:

1. arranca el frontend minimo con `npm run dev:web` o usa `npm run e2e:webauthn`
2. abre el panel en `http://localhost:3000` o `http://127.0.0.1:3000`
3. pulsa `Probar API` y confirma `live=ok` y `ready=ready`
4. si hace falta, usa `Usar localhost` o `Usar 127.0.0.1` para alinear frontend y API
5. inicia sesion
6. reautentica con password
7. registra la passkey
8. haz logout
9. vuelve a login y completa `Completar login con passkey`
10. reautentica con passkey
11. carga y revoca la credencial

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
- cuando la dependencia vuelve, `health/ready` ya intenta reconectar sin requerir reinicio
- auth y sesiones tambien ya pueden disparar la recuperacion de Redis sin esperar a que alguien consulte `health/ready`

## Troubleshooting

Si quieres una lista mas concentrada de errores comunes y respuestas rapidas, consulta tambien:

- [technical-faq.md](./technical-faq.md)

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

### `No active WebAuthn registration challenge found` o error de origen WebAuthn

- revisa que el frontend este corriendo en un origen incluido en `WEBAUTHN_ORIGINS`
- revisa `WEBAUTHN_RP_ID`
- completa la ceremonia sin recargar o perder la sesion/challenge en Redis
- recuerda que la challenge expira segun `WEBAUTHN_TIMEOUT_MS`

### `Audit persistence unavailable`

- la ruta intento ejecutar una operacion con auditoria duradera y PostgreSQL no estaba disponible
- revisa `health/ready` y la conectividad de la base
- si usas Neon, deja `DATABASE_URL` con la URL pooled y `DIRECT_DATABASE_URL` con la URL directa para migraciones
