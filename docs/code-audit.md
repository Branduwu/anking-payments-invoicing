# Auditoria de codigo

Fecha de referencia: 2026-03-16

## Hallazgos actuales

### 1. El PAC productivo todavia no esta integrado

Archivos:

- `apps/api/src/modules/invoices/pac.service.ts`
- `apps/api/src/modules/invoices/invoices.service.ts`

Estado:

- el flujo de timbrado ya existe
- el proveedor `mock` ya no puede usarse en produccion por accidente
- `custom-http` ya permite adaptador externo
- aun falta el adaptador vendor-specific real con mapeo CFDI completo

Impacto:

- la arquitectura ya soporta timbrado
- aun no esta lista para fiscal real de produccion

### 2. MFA ya es operativo, pero aun no llega a su postura maxima

Archivos:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/mfa.service.ts`

Estado:

- TOTP, recovery codes, disable y admin reset ya existen
- ya hay throttling y lockout
- `login` y `reauthenticate` ya tienen rate limiting en `Redis` por correo/usuario e IP
- aun falta WebAuthn/passkeys

Impacto:

- seguridad operativa buena
- seguridad de autenticacion aun no es la maxima posible para cuentas criticas

### 3. La auditoria durable mejoro, pero sigue sin ser fail-closed para todo el universo de eventos

Archivos:

- `apps/api/src/modules/audit/audit.service.ts`
- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/invoices/invoices.service.ts`

Estado:

- sesiones, pagos y facturas sensibles ya endurecieron sus rutas criticas
- fallos y denegaciones sensibles de `auth` y creacion denegada de `payments` ya pueden endurecerse por prefijos separados
- aun hay eventos no criticos que siguen en best effort

Impacto:

- las mutaciones de mayor riesgo estan mucho mejor protegidas
- la postura de auditoria ya es mas consistente para rutas de seguridad, pero aun no es uniforme para todos los eventos

### 4. La base operativa ya existe, pero falta conectarla a observabilidad productiva real

Archivos:

- `apps/api/src/modules/health/health.controller.ts`
- `apps/api/src/modules/health/health.service.ts`
- `apps/api/src/common/interceptors/request-logging.interceptor.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

Estado:

- ya hay `health/live` y `health/ready` con detalle por dependencia
- ya hay request logs estructurados
- ya existe CI y workflow de release controlado
- faltan backend real de metricas, alertas y plataforma final de despliegue

Impacto:

- el repo ya no depende de memoria tribal para operar
- aun falta la integracion final con tooling productivo

## Hallazgos resueltos en este ciclo

### 1. Rotacion de sesion ya no expulsa al usuario por un fallo a mitad del refresh

Archivos:

- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/sessions/sessions.service.spec.ts`

Estado:

- `rotateSession` ahora crea primero la sesion de reemplazo
- si la revocacion de la sesion anterior falla, elimina la sesion nueva y propaga el error
- ya existen pruebas para validar el orden y el rollback

Impacto:

- evita logout involuntario por fallos transitorios en Redis o auditoria durante `refresh`

### 2. Disable y admin reset de MFA ya no dejan PostgreSQL y Redis desalineados

Archivos:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`

Estado:

- `disableMfa` y `adminResetMfa` capturan el estado MFA previo
- si la revocacion de sesiones o la actualizacion de la sesion actual fallan, restauran el estado anterior en `PostgreSQL`
- el rollback queda auditado y probado

Impacto:

- evita dejar MFA deshabilitado con sesiones previas todavia activas
- mantiene una postura conservadora de seguridad ante fallos parciales

## Mejoras aplicadas en este ciclo

- se agrego lint real con `eslint.config.mjs`
- se agregaron scripts raiz de `lint`, `audit:deps`, `prisma:migrate:status` y `prisma:migrate:controlled`
- se incorporo `scripts/deploy-migrations.ps1`
- se definio `ci.yml` con verify, lint, audit y smoke tests
- se definio `deploy.yml` con quality gate, migraciones controladas y smoke post-deploy
- se agrego `dependabot.yml`
- `health/live` y `health/ready` ahora reportan metadata y checks por dependencia
- se agrego logging estructurado de requests
- se corrigio la clasificacion de errores controlados para que `503` operativos se registren como `warn` y no como `500` inesperados
- la politica fail-closed de auditoria ahora distingue prefijos por `SUCCESS`, `FAILURE` y `DENIED`
- `payments.create.denied` ya no usa fire-and-forget y respeta fail-closed real
- `RedisService` ahora actualiza mejor su estado de disponibilidad
- se agregaron runbooks de incidente, revocacion, rotacion y despliegue
- se amplio el `README` y la documentacion operativa
- `auth` ahora aplica rate limiting real para `login` y `reauthenticate` con trazabilidad de eventos `rate_limited`
- la rotacion de sesion ahora hace rollback del reemplazo si la revocacion de la sesion anterior falla
- disable y admin reset de MFA ahora restauran el estado anterior si la parte de sesiones no se puede completar

## Dependencias

Estado actual de `npm audit`:

- 0 vulnerabilidades

## Como usar esta auditoria

1. elegir un hallazgo
2. confirmarlo en codigo
3. definir severidad
4. aplicar fix tecnico u operativo
5. agregar pruebas si aplica
6. correr `npm run verify`
7. correr `npm run lint`
8. correr `npm run validate:local`
9. actualizar este archivo y `README.md`

## Recomendacion de siguiente fase

1. elegir e integrar un PAC real
2. agregar WebAuthn/passkeys
3. conectar logs y metricas a observabilidad real
4. endurecer aun mas la politica fail-closed de auditoria
