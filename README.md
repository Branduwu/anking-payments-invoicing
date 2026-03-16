# anking-payments-invoicing

Base de una plataforma segura para autenticacion, sesiones stateful, cobros bancarios y timbrado de facturas con `NestJS + PostgreSQL + Redis`.

## Que es este proyecto

Este repositorio prepara una base seria para una plataforma financiera con foco en:

- autenticacion robusta
- MFA con TOTP y recovery codes
- sesiones revocables de inmediato
- pagos persistidos con auditoria
- facturacion con creacion, timbrado y cancelacion
- salud operativa, validacion local y endurecimiento progresivo

No esta pensado como demo desechable. La meta es tener un backend que pueda crecer hacia productivo sin rehacer seguridad, sesiones, auditoria y operacion desde cero.

## Para que sirve

Sirve para construir una plataforma que permita:

- login seguro con `Argon2`
- manejo de sesiones server-side en `Redis`
- reautenticacion para operaciones criticas
- MFA TOTP con lockout y recovery codes
- rate limiting en `login` y `reauthenticate` por usuario/correo e IP en `Redis`
- cobros bancarios persistidos en `PostgreSQL`
- facturas con flujo `DRAFT -> STAMPED -> CANCELLED`
- auditoria durable de eventos sensibles

## Como esta compuesto

La solucion actual es un monolito modular con limites de dominio claros:

- `auth`
- `sessions`
- `payments`
- `invoices`
- `audit`
- `health`

Infraestructura:

- `NestJS` como API
- `PostgreSQL` para datos durables y auditoria
- `Redis` para sesiones y datos efimeros
- PAC configurable via `mock` o `custom-http`
- integracion bancaria prevista para una fase posterior

Vista rapida:

```text
Cliente
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

## Estructura del repo

```text
.
|-- .github/
|   |-- dependabot.yml
|   `-- workflows/
|       |-- ci.yml
|       `-- deploy.yml
|-- apps/
|   `-- api/
|       |-- prisma/
|       |-- src/
|       |-- eslint.config.mjs
|       `-- package.json
|-- docs/
|   |-- api-surface.md
|   |-- architecture.md
|   |-- ci-cd.md
|   |-- code-audit.md
|   |-- implementation-status.md
|   |-- local-runbook.md
|   |-- observability.md
|   |-- production-readiness.md
|   |-- runbooks/
|   `-- security-baseline.md
|-- scripts/
|   |-- deploy-migrations.ps1
|   |-- smoke-test.ps1
|   |-- start-infra.ps1
|   |-- start-local.ps1
|   |-- stop-infra.ps1
|   |-- validate-local.ps1
|   `-- verify.ps1
|-- .env.example
`-- docker-compose.yml
```

## Estado actual

La base actual ya deja:

- login real contra `PostgreSQL`
- sesiones persistidas en `Redis` con revocacion inmediata
- MFA TOTP con setup, verify, recovery codes, disable y admin reset
- rate limiting de autenticacion en `Redis` para `login` y `reauthenticate`
- throttling y lockout temporal para MFA
- pagos persistidos con auditoria durable
- facturas con creacion, timbrado y cancelacion
- PAC configurable y protegido para no usar `mock` por accidente en produccion
- politica de auditoria fail-closed ampliada para mutaciones sensibles y fallos/denegaciones de seguridad
- health checks con detalle por dependencia
- request logging estructurado para operacion
- modo degradado controlado cuando faltan dependencias
- lint, build, tests, verify y smoke tests
- workflows listos para CI y release controlado
- runbooks de incidente, revocacion y rotacion de secretos

La foto detallada de que ya esta implementado, por fase y por modulo, vive en:

- `docs/implementation-status.md`

## Riesgos que siguen abiertos

Los huecos importantes que todavia quedan:

- falta un PAC vendor-specific real para CFDI productivo
- falta WebAuthn/passkeys
- la auditoria fail-closed ya cubre mas casos sensibles, pero aun no abarca absolutamente todos los eventos
- la observabilidad actual ya tiene health y logs estructurados, pero aun no esta conectada a un backend real de metricas o alertas
- el despliegue productivo final sigue pendiente del destino real que elijas

## Como funciona hoy

### Auth y sesiones

- `POST /api/auth/login` valida email y password contra `PostgreSQL`
- si el usuario tiene MFA, la sesion queda en estado pendiente hasta `POST /api/auth/mfa/verify`
- `login` y `reauthenticate` aplican rate limiting por correo/usuario e IP usando `Redis`
- las sesiones viven en `Redis`
- `GET /api/sessions` lista sesiones activas
- `DELETE /api/sessions/{id}` y `DELETE /api/sessions/all` permiten revocacion inmediata

### MFA

El modulo actual soporta:

- setup de TOTP
- verificacion con TOTP
- recovery codes
- regeneracion de recovery codes
- disable voluntario
- reset administrativo
- throttling y lockout por intentos fallidos

### Pagos

- `POST /api/payments` crea pagos en `PENDING`
- la escritura y auditoria ocurren de forma transaccional
- `GET /api/payments` lista pagos segun permisos del usuario

### Facturas

- `POST /api/invoices` crea facturas en `DRAFT`
- `POST /api/invoices/stamp` timbra via PAC
- `POST /api/invoices/cancel` cancela localmente o via PAC
- `GET /api/invoices` lista facturas

### Health y observabilidad

