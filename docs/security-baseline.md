# Baseline de seguridad

## Controles obligatorios

- `HTTPS` en todos los entornos expuestos
- cookies `HttpOnly`, `Secure` y `SameSite=Strict`
- sesiones revocables inmediatamente
- hash de password con `Argon2id`
- expiracion por inactividad de 15 minutos
- expiracion absoluta de 8 horas
- reautenticacion para operaciones sensibles con ventana maxima de 5 minutos
- secretos fuera del repositorio
- auditoria de eventos criticos
- validacion estricta de entrada

## Controles recomendados

- `MFA` obligatorio para cuentas con privilegios altos
- proteccion CSRF si hay navegadores y cookies de sesion
- rate limiting por IP, usuario y endpoint
- bloqueo progresivo ante intentos fallidos
- deteccion de anomalias por IP, dispositivo o geografia
- cabeceras de seguridad con `helmet`
- rotacion de `sessionId` tras login y elevacion de privilegio

## Reglas de backend

- nunca confiar en el frontend para autenticar o autorizar
- toda autorizacion debe hacerse en backend
- no guardar passwords, secretos, tokens completos ni datos bancarios sensibles en logs
- separar errores operativos de errores de seguridad
- normalizar respuestas `401`, `403` y `429`

## Redis y PostgreSQL

- no exponer Redis a internet
- no exponer PostgreSQL a internet
- ubicar ambos servicios en red privada
- restringir accesos por red y credenciales
- usar backups y politicas de retencion

## Integraciones externas

Para cobro bancario y timbrado:

- usar credenciales separadas por entorno
- rotar secretos periodicamente
- establecer timeouts, reintentos y circuit breakers
- firmar y auditar callbacks o webhooks
- validar certificados, hostnames y origen

## Auditoria minima

Registrar como minimo:

- login exitoso
- login fallido
- logout
- cambio de password
- alta o baja de MFA
- revocacion de sesiones
- accesos denegados
- cobros iniciados y resueltos
- facturas emitidas y canceladas

