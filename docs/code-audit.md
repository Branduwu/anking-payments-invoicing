# Auditoria de codigo

Fecha de referencia: 2026-03-16

## Hallazgos actuales

### 1. La auditoria critica ya endurecio sus rutas principales, pero no todo el sistema esta en modo fail-closed

Archivos: `apps/api/src/modules/audit/audit.service.ts`, `apps/api/src/modules/sessions/sessions.service.ts`, `apps/api/src/modules/payments/payments.service.ts`, `apps/api/src/modules/invoices/invoices.service.ts`

- `payments` e `invoices` ya persisten auditoria dentro de transacciones Prisma
- la creacion y revocacion de sesiones ya fuerzan persistencia o revierten el cambio
- todavia existen eventos no criticos de lectura, denegacion o telemetria que siguen en modo best effort

Impacto:

- la trazabilidad de mutaciones sensibles mejoro de forma sustancial
- aun no todo el universo de eventos esta bajo una politica uniforme de fallo cerrado

### 2. La automatizacion local ya valida mejor sus fallos, pero sigue dependiendo de credenciales operativas correctas

Archivos: `scripts/verify.ps1`, `scripts/start-infra.ps1`, `scripts/validate-local.ps1`, `scripts/smoke-test.ps1`

- los scripts ya validan exit codes de `npm` y `docker compose` en puntos criticos
- `validate:local` ahora falla de inmediato si la API muere antes de quedar lista
- `smoke:test` ya soporta MFA via `ADMIN_MFA_TOTP_CODE` o `ADMIN_MFA_RECOVERY_CODE`
- aun depende de que las credenciales y, en su caso, el codigo MFA vigente esten configurados correctamente para la corrida

Impacto:

- se redujo el riesgo de falsos positivos en validaciones locales
- aun existe dependencia operativa de secretos locales y de infraestructura viva

### 3. MFA ya cubre TOTP, recovery codes, disable y reset, pero aun faltan controles avanzados

Archivos: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/mfa.service.ts`

- ya existe alta de MFA TOTP, verificacion, recovery codes, deshabilitacion y reseteo administrativo
- ya existe throttling especifico y lockout temporal para TOTP, recovery code y pending setup
- no existe todavia WebAuthn/passkeys

Impacto:

- operativamente el modulo ya cubre el ciclo principal de MFA
- aun faltan controles de fortaleza y UX para una postura mas madura

### 4. Facturacion ya incorpora timbrado, pero sigue faltando una integracion PAC vendor-specific de produccion

Archivos: `apps/api/src/modules/invoices/invoices.service.ts`, `apps/api/src/modules/invoices/pac.service.ts`

- ya hay creacion, listado, `stamp` y cancelacion persistidos en Prisma
- el sistema soporta proveedor PAC configurable en modo `mock` o `custom-http`
- aun no existe adaptador especifico para un PAC real con mapeo completo de CFDI

Impacto:

- el modulo ya no es solo persistencia local
- todavia falta el paso final para produccion fiscal real

## Mejoras realizadas en este ciclo

- `payments` ya persiste con auditoria transaccional en Prisma
- `invoices` ya persiste con creacion, listado, timbrado y cancelacion
- se implemento MFA TOTP con setup, verificacion, recovery codes, disable y reset administrativo
- se agrego `start:local` para levantar flujo local desde la raiz
- `npm start` ahora apunta a `start:local`
- el arranque local soporta modo degradado si no hay PostgreSQL/Redis ni Docker, sin spam repetitivo de Redis
- se agregaron scripts `test` y `verify`
- se corrigio el manejo de exit codes en scripts PowerShell para que errores de Prisma, npm o Docker no pasen silenciosamente
- `smoke:test` ya puede validar cuentas con MFA si recibe codigo TOTP o recovery code
- el contenedor de `api` ya arranca la aplicacion compilada y no watch mode
- se elimino la dependencia de `@nestjs/cli` y `@nestjs/schematics` del flujo local de build/dev
- MFA ahora aplica throttling y lockout temporal por intentos invalidos
- el proveedor `mock` del PAC ya no puede usarse en produccion por accidente salvo override explicito
- se agrego `.dockerignore` para reducir contexto de build y evitar copiar artefactos locales al contenedor
- se incorporaron pruebas unitarias para `auth`, `payments`, `invoices` y guardas de sesion
- se corrigio la carga de `.env` para ejecucion desde raiz y desde `apps/api`

## Dependencias

Estado actual de `npm audit`:

- 0 vulnerabilidades

## Como usar esta auditoria

Usa este documento como backlog vivo de endurecimiento:

1. toma un hallazgo
2. confirma si sigue vigente en codigo
3. define severidad y alcance
4. corrige el problema
5. agrega o ajusta prueba si aplica
6. corre `npm run verify`
7. actualiza este archivo y `README.md`

## Recomendacion de siguiente fase

1. elegir e integrar un PAC real con contrato CFDI productivo
2. agregar WebAuthn/passkeys para roles criticos
3. extender la politica fail-closed a eventos no criticos si el requisito operativo lo demanda
4. ampliar pruebas end-to-end y de integracion real
