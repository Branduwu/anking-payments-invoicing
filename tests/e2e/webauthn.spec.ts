import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const DEMO_EMAIL = process.env.WEBAUTHN_DEMO_EMAIL ?? 'webauthn.demo@example.com';
const DEMO_PASSWORD = process.env.WEBAUTHN_DEMO_PASSWORD ?? 'ChangeMeNow_123456789!';

test.describe('WebAuthn browser flow', () => {
  test.beforeEach(async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Virtual WebAuthn authenticator is only configured for Chromium');

    resetDemoUser();

    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
  });

  test('registers, uses and revokes a passkey end-to-end', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('email-input').fill(DEMO_EMAIL);
    await page.getByTestId('password-input').fill(DEMO_PASSWORD);

    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('session-summary')).toContainText(DEMO_EMAIL);
    await expect(page.getByTestId('session-summary')).toContainText('desactivado');

    await page.getByTestId('reauth-password-button').click();
    await expect(page.getByTestId('activity-log')).toContainText('Reautenticacion con password completada');

    await page.getByTestId('register-passkey-button').click();
    await expect(page.getByTestId('activity-log')).toContainText('Passkey registrada');
    await expect(page.getByTestId('recovery-codes')).not.toContainText('Aun no se han generado');

    await page.getByTestId('load-credentials-button').click();
    await expect(page.getByTestId('credentials-count')).toHaveText('1');

    await page.getByTestId('logout-button').click();
    await expect(page.getByTestId('session-summary')).toContainText('No autenticado');

    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('session-summary')).toContainText('MFA pendiente');
    await expect(page.getByTestId('session-summary')).toContainText('webauthn');

    await page.getByTestId('complete-login-passkey-button').click();
    await expect(page.getByTestId('session-summary')).toContainText(DEMO_EMAIL);
    await expect(page.getByTestId('session-summary')).toContainText('activo');

    await page.getByTestId('reauth-passkey-button').click();
    await expect(page.getByTestId('activity-log')).toContainText('Reautenticacion con passkey completada');

    await page.getByTestId('load-credentials-button').click();
    await expect(page.getByTestId('credentials-count')).toHaveText('1');

    await page.locator('[data-credential-id]').first().click();
    await expect(page.getByTestId('credentials-count')).toHaveText('0');
    await page.getByTestId('load-me-button').click();
    await expect(page.getByTestId('session-summary')).toContainText('desactivado');
  });
});

function resetDemoUser(): void {
  const repoRoot = process.cwd();
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['run', 'seed:webauthn-demo'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error('Failed to reset the WebAuthn demo user before the E2E test');
  }
}
