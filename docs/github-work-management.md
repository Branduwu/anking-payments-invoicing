# Estrategia de Trabajo en GitHub

Fecha de referencia: 2026-03-16

## Objetivo

Esta guia propone una estructura simple pero seria para gestionar trabajo, riesgo y operacion en GitHub.

Sirve para organizar:

- issues
- pull requests
- labels
- milestones
- proyectos o boards

## Principio general

No mezcles todo en una sola lista plana.

La recomendacion para este repo es separar por:

- tipo de trabajo
- area afectada
- severidad o riesgo
- estado

## Labels recomendados

### Tipo de trabajo

Usa prefijo `type:`

- `type:feature`
- `type:bug`
- `type:refactor`
- `type:docs`
- `type:test`
- `type:security`
- `type:ci-cd`
- `type:migration`

### Area o dominio

Usa prefijo `area:`

- `area:auth`
- `area:sessions`
- `area:customers`
- `area:payments`
- `area:invoices`
- `area:audit`
- `area:health`
- `area:prisma`
- `area:redis`
- `area:docs`
- `area:operations`

### Riesgo o severidad

Usa prefijo `risk:`

- `risk:low`
- `risk:medium`
- `risk:high`
- `risk:critical`

### Estado

Usa prefijo `status:`

- `status:triage`
- `status:ready`
- `status:in-progress`
- `status:blocked`
- `status:review`
- `status:release-ready`

### Naturaleza operativa

Opcionales, pero utiles:

- `needs:migration`
- `needs:rollback-plan`
- `needs:docs`
- `needs:security-review`
- `needs:smoke`
- `needs:browser-validation`

## Convencion recomendada

Un issue o PR sano deberia terminar con algo parecido a esto:

- un label `type:*`
- uno o varios `area:*`
- un `risk:*`
- un `status:*`

Ejemplo:

```text
type:bug
area:auth
area:sessions
risk:high
status:review
needs:security-review
needs:smoke
```

## Milestones recomendados

Usa milestones por etapa real de entrega, no por tema ambiguo.

Ejemplo sugerido para este repo:

### `M1 - Foundation and Hardening`

- auth
- sesiones
- Redis
- auditoria
- health

### `M2 - Business Flows`

- customers
- payments
- invoices
- smoke tests de negocio

### `M3 - WebAuthn and UX Closure`

- frontend/browser WebAuthn
- validacion real de origen
- UX de recovery y passkeys

### `M4 - Production Readiness`

- PAC real
- observabilidad real
- deploy real
- runbooks finales

### `M5 - Release Candidate`

- cierre de hallazgos
- smoke en ambiente real
- checklist de release en verde

## Proyecto o board recomendado

Si usas GitHub Projects, mantenlo simple.

### Columnas sugeridas

- `Triage`
- `Ready`
- `In Progress`
- `Blocked`
- `Review`
- `Release Ready`
- `Done`

### Regla operativa

- issues nuevos entran en `Triage`
- cuando el alcance y riesgo ya estan claros, pasan a `Ready`
- si requieren fix tecnico, van a `In Progress`
- si dependen de tercero, ambiente o decision, van a `Blocked`
- si ya existe PR, pasan a `Review`
- si ya esta validado y esperando merge/deploy, pasan a `Release Ready`
- despues de merge y cierre, van a `Done`

## Que tipo de issue abrir

### Bug

Usa:

- `.github/ISSUE_TEMPLATE/bug_report.yml`

Cuando:

- algo no funciona
- hay regresion
- falla local, CI, Redis, Prisma, Docker, payments o invoices

### Security

Usa:

- `.github/ISSUE_TEMPLATE/security_report.yml`

Cuando:

- auth, sesiones, MFA, secretos, permisos, auditoria o pagos/facturas tengan riesgo real

Nota:

- si el problema es explotable o sensible, no hagas disclosure publica completa
- revisa `SECURITY.md`

## Como usar labels con la plantilla de PR

La plantilla de PR ya pide:

- riesgo
- area afectada
- cambio sensible
- validacion corrida
- rollback

La estrategia recomendada es reflejar eso tambien en labels:

- riesgo alto -> `risk:high`
- toca auth/sesiones -> `area:auth`, `area:sessions`
- toca Prisma -> `area:prisma`, `needs:migration`
- toca WebAuthn -> `needs:browser-validation`

## Flujo recomendado para un cambio sensible

1. abrir issue o ticket
2. etiquetar tipo, area y riesgo
3. mover a `Triage`
4. cuando este bien definido, mover a `Ready`
5. trabajar cambio y abrir PR con plantilla
6. marcar `needs:security-review` o `needs:migration` si aplica
7. correr checklist de release
8. mover a `Release Ready` cuando el PR este listo

## Gobernanza minima recomendada

Si el repo va a operar de forma seria, configura tambien:

- ramas protegidas
- PR obligatorio antes de merge a `main`
- CI obligatorio en `main`
- reviewers para cambios sensibles
- entornos protegidos en deploy

## Relacion con otros documentos

Lee tambien:

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [release-checklist.md](./release-checklist.md)
- [ci-cd.md](./ci-cd.md)
- [code-audit.md](./code-audit.md)
