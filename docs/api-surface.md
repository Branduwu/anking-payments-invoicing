# API inicial

Prefijo sugerido: `/api`

## Health

### `GET /health/live`

- publica
- confirma que el proceso esta arriba
- devuelve metadata del servicio

### `GET /health/ready`

- publica
- valida `PostgreSQL` y `Redis`
- devuelve `503` con detalle por dependencia cuando falta alguna

## Auth

### `POST /auth/login`

- publica
- valida credenciales
- crea sesion
- rota `sessionId`
- devuelve cookie segura
- si el usuario tiene MFA, deja la sesion en estado pendiente y devuelve `availableMfaMethods`

### `POST /auth/logout`

- requiere sesion
- revoca la sesion actual
- limpia la cookie

### `POST /auth/refresh`

- requiere sesion
- rota la sesion activa
- extiende continuidad sin exponer tokens al frontend

### `GET /auth/me`

- requiere sesion
- devuelve contexto actual del usuario y sesion

### `POST /auth/mfa/verify`

- requiere sesion parcial o challenge valido
- eleva `mfaLevel`
- habilita reautenticacion reciente cuando aplique
- acepta TOTP y recovery code

### `POST /auth/webauthn/registration/options`

- requiere sesion
- requiere reautenticacion reciente
- genera challenge de registro WebAuthn
- usa `Redis` para guardar la challenge temporal

### `POST /auth/webauthn/registration/verify`

- requiere sesion
- requiere reautenticacion reciente
- verifica la respuesta WebAuthn
- persiste la credencial en `PostgreSQL`
- puede generar recovery codes si es el primer factor primario MFA del usuario

### `POST /auth/webauthn/authentication/options`

- requiere sesion valida o sesion pendiente de MFA
- genera challenge WebAuthn para completar login o reautenticacion
- usa `Redis` para guardar la challenge temporal

### `POST /auth/webauthn/authentication/verify`

- requiere sesion valida o sesion pendiente de MFA
- verifica la respuesta WebAuthn
- completa MFA de login o reautenticacion segun el contexto
- actualiza contador y `lastUsedAt` de la credencial

### `GET /auth/webauthn/credentials`

- requiere sesion
- requiere reautenticacion reciente
- lista credenciales WebAuthn activas del usuario

### `DELETE /auth/webauthn/credentials/:credentialId`

- requiere sesion
- requiere reautenticacion reciente
- revoca una credencial WebAuthn activa
- si era el ultimo factor primario MFA, limpia MFA del usuario

### `POST /auth/mfa/setup`

- requiere sesion
- requiere reautenticacion reciente
- inicia alta de TOTP

### `POST /auth/mfa/recovery-codes/regenerate`

- requiere sesion
- requiere reautenticacion reciente
- rota los recovery codes del usuario

### `POST /auth/mfa/disable`

- requiere sesion
- requiere reautenticacion reciente
- limpia secreto TOTP y recovery codes

### `POST /auth/mfa/admin/reset`

- requiere sesion
- requiere reautenticacion reciente
- exige rol `ADMIN` o `SECURITY`
- resetea MFA de un tercero y revoca sus sesiones

### `POST /auth/reauthenticate`

- requiere sesion
- valida password actual
- abre una nueva ventana corta de reautenticacion cuando el usuario no tiene MFA activo
- si el usuario tiene MFA activo, la reautenticacion reforzada debe completarse con TOTP, recovery code o WebAuthn

## Sessions

### `GET /sessions`

- requiere sesion
- lista sesiones activas del usuario

### `DELETE /sessions/:id`

- requiere sesion
- revoca una sesion especifica

### `DELETE /sessions/all`

- requiere sesion
- revoca todas las sesiones, incluida la actual

## Payments

### `POST /payments`

- requiere sesion
- requiere reautenticacion reciente
- registra auditoria

### `GET /payments`

- requiere sesion
- devuelve historial segun permisos

## Customers

### `POST /customers`

- requiere sesion
- requiere reautenticacion reciente
- persiste con Prisma
- invalida cache Redis
- registra auditoria

### `GET /customers`

- requiere sesion
- devuelve clientes propios o todos segun permisos
- usa Redis como cache de lista
- expone `source=database|cache`

### `GET /customers/:id`

- requiere sesion
- respeta permisos por rol y propietario
- usa Redis como cache puntual
- expone `source=database|cache`

### `PATCH /customers/:id`

- requiere sesion
- requiere reautenticacion reciente
- actualiza con Prisma
- invalida cache Redis
- registra auditoria

### `DELETE /customers/:id`

- requiere sesion
- requiere reautenticacion reciente
- elimina con Prisma
- invalida cache Redis
- registra auditoria

## Invoices

### `POST /invoices`

- requiere sesion
- requiere reautenticacion reciente

### `GET /invoices`

- requiere sesion
- devuelve historial y estados

### `POST /invoices/stamp`

- requiere sesion
- requiere reautenticacion reciente
- ejecuta timbrado via PAC configurable
- mueve la factura a `STAMPED`

### `POST /invoices/cancel`

- requiere sesion
- requiere reautenticacion reciente
- registra motivo de cancelacion
- si la factura estaba timbrada, solicita cancelacion al PAC
