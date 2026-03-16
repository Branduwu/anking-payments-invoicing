# Runbook: Session Revocation

Fecha de referencia: 2026-03-16

## Cuando usarlo

Usa este runbook cuando:

- un usuario reporta acceso no reconocido
- se cambia password de una cuenta sensible
- hay sospecha de secuestro de sesion
- un admin debe forzar cierre de sesiones

## Objetivo

Revocar acceso activo lo antes posible y dejar evidencia en auditoria.

## Acciones disponibles

### Sesion actual

Usa:

- `POST /api/auth/logout`

### Una sesion especifica

Usa:

- `DELETE /api/sessions/{id}`

### Todas las sesiones de un usuario

Usa:

- `DELETE /api/sessions/all`

## Procedimiento recomendado

1. confirmar identidad del usuario o ticket administrativo
2. listar sesiones activas con `GET /api/sessions`
3. revocar la sesion puntual o todas segun el alcance
4. si el riesgo es alto, forzar cambio de password y revisar MFA
5. validar que el evento aparezca en auditoria como `session.revoked`

## Validacion tecnica

- en Redis, la entrada `session:{sessionId}` debe desaparecer o quedar invalidada
- en `user_sessions:{userId}` la sesion debe salir del set
- en auditoria debe existir el evento de revocacion

## Seguimiento

Si la revocacion fue por riesgo real:

- revisar MFA del usuario
- revisar IP y user-agent previos
- evaluar rotacion de secretos si hubo compromiso mas amplio
