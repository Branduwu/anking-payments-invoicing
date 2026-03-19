# Onboarding para Nuevos Desarrolladores

Fecha de referencia: 2026-03-16

## Objetivo

Esta guia ayuda a una persona nueva a:

- entender que es este proyecto
- levantarlo localmente
- saber por donde empezar a leer
- probar un flujo real
- trabajar sin romper la logica de negocio

## Que es este proyecto

`anking-payments-invoicing` es la base de una plataforma segura para:

- autenticacion robusta
- sesiones stateful server-side
- MFA con TOTP y WebAuthn/passkeys
- cobros bancarios
- facturacion con timbrado y cancelacion
- auditoria durable

No esta pensado como demo rapida. La idea es tener una base seria que pueda evolucionar hacia productivo.

## Modelo mental minimo

Antes de tocar codigo, entiende estas reglas:

- `PostgreSQL/Neon` guarda lo durable
- `Redis` guarda sesiones, rate limiting, challenges y cache
- el navegador no decide autenticacion; el backend valida la sesion en cada request
- operaciones sensibles exigen reautenticacion reciente
- eventos sensibles deben quedar auditados

Si esta parte no esta clara, lee primero:

- [README.md](../README.md)
- [documentation-map.md](./documentation-map.md)
- [technical-faq.md](./technical-faq.md)
- [architecture.md](./architecture.md)
- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)

## Stack actual

- `NestJS`
- `TypeScript`
- `Prisma ORM`
- `PostgreSQL` o `Neon`
- `Redis`
- `Docker` y `Docker Compose`
- `Jest`
- `ESLint`

## Donde vive cada cosa

### Aplicacion

- `apps/api/src`

Modulos importantes:

- `auth`
- `sessions`
- `customers`
- `payments`
- `invoices`
- `audit`
- `health`

### Esquema y migraciones

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations`

### Scripts operativos

- `scripts/setup-workstation.ps1`
- `scripts/start-infra.ps1`
- `scripts/start-local.ps1`
- `scripts/validate-local.ps1`
- `scripts/smoke-test.ps1`
- `scripts/verify.ps1`

### Documentacion

- `README.md`
- `docs/architecture.md`
- `docs/data-model-and-crud-guide.md`
- `docs/environment-guide.md`
- `docs/local-runbook.md`
- `docs/code-audit.md`
- `docs/diagrams-index.md`

## Primer recorrido recomendado

Haz esto en este orden:

1. leer `README.md`
2. leer [documentation-map.md](./documentation-map.md)
3. leer [architecture.md](./architecture.md)
4. leer [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)
5. leer [diagrams-index.md](./diagrams-index.md)
6. abrir `schema.prisma`
7. revisar `auth`, `sessions` y `customers`

## Como levantar el proyecto

### Opcion 0. Bootstrap rapido de una PC nueva

Si estas en una workstation Windows nueva, empieza aqui:

```powershell
npm run setup:workstation
```

Si quieres que tambien intente instalar prerequisitos faltantes con `winget` y deje Chromium listo para `Playwright`:

```powershell
npm run setup:workstation:full
```

Esto ayuda a reducir drift entre maquinas y acelera onboarding, aunque no reemplaza revisar `.env` cuando uses Neon, Redis remoto o secretos propios.

### Opcion A. Todo local con Docker

1. copiar variables:

```powershell
Copy-Item .env.example .env
```

2. instalar dependencias:

```powershell
npm install
```

3. levantar infraestructura:

```powershell
npm run infra:up
```

4. validar:

```powershell
npm run validate:full
```

### Opcion B. Neon + Redis local o remoto

1. configurar:

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`

2. instalar dependencias:

```powershell
npm install
```

3. migrar y seedear:

```powershell
npm run prisma:migrate:deploy
npm run seed:admin
```

4. validar:

```powershell
npm run validate:local
```

Mas detalle:

- [environment-guide.md](./environment-guide.md)
- [local-runbook.md](./local-runbook.md)

## Primer flujo de negocio que debes probar

El flujo recomendado para una persona nueva es el CRUD de `customers`.

Por que:

- usa sesion real
- usa reautenticacion
- persiste con Prisma
- toca PostgreSQL/Neon
- toca Redis
- invalida cache
- deja auditoria

Guia exacta:

- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)

## Como validar antes de entregar cambios

Regla del proyecto:

1. `npm run verify`
2. `npm run lint`
3. `npm run validate:local`
4. revisar si hay que actualizar documentacion

Si cambias seguridad, auth, sesiones, infraestructura o contratos:

- tambien revisa [code-audit.md](./code-audit.md)

## Como pensar cambios sin romper la logica de negocio

Cuando vayas a cambiar algo, pregunta primero:

- esto afecta sesion o Redis
- esto afecta reautenticacion
- esto afecta auditoria
- esto afecta una mutacion sensible
- esto cambia contratos de API
- esto requiere actualizar diagramas o README

Si la respuesta es si a alguna de esas, no cierres el cambio sin actualizar docs y validaciones.

## Buen punto de entrada para entender el codigo

### Auth y sesiones

Lee:

- `apps/api/src/modules/auth`
- `apps/api/src/modules/sessions`

Objetivo:

- entender login
- entender MFA
- entender revocacion y rotacion de sesiones

### Datos y persistencia

Lee:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/infrastructure/prisma`
- `apps/api/src/infrastructure/redis`

Objetivo:

- entender que vive en la base
- entender que vive en Redis

### CRUD de referencia

Lee:

- `apps/api/src/modules/customers`

Objetivo:

- ver un flujo completo y pequeno de negocio

## Errores comunes de una persona nueva

- asumir que la cookie sola autentica sin Redis
- confundir `PostgreSQL` con store de sesiones
- saltarse `reauthenticate` antes de una mutacion sensible
- probar WebAuthn con `curl` o `PowerShell`
- cambiar codigo y no actualizar `README` ni docs

## Como saber si todo esta sano

Checklist rapido:

- `GET /api/health/live` responde `ok`
- `GET /api/health/ready` responde `ready`
- `login` funciona
- `customers` funciona end-to-end
- `validate:local` pasa

## Documentos que debes tener abiertos a mano

- [README.md](../README.md)
- [documentation-map.md](./documentation-map.md)
- [architecture.md](./architecture.md)
- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)
- [diagrams-index.md](./diagrams-index.md)
- [environment-guide.md](./environment-guide.md)
- [technical-faq.md](./technical-faq.md)
- [code-audit.md](./code-audit.md)

## Siguiente nivel despues del onboarding

Cuando ya entiendas el proyecto, los siguientes frentes naturales son:

1. `payments`
2. `invoices`
3. frontend/browser de `WebAuthn/passkeys`
4. PAC vendor-specific real
5. observabilidad productiva
