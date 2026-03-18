# Auditoria de codigo

Fecha de referencia: 2026-03-16

## Hallazgos actuales

### 1. El PAC productivo todavia no esta integrado

Archivos:

- `apps/api/src/modules/invoices/pac.service.ts`
- `apps/api/src/modules/invoices/invoices.service.ts`

Estado:

- el flujo de timbrado ya existe
- el proveedor `mock` ya no puede usarse en produccion por accidente
- `custom-http` ya permite adaptador externo
- aun falta el adaptador vendor-specific real con mapeo CFDI completo

Impacto:

- la arquitectura ya soporta timbrado
- aun no esta lista para fiscal real de produccion

### 2. WebAuthn ya existe en backend, pero aun falta cerrar el tramo browser y E2E real

Archivos:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/mfa.service.ts`
- `apps/api/src/modules/auth/webauthn.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`

Estado:

- TOTP, recovery codes, disable y admin reset ya existen
- ya hay throttling y lockout
- `login` y `reauthenticate` ya tienen rate limiting en `Redis` por correo/usuario e IP
- WebAuthn/passkeys ya existe en backend para registro, autenticacion, reautenticacion, auditoria y revocacion
- aun falta cerrar frontend/browser y una prueba E2E que ejercite la ceremonia real con origen valido

Impacto:

- la postura de autenticacion ya subio de forma importante
- todavia falta la validacion operativa de punta a punta desde cliente real para darlo por cerrado a nivel producto

### 3. La auditoria durable mejoro, pero sigue sin ser fail-closed para todo el universo de eventos

Archivos:

- `apps/api/src/modules/audit/audit.service.ts`
- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/invoices/invoices.service.ts`

Estado:

- sesiones, pagos y facturas sensibles ya endurecieron sus rutas criticas
- fallos y denegaciones sensibles de `auth` y creacion denegada de `payments` ya pueden endurecerse por prefijos separados
- aun hay eventos no criticos que siguen en best effort

Impacto:

- las mutaciones de mayor riesgo estan mucho mejor protegidas
- la postura de auditoria ya es mas consistente para rutas de seguridad, pero aun no es uniforme para todos los eventos

### 4. La base operativa ya existe, pero falta conectarla a observabilidad productiva real

Archivos:

- `apps/api/src/modules/health/health.controller.ts`
- `apps/api/src/modules/health/health.service.ts`
- `apps/api/src/common/interceptors/request-logging.interceptor.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

Estado:

- ya hay `health/live` y `health/ready` con detalle por dependencia
- ya hay request logs estructurados
- ya existe CI y workflow de release controlado
- faltan backend real de metricas, alertas y plataforma final de despliegue

Impacto:

- el repo ya no depende de memoria tribal para operar
- aun falta la integracion final con tooling productivo

## Hallazgos resueltos en este ciclo

### 1. WebAuthn/passkeys ya esta implementado en backend

Archivos:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/auth/webauthn.service.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/webauthn.service.spec.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`

Estado:

- ya existe modelo durable de credenciales WebAuthn
- ya existen endpoints de registro, autenticacion, listado y revocacion
- `login` ya expone `availableMfaMethods`
- WebAuthn ya puede completar MFA de login y reautenticacion critica
- ya hay pruebas unitarias y migracion aplicada

Impacto:

- la plataforma ya soporta passkeys en backend sin depender solo de TOTP
- mejora la postura de MFA para cuentas criticas y reduce dependencia de secretos compartidos

### 2. Recovery codes y revocacion de la ultima passkey ya son consistentes con WebAuthn

Archivos:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`

Estado:

- `verifyMfa` ya acepta recovery codes cuando el factor primario MFA activo es solo WebAuthn
- ya no existe contradiccion entre `availableMfaMethods` y el comportamiento real del endpoint
- al revocar la ultima credencial WebAuthn ya se endurece la parte de sesiones igual que en un disable de MFA
- si la enforcement de sesiones falla, el estado MFA previo se restaura y queda auditado

Impacto:

- evita bloquear cuentas WebAuthn-only que dependan de recovery codes como respaldo
- evita dejar sesiones antiguas con estado MFA stale cuando se elimina el ultimo factor primario

### 3. Rotacion de sesion ya no expulsa al usuario por un fallo a mitad del refresh

Archivos:

- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/sessions/sessions.service.spec.ts`

