# Checklist de Release y Pre-Produccion

Fecha de referencia: 2026-03-16

## Objetivo

Esta checklist sirve para decidir si un cambio esta listo para:

- subirlo a remoto
- mergearlo
- desplegarlo
- exponerlo a un ambiente mas sensible

No reemplaza `ci-cd.md` ni los runbooks. Esta lista funciona como filtro operativo de `go / no-go`.

## Como usar esta checklist

Regla simple:

- si un punto critico queda en rojo, no avances a release
- si un punto no aplica, dejalo explicitamente marcado como `N/A`
- si algo falla, documenta el riesgo o corrige antes de seguir

## 1. Quality gate local

Marca cada punto:

- [ ] `npm.cmd run verify` paso
- [ ] `npm.cmd run lint` paso
- [ ] `npm.cmd run audit:deps` paso
- [ ] `npm.cmd run validate:local` paso o existe evidencia reciente equivalente
- [ ] no hay errores nuevos en los logs de arranque
- [ ] los cambios sensibles tienen pruebas nuevas o ajustadas

Notas:

- si cambiaste `schema.prisma`, migraciones o auth/sesiones, `validate:local` no se debe saltar
- si `verify` falla por `EPERM` en Windows, primero detiene watchers y repite

## 2. Cambios de base de datos

- [ ] el cambio de esquema esta versionado en `apps/api/prisma/migrations`
- [ ] `prisma migrate status` esta sano
- [ ] la migracion fue validada sobre el ambiente correcto
- [ ] `DATABASE_URL` y `DIRECT_DATABASE_URL` estan correctas para el entorno
- [ ] si usas Neon, `DATABASE_URL` es pooled y `DIRECT_DATABASE_URL` es direct
- [ ] existe plan de rollback o forward-fix para la migracion
- [ ] hay backup reciente o posibilidad clara de restauracion

## 3. Auth, sesiones y seguridad

- [ ] login sigue funcionando
- [ ] logout sigue funcionando
- [ ] revocacion de sesiones sigue funcionando
- [ ] reautenticacion sigue funcionando
- [ ] MFA no quedo roto por el cambio
- [ ] si el cambio toca WebAuthn, se valido tambien desde navegador real o se documento la parte pendiente
- [ ] las rutas protegidas siguen fallando cerrado si Redis no confirma sesion
- [ ] no se agregaron secretos al repo ni a la documentacion
- [ ] el cambio no degrada `COOKIE_SECURE`, `SameSite` o la politica de cookies del ambiente

## 4. Flujos de negocio

### Customers

- [ ] create
- [ ] list
- [ ] get by id
- [ ] update
- [ ] delete

### Payments

- [ ] create
- [ ] list
- [ ] auditoria asociada

### Invoices

- [ ] create
- [ ] list
- [ ] stamp
- [ ] cancel
- [ ] auditoria asociada

Notas:

- si el cambio no toca alguno de estos dominios, igual valida al menos que no haya regresion colateral en smoke

## 5. Redis y estado efimero

- [ ] sesiones activas se crean y validan
- [ ] challenges temporales siguen funcionando
- [ ] cache no introduce datos stale
- [ ] invalidacion de cache sigue funcionando en mutaciones
- [ ] rate limiting sigue funcionando si el cambio toca auth
- [ ] el sistema sigue reaccionando correctamente si Redis no esta disponible

## 6. Observabilidad y operacion

- [ ] `GET /api/health/live` responde `ok`
- [ ] `GET /api/health/ready` responde `ready`
- [ ] errores controlados siguen logueando como `warn` cuando aplica
- [ ] errores inesperados siguen logueando como `error`
- [ ] no aparecieron logs nuevos ruidosos o spam repetitivo
- [ ] auditoria durable sigue registrando los eventos sensibles del cambio

## 7. CI/CD y release

- [ ] `ci.yml` sigue cubriendo el cambio
- [ ] si el cambio toca base o smoke, el workflow fue ajustado si hacia falta
- [ ] si el cambio toca despliegue, `deploy.yml` y runbooks quedaron alineados
- [ ] los secretos y variables del environment existen en GitHub Actions o en el destino real
- [ ] el release no depende de pasos manuales no documentados

## 8. Documentacion

- [ ] `README.md` fue actualizado si cambia comportamiento visible
- [ ] la documentacion especifica afectada fue actualizada
- [ ] `docs/code-audit.md` fue actualizado si cambia el riesgo
- [ ] `docs/api-surface.md` fue actualizado si cambian endpoints o contratos
- [ ] diagramas o onboarding fueron actualizados si cambia el flujo importante

## 9. Checklist minima antes de push

Usa esta lista corta cuando aun no vas a desplegar, pero si vas a subir cambios sensibles:

- [ ] `verify`
- [ ] `lint`
- [ ] `validate:local`
- [ ] docs actualizadas
- [ ] sin secretos expuestos
- [ ] cambios entendibles y coherentes con el roadmap

## 10. Checklist minima antes de deploy

- [ ] quality gate verde
- [ ] migraciones revisadas
- [ ] backup/restore confirmados
- [ ] secretos del ambiente revisados
- [ ] smoke tests del ambiente preparados
- [ ] runbook de despliegue a mano
- [ ] criterio claro de rollback o contencion

## Criterio de no-go

No despliegues si ocurre cualquiera de estos:

- `health/ready` queda en `503`
- login o sesiones fallan
- reautenticacion falla
- pagos o facturas quedan rotos
- auditoria durable falla en una ruta que debe operar fail-closed
- la migracion no fue validada
- falta una variable critica del ambiente
- se detecto una exposicion de secretos

## Documentos complementarios

- [ci-cd.md](./ci-cd.md)
- [production-readiness.md](./production-readiness.md)
- [runbooks/deployment-and-migrations.md](./runbooks/deployment-and-migrations.md)
- [observability.md](./observability.md)
- [code-audit.md](./code-audit.md)
- [../.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)
