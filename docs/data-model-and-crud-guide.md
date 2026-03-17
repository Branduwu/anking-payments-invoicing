# Modelo de Datos y Guia de CRUD

Fecha de referencia: 2026-03-16

## Objetivo

Esta guia sirve para dos casos:

- entender que tablas existen hoy y como se relacionan
- probar un CRUD real para confirmar que `NestJS`, `Prisma`, `PostgreSQL/Neon`, `Redis`, sesiones y auditoria estan funcionando juntos

## Como pensar la arquitectura de datos

El proyecto separa dos tipos de informacion:

- `PostgreSQL` para datos durables y evidencia operativa
- `Redis` para datos efimeros, estado de sesion, challenges y cache

### PostgreSQL

Guarda:

- usuarios
- credenciales de password
- roles
- credenciales WebAuthn/passkeys
- customers
- payments
- invoices
- audit events

### Redis

Guarda:

- sesiones activas
- expiracion por inactividad y expiracion absoluta
- estado MFA de la sesion
- ventana de reautenticacion
- rate limiting
- challenges WebAuthn
- cache de lecturas rapidas como `customers`

Importante:

- no existe tabla `Session` en `PostgreSQL`
- la validez inmediata de la sesion vive en `Redis`
- la evidencia durable del usuario y sus acciones vive en `PostgreSQL`

## Tablas actuales

La fuente de verdad del modelo es [schema.prisma](../apps/api/prisma/schema.prisma).

### `User`

Tabla principal de identidad.

Campos relevantes:

- `id`
- `email`
- `displayName`
- `status`
- `mfaEnabled`
- `mfaTotpSecretEnc`
- `mfaRecoveryCodes`
- `mfaRecoveryCodesGeneratedAt`
- `createdAt`
- `updatedAt`

Relaciones:

- `1:1` con `PasswordCredential`
- `1:N` con `UserRoleAssignment`
- `1:N` con `WebAuthnCredential`
- `1:N` con `Customer`
- `1:N` con `Payment`
- `1:N` con `Invoice`
- `1:N` con `AuditEvent`

### `PasswordCredential`

Credencial de password del usuario.

Campos relevantes:

- `userId`
- `passwordHash`
- `passwordChangedAt`
- `failedLoginCount`
- `lockedUntil`

Notas:

- usa `userId` como `PK`
- se elimina en cascada si el usuario desaparece

### `UserRoleAssignment`

Asigna roles al usuario.

Campos relevantes:

- `id`
- `userId`
- `role`
- `createdAt`

Restricciones:

- unico compuesto `userId + role`

### `WebAuthnCredential`

Guarda credenciales de passkeys/WebAuthn.

Campos relevantes:

- `id`
- `userId`
- `credentialId`
- `publicKey`
- `counter`
- `transports`
- `deviceType`
- `backedUp`
- `lastUsedAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Restricciones:

- `credentialId` unico

### `Customer`

Tabla de clientes. Es el CRUD de referencia para verificar la orquestacion del sistema.

Campos relevantes:

- `id`
- `userId`
- `name`
- `taxId`
- `email`
- `phone`
- `status`
- `createdAt`
- `updatedAt`

Restricciones:

- unico compuesto `userId + taxId`

### `Payment`

Tabla de cobros/pagos.

Campos relevantes:

- `id`
- `userId`
- `amount`
- `currency`
- `status`
- `bankAccountRef`
- `externalReference`
- `concept`
- `createdAt`
- `updatedAt`
- `settledAt`

### `Invoice`

Tabla de facturas.

Campos relevantes:

- `id`
- `userId`
- `folio`
- `status`
- `customerTaxId`
- `currency`
- `subtotal`
- `total`
- `pacReference`
- `pacProvider`
- `paymentId`
- `stampedAt`
- `cancelledAt`
- `cancellationRef`
- `createdAt`
- `updatedAt`

Restricciones:

- `folio` unico

### `AuditEvent`

Tabla de auditoria durable.

Campos relevantes:

- `id`
- `userId`
- `requestId`
- `ipAddress`
- `action`
- `result`
- `entityType`
- `entityId`
- `metadata`
- `createdAt`

Notas:

- `userId` es opcional para eventos anonimos o antes de autenticar
- `metadata` es `JSON`

## Enums actuales

### `UserStatus`

- `ACTIVE`
- `LOCKED`
- `DISABLED`

### `UserRole`

- `ADMIN`
- `SECURITY`
- `FINANCE`
- `OPERATOR`
- `AUDITOR`

### `CustomerStatus`

- `ACTIVE`
- `INACTIVE`
- `BLOCKED`

### `PaymentStatus`

- `PENDING`
- `AUTHORIZED`
- `SETTLED`
- `FAILED`
- `REVERSED`

### `InvoiceStatus`

- `DRAFT`
- `STAMPED`
- `CANCELLED`
- `FAILED`

### `AuditResult`

- `SUCCESS`
- `FAILURE`
- `DENIED`

## CRUD de referencia: `customers`

El modulo `customers` existe para dos objetivos:

- cubrir una necesidad de negocio basica
- servir como prueba real de que API, Prisma, PostgreSQL/Neon, Redis, sesiones, reautenticacion y auditoria estan coordinando bien

Codigo principal:

- [customers.controller.ts](../apps/api/src/modules/customers/customers.controller.ts)
- [customers.service.ts](../apps/api/src/modules/customers/customers.service.ts)

### Endpoints

- `POST /api/customers`
- `GET /api/customers`
- `GET /api/customers/:id`
- `PATCH /api/customers/:id`
- `DELETE /api/customers/:id`

### Reglas de acceso

- todas las rutas requieren sesion activa
- `POST`, `PATCH` y `DELETE` requieren reautenticacion reciente
- `GET /api/customers` puede devolver clientes propios o todos segun rol
- `GET /api/customers/:id` valida propietario o rol permitido

### Cache

`GET /api/customers` y `GET /api/customers/:id` usan cache en `Redis`.

El contrato expone:

- `source=database`
- `source=cache`

`PATCH` y `DELETE` invalidan esa cache.

## Payloads del CRUD

### Crear customer

```json
{
  "name": "Cliente Demo",
  "taxId": "XAXX010101000",
  "email": "cliente.demo@correo.com",
  "phone": "5512345678",
  "status": "ACTIVE"
}
```

### Actualizar customer

```json
{
  "name": "Cliente Demo Actualizado",
  "phone": "5599990000"
}
```

## Flujo recomendado de prueba manual

Supuestos:

- API en `http://127.0.0.1:4000`
- admin sembrado con `seed:admin`
- variables `ADMIN_EMAIL` y `ADMIN_PASSWORD` validas

