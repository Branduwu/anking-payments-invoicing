# Observabilidad

Fecha de referencia: 2026-03-16

## Objetivo

Definir como observar la salud del servicio, que alertas valen la pena y como leer la telemetria actual del backend.

## Salud del servicio

### `GET /api/health/live`

Siempre debe responder mientras el proceso este arriba.

Entrega:

- `status`
- `timestamp`
- `service.name`
- `service.version`
- `service.commitSha`
- `service.environment`
- `service.uptimeSeconds`
- `service.degradedStartupAllowed`

Uso:

- liveness probe del orquestador
- chequeo rapido durante incidentes

### `GET /api/health/ready`

Valida dependencias de negocio:

- `PostgreSQL`
- `Redis`

Si alguna dependencia falla:

- responde `503`
- incluye `checks[]` con estado y detalle por dependencia

Uso:

- readiness probe
- alertas
- diagnostico de degradacion

## Logs actuales

La API ya emite logs estructurados de:

- eventos de auditoria
- errores globales
- requests HTTP via `RequestLoggingInterceptor`

Campos principales por request:

- `event`
- `timestamp`
- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- `ipAddress`
- `userAgent`
- `userId`

Regla actual de severidad en logs:

- respuestas exitosas: `log`
- errores controlados por `HttpException`, incluidos `503` de dependencias: `warn`
- errores inesperados `500`: `error`

## Alertas recomendadas

### Criticas

- `health/ready` en `503` durante mas de 2 minutos
- errores de persistencia de auditoria en eventos `failClosed`
- fallos sostenidos de conexion a `PostgreSQL`
- fallos sostenidos de conexion a `Redis`
- error rate alto en `payments` o `invoices/stamp`

### Importantes

- aumento anormal de `auth.login.failure`
- aumento anormal de lockouts MFA
- latencia alta sostenida en PAC o integracion bancaria
- crecimiento anormal de revocaciones de sesion

## Dashboards recomendados

Minimo deberias tener:

- disponibilidad de `live` y `ready`
- latencia p95/p99 por endpoint
- volumen de login exitoso/fallido
- volumen de MFA setup, verify y lockout
- pagos creados por estado
- facturas `DRAFT`, `STAMPED` y `CANCELLED`
- errores de PAC y banco
- errores `5xx` por modulo

## Implementacion sugerida

Cuando el proyecto pase a productivo:

1. enviar logs JSON a un agregador central
2. extraer metricas a Prometheus, Datadog o equivalente
3. mapear alertas al pager o canal operativo
4. correlacionar `requestId` con auditoria y logs de infraestructura

## Reglas de operacion

- toda degradacion de `ready` debe tener ticket o incidente
- toda rotacion de secreto debe dejar evidencia en auditoria operativa
- todo deploy debe revisar `health/ready` y smoke tests antes de darlo por sano
