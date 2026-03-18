import './style.css';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

type AvailableMfaMethod = 'totp' | 'recovery_code' | 'webauthn';
type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON'];

interface LoginResponse {
  mfaRequired: boolean;
  availableMfaMethods: AvailableMfaMethod[];
  message: string;
}

interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    mfaEnabled: boolean;
    roles: string[];
    recoveryCodesRemaining: number;
    webauthnCredentialsCount: number;
    mfaMethods: AvailableMfaMethod[];
  };
  session: {
    id: string;
    userId: string;
    mfaLevel: string;
    requiresMfa: boolean;
    reauthenticatedUntil?: string;
    createdAt: string;
    lastActivity: string;
    expiresAt: string;
    absoluteExpiresAt: string;
  };
}

interface ReauthResponse {
  reauthenticatedUntil?: string;
  message: string;
}

interface RegistrationVerifyResponse {
  credentialId: string;
  recoveryCodes?: string[];
  remainingRecoveryCodes: number;
  totalCredentials: number;
}

interface AuthenticationVerifyResponse {
  reauthenticatedUntil?: string;
  mfaLevel: string;
  purpose: 'login' | 'reauth';
}

interface WebAuthnCredentialView {
  id: string;
  createdAt: string;
  lastUsedAt?: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
}

interface CredentialsResponse {
  credentials: WebAuthnCredentialView[];
}

interface RevokeCredentialResponse {
  message: string;
  remainingCredentials: number;
  mfaEnabled: boolean;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  checks?: Record<string, { status: string }>;
  message?: string | string[];
  reason?: string;
}

interface HealthState {
  liveStatus: string;
  readyStatus: string;
  detail: string;
  checkedAt?: string;
}

interface NextActionState {
  title: string;
  description: string;
  tone: 'ok' | 'warn' | 'idle';
}

interface GuidedStepState {
  label: string;
  detail: string;
  status: 'done' | 'current' | 'todo';
}

interface NoticeState {
  tone: 'success' | 'error' | 'info';
  title: string;
  detail: string;
}

interface AppState {
  apiBaseUrl: string;
  browserOrigin: string;
  email: string;
  password: string;
  mfaCode: string;
  showPassword: boolean;
  user: MeResponse['user'] | null;
  session: MeResponse['session'] | null;
  credentials: WebAuthnCredentialView[];
  recoveryCodes: string[];
  pendingLoginMfa: AvailableMfaMethod[];
  health: HealthState;
  busy: boolean;
  lastError: string | null;
  notice: NoticeState;
  logs: string[];
}

const viteEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

function getPreferredLoopbackRedirectUrl(): string | null {
  const shouldPreferLocalhost =
    viteEnv.VITE_PREFER_LOCALHOST_FOR_WEBAUTHN?.trim().toLowerCase() === 'true';

  if (!shouldPreferLocalhost || window.location.hostname !== '127.0.0.1') {
    return null;
  }

  try {
    const targetUrl = new URL(window.location.href);
    targetUrl.hostname = 'localhost';
    return targetUrl.toString();
  } catch {
    return null;
  }
}

function getDefaultApiBaseUrl(): string {
  const configuredBaseUrl = viteEnv.VITE_DEFAULT_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    const normalizedConfiguredBaseUrl = configuredBaseUrl.replace(/\/+$/, '');

    try {
      const configuredUrl = new URL(normalizedConfiguredBaseUrl);
      const browserHost = window.location.hostname;

      if (
        isLoopbackHost(browserHost) &&
        isLoopbackHost(configuredUrl.hostname) &&
        browserHost !== configuredUrl.hostname
      ) {
        const portSegment = configuredUrl.port ? `:${configuredUrl.port}` : '';
        return `${configuredUrl.protocol}//${browserHost}${portSegment}${configuredUrl.pathname}`.replace(
          /\/+$/,
          '',
        );
      }
    } catch {
      return normalizedConfiguredBaseUrl;
    }

    return normalizedConfiguredBaseUrl;
  }

  const host = window.location.hostname;
  if (isLoopbackHost(host)) {
    return `http://${host}:4000/api`;
  }

  return 'http://localhost:4000/api';
}

function isLoopbackHost(value: string): boolean {
  return value === 'localhost' || value === '127.0.0.1';
}

const initialState: AppState = {
  apiBaseUrl: getDefaultApiBaseUrl(),
  browserOrigin: window.location.origin,
  email: '',
  password: '',
  mfaCode: '',
  showPassword: false,
  user: null,
  session: null,
  credentials: [],
  recoveryCodes: [],
  pendingLoginMfa: [],
  health: {
    liveStatus: 'unknown',
    readyStatus: 'unknown',
    detail: 'Sin comprobar todavia',
  },
  busy: false,
  lastError: null,
  notice: {
    tone: 'info',
    title: 'Laboratorio listo para pruebas',
    detail: 'Valida la API, entra con una cuenta local y sigue el flujo guiado para probar passkeys end-to-end.',
  },
  logs: ['Panel listo. Usa una cuenta local preparada por seed o tus propias credenciales.'],
};

const preferredLoopbackRedirectUrl = getPreferredLoopbackRedirectUrl();
if (preferredLoopbackRedirectUrl) {
  window.location.replace(preferredLoopbackRedirectUrl);
}

const state: AppState = { ...initialState };
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found');
}

