# Mapa de Documentacion

Fecha de referencia: 2026-03-16

## Objetivo

Esta tabla maestra te dice que documento leer segun lo que quieras hacer.

Sirve para:

- no perder tiempo buscando entre varias guias
- orientar a una persona nueva
- encontrar rapido el documento correcto segun la tarea

## Tabla maestra

| Si quieres... | Lee esto primero | Luego sigue con |
|---|---|---|
| Entender de que trata el proyecto | [README.md](../README.md) | [architecture.md](./architecture.md) |
| Entender la arquitectura general | [architecture.md](./architecture.md) | [diagrams-index.md](./diagrams-index.md) |
| Entender tablas y relaciones | [data-model-and-crud-guide.md](./data-model-and-crud-guide.md) | [schema.prisma](../apps/api/prisma/schema.prisma) |
| Entender que vive en PostgreSQL y que vive en Redis | [data-model-and-crud-guide.md](./data-model-and-crud-guide.md) | [environment-guide.md](./environment-guide.md) |
| Ver todos los diagramas disponibles | [diagrams-index.md](./diagrams-index.md) | [architecture.md](./architecture.md) |
| Empezar como desarrollador nuevo | [onboarding.md](./onboarding.md) | [documentation-map.md](./documentation-map.md) |
| Levantar el proyecto localmente | [environment-guide.md](./environment-guide.md) | [local-runbook.md](./local-runbook.md) |
| Levantar el proyecto con Neon | [environment-guide.md](./environment-guide.md) | [local-runbook.md](./local-runbook.md) |
| Entender auth, sesion, MFA y reautenticacion | [architecture.md](./architecture.md) | [api-surface.md](./api-surface.md) |
| Entender WebAuthn/passkeys | [architecture.md](./architecture.md) | [api-surface.md](./api-surface.md) |
| Probar un CRUD real de punta a punta | [data-model-and-crud-guide.md](./data-model-and-crud-guide.md) | [local-runbook.md](./local-runbook.md) |
| Entender endpoints disponibles | [api-surface.md](./api-surface.md) | [architecture.md](./architecture.md) |
| Entender el estado actual del roadmap | [implementation-status.md](./implementation-status.md) | [development-roadmap.md](./development-roadmap.md) |
| Revisar que falta por construir | [implementation-status.md](./implementation-status.md) | [production-readiness.md](./production-readiness.md) |
| Revisar hallazgos y deuda de seguridad | [code-audit.md](./code-audit.md) | [security-baseline.md](./security-baseline.md) |
| Entender politica de vulnerabilidades y reporte de seguridad | [../SECURITY.md](../SECURITY.md) | [code-audit.md](./code-audit.md) |
| Resolver errores tecnicos comunes | [technical-faq.md](./technical-faq.md) | [local-runbook.md](./local-runbook.md) |
| Entender controles de seguridad base | [security-baseline.md](./security-baseline.md) | [architecture.md](./architecture.md) |
| Validar si un cambio esta listo para release | [release-checklist.md](./release-checklist.md) | [runbooks/deployment-and-migrations.md](./runbooks/deployment-and-migrations.md) |
| Abrir un PR alineado a la checklist | [release-checklist.md](./release-checklist.md) | [../.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) |
| Colaborar correctamente en el repo | [../CONTRIBUTING.md](../CONTRIBUTING.md) | [release-checklist.md](./release-checklist.md) |
| Reportar un bug o issue de seguridad | [../.github/ISSUE_TEMPLATE/bug_report.yml](../.github/ISSUE_TEMPLATE/bug_report.yml) | [../.github/ISSUE_TEMPLATE/security_report.yml](../.github/ISSUE_TEMPLATE/security_report.yml) |
| Organizar labels, milestones y proyectos | [github-work-management.md](./github-work-management.md) | [release-checklist.md](./release-checklist.md) |
| Entender CI/CD y despliegues | [ci-cd.md](./ci-cd.md) | [runbooks/deployment-and-migrations.md](./runbooks/deployment-and-migrations.md) |
| Revisar observabilidad y operacion | [observability.md](./observability.md) | [runbooks/incident-response.md](./runbooks/incident-response.md) |
| Saber que hacer en un incidente | [runbooks/incident-response.md](./runbooks/incident-response.md) | [runbooks/session-revocation.md](./runbooks/session-revocation.md) |
| Revocar sesiones o atender seguridad operativa | [runbooks/session-revocation.md](./runbooks/session-revocation.md) | [code-audit.md](./code-audit.md) |
| Rotar secretos | [runbooks/secret-rotation.md](./runbooks/secret-rotation.md) | [production-readiness.md](./production-readiness.md) |
| Entender que falta para productivo | [production-readiness.md](./production-readiness.md) | [ci-cd.md](./ci-cd.md) |

## Rutas sugeridas por perfil

### Si eres desarrollador backend

Lee en este orden:

1. [README.md](../README.md)
2. [onboarding.md](./onboarding.md)
3. [architecture.md](./architecture.md)
4. [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)
5. [api-surface.md](./api-surface.md)

### Si vienes a operar o desplegar

Lee en este orden:

1. [README.md](../README.md)
2. [environment-guide.md](./environment-guide.md)
3. [ci-cd.md](./ci-cd.md)
4. [observability.md](./observability.md)
5. [runbooks/deployment-and-migrations.md](./runbooks/deployment-and-migrations.md)

### Si vienes a revisar seguridad

Lee en este orden:

1. [README.md](../README.md)
2. [security-baseline.md](./security-baseline.md)
3. [code-audit.md](./code-audit.md)
4. [architecture.md](./architecture.md)
5. [runbooks/session-revocation.md](./runbooks/session-revocation.md)

## Documento fuente para cada tipo de duda

### Duda funcional

Empieza en:

- [api-surface.md](./api-surface.md)

### Duda de arquitectura

Empieza en:

- [architecture.md](./architecture.md)

### Duda de datos

Empieza en:

- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)

### Duda de ambiente

Empieza en:

- [environment-guide.md](./environment-guide.md)

### Duda de operacion

Empieza en:

- [local-runbook.md](./local-runbook.md)
- [observability.md](./observability.md)
- [technical-faq.md](./technical-faq.md)
- [release-checklist.md](./release-checklist.md)

### Duda de seguridad o deuda tecnica

Empieza en:

- [../SECURITY.md](../SECURITY.md)
- [code-audit.md](./code-audit.md)