Estado:

- `rotateSession` ahora crea primero la sesion de reemplazo
- si la revocacion de la sesion anterior falla, elimina la sesion nueva y propaga el error
- ya existen pruebas para validar el orden y el rollback

Impacto:

- evita logout involuntario por fallos transitorios en Redis o auditoria durante `refresh`

### 4. Disable y admin reset de MFA ya no dejan PostgreSQL y Redis desalineados

Archivos:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`

Estado:

- `disableMfa` y `adminResetMfa` capturan el estado MFA previo
- si la revocacion de sesiones o la actualizacion de la sesion actual fallan, restauran el estado anterior en `PostgreSQL`
- el rollback queda auditado y probado

Impacto:

- evita dejar MFA deshabilitado con sesiones previas todavia activas
- mantiene una postura conservadora de seguridad ante fallos parciales

### 5. La configuracion de cookie local y de CI ya no usa un prefijo invalido para HTTP

Archivos:

- `apps/api/src/common/config/app.config.ts`
- `apps/api/src/common/config/env.validation.ts`
- `.env.example`
- `.github/workflows/ci.yml`

Estado:

- el nombre por defecto ahora es `session` cuando `COOKIE_SECURE=false`
- `__Host-session` queda reservado para cookies seguras sobre HTTPS
- la validacion de entorno ahora bloquea combinaciones invalidas como `COOKIE_NAME=__Host-session` con `COOKIE_SECURE=false`

Impacto:

- evita que navegadores rechacen silenciosamente la cookie de sesion en local o CI HTTP
- alinea mejor el comportamiento local con el comportamiento real del frontend

### 6. `verify` y `validate:local` ya son mas representativos del quality gate real

Archivos:

- `scripts/verify.ps1`
- `scripts/validate-local.ps1`

Estado:

- `verify` ahora reintenta bloqueos transitorios del engine de Prisma en Windows
- `validate:local` ahora ejecuta `lint` ademas de `verify`
- `validate:local` ahora espera `health/live.status=ok` y `health/ready.status=ready`, y muestra logs de la API si el arranque o el smoke fallan
- `seed:admin` ya no regenera Prisma Client de forma redundante; usa el cliente preparado por `verify` o CI para evitar choques `EPERM` en Windows
- `infra:up` y `start-local` sincronizan `apps/api/.env` desde el `.env` raiz para evitar drift de configuracion
- `infra:up` ahora imprime logs de `postgres` y `redis` si bootstrap falla despues de levantar Docker
- `validate:local` ahora limpia el arbol de procesos de la API si el readiness check o el smoke fallan, evitando dejar el puerto `4000` ocupado

Impacto:

- reduce falsos rojos locales por bloqueos temporales del engine
- acerca mas la validacion local al pipeline real de CI
- mejora mucho el diagnostico del tramo full local con dependencias reales

### 7. Las challenges WebAuthn ya se consumen de forma atomica en Redis

Archivos:

- `apps/api/src/modules/auth/webauthn.service.ts`
- `apps/api/src/modules/auth/webauthn.service.spec.ts`

Estado:

- el consumo de challenges de registro y autenticacion ya no usa `GET` seguido de `DEL`
- ahora usa una operacion atomica en Redis para leer y borrar en un solo paso logico

Impacto:

- reduce la ventana de replay bajo concurrencia
- fortalece la integridad de la ceremonia WebAuthn en login y reautenticacion

### 8. El modo degradado ya puede recuperarse sin reinicio cuando vuelven PostgreSQL o Redis

Archivos:

- `apps/api/src/infrastructure/prisma/prisma.service.ts`
- `apps/api/src/infrastructure/redis/redis.service.ts`
- `apps/api/src/modules/health/health.service.ts`
- `apps/api/src/modules/health/health.service.spec.ts`

Estado:

- `PrismaService` y `RedisService` ya exponen `ensureConnected()`
- `health/ready` ya vuelve a sondear dependencias aunque hayan arrancado como no disponibles
- `Redis` ya puede recrear o reconectar el cliente despues de un arranque degradado
- ya existe prueba de readiness para recuperacion posterior

Impacto:

- evita que la API quede degradada hasta reinicio cuando la infraestructura vuelve
- mejora la resiliencia operativa frente a fallos temporales

### 9. La autorecuperacion de Redis ya funciona tambien bajo trafico normal de auth y sesiones

Archivos:

- `apps/api/src/infrastructure/redis/redis.service.ts`
- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/auth/auth-rate-limit.service.ts`
- `apps/api/src/modules/auth/mfa.service.ts`
- `apps/api/src/modules/auth/webauthn.service.ts`