const render = (): void => {
  const nextAction = getNextActionState();
  const guidedSteps = getGuidedSteps();
  const healthCheckedAt = state.health.checkedAt
    ? new Date(state.health.checkedAt).toLocaleTimeString()
    : 'Sin comprobar';

  app.innerHTML = `
    <div class="shell">
      <section class="hero">
        <p class="eyebrow">Passkeys + Stateful Sessions</p>
        <h1>WebAuthn Control Panel</h1>
        <p class="lede">
          Laboratorio browser-based para validar login, MFA con passkeys, reautenticacion critica y
          revocacion real contra la API sin depender de consola.
        </p>
        <div class="feedback-banner ${state.notice.tone}" data-testid="feedback-banner">
          <strong>${escapeHtml(state.notice.title)}</strong>
          <p>${escapeHtml(state.notice.detail)}</p>
        </div>
      </section>

      <div class="grid">
        <section class="panel">
          <h2>Conexion</h2>
          <p class="muted">
            Origin del navegador:
            <strong data-testid="browser-origin">${escapeHtml(state.browserOrigin)}</strong>
          </p>
          <label>
            API base URL
            <input data-testid="api-base-url" id="api-base-url" type="text" value="${escapeHtml(
              state.apiBaseUrl,
            )}" />
          </label>
          <div class="actions compact">
            <button class="ghost" data-testid="preset-localhost-button" id="preset-localhost-button" ${actionAttr(false)}>
              Usar localhost
            </button>
            <button class="ghost" data-testid="preset-loopback-button" id="preset-loopback-button" ${actionAttr(false)}>
              Usar 127.0.0.1
            </button>
            <button class="secondary" data-testid="check-api-button" id="check-api-button" ${actionAttr(false)}>
              Probar API
            </button>
          </div>
          <div class="health-card" data-testid="api-health-card">
            <div class="status-line">
              <span class="status-pill ${healthClass(state.health.liveStatus)}">
                live: ${escapeHtml(state.health.liveStatus)}
              </span>
              <span class="status-pill ${healthClass(state.health.readyStatus)}">
                ready: ${escapeHtml(state.health.readyStatus)}
              </span>
            </div>
            <p class="muted health-detail">${escapeHtml(state.health.detail)}</p>
          </div>
          <p class="section-hint">
            Usa el mismo host en frontend y API. El panel ya te avisa si mezclas localhost con
            127.0.0.1.
          </p>
          <label>
            Email
            <input data-testid="email-input" id="email-input" type="email" value="${escapeHtml(
              state.email,
            )}" />
          </label>
          <label>
            Password
            <input
              data-testid="password-input"
              id="password-input"
              type="${state.showPassword ? 'text' : 'password'}"
              value="${escapeHtml(state.password)}"
            />
          </label>
          <div class="actions">
            <button data-testid="login-button" id="login-button" ${actionAttr(false)}>Login</button>
            <button class="secondary" data-testid="load-me-button" id="load-me-button" ${actionAttr(!canRefreshSession())}>
              Refrescar sesion
            </button>
            <button class="secondary" data-testid="logout-button" id="logout-button" ${actionAttr(!canLogout())}>Logout</button>
          </div>
        </section>

        <section class="panel">
          <h2>Demo guiado</h2>
          <p class="muted">
            Este panel ya puede guiar el flujo completo de passkeys sin salir a consola y sin exponer
            credenciales demo en pantalla.
          </p>
          <dl class="demo-grid">
            <div>
              <dt>Cuenta local</dt>
              <dd>Preparada por seed en el entorno activo</dd>
            </div>
            <div>
              <dt>Credenciales</dt>
              <dd>Configuralas con WEBAUTHN_DEMO_EMAIL y WEBAUTHN_DEMO_PASSWORD</dd>
            </div>
            <div>
              <dt>Ultimo check API</dt>
              <dd>${escapeHtml(healthCheckedAt)}</dd>
            </div>
          </dl>
          <p class="section-hint">
            El formulario ya no precarga ni revela passwords demo. Usa credenciales locales que
            controles desde el entorno o tus propias cuentas.
          </p>
          <div class="actions compact">
            <button class="secondary" data-testid="clear-form-button" id="clear-form-button" ${actionAttr(false)}>
              Limpiar formulario
            </button>
            <button class="ghost" data-testid="toggle-password-button" id="toggle-password-button" ${actionAttr(false)}>
              ${state.showPassword ? 'Ocultar password' : 'Mostrar password'}
            </button>
            <button class="ghost" data-testid="clear-log-button" id="clear-log-button" ${actionAttr(false)}>
              Limpiar actividad
            </button>
          </div>
          <div class="next-step-card">
            <span class="status-pill ${nextAction.tone}">Siguiente paso</span>
            <strong data-testid="next-step-title">${escapeHtml(nextAction.title)}</strong>
            <p class="muted" data-testid="next-step-description">${escapeHtml(nextAction.description)}</p>
          </div>
          <ol class="guided-steps" data-testid="guided-steps">
            ${guidedSteps
              .map(
                (step) => `
                  <li class="${step.status}">
                    <span class="step-marker">${step.status === 'done' ? 'OK' : step.status === 'current' ? 'NOW' : 'NEXT'}</span>
                    <div>
                      <strong>${escapeHtml(step.label)}</strong>
                      <p>${escapeHtml(step.detail)}</p>
                    </div>
                  </li>
                `,
              )
              .join('')}
          </ol>
        </section>

        <section class="panel status-panel">
          <h2>Estado actual</h2>
          <div class="status-line">
            <span class="status-pill ${state.user ? 'ok' : state.pendingLoginMfa.length > 0 ? 'warn' : 'idle'}">
              ${
                state.user
                  ? 'Sesion autenticada'
                  : state.pendingLoginMfa.length > 0
                    ? 'MFA pendiente'
                    : 'Sin sesion autenticada'
              }
            </span>
            ${
              state.lastError
                ? `<span class="status-pill error" data-testid="last-error">${escapeHtml(state.lastError)}</span>`
                : ''
            }
          </div>
          ${
            getHostMismatchHint()
              ? `<p class="host-hint" data-testid="host-mismatch-hint">${escapeHtml(getHostMismatchHint() ?? '')}</p>`
              : ''
          }
          <dl class="summary" data-testid="session-summary">
            <div>
              <dt>Usuario</dt>
              <dd>${state.user ? escapeHtml(state.user.email) : 'No autenticado'}</dd>
            </div>
            <div>
              <dt>Roles</dt>
              <dd>${state.user ? escapeHtml(state.user.roles.join(', ') || 'Sin roles') : 'N/A'}</dd>
            </div>
            <div>
              <dt>MFA</dt>
              <dd>${
                state.user
                  ? `${state.user.mfaEnabled ? 'activo' : 'desactivado'} (${escapeHtml(
                      state.user.mfaMethods.join(', ') || 'ninguno',
                    )})`
                  : state.pendingLoginMfa.length > 0
                    ? `pendiente (${escapeHtml(state.pendingLoginMfa.join(', '))})`
                    : 'N/A'
              }</dd>
            </div>
            <div>
              <dt>Reauth hasta</dt>
              <dd>${
                state.session?.reauthenticatedUntil
                  ? new Date(state.session.reauthenticatedUntil).toLocaleString()
                  : 'No reciente'
              }</dd>
            </div>
          </dl>
        </section>

        <section class="panel">
          <h2>Reautenticacion</h2>
          <p class="muted">
            La reautenticacion con password solo aplica antes de activar MFA. Cuando la cuenta ya tiene
            factores activos, la reautenticacion critica debe hacerse con MFA registrado.
          </p>
          <p class="section-hint">${escapeHtml(getReauthHint())}</p>
          <div class="actions">
            <button data-testid="reauth-password-button" id="reauth-password-button" ${actionAttr(!canUsePasswordReauth())}>
              Reautenticar con password
            </button>
            <button data-testid="reauth-passkey-button" id="reauth-passkey-button" ${actionAttr(!canUsePasskeyReauth())}>
              Reautenticar con passkey
            </button>
          </div>
        </section>

        <section class="panel">
          <h2>Codigo MFA</h2>
          <p class="muted">
            Usa TOTP o recovery code tanto para completar login pendiente como para abrir una nueva
            ventana de reautenticacion cuando la cuenta no usa passkeys.
          </p>
          <p class="section-hint">${escapeHtml(getMfaCodeHint())}</p>
          <label>
            Codigo TOTP o recovery code
            <input
              data-testid="mfa-code-input"
              id="mfa-code-input"
              type="text"
              value="${escapeHtml(state.mfaCode)}"
              placeholder="123456 o AAAA-BBBB-CCCC-DDDD"
            />
          </label>
          <div class="actions">
            <button data-testid="verify-totp-button" id="verify-totp-button" ${actionAttr(!canVerifyTotp())}>
              Verificar TOTP
            </button>
            <button class="secondary" data-testid="verify-recovery-button" id="verify-recovery-button" ${actionAttr(!canVerifyRecoveryCode())}>
              Usar recovery code
            </button>
          </div>
        </section>

        <section class="panel">
          <h2>Passkeys</h2>
          <p class="section-hint">${escapeHtml(getPasskeysHint())}</p>
          <div class="actions">
            <button data-testid="register-passkey-button" id="register-passkey-button" ${actionAttr(!canRegisterPasskey())}>
              Registrar passkey
            </button>
            <button
              class="secondary"
              data-testid="complete-login-passkey-button"
              id="complete-login-passkey-button"
              ${actionAttr(!canCompleteLoginWithPasskey())}
            >
              Completar login con passkey
            </button>
            <button class="secondary" data-testid="load-credentials-button" id="load-credentials-button" ${actionAttr(!canLoadCredentials())}>
              Cargar credenciales
            </button>
          </div>
          <div class="stack">
            <h3>Recovery codes</h3>
            <pre data-testid="recovery-codes" class="code-block">${
              state.recoveryCodes.length > 0
                ? escapeHtml(state.recoveryCodes.join('\n'))
                : escapeHtml(getRecoveryCodesEmptyState())
            }</pre>
          </div>
        </section>

        <section class="panel wide">
          <div class="panel-header">
            <h2>Credenciales WebAuthn</h2>
            <span data-testid="credentials-count" class="count">${state.credentials.length}</span>
          </div>
          <ul class="credential-list" data-testid="credentials-list">
            ${
              state.credentials.length > 0
                ? state.credentials
                    .map(
                      (credential) => `
                <li>
                  <div>
                    <strong>${escapeHtml(credential.id)}</strong>
                    <p>${escapeHtml(credential.deviceType)} - backedUp=${credential.backedUp ? 'true' : 'false'}</p>
                    <p>Transportes: ${escapeHtml(credential.transports.join(', ') || 'none')}</p>
                  </div>
                  <button
                    data-testid="revoke-credential-${escapeHtml(credential.id)}"
                    data-credential-id="${escapeHtml(credential.id)}"
                    class="danger"
                    ${actionAttr(!canRevokeCredentials())}
                  >
                    Revocar
                  </button>
                </li>
              `,
                    )
                    .join('')
                : `<li class="empty">
                    <div class="empty-state">
                      <strong>Sin credenciales cargadas</strong>
                      <p>${escapeHtml(getCredentialsEmptyState())}</p>
                    </div>
                  </li>`
            }
          </ul>
        </section>

        <section class="panel wide">
          <h2>Actividad</h2>
          <ol class="log-list" data-testid="activity-log">
            ${state.logs
              .map((entry) => `<li class="${escapeHtml(getLogTone(entry))}">${escapeHtml(entry)}</li>`)
              .join('')}
          </ol>
        </section>
      </div>
    </div>
  `;

  bindCommonInputs();
  bindActions();
};

