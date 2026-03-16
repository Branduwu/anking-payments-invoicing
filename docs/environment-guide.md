# Guia de Ambientacion

Fecha de referencia: 2026-03-16

## Objetivo

Esta guia explica como ambientar el proyecto en tres escenarios:

1. local completo con Docker
2. local con Neon
3. preparacion base para productivo

Tambien explica el reparto correcto entre `PostgreSQL` y `Redis`.

## Modelo de datos y sesion

### PostgreSQL

Guarda lo durable:

- usuarios
- credenciales
- roles
- customers
- pagos
- facturas
- auditoria

### Redis

Guarda lo efimero:

- sesiones activas
- `sessionId`
- `lastActivity`
- expiracion idle
- expiracion absoluta
- estado MFA de sesion
- ventana de reautenticacion
- rate limiting
- cache de lecturas rapidas

### Autenticacion actual

El proyecto usa sesiones server-side:

- no depende de JWT access token + refresh token como mecanismo principal
- usa cookie con `sessionId`
- valida la sesion en `Redis` en cada request protegida
- revoca sesiones de inmediato desde `Redis`
- registra auditoria durable en `PostgreSQL`

## Escenario 1. Local completo con Docker

### Requisitos

- Docker Desktop funcionando
- Node.js instalado
- `npm`

### Variables

Parte de:

```powershell
Copy-Item .env.example .env
```

Minimo recomendado:

- `COOKIE_SECRET`
- `MFA_ENCRYPTION_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Deja estas URLs locales:

```env
DATABASE_URL=postgresql://platform:platform@localhost:5432/platform
DIRECT_DATABASE_URL=postgresql://platform:platform@localhost:5432/platform
REDIS_URL=redis://localhost:6379
```

### Levantar

```powershell
npm.cmd install
npm.cmd run infra:up
npm.cmd run validate:full
```

### Resultado esperado

- `PostgreSQL` en `localhost:5432`
- `Redis` en `localhost:6379`
- migraciones aplicadas
- admin sembrado
- smoke full verde

## Escenario 2. Local con Neon

### Cuando usarlo

Cuando quieres desarrollar localmente pero apuntando a una base administrada en la nube.

### Variables

Pon:

```env
DATABASE_URL=postgresql://<pooled-neon-url>
DIRECT_DATABASE_URL=postgresql://<direct-neon-url>
```

Recomendacion:

- `DATABASE_URL`: URL pooled de Neon para la aplicacion
- `DIRECT_DATABASE_URL`: URL directa para migraciones Prisma
- usa una base dedicada y vacia para el proyecto, por ejemplo `banking_platform`

### Redis

Tienes dos opciones:

1. Redis local:

```env
REDIS_URL=redis://localhost:6379
```

2. Redis remoto:

```env
REDIS_URL=redis://<host>:6379
```

o

```env
REDIS_URL=rediss://<host>:6379
```

### Flujo recomendado

```powershell
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:deploy
npm.cmd run seed:admin
npm.cmd run validate:local
```

Estado ya comprobado en este repo:

- migraciones Prisma aplicadas a Neon
- admin sembrado correctamente
- validacion local completa verde con Neon + Redis

### Notas importantes

- si usas Neon, no necesitas `PostgreSQL` local
- si mantienes `REDIS_URL` local, si necesitas Redis arriba
- `validate:full` puede seguir sirviendo si Redis esta en Docker/local

## Escenario 3. Preparacion base para productivo

No es solo cambiar URLs. Debes cambiar postura operativa.

### Seguridad minima

- `NODE_ENV=production`
- `COOKIE_SECURE=true`
- `COOKIE_NAME=__Host-session`
- `TLS`
- secretos fuera del repo
- PAC real

### Infraestructura minima

- `PostgreSQL` administrado
- `Redis` administrado o alta disponibilidad
- balanceador o reverse proxy
- monitoreo y alertas

### Flujo minimo de despliegue

1. generar Prisma Client
2. revisar `migrate status`
3. aplicar `migrate deploy`
4. arrancar API
5. correr smoke post-deploy

## Variables mas importantes

### Core

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `REDIS_KEY_PREFIX`
- `ALLOW_DEGRADED_STARTUP`

### Cookie y sesion

- `COOKIE_NAME`
- `COOKIE_SECRET`
- `COOKIE_SECURE`
- `SESSION_IDLE_TIMEOUT_MINUTES`
- `SESSION_ABSOLUTE_TIMEOUT_HOURS`
- `REAUTH_WINDOW_MINUTES`

### Seguridad

- `MFA_ENCRYPTION_KEY`
- `AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- `AUTH_REAUTH_RATE_LIMIT_MAX_ATTEMPTS`
- `MFA_VERIFY_MAX_ATTEMPTS`
- `MFA_VERIFY_LOCKOUT_MINUTES`

### Admin bootstrap

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

### PAC

- `PAC_PROVIDER`
- `PAC_BASE_URL`
- `PAC_API_KEY`
- `PAC_TIMEOUT_MS`

## Validaciones recomendadas

### Rapida

```powershell
npm.cmd run verify
npm.cmd run lint
```

### Completa

```powershell
npm.cmd run validate:full
```

### Infraestructura solamente

```powershell
npm.cmd run infra:up
docker compose ps
```

## Troubleshooting corto

### La API no arranca

- revisa `.env`
- revisa `DATABASE_URL`
- revisa `REDIS_URL`
- consulta `GET /api/health/live`
- consulta `GET /api/health/ready`

### Prisma no migra

- valida `DIRECT_DATABASE_URL`
- si usas Neon, confirma que sea la URL directa

### La sesion no dura o no revoca

- revisa `REDIS_URL`
- revisa que Redis este arriba
- revisa `GET /api/health/ready`

### El login existe pero rutas protegidas fallan

- la sesion puede no estar viva en Redis
- puede faltar MFA
- puede haber expirado la ventana de reautenticacion
