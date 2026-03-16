# Plataforma segura de cobro bancario y timbrado

Base inicial para una plataforma con autenticacion robusta, sesiones stateful revocables, cobros bancarios y timbrado de facturas sobre `NestJS + PostgreSQL + Redis`.

## Para que sirve

Este repositorio sirve como base de una plataforma financiera con foco en seguridad operativa. El objetivo es cubrir, desde backend, estos frentes:

- autenticacion segura con sesiones server-side
- MFA con TOTP y recovery codes
- revocacion inmediata de sesiones
- registro y consulta de cobros bancarios
- creacion, timbrado y cancelacion de facturas
- auditoria durable de eventos sensibles

No es solo un demo de endpoints. La idea del proyecto es arrancar con una base seria, auditable y endurecible, para poder evolucionarla hacia un entorno productivo real sin rehacer toda la arquitectura.

## Como esta compuesto

La solucion actual esta organizada como un monolito modular con limites de dominio claros:

- `auth`: login, logout, MFA, reautenticacion
- `sessions`: sesiones stateful en Redis, revocacion, rotacion
- `payments`: cobros y su auditoria
- `invoices`: facturas, timbrado y cancelacion
- `audit`: registro persistente de eventos

Infraestructura base:

- `NestJS` como API principal
- `PostgreSQL` para persistencia durable
- `Redis` para sesiones y datos efimeros
- integraciones externas previstas para banco y PAC

Vista rapida:

```text
Cliente web
  -> API NestJS
    -> auth
    -> sessions
    -> payments
    -> invoices
    -> audit
      -> PostgreSQL
      -> Redis
      -> PAC / banco
```

## Enfoque de arquitectura

El repositorio arranca como un monolito modular. Esto permite avanzar rapido sin perder limites claros entre dominios:

- `auth`
- `sessions`
- `payments`
- `invoices`
- `audit`

La idea es extraer servicios despues, cuando el volumen operativo o los requisitos de aislamiento lo justifiquen. Mientras tanto, el backend actual actua como API principal y como primer "gateway" de negocio.

## Estructura

```text
.
|-- apps/
|   `-- api/
|       |-- prisma/
|       |-- src/
|       `-- package.json
|-- docs/
|   |-- api-surface.md
|   |-- architecture.md
|   |-- development-roadmap.md
|   `-- security-baseline.md
|-- .env.example
`-- docker-compose.yml
```

## Estado actual

Este primer corte deja:

- infraestructura local con `PostgreSQL` y `Redis`
- `migration-runner` para aplicar Prisma en entorno contenedorizado
- esqueleto de `NestJS` con modulos y endpoints base
- sesiones persistidas en `Redis` con revocacion inmediata
- login real contra `PostgreSQL` con `Argon2` y auditoria persistida
- MFA TOTP con setup, verificacion, recovery codes, disable y reset administrativo
- `payments` con persistencia transaccional y auditoria durable en Prisma
- `invoices` con `DRAFT`, `STAMPED` y `CANCELLED`, mas proveedor PAC configurable (`mock` o `custom-http`)
- configuracion de cookies seguras y validacion estricta de entorno
- modo degradado de arranque con fallos claros a `503` cuando faltan dependencias
- guia de seguridad, roadmap y contrato inicial de API

Pendiente para el siguiente ciclo:

- integrar un proveedor PAC concreto con mapeo CFDI real de produccion
- agregar WebAuthn/passkeys para cuentas criticas
- ampliar pruebas end-to-end contra infraestructura real

## Que revisar primero si eres nuevo en el repo

Si alguien toma este proyecto por primera vez, este es el orden recomendado:

1. leer este `README`
2. revisar `docs/architecture.md`
3. revisar `docs/security-baseline.md`
4. revisar `docs/local-runbook.md`
5. revisar `docs/code-audit.md`
6. revisar `docs/production-readiness.md`

## Como funciona hoy

### Autenticacion y sesiones

- `POST /api/auth/login` valida email y password contra `PostgreSQL`.
- si el usuario no tiene MFA, el login deja una sesion ya reautenticada por una ventana corta.
- si el usuario tiene MFA, la sesion queda marcada como pendiente y solo puede completar `logout` o `mfa/verify`.
- las sesiones viven en `Redis` y se pueden listar o revocar desde `/api/sessions`.

### Reautenticacion

- operaciones sensibles como crear pagos, emitir facturas, timbrar o cancelar requieren reautenticacion reciente.
- para cuentas sin MFA, la reautenticacion usa password.
- para cuentas con MFA, se usa `POST /api/auth/mfa/verify`.

### MFA