Estado:

- `RedisService` ya expone `ensureAvailable()` para reconectar antes de fallar cerrado
- sesiones, rate limiting, MFA y WebAuthn ya dejaron de depender solo de `assertAvailable()`
- si Redis vuelve despues de un arranque degradado, las rutas de auth y sesion ya intentan recuperarlo en trafico real

Impacto:

- elimina la ventana donde la app seguia fallando aunque Redis ya hubiera vuelto
- mejora la autocuracion real sin depender exclusivamente de `health/ready`

### 10. Los rechazos de auth en guards ya dejan auditoria durable

Archivos:

- `apps/api/src/common/guards/session-auth.guard.ts`
- `apps/api/src/common/guards/recent-reauth.guard.ts`
- `apps/api/src/common/guards/session-auth.guard.spec.ts`
- `apps/api/src/common/guards/recent-reauth.guard.spec.ts`

Estado:

- cookie ausente, sesion invalida o expirada, MFA pendiente y reautenticacion ausente o vencida ya generan `AuditEvent`
- los rechazos quedan asociados a `requestId`, `ipAddress`, ruta y sesion cuando existe
- ya hay pruebas para esos caminos

Impacto:

- mejora la trazabilidad de seguridad en el punto exacto donde antes se perdia contexto
- fortalece la investigacion de incidentes y accesos denegados

### 11. La API ya tiene defensa explicita de `Origin` / `Referer` / `Sec-Fetch-Site` para mutaciones con cookie

Archivos:

- `apps/api/src/main.ts`
- `apps/api/src/common/http/csrf-origin-protection.ts`
- `apps/api/src/common/http/csrf-origin-protection.spec.ts`
- `apps/api/src/common/config/app.config.ts`
- `apps/api/src/common/config/env.validation.ts`
- `.env.example`

Estado:

- las mutaciones browser-based respaldadas por cookie ya validan `Origin`, `Referer` o `Sec-Fetch-Site`
- los clientes no browser sin esas cabeceras siguen pudiendo operar localmente
- `CSRF_TRUSTED_ORIGINS` ya permite explicitar los origins de confianza
- la proteccion ya sigue `API_PREFIX` configurable y normaliza query strings o trailing slashes antes de decidir
- ya existe prueba unitaria de la politica de decision

Impacto:

- reduce la exposicion a CSRF en un modelo stateful con cookies
- endurece el backend sin romper los smoke tests ni la operacion CLI

### 12. La validacion de sesion ya no reescribe Redis en cada request autenticada

Archivos:

- `apps/api/src/modules/sessions/sessions.service.ts`
- `apps/api/src/modules/sessions/sessions.service.spec.ts`
- `apps/api/src/common/config/app.config.ts`
- `apps/api/src/common/config/env.validation.ts`
- `.env.example`

Estado:

- `validateSession` ahora persiste actividad por ventana configurable en lugar de hacerlo en cada request
- `SESSION_TOUCH_INTERVAL_SECONDS` controla el debounce de actividad de sesion
- ya existen pruebas para tocar la sesion cuando la ventana expira y para evitar writes innecesarios entre requests cercanas

Impacto:

- reduce write amplification sobre Redis remoto
- mejora escalabilidad sin perder expiracion por inactividad

### 13. La clasificacion de errores de dependencia en el filtro global ya es mas explicita y menos fragil

