# Runbook: Deployment And Migrations

Fecha de referencia: 2026-03-16

## Objetivo

Desplegar sin perder control sobre migraciones, dependencias ni validacion funcional basica.

## Preflight

Antes de tocar produccion:

1. `npm run verify`
2. `npm run lint`
3. `npm run audit:deps`
4. validar migraciones en staging
5. confirmar backup reciente de base de datos
6. confirmar secretos y variables por environment

Checklist complementaria:

- [release-checklist.md](../release-checklist.md)

## Secuencia recomendada

1. correr `Quality Gate`
2. aplicar `Controlled Migrations`
3. desplegar la nueva version de la API
4. correr smoke tests post-deploy
5. revisar `health/live` y `health/ready`
6. revisar logs y auditoria de los primeros minutos

## Modo manual

Si necesitas ejecutar migraciones manualmente:

```powershell
npm run prisma:migrate:controlled
```

Ese comando:

1. valida `DATABASE_URL`
2. ejecuta `prisma generate`
3. ejecuta `prisma migrate status`
4. ejecuta `prisma migrate deploy`

## Rollback

La aplicacion ya no debe recibir trafico nuevo si:

- `health/ready` queda en `503`
- smoke tests fallan
- login, pagos o timbrado quedan rotos

Acciones:

1. revertir despliegue de aplicacion
2. evaluar si la migracion requiere forward-fix en vez de rollback
3. contener integraciones externas si hay riesgo financiero o fiscal
4. abrir incidente formal

## Regla importante

No ejecutes migraciones y despliegues en paralelo sobre el mismo environment.