const bindCommonInputs = (): void => {
  bindInput('api-base-url', (value) => {
    state.apiBaseUrl = normalizeApiBaseUrl(value);
  });
  bindInput('email-input', (value) => {
    state.email = value.trim().toLowerCase();
  });
  bindInput('password-input', (value) => {
    state.password = value;
  });
  bindInput('mfa-code-input', (value) => {
    state.mfaCode = value.trim().toUpperCase();
  });
};

const bindActions = (): void => {
  bindClick('login-button', login);
  bindClick('preset-localhost-button', useLocalhostPreset);
  bindClick('preset-loopback-button', useLoopbackPreset);
  bindClick('check-api-button', checkApiHealthAction);
  bindClick('clear-form-button', clearCredentialsForm);
  bindClick('toggle-password-button', togglePasswordVisibility);
  bindClick('clear-log-button', clearActivityLog);
  bindClick('load-me-button', loadSessionState);
  bindClick('logout-button', logout);
  bindClick('reauth-password-button', reauthenticateWithPassword);
  bindClick('reauth-passkey-button', () => authenticateWithPasskey('reauth'));
  bindClick('verify-totp-button', () => verifyMfaCode('totp'));
  bindClick('verify-recovery-button', () => verifyMfaCode('recovery_code'));
  bindClick('register-passkey-button', registerPasskey);
  bindClick('complete-login-passkey-button', () => authenticateWithPasskey('login'));
  bindClick('load-credentials-button', loadCredentials);

  document.querySelectorAll<HTMLButtonElement>('[data-credential-id]').forEach((button) => {
    button.addEventListener('click', () => {
      void revokeCredential(button.dataset.credentialId ?? '');
    });
  });
};

