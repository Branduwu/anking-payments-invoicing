# FAQ Tecnica

Fecha de referencia: 2026-03-16

## Objetivo

Esta FAQ resume errores reales y dudas tecnicas que ya aparecieron durante el desarrollo del proyecto.

Usala cuando necesites diagnosticar rapido:

- Prisma y migraciones
- Neon o PostgreSQL
- Redis y sesiones
- Docker local
- PowerShell vs `curl`
- reautenticacion
- MFA y WebAuthn

## Prisma y base de datos

### `DIRECT_DATABASE_URL` no existe o Prisma falla con `P1012`

Problema tipico:

- `Error: Environment variable not found: DIRECT_DATABASE_URL`

Causa:

- el esquema Prisma usa `DATABASE_URL` y `DIRECT_DATABASE_URL`
- la aplicacion usa la URL pooled
- las migraciones deben usar la URL directa

Que hacer:

1. valida que `.env` tenga ambas variables
2. si usas Neon:
   - `DATABASE_URL` = pooled
   - `DIRECT_DATABASE_URL` = direct
3. vuelve a correr:

```powershell
npm run prisma:migrate:deploy
```

Lee tambien:

- [environment-guide.md](./environment-guide.md)
- [ci-cd.md](./ci-cd.md)

### Prisma falla con `P3005` porque la base no esta vacia

Problema tipico:

- Prisma detecta que la base ya tiene tablas ajenas al proyecto

Causa:

- se esta intentando migrar sobre una base usada antes para pruebas

Que hacer:

1. crea una base nueva y vacia
2. apunta `DATABASE_URL` y `DIRECT_DATABASE_URL` a esa base
3. vuelve a correr migraciones

Recomendacion:

- si usas Neon, crea una base dedicada para el proyecto, por ejemplo `banking_platform`

### Prisma falla con `EPERM` sobre `query_engine-windows.dll.node`

Problema tipico:

- en Windows, `verify` o `prisma generate` falla al renombrar el engine

Causa:

- normalmente hay un proceso `node`, watcher o API levantada bloqueando el engine

Que hacer:

1. detiene `npm run dev`, `npm start` o cualquier watcher
2. repite:

```powershell
npm run verify
```

3. si cambiaste `schema.prisma`, usa:

```powershell
npm run verify:full
```

Nota:

- el script `verify` ya reintenta este caso antes de fallar

### `build:web` o `vite build` falla con `spawn EPERM` en Windows

Problema tipico:

- el frontend minimo falla en `vite build`
- el stack menciona `esbuild`, `vite:build-html` o `spawn EPERM`

Causa probable:

- una politica local de Windows esta bloqueando el modo servicio que usa `esbuild`
- no suele ser una regresion del panel ni del flujo WebAuthn

Que hace hoy el repo:

- `verify` deja pasar especificamente ese borde local de Windows para que no bloquee `build:api`, `test` y `lint:web`
- el flujo browser-based real sigue cubierto por `npm run e2e:webauthn`
- el merge gate del repo ya corre ese E2E en Linux CI

Que hacer si quieres forzar el build web local:

1. prueba en `WSL` o Linux
2. revisa politicas locales que impidan el spawn del servicio de `esbuild`
3. confirma que `npm run lint` y `npm run e2e:webauthn` sigan verdes

## Neon y PostgreSQL

### No se si conectar Neon o Prisma

Respuesta corta:

- no eliges entre uno u otro
- `Prisma` es el ORM
- `Neon` es la base PostgreSQL

La cadena correcta es:

```text
NestJS -> Prisma -> Neon
```

### Como se configuran las URLs de Neon

Regla correcta:

- `DATABASE_URL` = URL pooled de Neon
- `DIRECT_DATABASE_URL` = URL direct de Neon

No las inviertas.

### `Can't reach database server` o `health/ready` da error de base

Causas comunes:

- `DATABASE_URL` o `DIRECT_DATABASE_URL` incorrectas
- la base no responde
- el firewall o red bloquea la salida

Que hacer:

1. revisa `.env`
2. revisa `GET /api/health/ready`
3. si usas Neon, confirma que el proyecto este activo y la URL sea correcta

## Redis, sesiones y cache

### Redis no conecta o la API dice que la sesion no existe

Causas comunes:

- `REDIS_URL` incorrecta
- Redis abajo
- credenciales invalidas

Que hacer:

1. valida `REDIS_URL`
2. revisa `GET /api/health/ready`
3. confirma que Redis este arriba o que el host remoto responda

### Que guarda Redis y que guarda PostgreSQL

`PostgreSQL` guarda:

- usuarios
- credenciales
- roles
- customers
- pagos
- facturas
- auditoria

`Redis` guarda:

- sesiones activas
- challenges WebAuthn
- rate limiting
- ventanas de reautenticacion
- cache de lecturas

Guia detallada:

- [data-model-and-crud-guide.md](./data-model-and-crud-guide.md)

### La cookie existe pero las rutas protegidas fallan

Causa:

- la cookie sola no autentica
- el backend debe validar la sesion en `Redis` en cada request

Que hacer:

1. revisa que la sesion exista en Redis
2. revisa si la sesion expiro
3. revisa si la sesion esta pendiente de MFA

## Docker local

### `validate:local` o `infra:up` falla porque Docker no esta disponible

Que hacer:

1. instala o abre Docker Desktop
2. confirma:

```powershell
docker --version
docker compose version
```

3. vuelve a correr:

```powershell
npm run infra:up
npm run validate:local
```

### Docker reinicio la PC o no veo contenedores

Que hacer:

