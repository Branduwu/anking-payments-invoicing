# Indice de Diagramas

Fecha de referencia: 2026-03-16

## Objetivo

Esta guia sirve como mapa rapido de los diagramas del proyecto.

Usala cuando quieras:

- entender un flujo sin leer todo el codigo
- ubicar en que documento esta un diagrama concreto
- seguir un orden de lectura logico

## Orden recomendado de lectura

Si eres nuevo en el proyecto, este es el mejor orden:

1. arquitectura general y autenticacion
2. sesiones y reautenticacion
3. modelo de datos
4. CRUD de referencia
5. payments
6. invoices

## Diagramas disponibles

### En `architecture.md`

Archivo:

- [architecture.md](./architecture.md)

Diagramas:

- `Diagrama de autenticacion, sesion y MFA`
  - explica login, sesion parcial por MFA y elevacion de `mfaLevel`
- `Diagrama de vida de la sesion`
  - explica validacion de cookie, lookup en Redis, expiracion y fallo cerrado
- `Diagrama de reautenticacion critica`
  - explica cuando una operacion sensible exige password o MFA reciente
- `Secuencia: login -> sesion -> reauth -> create customer`
  - muestra un flujo completo de usuario, API, Redis, PostgreSQL/Neon y auditoria
- `Secuencia: reauth -> create payment`
  - muestra el recorrido de un cobro con reautenticacion y escritura durable
- `Secuencia: create invoice -> stamp -> cancel`
  - muestra el ciclo de vida de la factura y el punto donde participa el PAC

### En `data-model-and-crud-guide.md`

Archivo:

- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)

Diagramas:

- `Diagrama ER simple`
  - resume las relaciones principales de tablas
- `Diagrama ER en Mermaid`
  - muestra el modelo de datos actual con mas detalle

## Que responde cada diagrama

### Si quieres entender login y MFA

Lee:

- `Diagrama de autenticacion, sesion y MFA`

Te responde:

- donde valida credenciales el backend
- donde se crea la sesion
- cuando una sesion queda `pending_mfa`
- como se completa MFA

### Si quieres entender por que Redis es critico

Lee:

- `Diagrama de vida de la sesion`

Te responde:

- por que la cookie no basta por si sola
- como se valida la sesion en cada request
- por que Redis es la fuente de verdad operativa

### Si quieres entender mutaciones sensibles

Lee:

- `Diagrama de reautenticacion critica`
- `Secuencia: login -> sesion -> reauth -> create customer`
- `Secuencia: reauth -> create payment`

Te responde:

- cuando hace falta reautenticacion
- como se abre `reauthenticatedUntil`
- por que `customers`, `payments` e `invoices` no se escriben solo con login viejo

### Si quieres entender facturacion

Lee:

- `Secuencia: create invoice -> stamp -> cancel`

Te responde:

- por que la factura nace en `DRAFT`
- cuando se llama al PAC
- que se persiste en la base
- cuando entra la auditoria

### Si quieres entender tablas y relaciones

Lee:

- `Diagrama ER simple`
- `Diagrama ER en Mermaid`

Te responde:

- que tablas existen hoy
- cual es la entidad central
- como se conectan usuarios, credenciales, customers, payments, invoices y audit

## Como usar este indice en onboarding

Ruta corta recomendada para una persona nueva:

1. leer [README.md](../README.md)
2. abrir [onboarding.md](./onboarding.md)
3. usar este indice para saltar al diagrama que haga falta
4. validar el CRUD de `customers`

## Nota importante

Los diagramas describen el estado implementado hoy, no una arquitectura imaginaria futura.

La fuente de verdad sigue siendo:

- [schema.prisma](../apps/api/prisma/schema.prisma)
- codigo en `apps/api/src`

