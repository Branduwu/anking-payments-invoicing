# Roadmap de desarrollo

Este documento conserva la hoja de ruta original, pero ahora incluye el estado real de ejecucion del proyecto.

## Fase 1. Fundacion del repositorio

Estado actual: completada

Entregables:

- `docker-compose.yml`
- `.env.example`
- esqueleto `NestJS`
- esquema Prisma inicial
- documentacion base

Criterio de salida:

- un desarrollador nuevo puede levantar el proyecto localmente con pasos documentados

Estado observado:

- cumplido con `README`, `.env.example`, `docker-compose.yml`, scripts y runbook local
- existe base para CI/CD y documentacion operativa

## Fase 2. Identidad y usuarios

Estado actual: completada

Entregables:

- modelo `User`
- credenciales con `Argon2id`
- alta de usuario administrativo inicial
- politica de password
- bloqueo progresivo por intentos fallidos

Criterio de salida:

- existe login con validacion real de credenciales y trazabilidad completa

Estado observado:

- login real implementado
- bootstrap admin implementado
- `Argon2` activo
- lockout de credenciales activo

## Fase 3. Sesiones stateful

Estado actual: completada

Entregables:

- store Redis para sesiones
- middleware o guard de autenticacion
- cookie segura
- timeout por inactividad
- timeout absoluto
- rotacion de sesion

Criterio de salida:

- el backend revoca sesiones de forma inmediata y consistente

Estado observado:

- sesiones en `Redis`
- revocacion individual y total
- rotacion de sesion
- idle timeout y absolute timeout

## Fase 4. MFA y reautenticacion

Estado actual: completada y endurecida

Entregables:

- enrolamiento TOTP
- verificacion MFA
- reautenticacion para operaciones criticas
- eventos de auditoria asociados

Criterio de salida:

- pagos y facturacion ya no pueden ejecutarse sin sesion valida y contexto reforzado

Estado observado:

- TOTP activo
- WebAuthn/passkeys activos en backend
- frontend minimo browser-based en `apps/web`
- prueba E2E real con `Playwright` y autenticador virtual
- recovery codes activos
- reset y disable de MFA activos
- reautenticacion activa
- pendiente endurecer UX final y rollout de passkeys segun cliente definitivo

## Fase 5. Pagos

Estado actual: completada como base operativa

Entregables:

- endpoints de cobro
- validacion de permisos
- persistencia de transacciones
- manejo de errores y reintentos

Criterio de salida:

- cada cobro deja evidencia completa, trazable y auditable

Estado observado:

- pagos persistidos
- auditoria durable
- permisos y reautenticacion conectados
- pendiente integracion bancaria real

## Fase 6. Facturacion y timbrado

Estado actual: completada como base tecnica

Entregables:

- generacion de factura
- integracion con proveedor PAC
- cancelacion
- persistencia de estados

Criterio de salida:

- la plataforma soporta emision, seguimiento y cancelacion con auditoria

Estado observado:

- factura `DRAFT`
- timbrado `STAMPED`
- cancelacion `CANCELLED`
- PAC abstracto ya integrado
- pendiente PAC fiscal real vendor-specific

## Fase 7. Endurecimiento

Estado actual: avanzada

Entregables:

- rate limiting
- CSRF
- alertas de seguridad
- observabilidad estructurada
- pruebas de seguridad y smoke tests

Criterio de salida:

- el sistema cuenta con controles preventivos y detective basicos para un entorno serio

Estado observado:

- rate limiting de `login` y `reauthenticate`
- throttling MFA
- observabilidad base
- smoke tests
- E2E browser-based de WebAuthn con `Playwright`
- CI/CD
- runbooks operativos
- pendiente observabilidad real, alertas reales y endurecimiento adicional segun despliegue final
