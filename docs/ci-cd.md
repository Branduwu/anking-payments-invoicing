# CI/CD

Fecha de referencia: 2026-03-16

## Objetivo

Este documento describe el pipeline recomendado para este repositorio y como adaptarlo cuando el proyecto se suba a un repo remoto.

## Flujo definido

La base actual deja dos workflows en `.github/workflows`:

- `ci.yml`: validacion continua en cada push y pull request
- `deploy.yml`: liberacion controlada con migraciones y smoke tests post-deploy

`ci.yml` tambien puede dispararse manualmente con `workflow_dispatch`, lo que sirve para relanzar CI despues de corregir el pipeline o validar el estado de `main` sin crear un commit nuevo.

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
- `smoke` usa `COOKIE_NAME=session` porque el job corre sobre HTTP y un nombre `__Host-*` seria invalido sin `COOKIE_SECURE=true`

### Semantica de `seed:admin`

El script `seed:admin` del workspace `apps/api` ahora se concentra solo en el bootstrap administrativo.

La generacion de Prisma Client ocurre antes, en el flujo de CI o en `verify`/`infra:up`, para evitar regeneraciones redundantes que en Windows pueden chocar con bloqueos transitorios del engine.

Esto protege dos escenarios:

- ejecucion aislada local o en CI despues de `npm ci`
- jobs donde el cliente Prisma aun no ha sido generado para el esquema actual

Con eso se evita que `ts-node` falle al compilar el seed por ausencia de enums o tipos generados como `UserRole` o `UserStatus`, sin volver a introducir un `prisma generate` extra dentro del propio seed.

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

El script `smoke-test.ps1` resuelve credenciales en este orden:

1. parametros explicitos del script
2. variables de entorno del job
3. archivo `.env`

Con eso el mismo script funciona bien en local y en GitHub Actions sin depender de un `.env` presente en el runner.

Tambien se mantiene compatible con:

- Windows PowerShell 5.1
- PowerShell Core (`pwsh`) en Linux, como el runner de GitHub Actions

## Regla operativa

Antes de mergear cambios importantes:

1. `npm run verify`
2. `npm run lint`
3. `npm run validate:local`

`verify` ya reintenta bloqueos transitorios del engine de Prisma en Windows para reducir falsos rojos locales antes de escalar a `verify:full`.

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
