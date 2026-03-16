# Runbook: Secret Rotation

Fecha de referencia: 2026-03-16

## Inventario minimo

Debes considerar al menos estos secretos:

- `COOKIE_SECRET`
- `MFA_ENCRYPTION_KEY`
- `PAC_API_KEY`
- credenciales de `DATABASE_URL`
- credenciales de `REDIS_URL`

## Regla general

1. generar secreto nuevo en un gestor seguro
2. aplicar en staging
3. validar login, MFA, pagos y facturacion
4. desplegar controladamente a produccion
5. retirar el secreto anterior
6. documentar fecha, owner y motivo

## Impacto por secreto

### `COOKIE_SECRET`

- invalida o afecta sesiones activas segun implementacion
- planifica ventana o revocacion masiva controlada

### `MFA_ENCRYPTION_KEY`

- puede invalidar secretos TOTP almacenados si no hay estrategia de re-encripcion
- tratar como rotacion mayor
- preparar reenrolamiento o migracion previa

### `PAC_API_KEY`

- validar timbrado y cancelacion tras la rotacion
- revisar limites, sandbox y callback credentials si aplican

### Credenciales de base de datos y Redis

- rotar con doble credencial o ventana controlada si tu plataforma lo soporta
- validar `health/ready` y smoke tests al terminar

## Validacion posterior

Despues de rotar:

1. `GET /api/health/live`
2. `GET /api/health/ready`
3. smoke tests
4. revisar logs y auditoria
5. confirmar ausencia de errores de autenticacion por dependencia
