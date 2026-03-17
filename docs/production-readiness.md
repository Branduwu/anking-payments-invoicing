# Production Readiness

Fecha de referencia: 2026-03-16

## Objetivo

Describir que falta para llevar esta base a una operacion productiva real, como revisar riesgos y como convertirlos en trabajo ejecutable.

## Que ya existe

La plataforma ya tiene:

- API modular en `NestJS`
- persistencia durable en `PostgreSQL`
- sesiones stateful en `Redis`
- MFA TOTP y WebAuthn/passkeys con recovery codes, disable, reset y lockout
- pagos persistidos con auditoria
- facturas con timbrado abstracto
- auditoria fail-closed configurable por tipo de resultado
- health checks con detalle por dependencia
- request logging estructurado
- CI con verify, lint, audit y smoke tests
- workflow de release con migraciones controladas
- runbooks operativos

## Que sigue faltando

Lo mas importante para productivo real:

- banco o pasarela real
- PAC real vendor-specific
- cierre de frontend/browser y rollout real de WebAuthn/passkeys
- backend real de observabilidad
- destino final de despliegue automatizado
- estrategia HA/DR formal

## Ruta recomendada

### 1. Infraestructura

- `PostgreSQL` administrado con backups y PITR
- `Redis` administrado o altamente disponible
- reverse proxy o load balancer con `TLS`
- red privada y reglas de firewall
- secret manager

### 2. Seguridad

- `NODE_ENV=production`
- `COOKIE_SECURE=true`
- `CORS_ORIGIN` restringido
- secretos fuera del repo
- rotacion planeada de secretos
- anti-automation y rate limiting
- hacer obligatorio WebAuthn para cuentas criticas donde aplique y validar su UX/browser de punta a punta

### 3. Integraciones reales

Para pagos:

- definir idempotencia
- retries y conciliacion
- callbacks o webhooks auditados

Para facturacion:

- elegir PAC
- mapear CFDI real
- cubrir errores de negocio, timeout y cancelacion

### 4. Operacion

- usar `ci.yml` en PR y ramas protegidas
- usar `deploy.yml` con `GitHub Environments`
- conectar logs y metricas a un backend real
- montar alertas sobre `health/ready`, `5xx`, PAC y MFA
- usar los runbooks de `docs/runbooks`

### 5. Validacion final

- smoke tests post-deploy
- pruebas de reautenticacion y MFA
- pruebas de revocacion de sesiones
- pruebas de degradacion y recuperacion
- ensayo de restauracion y rotacion de secretos

## Como revisar la auditoria

La referencia viva sigue siendo `docs/code-audit.md`.

Proceso recomendado:

1. clasificar el hallazgo
2. medir severidad
3. ubicar evidencia en codigo
4. decidir si el fix es tecnico, operativo o documental
5. aplicar fix
6. correr `verify`, `lint` y smoke
7. actualizar documentacion

## Documentos de apoyo

- `docs/ci-cd.md`
- `docs/observability.md`
- `docs/runbooks/incident-response.md`
- `docs/runbooks/session-revocation.md`
- `docs/runbooks/secret-rotation.md`
- `docs/runbooks/deployment-and-migrations.md`

## Regla de trabajo

Cada cambio importante debe cerrar con:

1. actualizacion de `README.md`
2. actualizacion de `docs/code-audit.md` si cambia el riesgo
3. `npm run verify`
4. `npm run lint`
5. `npm run validate:local` cuando haya infraestructura disponible
