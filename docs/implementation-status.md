# Estado de implementacion

Fecha de referencia: 2026-03-16

## Objetivo de este documento

Este documento resume lo que ya esta implementado en la plataforma, como se relaciona con el roadmap original y cual es el estado real del proyecto para desarrollo local, auditoria y evolucion a productivo.

No reemplaza el `README`. Lo complementa con una vista mas ejecutiva y tecnica del estado del codigo.

## Resumen ejecutivo

La plataforma ya cuenta con una base funcional y endurecida para:

- autenticacion robusta con password hash `Argon2`
- sesiones server-side en `Redis`
- revocacion inmediata de sesiones
- MFA con `TOTP`, `WebAuthn/passkeys`, recovery codes, disable y reset administrativo
- reautenticacion para operaciones criticas
- rate limiting de autenticacion en `Redis`
- pagos persistidos con auditoria durable
- facturas con ciclo `DRAFT -> STAMPED -> CANCELLED`
- health checks, logs estructurados y modo degradado controlado
- CI/CD base con `verify`, `lint`, `tests`, `audit` y smoke tests

## Estado por area funcional

### 1. Identidad y autenticacion

Estado: implementado

Capacidades actuales:

- login real contra `PostgreSQL`
- passwords hasheados con `Argon2`
- bloqueo progresivo por credenciales fallidas
- rate limiting para `login` y `reauthenticate`
- auditoria de login correcto, fallido, denegado y rate limited

Pendiente:

- politicas mas avanzadas de password lifecycle si se requieren
- endurecer experiencia de frontend/browser para passkeys y sus pruebas E2E

### 2. Sesiones stateful

Estado: implementado

Capacidades actuales:

- sesiones activas en `Redis`
- cookie segura `HttpOnly`
- timeout por inactividad
- timeout absoluto
- rotacion de sesion
- rotacion segura con rollback del reemplazo si la revocacion falla
- listado de sesiones
- revocacion individual y masiva

Pendiente:

- replicacion o topologia HA de Redis para entorno productivo

### 3. MFA y reautenticacion

Estado: implementado y endurecido

Capacidades actuales:

- enrolamiento TOTP
- verificacion TOTP
- registro de credenciales WebAuthn/passkeys
- verificacion WebAuthn para login y reautenticacion
- listado y revocacion de credenciales WebAuthn
- recovery codes
- regeneracion de recovery codes
- disable voluntario
- reset administrativo
- compensacion de estado si el endurecimiento de sesiones falla
- lockout temporal por intentos fallidos
- reautenticacion con ventana temporal para operaciones sensibles

Pendiente:

- integracion frontend/browser de la ceremonia WebAuthn
- flujos avanzados de recuperacion con politicas operativas mas maduras

### 4. Pagos

Estado: implementado como base de negocio

Capacidades actuales:

- creacion de pagos
- persistencia en `PostgreSQL`
- auditoria durable
- control de permisos
- integracion con reautenticacion

Pendiente:

- adaptador real de banco o pasarela
- reconciliacion y callbacks externos
- colas y reintentos para escenarios asincronos

### 5. Facturacion y timbrado

Estado: implementado como base fiscal-tecnica

Capacidades actuales:

- creacion de factura en `DRAFT`
- timbrado via proveedor PAC abstracto
- cancelacion local o via PAC
- persistencia de referencias PAC y estados
- auditoria durable de emision, timbrado y cancelacion

Pendiente:

- PAC vendor-specific real
- mapeo CFDI productivo completo
- pruebas E2E con proveedor fiscal real

### 6. Auditoria y seguridad operativa

Estado: implementado y endurecido

Capacidades actuales:

- auditoria estructurada en `PostgreSQL`
- politica `fail-closed` configurable por prefijos y resultado
- `SUCCESS`, `FAILURE` y `DENIED` diferenciados
- eventos sensibles ya endurecidos
- logs estructurados por request

Pendiente:

- extender `fail-closed` a mas eventos si el riesgo lo exige
- enviar logs a backend real de observabilidad

### 7. Operacion, validacion y despliegue

Estado: implementado como base seria

Capacidades actuales:

- `verify`, `lint`, `test`, `audit:deps`
- smoke tests
- health checks `live` y `ready`
- modo degradado controlado
- runbooks de incidente, revocacion, rotacion y migraciones
- workflows `CI` y `deploy`

Pendiente:

- paso real de despliegue segun hosting final
- alertas y metricas sobre plataforma real

## Estado por fase del roadmap

### Fase 1. Fundacion del repositorio

Estado: completada

Evidencia:

- `docker-compose.yml`
- `.env.example`
- `README.md`
- estructura `apps/api`

### Fase 2. Identidad y usuarios

Estado: completada

Evidencia:

- Prisma models de usuarios y credenciales
- login real
- bootstrap administrativo
- lockout de credenciales

### Fase 3. Sesiones stateful

Estado: completada

Evidencia:

- `SessionsService`
- guards de sesion
- cookies seguras
- revocacion y rotacion

### Fase 4. MFA y reautenticacion

Estado: completada y endurecida

Evidencia:

- `setup`, `verify`, recovery codes
- endpoints de registro y autenticacion WebAuthn
- persistencia de credenciales WebAuthn en Prisma
- reautenticacion
- guards para operaciones sensibles

Nota:

- la base backend de WebAuthn ya existe; lo que sigue pendiente es el cierre de UX/browser y E2E real desde frontend

### Fase 5. Pagos

Estado: completada como base operativa

Evidencia:

- endpoints `payments`
- persistencia y auditoria
- pruebas de servicio

### Fase 6. Facturacion y timbrado

Estado: completada como base tecnica

Evidencia:

- endpoints `invoices`
- `stamp` y `cancel`
- proveedor PAC abstracto

Nota:

- aun no hay PAC fiscal real

### Fase 7. Endurecimiento

Estado: avanzada

Evidencia:

- rate limiting de auth
- throttling MFA
- observabilidad base
- CI/CD
- smoke tests
- runbooks

Pendiente:

- CSRF si se expone a navegador en arquitectura final
- alertas reales
- pruebas de seguridad mas amplias

## Controles de seguridad ya implementados

- sesiones server-side con `Redis`
- cookie `HttpOnly`
- `SameSite=Strict`
- `Secure` configurable por entorno
- timeout idle y absoluto
- revocacion inmediata
- reautenticacion para operaciones criticas
- MFA con TOTP y recovery codes
- rate limiting de autenticacion
- lockout MFA
- auditoria durable
- health checks
- logs estructurados

## Validaciones tecnicas que ya forman parte del trabajo

Despues de cambios importantes, el flujo recomendado y ya documentado es:

1. `npm.cmd run verify`
2. `npm.cmd run lint`
3. `npm.cmd run audit:deps`
4. `npm.cmd run validate:local`
5. revisar `docs/code-audit.md`
6. actualizar `README.md` y docs relacionadas

## Riesgos abiertos mas importantes

1. Elegir e integrar PAC real.
2. Cerrar frontend/browser y E2E real de WebAuthn/passkeys.
3. Completar observabilidad con backend real de metricas, logs y alertas.
4. Definir despliegue productivo final y automatizarlo.
5. Seguir ampliando politicas `fail-closed` donde el riesgo operativo lo amerite.

## Documentos relacionados

- `README.md`
- `docs/architecture.md`
- `docs/development-roadmap.md`
- `docs/code-audit.md`
- `docs/local-runbook.md`
- `docs/production-readiness.md`