const bindInput = (id: string, onChange: (value: string) => void): void => {
  const input = document.getElementById(id) as HTMLInputElement | null;
  input?.addEventListener('input', () => {
    onChange(input.value);
  });
};

const bindClick = (id: string, action: () => Promise<void>): void => {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void action();
  });
};

const login = async (): Promise<void> => {
  await runAction('Login completado', async () => {
    const result = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: {
        email: state.email,
        password: state.password,
      },
    });

    state.pendingLoginMfa = result.mfaRequired ? result.availableMfaMethods : [];
    state.recoveryCodes = [];

    if (result.mfaRequired) {
      addLog(`Login primario correcto. MFA pendiente: ${result.availableMfaMethods.join(', ')}`);
      state.user = null;
      state.session = null;
      state.credentials = [];
      state.mfaCode = '';
      return;
    }

    addLog('Login completo sin MFA adicional');
    await refreshAuthenticatedState();
    await refreshHealthState();
  });
};

const checkApiHealthAction = async (): Promise<void> => {
  await runAction('API validada', async () => {
    await refreshHealthState();
    addLog(`Health API: live=${state.health.liveStatus}, ready=${state.health.readyStatus}`);
  });
};

const useLocalhostPreset = async (): Promise<void> => {
  state.apiBaseUrl = 'http://localhost:4000/api';
  state.lastError = null;
  state.notice = {
    tone: 'info',
    title: 'Preset localhost aplicado',
    detail: 'El panel ya apunta a la API en localhost. Si el frontend tambien corre en localhost, el origin queda alineado.',
  };
  addLog('Preset aplicado: localhost');
  render();
};

const useLoopbackPreset = async (): Promise<void> => {
  state.apiBaseUrl = 'http://127.0.0.1:4000/api';
  state.lastError = null;
  state.notice = {
    tone: 'info',
    title: 'Preset 127.0.0.1 aplicado',
    detail: 'El panel ya apunta a la API en 127.0.0.1. Usa este preset si abriste el frontend con ese mismo host.',
  };
  addLog('Preset aplicado: 127.0.0.1');
  render();
};

const clearCredentialsForm = async (): Promise<void> => {
  state.email = '';
  state.password = '';
  state.mfaCode = '';
  state.lastError = null;
  state.notice = {
    tone: 'info',
    title: 'Formulario limpiado',
    detail: 'Captura de nuevo tus credenciales locales o las del seed activo.',
  };
  addLog('Formulario de credenciales reiniciado');
  render();
};

const togglePasswordVisibility = async (): Promise<void> => {
  state.showPassword = !state.showPassword;
  state.notice = {
    tone: 'info',
    title: state.showPassword ? 'Password visible' : 'Password oculto',
    detail: state.showPassword
      ? 'Usa esta vista solo mientras validas el entorno local.'
      : 'El campo vuelve a mostrarse de forma protegida.',
  };
  render();
};