- `GET /api/health/live` indica que el proceso esta arriba
- `GET /api/health/ready` valida `PostgreSQL` y `Redis`
- si una dependencia falla, `ready` devuelve `503` con detalle por dependencia
- los `503` operativos controlados se registran como `warn`, mientras que los `500` inesperados quedan en `error`
- las requests ya generan logs estructurados con `requestId`, `statusCode`, `durationMs`, `ipAddress` y `userId`

### Auditoria

- `SUCCESS`, `FAILURE` y `DENIED` ya pueden endurecerse por prefijos separados
- pagos, sesiones y facturas sensibles ya operan con rutas endurecidas
- fallos y denegaciones de autenticacion ya pueden forzar cierre cuando la persistencia de auditoria no esta disponible
- los eventos `auth.login.rate_limited` y `auth.reauthenticate.rate_limited` quedan auditados como `DENIED`

## Como usarlo localmente

### 1. Preparar variables

```powershell
Copy-Item .env.example .env
```

Ajusta al menos:

- `COOKIE_SECRET`
- `MFA_ENCRYPTION_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### 2. Instalar dependencias

```powershell
npm.cmd install
```

### 3. Levantar infraestructura

Con Docker:

```powershell
npm.cmd run infra:up
```

Sin Docker, levanta manualmente:

- `PostgreSQL` en `localhost:5432`
- `Redis` en `localhost:6379`

### 4. Migrar y seedear

```powershell
npm.cmd run prisma:migrate:deploy
npm.cmd run seed:admin
```

### 5. Arrancar la API

```powershell
npm.cmd start
```

Si no existen dependencias y `ALLOW_DEGRADED_STARTUP=true`, la API puede levantar en modo degradado para pruebas de arranque.

## Scripts principales

```powershell
npm.cmd run verify
npm.cmd run lint
npm.cmd run test
npm.cmd run audit:deps
npm.cmd run infra:up
npm.cmd run infra:down
npm.cmd run smoke:test
npm.cmd run validate:local
npm.cmd run prisma:migrate:controlled
```

Que hace cada uno:

- `verify`: Prisma generate, build y unit tests
- `lint`: validacion estatica con ESLint
- `audit:deps`: revisa vulnerabilidades de dependencias
- `infra:up`: levanta `PostgreSQL` y `Redis`, corre migraciones y seed
- `smoke:test`: valida endpoints principales contra una API ya levantada
- `validate:local`: `verify` + infraestructura + arranque + smoke tests
- `prisma:migrate:controlled`: corre `generate`, `migrate status` y `migrate deploy` de forma controlada

## Flujo recomendado despues de cambios importantes

Cada vez que cambies logica de dominio, seguridad, infraestructura o contratos:

1. `npm.cmd run verify`
2. `npm.cmd run lint`
3. `npm.cmd run validate:local`
4. revisar `docs/code-audit.md`
5. actualizar este `README` y la documentacion afectada

## CI/CD preparado para repo

Cuando subas esto a GitHub ya tendras base de pipeline:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/dependabot.yml`

### CI

`ci.yml` corre:

- `verify`
- `lint`
- `audit:deps`
- smoke tests con `PostgreSQL` y `Redis` reales en GitHub Actions

### Controlled Release

`deploy.yml` deja:

- quality gate
- migraciones controladas con `GitHub Environments`
- smoke tests post-deploy

Todavia debes insertar el paso real de despliegue segun el hosting que elijas.

Detalles completos:

- `docs/ci-cd.md`
- `docs/runbooks/deployment-and-migrations.md`

## Como revisar la auditoria

La auditoria viva del proyecto esta en `docs/code-audit.md`.

Usala asi:

1. toma un hallazgo
2. confirma si sigue vigente en codigo
3. decide severidad y alcance
4. corrige el problema
5. agrega o ajusta pruebas
6. corre `verify`, `lint` y `validate:local`
7. actualiza documentacion

## Observabilidad y operacion

Los documentos operativos clave ahora son:

- `docs/observability.md`
- `docs/runbooks/incident-response.md`
- `docs/runbooks/session-revocation.md`
- `docs/runbooks/secret-rotation.md`
- `docs/runbooks/deployment-and-migrations.md`

Con eso ya queda definida una base minima para:

- health checks
- alertas sugeridas
- lectura de logs
- respuesta a incidentes
- revocacion operativa
- rotacion de secretos
- despliegues con migraciones controladas

## Como llevarlo a productivo

Ruta recomendada:

1. elegir banco o pasarela real para `payments`
2. elegir e integrar un PAC real para `invoices`
3. mover secretos a un secret manager
4. usar `PostgreSQL` y `Redis` administrados o altamente disponibles
5. poner la API detras de `TLS` y balanceador
6. conectar logs y metricas a una plataforma de observabilidad real
7. usar el workflow de release con environments protegidos
8. ensayar incidentes, revocacion y rotacion con los runbooks

Mas detalle en:

- `docs/production-readiness.md`

## Nombre de repo sugerido

Si vas a crear el repo remoto desde cero, el nombre recomendado para mantener consistencia con el codigo actual es:

```text
anking-payments-invoicing
```

## Documentacion disponible

- `docs/architecture.md`
- `docs/security-baseline.md`
- `docs/development-roadmap.md`
- `docs/implementation-status.md`
- `docs/api-surface.md`
- `docs/local-runbook.md`
- `docs/ci-cd.md`
- `docs/observability.md`
- `docs/code-audit.md`
- `docs/production-readiness.md`
- `docs/runbooks/*.md`
