## Resumen

Describe brevemente que cambia y por que.

## Tipo de cambio

- [ ] feature
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] ci/cd
- [ ] seguridad
- [ ] migracion de base de datos

## Modulos o areas afectadas

- [ ] auth
- [ ] sessions
- [ ] customers
- [ ] payments
- [ ] invoices
- [ ] audit
- [ ] health
- [ ] prisma/schema/migrations
- [ ] redis/cache/rate limiting
- [ ] docs
- [ ] workflows

## Contexto de negocio

Explica que problema resuelve este cambio y como respeta la logica del negocio.

## Riesgo del cambio

- [ ] bajo
- [ ] medio
- [ ] alto

Explica brevemente por que.

## Cambio sensible

Marca esto si aplica:

- [ ] toca autenticacion, sesiones, MFA o WebAuthn
- [ ] toca Redis, sesion, rate limiting o cache
- [ ] toca Prisma, schema o migraciones
- [ ] toca pagos, facturacion o timbrado
- [ ] toca secretos, variables o configuracion de despliegue
- [ ] toca CI/CD, smoke tests o release

Si marcaste algo arriba, completa tambien:

### Impacto operativo

Describe:

- que podria romperse si sale mal
- que monitorear despues del merge o deploy
- si requiere validacion adicional en staging o navegador real

### Plan de rollback o contencion

Describe:

- como revertir
- si aplica mejor rollback o forward-fix
- que endpoints o flujos deben revisarse primero si falla

## Validacion realizada

Marca lo que si corriste:

- [ ] `npm.cmd run verify`
- [ ] `npm.cmd run lint`
- [ ] `npm.cmd run audit:deps`
- [ ] `npm.cmd run validate:local`
- [ ] validacion manual de login/sesion
- [ ] validacion manual de customers CRUD
- [ ] validacion manual de payments
- [ ] validacion manual de invoices
- [ ] validacion manual de WebAuthn en navegador real

## Evidencia de validacion

Pega aqui comandos, salidas resumidas o notas utiles.

## Base de datos y migraciones

- [ ] no aplica
- [ ] hay cambio de schema Prisma
- [ ] hay migracion nueva versionada
- [ ] `prisma migrate status` fue revisado
- [ ] `DATABASE_URL` y `DIRECT_DATABASE_URL` fueron validados
- [ ] si aplica Neon: pooled para app y direct para migraciones

Notas:

## Auth, sesiones y seguridad

- [ ] no aplica
- [ ] login sigue funcionando
- [ ] logout sigue funcionando
- [ ] reautenticacion sigue funcionando
- [ ] revocacion de sesiones sigue funcionando
- [ ] MFA no quedo roto
- [ ] rutas protegidas siguen fallando cerrado si Redis no confirma sesion
- [ ] no se expusieron secretos en codigo, docs o logs

Notas:

## Flujos de negocio revisados

### Customers

- [ ] no aplica
- [ ] create
- [ ] list
- [ ] get by id
- [ ] update
- [ ] delete

### Payments

- [ ] no aplica
- [ ] create
- [ ] list
- [ ] auditoria asociada

### Invoices

- [ ] no aplica
- [ ] create
- [ ] list
- [ ] stamp
- [ ] cancel
- [ ] auditoria asociada

## Observabilidad y operacion

- [ ] `GET /api/health/live` responde `ok`
- [ ] `GET /api/health/ready` responde `ready`
- [ ] errores controlados siguen en `warn` cuando aplica
- [ ] errores inesperados siguen en `error`
- [ ] no aparecio spam nuevo en logs
- [ ] auditoria durable sigue registrando eventos sensibles

## Documentacion

- [ ] README actualizado si cambia comportamiento visible
- [ ] docs especificas actualizadas
- [ ] `docs/code-audit.md` actualizado si cambia el riesgo
- [ ] `docs/api-surface.md` actualizado si cambian contratos
- [ ] diagramas/onboarding/FAQ actualizados si cambia el flujo

Documentos tocados:

## Checklist minima antes de merge

- [ ] el cambio es entendible y esta justificado
- [ ] no deja deuda silenciosa no documentada
- [ ] no depende de pasos manuales ocultos
- [ ] no deja variables criticas sin definir
- [ ] esta alineado con `docs/release-checklist.md`

## Referencias

- Checklist de release: `docs/release-checklist.md`
- CI/CD: `docs/ci-cd.md`
- Runbook de despliegue: `docs/runbooks/deployment-and-migrations.md`
- FAQ tecnica: `docs/technical-faq.md`
