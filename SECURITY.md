# Security Policy

## Objetivo

Este documento explica:

- como reportar vulnerabilidades o hallazgos de seguridad
- que versiones o ramas deben considerarse activamente soportadas
- como se manejan reportes sensibles en este repositorio

## Alcance

Este proyecto maneja superficies sensibles:

- autenticacion
- sesiones stateful
- MFA y WebAuthn/passkeys
- rate limiting
- auditoria
- pagos
- facturacion y timbrado
- secretos y configuracion de despliegue

Por eso, un hallazgo de seguridad no debe tratarse igual que un bug comun.

## Versiones soportadas

Soporte activo esperado:

| Rama o version | Estado |
|---|---|
| `main` | soportada |
| releases historicas no mantenidas | no soportadas |
| forks o despliegues personalizados | mejor esfuerzo |

Regla practica:

- si reportas una vulnerabilidad, asume que la referencia principal es `main`

## Como reportar una vulnerabilidad

### Ruta preferida

Si GitHub muestra la opcion de reporte privado de vulnerabilidades o Security Advisories para el repo, usa esa via primero.

Esa es la forma recomendada para:

- bypass de auth
- secuestro de sesion
- MFA bypass
- exposicion de secretos
- debilidades en pagos, facturacion o auditoria
- errores de despliegue que expongan datos o control

### Si no hay canal privado disponible

Si el canal privado no esta habilitado:

1. no abras un issue publico con exploit detallado
2. no pegues secretos, cookies, tokens, credenciales o URLs completas sensibles
3. usa el issue template de seguridad solo para un resumen redactado y de bajo detalle
4. pide un canal privado o un traspaso seguro antes de compartir detalles explotables

Plantilla disponible:

- `.github/ISSUE_TEMPLATE/security_report.yml`

## Que incluir en el reporte

Incluye, en la medida de lo posible:

- resumen del hallazgo
- impacto
- componente afectado
- pasos de reproduccion redactados
- severidad estimada
- mitigacion temporal sugerida
- evidencia redactada

No incluyas:

- contraseñas
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- cookies de sesion
- recovery codes
- secretos MFA
- payloads completos si exponen una ventana de abuso activa

## Tiempos y expectativas

Objetivo razonable de manejo:

- triage inicial: lo antes posible
- clasificacion: severidad, alcance y explotabilidad
- mitigacion: segun riesgo y factibilidad
- disclosure publica: solo cuando exista correccion o contencion suficiente

No hay SLA contractual en este repositorio, pero la expectativa es tratar primero:

- auth
- sesiones
- MFA
- exposicion de secretos
- pagos o facturacion
- auditoria sensible

## Como se tratan hallazgos segun tipo

### Criticos

Ejemplos:

- auth bypass
- secuestro de sesion
- MFA bypass
- exposicion de secretos validos
- control indebido sobre pagos o facturas

Tratamiento recomendado:

- no disclosure publica inicial
- contencion inmediata
- rotacion o revocacion si aplica
- fix urgente o feature flag off

### Altos

Ejemplos:

- autorizacion debil
- inconsistencias de auditoria en rutas sensibles
- ventanas de replay
- errores de despliegue con exposicion parcial

Tratamiento recomendado:

- triage rapido
- fix priorizado
- documentar impacto operativo

### Medios o bajos

Ejemplos:

- hardening pendiente
- configuracion riesgosa no explotable por defecto
- logs o UX que inducen uso inseguro

Tratamiento recomendado:

- issue o ticket documentado
- incluir en roadmap o checklist de release

## Rotacion y contencion

Si un hallazgo sugiere exposicion de credenciales o material sensible, considera al menos:

- rotar secretos
- revocar sesiones
- invalidar recovery codes si aplica
- revisar `code-audit.md`
- revisar runbooks operativos

Referencias:

- `docs/runbooks/secret-rotation.md`
- `docs/runbooks/session-revocation.md`
- `docs/runbooks/incident-response.md`

## Relacion con otras guias

Documentos complementarios:

- `docs/code-audit.md`
- `docs/security-baseline.md`
- `docs/technical-faq.md`
- `docs/release-checklist.md`
- `CONTRIBUTING.md`