const clearActivityLog = async (): Promise<void> => {
  state.logs = ['Actividad limpiada. Ya puedes volver a correr el flujo desde cero.'];
  state.lastError = null;
  state.notice = {
    tone: 'info',
    title: 'Actividad reiniciada',
    detail: 'El panel quedo limpio para repetir la prueba o capturar un nuevo recorrido.',
  };
  render();
};

const loadSessionState = async (): Promise<void> => {
  await runAction('Sesion recargada', async () => {
    await refreshAuthenticatedState();
    await refreshHealthState();
  });
};

const logout = async (): Promise<void> => {
  await runAction('Logout completado', async () => {
    await apiFetch<{ message: string }>('/auth/logout', { method: 'POST' });
    state.user = null;
    state.session = null;
    state.credentials = [];
    state.pendingLoginMfa = [];
    state.recoveryCodes = [];
    state.mfaCode = '';
  });
};

const reauthenticateWithPassword = async (): Promise<void> => {
  await runAction('Reautenticacion con password completada', async () => {
    const result = await apiFetch<ReauthResponse>('/auth/reauthenticate', {
      method: 'POST',
      body: {
        password: state.password,
      },
    });

    addLog(`Reautenticacion password valida hasta ${result.reauthenticatedUntil ?? 'N/A'}`);
    await refreshAuthenticatedState();
  });
};

const registerPasskey = async (): Promise<void> => {
  await runAction('Passkey registrada', async () => {
    const options = await apiFetch<RegistrationOptionsJSON>('/auth/webauthn/registration/options', {
      method: 'POST',
    });
    const response = await startRegistration({ optionsJSON: options });
    const result = await apiFetch<RegistrationVerifyResponse>('/auth/webauthn/registration/verify', {
      method: 'POST',
      body: { response },
    });

    state.recoveryCodes = result.recoveryCodes ?? [];
    addLog(
      `Passkey registrada (${result.credentialId}). Credenciales activas: ${result.totalCredentials}`,
    );
    await refreshAuthenticatedState();
    await refreshCredentialsState();
  });
};

const verifyMfaCode = async (method: 'totp' | 'recovery_code'): Promise<void> => {
  const purpose = state.pendingLoginMfa.length > 0 ? 'login' : 'reauth';
  const successMessage =
    purpose === 'login'
      ? 'MFA completado con codigo'
      : method === 'recovery_code'
        ? 'Reautenticacion con recovery code completada'
        : 'Reautenticacion con TOTP completada';

  await runAction(successMessage, async () => {
    const result = await apiFetch<{
      reauthenticatedUntil?: string;
      recoveryCodes?: string[];
      remainingRecoveryCodes: number;
      purpose: 'login' | 'reauth';
    }>(purpose === 'login' ? '/auth/mfa/verify' : '/auth/reauthenticate/mfa', {
      method: 'POST',
      body: {
        code: state.mfaCode,
        method,
        purpose,
      },
    });

    if (result.recoveryCodes?.length) {
      state.recoveryCodes = result.recoveryCodes;
    }

    addLog(
      result.purpose === 'login'
        ? `MFA completado con ${method}`
        : `Reautenticacion MFA completada con ${method}`,
    );
    state.mfaCode = '';
    await refreshAuthenticatedState();
  });
};

const authenticateWithPasskey = async (purpose: 'login' | 'reauth'): Promise<void> => {
  const successMessage =
    purpose === 'login' ? 'Login MFA completado con passkey' : 'Reautenticacion con passkey completada';

  await runAction(successMessage, async () => {
    const options = await apiFetch<AuthenticationOptionsJSON>(
      '/auth/webauthn/authentication/options',
      {
        method: 'POST',
        body: { purpose },
      },
    );
    const response = await startAuthentication({ optionsJSON: options });
    const result = await apiFetch<AuthenticationVerifyResponse>(
      '/auth/webauthn/authentication/verify',
      {
        method: 'POST',
        body: { response, purpose },
      },
    );

    addLog(`Passkey verificada para ${result.purpose}`);
    state.pendingLoginMfa = [];
    await refreshAuthenticatedState();
  });
};

const loadCredentials = async (): Promise<void> => {
  await runAction('Credenciales cargadas', async () => {
    await refreshCredentialsState();
  });
};

const revokeCredential = async (credentialId: string): Promise<void> => {
  if (!credentialId) {
    return;
  }

  await runAction(`Credencial ${credentialId} revocada`, async () => {
    const result = await apiFetch<RevokeCredentialResponse>(`/auth/webauthn/credentials/${credentialId}`, {
      method: 'DELETE',
    });

    addLog(
      `Credencial revocada. Restantes: ${result.remainingCredentials}. MFA activo: ${result.mfaEnabled}`,
    );
    await refreshAuthenticatedState();
    await refreshCredentialsState();
  });
};

const refreshAuthenticatedState = async (): Promise<void> => {
  const result = await apiFetch<MeResponse>('/auth/me');
  state.user = result.user;
  state.session = result.session;
  state.pendingLoginMfa = [];
  addLog(`Sesion autenticada para ${result.user.email}`);
};

const refreshCredentialsState = async (): Promise<void> => {
  const result = await apiFetch<CredentialsResponse>('/auth/webauthn/credentials');
  state.credentials = result.credentials;
  addLog(`Credenciales activas: ${result.credentials.length}`);
};

