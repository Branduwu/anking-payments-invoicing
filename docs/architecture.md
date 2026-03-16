# Arquitectura objetivo

## Vision general

La plataforma debe proteger activos de alto impacto: credenciales, sesiones, operaciones financieras y timbrado fiscal. Para arrancar con bajo costo operativo sin perder orden arquitectonico, la recomendacion es un monolito modular en `NestJS`, preparado para evolucionar a servicios separados.

Flujo principal:

```text
Frontend web
  -> API NestJS
    -> modulo auth
    -> modulo sessions
    -> modulo payments
    -> modulo invoices
    -> modulo audit
      -> PostgreSQL (persistencia durable)
      -> Redis (sesiones activas y datos efimeros)
      -> integraciones externas (banco / PAC)
```

## Decisiones clave

### 1. Backend central inicial

Se implementa una sola API con modulos bien delimitados, en lugar de varios microservicios desde el dia uno.

Motivos:

- reduce complejidad operativa
- simplifica despliegue y debugging
- mantiene fronteras de dominio para extraer despues
- evita introducir problemas de consistencia distribuida demasiado pronto

### 2. Sesiones stateful

La autenticacion usa sesiones server-side y cookie segura. El frontend nunca decide si el usuario esta autenticado; siempre lo valida el backend contra el store de sesiones.

Redis es la fuente de verdad para sesiones activas.

Claves recomendadas:

```text
session:{sessionId}
user_sessions:{userId}
```

Estructura recomendada para `session:{sessionId}`:

```json
{
  "userId": "usr_123",
  "status": "active",
  "mfaLevel": "totp",
  "createdAt": "2026-03-15T23:00:00.000Z",
  "lastActivity": "2026-03-15T23:05:00.000Z",
  "expiresAt": "2026-03-15T23:20:00.000Z",
  "absoluteExpiresAt": "2026-03-16T07:00:00.000Z",
  "reauthenticatedUntil": "2026-03-15T23:10:00.000Z"
}
```

### 3. Persistencia

`PostgreSQL` almacena:

- usuarios
- credenciales hasheadas
- roles y estados
- facturas
- pagos
- auditoria

`Redis` almacena:

- sesiones activas
- ventanas de reautenticacion
- contadores de rate limiting
- datos temporales de MFA o challenges

## Fronteras de dominio

### Auth

- login
- logout
- MFA
- cambio de password
- reautenticacion

### Sessions

- validar cookie de sesion
- crear, rotar y revocar sesiones
- listar sesiones activas
- cerrar una o todas

### Payments

- iniciar cobros
- consultar cobros
- registrar resultado del banco
- validar permisos y reautenticacion

### Invoices

- emitir factura
- timbrar con PAC
- cancelar factura
- registrar estado fiscal

### Audit

- registrar eventos criticos
- correlacionar `requestId`, usuario, IP y resultado

## Estrategia de evolucion

Disparadores razonables para separar servicios:

- necesidad de escalar `payments` o `invoices` de forma independiente
- obligaciones regulatorias o de segregacion mas estrictas
- integraciones externas con latencias o SLAs muy distintos
- colas asynchronas y reintentos complejos

Cuando eso ocurra, el orden recomendado es:

1. extraer `payments`
2. extraer `invoices`
3. dejar `auth` y `sessions` lo mas centralizados posible

