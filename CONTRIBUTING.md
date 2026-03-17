# Contributing

## Objetivo

Este archivo resume como colaborar en este repo sin romper la logica de negocio ni bajar la postura de seguridad.

## Regla principal

No basta con que el cambio compile.

En este proyecto, un cambio correcto tambien debe:

- respetar auth, sesiones y reautenticacion
- no romper auditoria
- no degradar el uso de `PostgreSQL/Neon` y `Redis`
- dejar documentacion actualizada cuando cambia el comportamiento

## Antes de empezar

Lee primero:

- [README.md](./README.md)
- [docs/onboarding.md](./docs/onboarding.md)
- [docs/documentation-map.md](./docs/documentation-map.md)
- [docs/release-checklist.md](./docs/release-checklist.md)

Si vas a tocar seguridad o auth, revisa tambien:

- [docs/code-audit.md](./docs/code-audit.md)
- [docs/technical-faq.md](./docs/technical-faq.md)

## Flujo de trabajo recomendado

1. crea tu cambio
2. agrega o ajusta pruebas
3. corre validaciones
4. actualiza docs
5. abre PR usando la plantilla del repo

## Validaciones minimas

Antes de abrir un PR:

```powershell
npm.cmd run verify
npm.cmd run lint
npm.cmd run validate:local
```

Si `validate:local` no aplica por entorno, deja evidencia clara del equivalente y explicalo en el PR.

## Reglas de cambio

### Si tocas Prisma o migraciones

- versiona la migracion
- valida `DATABASE_URL` y `DIRECT_DATABASE_URL`
- no mezcles cambios de schema sin explicar impacto

### Si tocas auth, sesiones o MFA

- valida login
- valida logout
- valida reautenticacion
- valida que Redis siga siendo la fuente de verdad de la sesion
- no rompas el comportamiento fail-closed

### Si tocas Redis

- valida sesiones
- valida rate limiting si aplica
- valida cache e invalidacion si toca `customers`

### Si tocas payments o invoices

- valida flujo de negocio
- valida auditoria asociada
- si toca PAC o integraciones, documenta claramente el impacto

## Documentacion

Si cambias comportamiento visible o flujo importante, actualiza lo que corresponda:

- `README.md`
- `docs/api-surface.md`
- `docs/architecture.md`
- `docs/data-model-and-crud-guide.md`
- `docs/code-audit.md`
- `docs/technical-faq.md`

## PRs

Usa la plantilla:

- `.github/PULL_REQUEST_TEMPLATE.md`

Deja claro:

- que cambia
- por que cambia
- validacion corrida
- impacto operativo
- plan de rollback si es sensible

## Issues

Plantillas disponibles:

- bug report
- security report

Si reportas seguridad:

- no publiques secretos
- no pegues credenciales reales
- redacta valores sensibles

## No hacer

- no subir secretos al repo
- no saltarte `validate:local` en cambios sensibles sin explicarlo
- no cambiar flujos de auth/sesion/MFA sin ajustar pruebas y docs
- no dejar deuda silenciosa en PRs de riesgo alto

## Referencias utiles

- [docs/technical-faq.md](./docs/technical-faq.md)
- [docs/release-checklist.md](./docs/release-checklist.md)
- [docs/ci-cd.md](./docs/ci-cd.md)
- [docs/runbooks/deployment-and-migrations.md](./docs/runbooks/deployment-and-migrations.md)