const refreshHealthState = async (): Promise<void> => {
  const live = await apiFetch<HealthResponse>('/health/live');
  const readyResult = await fetchJsonAllowingFailure<HealthResponse>('/health/ready');

  state.health = {
    liveStatus: live.status,
    readyStatus: readyResult.payload?.status ?? 'unavailable',
    detail: buildHealthDetail(readyResult.payload),
    checkedAt: new Date().toISOString(),
  };
};

const apiFetch = async <T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
  } = {},
): Promise<T> => {
  try {
    const response = await fetch(`${normalizeApiBaseUrl(state.apiBaseUrl)}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(await formatHttpError(response));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    throw new Error(formatActionError(error));
  }
};

const fetchJsonAllowingFailure = async <T>(path: string): Promise<{
  ok: boolean;
  payload?: T;
}> => {
  try {
    const response = await fetch(`${normalizeApiBaseUrl(state.apiBaseUrl)}${path}`, {
      method: 'GET',
      credentials: 'include',
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as T) : undefined;

    return {
      ok: response.ok,
      payload,
    };
  } catch {
    return { ok: false };
  }
};

const formatHttpError = async (response: Response): Promise<string> => {
  let message = `HTTP ${response.status}`;
  const rawBody = await response.text();

  try {
    const payload = rawBody ? (JSON.parse(rawBody) as { message?: string | string[]; reason?: string }) : {};
    if (Array.isArray(payload.message)) {
      message = payload.message.join(', ');
    } else if (typeof payload.message === 'string') {
      message = payload.message;
    }

    if (payload.reason) {
      message = `${message} (${payload.reason})`;
    }
  } catch {
    if (rawBody) {
      message = `${message}: ${rawBody}`;
    }
  }

  return message;
};

const runAction = async (successMessage: string, action: () => Promise<void>): Promise<void> => {
  state.busy = true;
  state.lastError = null;
  render();

  try {
    await action();
    const nextAction = getNextActionState();
    state.notice = {
      tone: 'success',
      title: successMessage,
      detail: nextAction.description,
    };
    addLog(successMessage);
  } catch (error) {
    const message = formatActionError(error);
    state.lastError = message;
    state.notice = {
      tone: 'error',
      title: 'La accion no se pudo completar',
      detail: message,
    };
    addLog(`ERROR: ${message}`);
  } finally {
    state.busy = false;
    render();
  }
};

const addLog = (entry: string): void => {
  state.logs = [`${new Date().toLocaleTimeString()} - ${entry}`, ...state.logs].slice(0, 14);
};

const normalizeApiBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const getHostMismatchHint = (): string | null => {
  const browserHost = window.location.hostname;
  const apiUrl = safeUrl(state.apiBaseUrl);

  if (!apiUrl) {
    return 'La API base URL no es valida.';
  }

  if (browserHost !== apiUrl.hostname && isLoopbackHost(browserHost) && isLoopbackHost(apiUrl.hostname)) {
    return `Frontend en ${browserHost} y API en ${apiUrl.hostname}. La plataforma ya soporta ambos, pero es mas predecible usar el mismo host en ambos lados.`;
  }

  if (!state.health.checkedAt) {
    return 'Pulsa "Probar API" antes de iniciar el flujo si acabas de levantar el entorno.';
  }

  return null;
};

const buildHealthDetail = (ready: HealthResponse | undefined): string => {
  if (!ready) {
    return 'No se pudo leer readiness.';
  }

  if (!ready.checks || Object.keys(ready.checks).length === 0) {
    return `Readiness: ${ready.status}`;
  }

  return `Checks: ${Object.entries(ready.checks)
    .map(([dependency, status]) => `${dependency}=${status.status}`)
    .join(', ')}`;
};

const getNextActionState = (): NextActionState => {
  if (!hasHealthyApi()) {
    return {
      title: 'Probar la API',
      description: 'Valida live y ready antes de iniciar login o la ceremonia WebAuthn.',
      tone: 'warn',
    };
  }

  if (!hasAuthenticatedSession() && state.pendingLoginMfa.length === 0) {
    return {
      title: 'Iniciar login primario',
      description: 'Haz login con usuario y password para crear la sesion base.',
      tone: 'idle',
    };
  }

  if (state.pendingLoginMfa.includes('webauthn')) {
    return {
      title: 'Completar login MFA con passkey',
      description: 'Tu sesion ya paso el password. Solo falta verificar la passkey.',
      tone: 'warn',
    };
  }

  if (state.pendingLoginMfa.length > 0) {
    return {
      title: 'Completar MFA con codigo',
      description: 'La sesion ya paso password. Completa el MFA pendiente con TOTP o recovery code.',
      tone: 'warn',
    };
  }

  if (hasAuthenticatedSession() && !hasPasskeyRegistered() && !hasRecentReauth()) {
    return {
      title: hasActiveMfaMethods() ? 'Reautenticar con MFA' : 'Reautenticar con password',
      description: hasActiveMfaMethods()
        ? 'Abre una nueva ventana reciente con TOTP, recovery code o passkey antes de operar.'
        : 'La primera passkey requiere reautenticacion reciente antes del registro.',
      tone: 'idle',
    };
  }

  if (hasAuthenticatedSession() && !hasPasskeyRegistered()) {
    return {
      title: 'Registrar la primera passkey',
      description: 'Con la sesion ya reforzada, registra la credencial WebAuthn.',
      tone: 'idle',
    };
  }

  if (hasAuthenticatedSession() && hasPasskeyRegistered() && !hasRecentReauth()) {
    return {
      title: 'Probar reautenticacion con passkey',
      description: 'Valida el flujo critico sin password para acercarte al caso productivo.',
      tone: 'ok',
    };
  }

  if (hasAuthenticatedSession() && state.credentials.length === 0) {
    return {
      title: 'Cargar credenciales activas',
      description: 'Consulta las passkeys registradas y prepara una revocacion de prueba.',
      tone: 'ok',
    };
  }

  return {
    title: 'Cerrar el ciclo con revocacion',
    description: 'Puedes revocar la credencial, recargar estado y repetir el flujo desde el panel.',
    tone: 'ok',
  };
};

const getGuidedSteps = (): GuidedStepState[] => {
  const loginCompleted = hasAuthenticatedSession() || state.pendingLoginMfa.length > 0;
  const registrationCompleted = hasPasskeyRegistered();
  const loginWithPasskeyCompleted = hasLogEntry('Passkey verificada para login');
  const reauthWithPasskeyCompleted = hasLogEntry('Reautenticacion con passkey completada');
  const revocationCompleted = hasLogEntry('Credencial revocada');

  return [
    {
      label: 'Conectividad',
      detail: hasHealthyApi()
        ? 'API saludable y lista para flujo browser-based.'
        : 'Pulsa Probar API y confirma live=ok / ready=ready.',
      status: hasHealthyApi() ? 'done' : 'current',
    },
    {
      label: 'Login primario',
      detail: loginCompleted
        ? 'La sesion ya se creo o esta esperando MFA.'
        : 'Inicia login con usuario y password.',
      status: loginCompleted ? 'done' : hasHealthyApi() ? 'current' : 'todo',
    },
    {
      label: 'Reautenticacion inicial',
      detail: hasRecentReauth()
        ? 'Ya existe una ventana reciente de reautenticacion.'
        : hasActiveMfaMethods()
          ? 'Si MFA ya esta activo, usa un factor MFA registrado para reautenticar.'
          : 'Haz reauth con password antes de registrar la primera passkey.',
      status: hasRecentReauth() ? 'done' : loginCompleted ? 'current' : 'todo',
    },
    {
      label: 'Registro de passkey',
      detail: registrationCompleted
        ? 'Ya existe al menos una credencial WebAuthn activa.'
        : 'Registra la primera passkey desde el navegador.',
      status: registrationCompleted ? 'done' : hasRecentReauth() ? 'current' : 'todo',
    },
    {
      label: 'Login MFA con passkey',
      detail: loginWithPasskeyCompleted
        ? 'La passkey ya se uso para completar un login MFA.'
        : 'Haz logout, vuelve a login y completa MFA con passkey.',
      status: loginWithPasskeyCompleted ? 'done' : registrationCompleted ? 'current' : 'todo',
    },
    {
      label: 'Reautenticacion con passkey',
      detail: reauthWithPasskeyCompleted
        ? 'El flujo critico de reauth con passkey ya quedo probado.'
        : 'Valida reauth critica con WebAuthn.',
      status: reauthWithPasskeyCompleted ? 'done' : loginWithPasskeyCompleted ? 'current' : 'todo',
    },
    {
      label: 'Listado y revocacion',
      detail: revocationCompleted
        ? 'Ya se ejercio revocacion de credencial desde el panel.'
        : 'Carga credenciales, revisalas y revoca una de prueba.',
      status: revocationCompleted ? 'done' : registrationCompleted ? 'current' : 'todo',
    },
  ];
};

const getReauthHint = (): string => {
  if (!hasAuthenticatedSession()) {
    return 'Primero necesitas una sesion autenticada para abrir una ventana de reautenticacion.';
  }

  if (hasActiveMfaMethods() && !hasMfaMethod('webauthn')) {
    return 'La cuenta ya tiene MFA activo. Usa TOTP o recovery code para reautenticacion critica.';
  }

  if (!hasActiveMfaMethods()) {
    return 'La primera reautenticacion suele hacerse con password para poder registrar la passkey.';
  }

  if (hasRecentReauth()) {
    return 'Tu ventana de reautenticacion sigue activa. Puedes aprovecharla para listar o revocar credenciales.';
  }

  return 'Ya tienes passkeys registradas. Este es el momento ideal para validar reauth critica con WebAuthn.';
};

const getPasskeysHint = (): string => {
  if (!hasAuthenticatedSession() && state.pendingLoginMfa.length === 0) {
    return 'Inicia login y valida conectividad antes de intentar registrar o usar passkeys.';
  }

  if (state.pendingLoginMfa.includes('webauthn')) {
    return 'Tu siguiente accion natural es completar el login MFA con passkey.';
  }

  if (state.pendingLoginMfa.length > 0) {
    return 'Completa primero el MFA pendiente con TOTP o recovery code antes de trabajar con passkeys.';
  }

  if (!hasRecentReauth()) {
    return 'Registrar y revocar passkeys requiere una reautenticacion reciente.';
  }

  if (!hasPasskeyRegistered()) {
    return 'Todo esta listo para registrar la primera credencial WebAuthn.';
  }

  return 'Con este panel ya puedes registrar, usar, listar y revocar passkeys desde navegador real.';
};

const getMfaCodeHint = (): string => {
  if (state.pendingLoginMfa.includes('totp')) {
    return 'Tu login quedo pendiente de TOTP. Captura el codigo actual de tu autenticador para completar la sesion.';
  }

  if (state.pendingLoginMfa.includes('recovery_code')) {
    return 'Tu login pendiente puede completarse con un recovery code si no tienes el factor primario disponible.';
  }

  if (!hasAuthenticatedSession()) {
    return 'Este bloque se activa cuando el login queda pendiente de MFA o cuando ya tienes una sesion autenticada con MFA activo.';
  }

  if (hasMfaMethod('totp') || hasMfaMethod('recovery_code')) {
    return 'Usa TOTP o recovery code para volver a abrir la ventana de reautenticacion cuando la cuenta no use passkeys.';
  }

  return 'Si tu cuenta usa passkeys, el bloque principal de reauth recomendado es WebAuthn.';
};

const getRecoveryCodesEmptyState = (): string => {
  if (!hasAuthenticatedSession() && state.pendingLoginMfa.length === 0) {
    return 'Inicia sesion y registra una passkey para que aqui aparezcan recovery codes nuevos.';
  }

  if (!hasPasskeyRegistered()) {
    return 'Cuando registres la primera passkey, aqui veras recovery codes recien emitidos para resguardo.';
  }

  return 'En esta sesion no se han emitido nuevos recovery codes. Si necesitas rotarlos, regeneralos desde el backend.';
};

const getCredentialsEmptyState = (): string => {
  if (!hasAuthenticatedSession()) {
    return 'Autenticate primero para poder consultar credenciales activas.';
  }

  if (!hasRecentReauth()) {
    return 'Haz reautenticacion reciente antes de cargar o revocar credenciales WebAuthn.';
  }

  if (!hasPasskeyRegistered()) {
    return 'Aun no registras passkeys. Usa "Registrar passkey" para crear la primera.';
  }

  return 'No hay credenciales cargadas ahora mismo. Pulsa "Cargar credenciales" para refrescar desde la API.';
};

const formatActionError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'Unexpected browser flow error';
  }

  if (error.message === 'Failed to fetch') {
    return `No se pudo conectar a la API. Revisa que este arriba y que frontend y API usen hosts compatibles. Frontend=${state.browserOrigin}, API=${state.apiBaseUrl}`;
  }

  return error.message;
};

const hasHealthyApi = (): boolean =>
  state.health.liveStatus === 'ok' && state.health.readyStatus === 'ready';

const hasAuthenticatedSession = (): boolean => Boolean(state.user && state.session);

const hasActiveMfaMethods = (): boolean => (state.user?.mfaMethods.length ?? 0) > 0;

const hasMfaMethod = (method: AvailableMfaMethod): boolean =>
  Boolean(state.user?.mfaMethods.includes(method));

const hasPasskeyRegistered = (): boolean =>
  hasMfaMethod('webauthn') || (state.user?.webauthnCredentialsCount ?? 0) > 0 || state.credentials.length > 0;

const hasRecentReauth = (): boolean => {
  if (!state.session?.reauthenticatedUntil) {
    return false;
  }

  const reauthUntil = new Date(state.session.reauthenticatedUntil).getTime();
  return Number.isFinite(reauthUntil) && reauthUntil > Date.now();
};

const hasLogEntry = (snippet: string): boolean => state.logs.some((entry) => entry.includes(snippet));

const canRefreshSession = (): boolean => hasAuthenticatedSession() || state.pendingLoginMfa.length > 0;

const canLogout = (): boolean => hasAuthenticatedSession() || state.pendingLoginMfa.length > 0;

const canUsePasswordReauth = (): boolean => hasAuthenticatedSession() && !hasActiveMfaMethods();

const canUsePasskeyReauth = (): boolean => hasAuthenticatedSession() && hasMfaMethod('webauthn');

const canRegisterPasskey = (): boolean => hasAuthenticatedSession() && hasRecentReauth();

const canCompleteLoginWithPasskey = (): boolean => state.pendingLoginMfa.includes('webauthn');

const canLoadCredentials = (): boolean => hasAuthenticatedSession() && hasRecentReauth();

const canRevokeCredentials = (): boolean => hasAuthenticatedSession() && hasRecentReauth();

const canVerifyTotp = (): boolean =>
  state.mfaCode.length >= 6 &&
  (state.pendingLoginMfa.includes('totp') || (hasAuthenticatedSession() && hasMfaMethod('totp')));

const canVerifyRecoveryCode = (): boolean =>
  state.mfaCode.length >= 6 &&
  (state.pendingLoginMfa.includes('recovery_code') ||
    (hasAuthenticatedSession() && hasMfaMethod('recovery_code')));

const safeUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const healthClass = (status: string): string => {
  if (status === 'ok' || status === 'ready') {
    return 'ok';
  }

  if (status === 'degraded' || status === 'unavailable' || status === 'unknown') {
    return 'warn';
  }

  return 'idle';
};

const getLogTone = (entry: string): 'log-success' | 'log-error' | 'log-info' => {
  if (entry.includes('ERROR:')) {
    return 'log-error';
  }

  if (
    entry.includes('completad') ||
    entry.includes('registrad') ||
    entry.includes('revocad') ||
    entry.includes('validada') ||
    entry.includes('Sesion autenticada')
  ) {
    return 'log-success';
  }

  return 'log-info';
};

const actionAttr = (disabled: boolean): string =>
  state.busy || disabled ? 'disabled aria-disabled="true"' : '';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

void (async () => {
  render();

  try {
    await refreshHealthState();
  } catch {
    addLog('No se pudo leer health al cargar el panel.');
  }

  try {
    await refreshAuthenticatedState();
  } catch {
    addLog('Sin sesion previa valida. Inicia login para comenzar.');
  } finally {
    render();
  }
})();