1. abre Docker Desktop
2. confirma que el engine este `running`
3. valida:

```powershell
docker compose ps
```

4. si hace falta, vuelve a levantar:

```powershell
npm run infra:up
```

## PowerShell vs `curl`

### Mis comandos `curl` no funcionan en PowerShell

Causa:

- en PowerShell no debes usar la continuacion de `cmd` con `^`

Que hacer:

- usa `Invoke-RestMethod`
- o usa `curl.exe` en una sola linea
- o usa el caracter de continuacion de PowerShell: la comilla invertida `` ` ``

Ejemplo sano en PowerShell:

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:4000/api/health/live"
```

### `Invoke-RestMethod` dice que no puede conectar

Causa:

- la API no estaba levantada

Que hacer:

1. arranca la API:

```powershell
npm run dev
```

2. valida salud:

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:4000/api/health/live"
```

## Reautenticacion

### Login funciona, pero `POST /api/customers`, `POST /api/payments` o `POST /api/invoices` fallan

Causa:

- esas rutas requieren reautenticacion reciente

Que hacer:

1. corre:

```powershell
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:4000/api/auth/reauthenticate" -WebSession $session -ContentType 'application/json' -Body (@{
  password = $Password
} | ConvertTo-Json)
```

2. vuelve a intentar la mutacion sensible

### La reautenticacion por password ya no basta

Causa:

- si el usuario tiene MFA activo, la reautenticacion reforzada puede requerir TOTP, recovery code o WebAuthn

Que hacer:

- completa MFA segun `availableMfaMethods`
- si ya tienes sesion autenticada y solo necesitas reabrir la ventana critica con TOTP o recovery code, usa `POST /api/auth/reauthenticate/mfa`

## MFA y WebAuthn

### `mfaRequired=true` y no se que hacer

Debes revisar `availableMfaMethods`.

Puede incluir:

- `totp`
- `recovery_code`
- `webauthn`

Entonces completas uno de esos caminos.

### WebAuthn no se puede probar con PowerShell o `curl`

Causa:

- la ceremonia necesita APIs del navegador y un `origin` valido

Que hacer:

1. usa frontend o navegador real
2. valida `WEBAUTHN_RP_ID`
3. valida `WEBAUTHN_ORIGINS`

Hoy el repo ya incluye una ruta lista para eso:

```powershell
npm run dev:web
npm run e2e:webauthn
```

`dev:web` levanta el panel minimo de passkeys y `e2e:webauthn` valida la ceremonia completa con `Playwright`.
El comando `e2e:webauthn` ahora regenera Prisma Client antes de arrancar el laboratorio, para evitar que `ts-node` caiga por tipos stale del cliente en CI o en maquinas limpias.

### Quiero levantar todo el laboratorio de passkeys de una sola vez

Usa:

```powershell
npm run webauthn:demo
```

Y si quieres que abra el navegador al final:

```powershell
npm run webauthn:demo:open
```

Eso prepara infra, usuario demo, API y frontend con logs listos para revisar.
Ahora lo hace sobre `PostgreSQL` y `Redis` locales por defecto, para no depender accidentalmente de URLs remotas en `.env`.
Si Docker Desktop no esta arriba, el script ya falla con un mensaje explicito.
Tambien fija `CORS_ORIGIN`, `CSRF_TRUSTED_ORIGINS`, `WEBAUTHN_RP_ID` y `WEBAUTHN_ORIGINS` locales cuando corre en modo aislado.
El cleanup del laboratorio en CI ya es best-effort para no convertir un fallo temprano de bootstrap en un error secundario de `infra:down`.

### `No active WebAuthn registration challenge found`

Causas comunes:

- la challenge expiro
- la sesion cambio
- el navegador perdio el contexto

Que hacer:

1. vuelve a pedir `registration/options`
2. termina la ceremonia sin recargar
3. revisa `WEBAUTHN_TIMEOUT_MS`

### WebAuthn o revocacion de credenciales falla con `Failed to fetch` en navegador

Causas comunes:

- la API no permite el metodo HTTP mutante en CORS
- el frontend corre desde un `origin` no permitido
- la API no esta arriba o el puerto no coincide
- frontend y API estan mezclando `localhost` con `127.0.0.1`

Que hacer:

1. abre el panel y pulsa `Probar API`
2. confirma que `live=ok` y `ready=ready`
3. confirma que frontend y API usan la misma pareja:
   - `http://localhost:3000` con `http://localhost:4000/api`
   - o `http://127.0.0.1:3000` con `http://127.0.0.1:4000/api`
4. revisa `CORS_ORIGIN`, `CSRF_TRUSTED_ORIGINS` y `WEBAUTHN_ORIGINS`
5. si el panel marca mismatch, usa `Usar localhost` o `Usar 127.0.0.1`
6. corre:

```powershell
npm run e2e:webauthn
```

Si ese flujo pasa, la ceremonia browser-based, el CORS y la revocacion WebAuthn ya quedaron bien orquestados.

## FAQ de trabajo diario

### Que corro despues de cambios importantes

```powershell
npm run verify
npm run lint
npm run validate:local
```

### Que documento leo si soy nuevo

Empieza por:

- [README.md](../README.md)
- [onboarding.md](./onboarding.md)
- [documentation-map.md](./documentation-map.md)

### Que documento leo si algo falla

Segun el problema:

- ambiente: [environment-guide.md](./environment-guide.md)
- operacion local: [local-runbook.md](./local-runbook.md)
- seguridad o hallazgos: [code-audit.md](./code-audit.md)
- despliegue: [ci-cd.md](./ci-cd.md)
