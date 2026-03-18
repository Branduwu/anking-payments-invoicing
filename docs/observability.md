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

### `GET /api/metrics`

Expone metricas estilo Prometheus para consumo de un scraper interno.

Incluye:

- `banking_platform_build_info`
- `banking_platform_process_uptime_seconds`
- `banking_platform_process_resident_memory_bytes`
- `banking_platform_http_requests_total`
- `banking_platform_http_request_duration_ms`
- `banking_platform_http_slow_requests_total`
- `banking_platform_dependency_up`
- `banking_platform_dependency_check_latency_ms`
- `banking_platform_dependency_checks_total`

Notas operativas:

- el endpoint omite contarse a si mismo para no ensuciar los totales HTTP
- los paths HTTP se normalizan para bajar cardinalidad en metricas
- si defines `METRICS_BEARER_TOKEN`, el scraper debe enviar `Authorization: Bearer <token>`

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
- disponibilidad y scrape freshness de `metrics`
- latencia p95/p99 por endpoint
- volumen de login exitoso/fallido
- volumen de MFA setup, verify y lockout
- pagos creados por estado
- facturas `DRAFT`, `STAMPED` y `CANCELLED`
- errores de PAC y banco
- errores `5xx` por modulo

## Implementacion sugerida

Con lo que ya existe hoy, el siguiente salto serio es:

1. scrapear `GET /api/metrics` desde Prometheus, Grafana Agent, Datadog o equivalente
2. enviar logs JSON a un agregador central
3. mapear alertas al pager o canal operativo
4. correlacionar `requestId` con auditoria, metricas y logs de infraestructura

## Stack local incluido

El repo ya incluye una base local para empezar sin improvisar:

- `docker-compose.observability.yml`
- `ops/prometheus/prometheus.yml.tmpl`
- `ops/prometheus/alerts.yml`
- `ops/alertmanager/alertmanager.yml`

Levantarlo:

```powershell
npm run observability:up
```

Apagarlo:

```powershell
npm run observability:down
```

Defaults:

- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- target de scrape: `host.docker.internal:4000`

Variables opcionales:

- `PROMETHEUS_METRICS_TARGET`
- `PROMETHEUS_METRICS_BEARER_TOKEN`

Si proteges `GET /api/metrics` con `METRICS_BEARER_TOKEN`, Prometheus puede reutilizar ese mismo valor via `PROMETHEUS_METRICS_BEARER_TOKEN`.

Alertas incluidas:

- API down
- error rate HTTP alto
- latencia p95 alta
- dependencia degradada
- burst de requests lentas

Esto cierra el gap local de scrape + reglas. Lo que sigue pendiente para productivo es conectar `Alertmanager` a Slack, email, PagerDuty o el receiver que uses realmente.

## Reglas de operacion

- toda degradacion de `ready` debe tener ticket o incidente
- toda rotacion de secreto debe dejar evidencia en auditoria operativa
- todo deploy debe revisar `health/ready` y smoke tests antes de darlo por sano