Archivos:

- `apps/api/src/common/filters/all-exceptions.filter.ts`
- `apps/api/src/common/filters/all-exceptions.filter.spec.ts`

Estado:

- el filtro ya usa una clasificacion centralizada por codigos, nombres conocidos, causas encadenadas y un conjunto acotado de mensajes
- se elimino la dependencia de regex abiertas para distinguir fallos operativos
- ya existe prueba para `ECONNREFUSED`, errores de dependencia conocidos y errores internos reales

Impacto:

- reduce el riesgo de volver a transformar fallos operativos en `500` inesperados
- hace mas mantenible la frontera entre errores de dependencia y errores internos

## Mejoras aplicadas en este ciclo

### 1. CRUD util de `customers` para validar Prisma + Redis

Archivos:

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260316153000_add_customers/migration.sql`
- `apps/api/src/modules/customers/*`
- `scripts/smoke-test.ps1`

Estado:

- existe un CRUD completo de `customers`
- lectura de lista e item usa cache Redis con `source=database|cache`
- create/update/delete invalidan cache
- el smoke test ya recorre ese CRUD antes de pagos y facturas

Impacto:

- da una verificacion mas visible de la orquestacion real entre API, Prisma, PostgreSQL y Redis
- deja una base reutilizable para catalogos y datos maestros

### 2. Preparacion explicita para Neon con Prisma

Archivos:

- `apps/api/prisma/schema.prisma`
- `.env.example`

Estado:

- Prisma ya soporta `DIRECT_DATABASE_URL`
- el repo ya distingue la URL pooled de aplicacion y la URL directa de migraciones

Impacto:

- deja al proyecto listo para mover PostgreSQL local a Neon sin rehacer el flujo de Prisma

- se agrego lint real con `eslint.config.mjs`
- se agregaron scripts raiz de `lint`, `audit:deps`, `prisma:migrate:status` y `prisma:migrate:controlled`
- se incorporo `scripts/deploy-migrations.ps1`
- se definio `ci.yml` con verify, lint, audit y smoke tests
- se definio `deploy.yml` con quality gate, migraciones controladas y smoke post-deploy
- se agrego `dependabot.yml`
- `health/live` y `health/ready` ahora reportan metadata y checks por dependencia
- se agrego logging estructurado de requests
- se corrigio la clasificacion de errores controlados para que `503` operativos se registren como `warn` y no como `500` inesperados
- la politica fail-closed de auditoria ahora distingue prefijos por `SUCCESS`, `FAILURE` y `DENIED`
- `payments.create.denied` ya no usa fire-and-forget y respeta fail-closed real
- `RedisService` ahora actualiza mejor su estado de disponibilidad
- se agregaron runbooks de incidente, revocacion, rotacion y despliegue
- se amplio el `README` y la documentacion operativa
- `auth` ahora aplica rate limiting real para `login` y `reauthenticate` con trazabilidad de eventos `rate_limited`
- la rotacion de sesion ahora hace rollback del reemplazo si la revocacion de la sesion anterior falla
- disable y admin reset de MFA ahora restauran el estado anterior si la parte de sesiones no se puede completar
- la configuracion de cookie local y de CI ya no usa un nombre `__Host-*` invalido para HTTP
- `verify` ahora reintenta bloqueos transitorios del engine de Prisma y `validate:local` incluye `lint`
- el flujo full local ahora sincroniza env, espera readiness real y muestra logs utiles al fallar

## Dependencias

Estado actual de `npm audit`:

- 0 vulnerabilidades

## Como usar esta auditoria

1. elegir un hallazgo
2. confirmarlo en codigo
3. definir severidad
4. aplicar fix tecnico u operativo
5. agregar pruebas si aplica
6. correr `npm run verify`
7. correr `npm run lint`
8. correr `npm run validate:local`
9. actualizar este archivo y `README.md`

## Recomendacion de siguiente fase

1. elegir e integrar un PAC real
2. cerrar frontend/browser y E2E real para WebAuthn/passkeys
3. conectar logs y metricas a observabilidad real
4. endurecer aun mas la politica fail-closed de auditoria