### 1. Health

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:4000/api/health/live"
```

### 2. Login

```powershell
$BaseUrl = 'http://127.0.0.1:4000'
$Email = 'admin@example.com'
$Password = 'ChangeMeNow_123456789!'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$login = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/auth/login" -WebSession $session -ContentType 'application/json' -Body (@{
  email = $Email
  password = $Password
} | ConvertTo-Json)

$login
```

### 3. Ver sesion actual

```powershell
Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/auth/me" -WebSession $session
```

### 4. Reautenticacion

```powershell
Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/auth/reauthenticate" -WebSession $session -ContentType 'application/json' -Body (@{
  password = $Password
} | ConvertTo-Json)
```

### 5. Create

```powershell
$created = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/customers" -WebSession $session -ContentType 'application/json' -Body (@{
  name = 'Cliente Demo'
  taxId = 'XAXX010101000'
  email = 'cliente.demo@correo.com'
  phone = '5512345678'
  status = 'ACTIVE'
} | ConvertTo-Json)

$CustomerId = $created.customer.id
$created
```

### 6. List

```powershell
Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/customers" -WebSession $session
```

### 7. Get

```powershell
Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/customers/$CustomerId" -WebSession $session
```

### 8. Update

```powershell
Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/auth/reauthenticate" -WebSession $session -ContentType 'application/json' -Body (@{
  password = $Password
} | ConvertTo-Json)

Invoke-RestMethod -Method PATCH -Uri "$BaseUrl/api/customers/$CustomerId" -WebSession $session -ContentType 'application/json' -Body (@{
  name = 'Cliente Demo Actualizado'
  phone = '5599990000'
} | ConvertTo-Json)
```

### 9. Delete

```powershell
Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/auth/reauthenticate" -WebSession $session -ContentType 'application/json' -Body (@{
  password = $Password
} | ConvertTo-Json)

Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/api/customers/$CustomerId" -WebSession $session
```

### 10. Logout

```powershell
Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/auth/logout" -WebSession $session
```

## Que valida este CRUD

Si el flujo anterior pasa, queda comprobado:

- la API esta arriba
- el login y la cookie de sesion funcionan
- `Redis` confirma la sesion en cada request protegido
- la reautenticacion funciona para operaciones sensibles
- `Prisma` persiste correctamente en `PostgreSQL/Neon`
- `Redis` cachea lecturas y se invalida en mutaciones
- la auditoria se registra en operaciones clave

## Como seguir despues del CRUD

Una vez validado `customers`, el siguiente orden recomendado es:

1. `payments`
2. `invoices`
3. ceremonia browser-based de `WebAuthn/passkeys`

## Referencias utiles

- [README.md](../README.md)
- [api-surface.md](./api-surface.md)
- [environment-guide.md](./environment-guide.md)
- [local-runbook.md](./local-runbook.md)
