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
- abre una nueva ventana corta de reautenticacion
- primer metodo util para operaciones sensibles mientras MFA sigue pendiente

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