- el flujo actual soporta `setup` de TOTP, verificacion con codigo, recovery codes, regeneracion, disable voluntario y reset administrativo.
- existe throttling especifico y lockout temporal para intentos TOTP, recovery code y enrolamiento pendiente.
- cuando se habilita MFA por primera vez, el backend devuelve los recovery codes una sola vez y guarda solo sus hashes.

### Pagos

- `POST /api/payments` crea pagos en estado `PENDING`.
- la creacion corre dentro de transaccion con auditoria durable.
- el listado usa permisos por rol.

### Facturas

- `POST /api/invoices` crea facturas en `DRAFT`.
- `POST /api/invoices/stamp` intenta timbrarlas a traves de un PAC configurable.
- `POST /api/invoices/cancel` cancela localmente o via PAC si ya estaban timbradas.
- el proveedor PAC actual puede ser `mock` para desarrollo o `custom-http` para integrar un vendor real.

### Modo degradado

- si no hay `PostgreSQL` o `Redis` y tampoco hay Docker, `npm start` levanta la API en modo degradado.
- en ese estado, `health/live` responde y `health/ready` debe fallar.
- cualquier endpoint que dependa de Prisma o Redis real respondera `503` o fallara de forma controlada.

## Uso local

1. Copia `.env.example` a `.env` y ajusta secretos y conexiones.
2. Instala dependencias.
3. Levanta `PostgreSQL` y `Redis`.
4. Ejecuta migraciones y luego inicia la API.

En PowerShell con politica restrictiva, usa `npm.cmd` en lugar de `npm`.

Ejemplo:

```powershell
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run build
```

Bootstrap de usuario administrador:

```powershell
npm.cmd run seed:admin
```

Arranque local asistido:

```powershell
npm.cmd start
```

Ese script:

- verifica `.env`
- intenta levantar `PostgreSQL` y `Redis` con Docker si existe
- aplica migraciones
- ejecuta `seed:admin`
- inicia la API
- si no encuentra base de datos ni Redis y tampoco hay Docker, arranca la API en modo degradado para desarrollo

Verificacion automatizada:

```powershell
npm.cmd run verify
```

Esto ejecuta:

- `prisma:generate`
- `build`
- `test`

Notas sobre `verify`:

- si detecta una API escuchando en `localhost:4000`, intenta regenerar Prisma igual
- si Prisma falla por bloqueo del engine, y el cliente generado ya esta al dia con `schema.prisma`, continua con `build` y `test`
- si cambiaste `schema.prisma`, migraciones o el cliente no esta fresco, debes detener la API y ejecutar `npm.cmd run verify:full`

Variables nuevas relevantes:

- `PAC_PROVIDER`
- `PAC_BASE_URL`
- `PAC_API_KEY`
- `PAC_TIMEOUT_MS`
- `PAC_ALLOW_MOCK_IN_PRODUCTION`
- `MFA_VERIFY_MAX_ATTEMPTS`
- `MFA_VERIFY_WINDOW_MINUTES`
- `MFA_VERIFY_LOCKOUT_MINUTES`
- `AUDIT_FAIL_CLOSED_DEFAULT`
- `AUDIT_FAIL_CLOSED_ACTION_PREFIXES`

## Scripts recomendados

```powershell
npm.cmd run infra:up
npm.cmd run infra:down
npm.cmd run smoke:test
npm.cmd run validate:local
```

- `infra:up`: levanta `PostgreSQL` y `Redis`, aplica migraciones y ejecuta `seed:admin`.
- `infra:down`: detiene los servicios locales del stack.
- `smoke:test`: prueba los endpoints principales contra una API ya levantada.
- `validate:local`: ejecuta `verify`, prepara infraestructura, levanta la API y corre smoke tests.
- `verify:full`: fuerza `prisma generate` sin atajos; usalo si cambiaste el schema o migraciones.
- los scripts PowerShell ya son compatibles con Windows PowerShell 5.1 y PowerShell 7 para las llamadas HTTP del smoke test

Si el usuario usado por `smoke:test` tiene MFA habilitado:

- exporta `ADMIN_MFA_TOTP_CODE` con un codigo TOTP vigente antes de correr el script
- o exporta `ADMIN_MFA_RECOVERY_CODE` si quieres validar con un recovery code de un solo uso
- si usas recovery code, luego debes regenerarlo para la siguiente corrida automatizada

## Flujo recomendado despues de cambios importantes

1. `npm.cmd run verify`
2. `npm.cmd run infra:up`
3. `npm.cmd run validate:local`

Detalles operativos importantes:

- `verify` ahora falla con mensaje claro si Prisma, build o test regresan codigo distinto de cero
- `validate:local` falla temprano si `verify` falla, si la API ya esta ocupando `localhost:4000` sin `-UseRunningApi`, o si el proceso de la API termina antes de quedar listo
- el contenedor Docker de la API ya arranca la build compilada con `node dist/main.js`, no el watch mode
- el arranque local en desarrollo ya no depende de `@nestjs/cli`; usa `tsc` para build y `ts-node` para desarrollo

Si ya tienes la API arriba en otra terminal, puedes usar:

```powershell
npm.cmd run smoke:test
```

Si quieres validar explicitamente contra una API ya levantada, usa:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-local.ps1 -UseRunningApi
```

Con Docker Compose, el flujo esperado es:

```powershell
docker compose up --build postgres redis migration-runner
docker compose up --build api
```

## Camino a productivo

Para llevar esta base a produccion de forma responsable, la ruta sugerida es esta:

1. cerrar integraciones reales
   - conectar banco o pasarela real para `payments`
   - integrar un PAC real para `invoices`
   - firmar y validar callbacks/webhooks
2. endurecer seguridad
   - obligar `COOKIE_SECURE=true`
   - usar `HTTPS` extremo a extremo
   - mover secretos a un secret manager
   - habilitar rate limiting y anti-automation por endpoint
   - agregar CSRF si el frontend opera con cookies de sesion en navegador
3. endurecer infraestructura
   - usar `PostgreSQL` y `Redis` administrados o altamente disponibles
   - sacar `Redis` y `PostgreSQL` de exposicion publica
   - poner la API detras de reverse proxy o load balancer
   - configurar backups, rotacion de logs y monitoreo
4. endurecer operacion
   - definir pipeline CI/CD con `verify`, lint, tests y smoke tests
   - aplicar migraciones en deploy de forma controlada
   - instrumentar health checks, alertas y observabilidad
   - definir runbooks de incidente, revocacion y rotacion de secretos
5. validar cumplimiento funcional
   - pruebas end-to-end con infraestructura real
   - pruebas de reautenticacion y MFA
   - pruebas de timeout, revocacion de sesiones y recuperacion operativa

La guia detallada esta en `docs/production-readiness.md`.

## Como revisar la auditoria

La auditoria viva del estado actual esta en `docs/code-audit.md`. La forma correcta de usarla es:

1. leer primero los hallazgos actuales
2. confirmar si cada hallazgo sigue vigente en codigo
3. decidir si el riesgo es de seguridad, operacion, producto o mantenibilidad
4. convertir cada riesgo en una accion concreta con owner y prioridad
5. volver a correr `npm.cmd run verify` y `npm.cmd run validate:local` despues de cada correccion importante

Cuando encuentres un problema, intenta cerrarlo asi:

1. reproducirlo
2. corregirlo
3. agregar o ajustar prueba automatizada si aplica
4. actualizar `README` y `docs/code-audit.md`
5. dejar evidencia del resultado en la PR o en el historial del cambio

## Como hacerlo mas robusto y escalable

Las mejoras de mayor retorno hoy son:

1. robustez de seguridad
   - throttling especifico para MFA y login
   - WebAuthn/passkeys
   - politica mas amplia de auditoria fail-closed
2. robustez operativa
   - jobs asincronos para timbrado y callbacks
   - retries con backoff y circuit breakers para PAC/banco
   - monitoreo y alertas por errores de integracion
3. escalabilidad
   - separar `payments` e `invoices` cuando haya carga o requerimientos regulatorios
   - introducir colas para procesos de larga duracion
   - aislar workloads de lectura, escritura y auditoria
4. mantenibilidad
   - pruebas end-to-end
   - contratos de integracion por proveedor
   - estandarizar DTOs de error y telemetria

En corto: hoy la base ya sirve para construir sobre ella, pero para produccion seria todavia hay que cerrar integraciones reales, endurecer controles y profesionalizar despliegue/observabilidad.

## Documentacion

- `docs/architecture.md`: arquitectura objetivo y estrategia de evolucion
- `docs/security-baseline.md`: controles de seguridad obligatorios y recomendados
- `docs/development-roadmap.md`: fases de construccion y criterios de salida
- `docs/api-surface.md`: endpoints iniciales y requisitos de proteccion
- `docs/local-runbook.md`: como levantar, validar y probar la plataforma localmente
- `docs/code-audit.md`: hallazgos actuales, mejoras aplicadas y riesgos pendientes
- `docs/production-readiness.md`: pasos para endurecer, desplegar y operar la plataforma en produccion
