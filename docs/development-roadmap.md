# Roadmap de desarrollo

## Fase 1. Fundacion del repositorio

Entregables:

- `docker-compose.yml`
- `.env.example`
- esqueleto `NestJS`
- esquema Prisma inicial
- documentacion base

Criterio de salida:

- un desarrollador nuevo puede levantar el proyecto localmente con pasos documentados

## Fase 2. Identidad y usuarios

Entregables:

- modelo `User`
- credenciales con `Argon2id`
- alta de usuario administrativo inicial
- politica de password
- bloqueo progresivo por intentos fallidos

Criterio de salida:

- existe login con validacion real de credenciales y trazabilidad completa

## Fase 3. Sesiones stateful

Entregables:

- store Redis para sesiones
- middleware o guard de autenticacion
- cookie segura
- timeout por inactividad
- timeout absoluto
- rotacion de sesion

Criterio de salida:

- el backend revoca sesiones de forma inmediata y consistente

## Fase 4. MFA y reautenticacion

Entregables:

- enrolamiento TOTP
- verificacion MFA
- reautenticacion para operaciones criticas
- eventos de auditoria asociados

Criterio de salida:

- pagos y facturacion ya no pueden ejecutarse sin sesion valida y contexto reforzado

## Fase 5. Pagos

Entregables:

- endpoints de cobro
- validacion de permisos
- persistencia de transacciones
- manejo de errores y reintentos

Criterio de salida:

- cada cobro deja evidencia completa, trazable y auditable

## Fase 6. Facturacion y timbrado

Entregables:

- generacion de factura
- integracion con proveedor PAC
- cancelacion
- persistencia de estados

Criterio de salida:

- la plataforma soporta emision, seguimiento y cancelacion con auditoria

## Fase 7. Endurecimiento

Entregables:

- rate limiting
- CSRF
- alertas de seguridad
- observabilidad estructurada
- pruebas de seguridad y smoke tests

Criterio de salida:

- el sistema cuenta con controles preventivos y detective basicos para un entorno serio
