# Runbook: Incident Response

Fecha de referencia: 2026-03-16

## Cuando usarlo

Usa este runbook cuando ocurra cualquiera de estos eventos:

- `health/ready` permanece en `503`
- el login o MFA dejan de funcionar
- pagos o timbrado fallan en volumen anormal
- sospecha de compromiso de cuenta o secreto
- perdida de conectividad con `PostgreSQL`, `Redis`, PAC o banco

## Objetivos

1. contener el impacto
2. preservar evidencia
3. recuperar servicio
4. dejar accion correctiva y seguimiento

## Pasos

### 1. Confirmar el incidente

- revisar `GET /api/health/live`
- revisar `GET /api/health/ready`
- revisar logs por `requestId`, `statusCode` y errores de dependencia
- identificar modulo afectado: `auth`, `sessions`, `payments`, `invoices`, `audit`

### 2. Clasificar

- `sev-1`: indisponibilidad total, riesgo financiero o sospecha de compromiso
- `sev-2`: degradacion importante sin perdida total
- `sev-3`: fallo acotado o recuperable sin impacto mayor

### 3. Contener

- detener despliegues activos
- si el problema es credencial o secreto, ir a `secret-rotation.md`
- si el problema es sesion o cuenta comprometida, ir a `session-revocation.md`
- si el problema es PAC o banco, deshabilitar temporalmente la operacion afectada si existe feature flag o control operativo equivalente

### 4. Recuperar

- validar `PostgreSQL`
- validar `Redis`
- validar conectividad al PAC y banco
- revisar el ultimo deploy y migraciones aplicadas
- correr smoke tests en el entorno si la app ya responde

### 5. Cerrar

- documentar causa raiz
- anotar alcance
- listar mitigacion inmediata
- crear backlog de correccion permanente
- actualizar `docs/code-audit.md` y `README.md` si cambia el riesgo operativo
