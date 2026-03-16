# CI/CD

Fecha de referencia: 2026-03-16

## Objetivo

Este documento describe el pipeline recomendado para este repositorio y como adaptarlo cuando el proyecto se suba a un repo remoto.

## Flujo definido

La base actual deja dos workflows en `.github/workflows`:

- `ci.yml`: validacion continua en cada push y pull request
- `deploy.yml`: liberacion controlada con migraciones y smoke tests post-deploy

## CI

El workflow `ci.yml` corre en dos etapas:

1. `quality`
   - `npm ci`
   - `npm run verify`
   - `npm run lint`
   - `npm run audit:deps`
2. `smoke`
   - levanta `PostgreSQL` y `Redis` como services de GitHub Actions
   - ejecuta `prisma generate`
   - ejecuta `build`
   - aplica `prisma migrate deploy`
   - ejecuta `seed:admin`
   - arranca la API
   - corre `scripts/smoke-test.ps1` en modo `full`

### Por que esta separado

- `quality` da una puerta rapida para build, Prisma y unit tests
- `smoke` valida el comportamiento contra dependencias reales
- si `quality` falla, no se consumen recursos del job de smoke
- `smoke` genera Prisma de forma explicita para que el seed y la API no dependan del orden externo del pipeline
- `quality` y `smoke` corren en runners distintos, asi que `dist/` no sobrevive entre jobs y debe reconstruirse en `smoke`

### Semantica de `seed:admin`

El script `seed:admin` del workspace `apps/api` ahora ejecuta `prisma generate` antes del bootstrap administrativo.

Esto protege dos escenarios:

- ejecucion aislada local o en CI despues de `npm ci`
- jobs donde el cliente Prisma aun no ha sido generado para el esquema actual

Con eso se evita que `ts-node` falle al compilar el seed por ausencia de enums o tipos generados como `UserRole` o `UserStatus`.

## CD

El workflow `deploy.yml` esta pensado como release controlado, no como despliegue ciego.

Orden actual:

1. `quality-gate`
2. `controlled-migrations`
3. `post-deploy-smoke`

### Control de migraciones

La fase de migraciones:

- usa `GitHub Environments`
- tiene `concurrency` dedicado para evitar migraciones simultaneas
- exige `DEPLOY_DATABASE_URL`
- ejecuta `scripts/deploy-migrations.ps1`

Ese script hace:

1. `prisma generate`
2. `prisma migrate status`
3. `prisma migrate deploy`

### Que falta adaptar

El workflow no incluye aun un rollout vendor-specific de infraestructura porque todavia no definimos destino final.

Debes insertar tu paso de despliegue entre:

- `controlled-migrations`
- `post-deploy-smoke`

Ejemplos:

- despliegue de contenedor a ECS
- rollout a Kubernetes
- release a App Service
- deploy a VM con Docker Compose endurecido

## Secrets recomendados

Para `ci.yml`, el workflow usa valores efimeros definidos inline.

Para `deploy.yml`, define secretos por `environment`:

- `DEPLOY_DATABASE_URL`
- `DEPLOY_BASE_URL`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`
- `SMOKE_ADMIN_MFA_TOTP_CODE` o `SMOKE_ADMIN_MFA_RECOVERY_CODE`

## Regla operativa

Antes de mergear cambios importantes:

1. `npm run verify`
2. `npm run lint`
3. `npm run validate:local`

Antes de desplegar:

1. validar migraciones en staging
2. revisar `docs/code-audit.md`
3. revisar `docs/observability.md`
4. confirmar secretos y accesos
5. ejecutar el workflow `Controlled Release`

## Recomendaciones siguientes

- agregar build y push de imagen firmada
- introducir firmas o attestations de artefactos
- agregar escaneo SAST y secret scanning al pipeline
- integrar despliegue real del target que elijas
