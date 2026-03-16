# Production Readiness

Fecha de referencia: 2026-03-16

## Objetivo

Este documento describe que falta para operar esta plataforma de forma productiva, como priorizarlo y como revisar los hallazgos de auditoria para convertirlos en trabajo ejecutable.

## Estado actual resumido

La base actual ya cubre:

- API modular en `NestJS`
- sesiones stateful en `Redis`
- usuarios y auditoria en `PostgreSQL`
- MFA TOTP con recovery codes y lockout por intentos invalidos
- pagos persistidos
- facturas con timbrado abstracto
- scripts locales de verificacion y smoke tests

La base todavia no cubre completamente:

- integracion bancaria real
- PAC real vendor-specific
- WebAuthn
- observabilidad y despliegue productivo completos
- estrategia HA y DR formal

## Pasos para llevarlo a productivo

### 1. Infraestructura base

Necesitas como minimo:

- `PostgreSQL` administrado o replicado
- `Redis` administrado o altamente disponible
- balanceador o reverse proxy con `TLS`
- despliegue controlado para la API
- secret manager
- monitoreo y alertas

Recomendacion:

- usar `PostgreSQL` administrado con backups automaticos y PITR
- usar `Redis` administrado con persistencia acorde al riesgo aceptado
- no exponer `PostgreSQL` ni `Redis` a internet
- limitar trafico por red privada y security groups

### 2. Configuracion segura

Antes de exponer la aplicacion:

- `NODE_ENV=production`
- `COOKIE_SECURE=true`
- `CORS_ORIGIN` restringido al frontend real
- secretos fuertes para cookies y MFA
- secretos fuera del repositorio y de archivos locales permanentes
- rotacion planificada de secretos
- `PAC_ALLOW_MOCK_IN_PRODUCTION=false`

### 3. Integraciones reales

Para `payments`:

- elegir proveedor bancario o pasarela
- definir contrato de idempotencia
- validar estados intermedios, retries y conciliacion
- auditar callbacks/webhooks

Para `invoices`:

- elegir PAC real
- mapear CFDI real de emisor, receptor, conceptos, impuestos y cancelacion
- validar errores de negocio del PAC y respuestas asincronas
- registrar referencias externas y tiempos de respuesta

### 4. Seguridad adicional

Antes de productivo deberias agregar:

- rate limiting por IP, usuario y ruta
- antifraude o deteccion de anomalias
- CSRF si operas desde navegador con cookies
- WebAuthn para cuentas criticas
- reglas de hardening de cabeceras y proxy
- politicas de password y revocacion de sesiones por cambio de password

### 5. Operacion y despliegue

Tu pipeline deberia cubrir:

1. `npm run verify`
2. pruebas de integracion
3. smoke tests del entorno
4. migraciones controladas
5. despliegue escalonado
6. rollback o mitigacion clara

Checklist minima de deploy:

- la migracion Prisma fue probada en staging
- `health/live` y `health/ready` responden correctamente
- logs y metricas llegan al sistema de observabilidad
- secretos correctos cargados
- integraciones externas alcanzables

## Como revisar la auditoria

La referencia principal es `docs/code-audit.md`.

Usa este proceso:

1. clasifica cada hallazgo
   - seguridad
   - disponibilidad
   - cumplimiento
   - deuda tecnica
2. define severidad
   - bloqueante para produccion
   - importante pero mitigable
   - mejora diferible
3. busca evidencia en codigo
   - modulo afectado
   - endpoint afectado
   - prueba existente o faltante
4. crea una accion concreta
   - fix tecnico
   - control operativo
   - cambio documental
5. valida el cierre
   - reproduccion antes
   - fix
   - prueba
   - actualizacion de documentacion

## Problemas actuales y como atacarlos

### Auditoria no totalmente fail-closed

Riesgo:

- algunos eventos siguen en best effort

Accion recomendada:

1. catalogar eventos criticos vs no criticos
2. forzar `failClosed` en mutaciones de alto impacto
3. medir impacto operativo cuando falle la persistencia de auditoria

### MFA sin WebAuthn

Riesgo:

- postura fuerte, pero no maxima

Accion recomendada:

1. agregar WebAuthn para roles altos
2. auditar enrolamiento, reset y disable
3. revisar telemetria y alertas por lockout MFA

### PAC no productivo

Riesgo:

- el flujo existe, pero no esta listo para fiscal real

Accion recomendada:

1. elegir PAC
2. crear adaptador vendor-specific
3. cubrir errores de negocio, timeout y cancelacion real
4. agregar pruebas de integracion y sandbox

### Dependencias vulnerables

Riesgo:

- hoy `npm audit` ya no reporta vulnerabilidades

Accion recomendada:

1. mantener `npm audit` en CI o en validaciones periodicas
2. rerun `verify` y smoke tests despues de upgrades
3. si reaparecen advisories, revisar changelog del paquete afectado y decidir mitigacion o upgrade

## Como hacerlo mas robusto

### Robustez tecnica

- idempotencia en pagos y timbrado
- circuit breaker para integraciones externas
- retries con backoff
- colas para procesos largos
- timeouts estrictos por dependencia

### Robustez operativa

- monitoreo de errores por modulo
- alertas de degradacion de `health/ready`
- trazabilidad por `requestId`
- dashboards de login, MFA, pagos y facturas

### Robustez de datos

- backups probados
- restauracion ensayada
- versionado de migraciones
- politicas de retencion de auditoria

## Como hacerlo mas escalable

Escalar no significa romper el monolito temprano. El camino recomendado es:

1. primero estabilizar el monolito modular
2. extraer `payments` si el volumen o el banco lo exige
3. extraer `invoices` si el PAC o los tiempos de timbrado lo justifican
4. introducir colas y workers antes de fragmentar mas servicios

Senales de que ya conviene separar:

- cargas muy distintas entre modulos
- necesidades regulatorias de aislamiento
- SLAs diferentes por dominio
- tiempos de respuesta degradados por procesos externos

## Regla de trabajo para siguientes cambios

Despues de cambios importantes:

1. actualizar `README.md`
2. actualizar `docs/code-audit.md` si cambia el riesgo
3. actualizar este documento si cambia el camino a produccion
4. correr `npm run verify`
5. correr `npm run validate:local` cuando haya infraestructura disponible
