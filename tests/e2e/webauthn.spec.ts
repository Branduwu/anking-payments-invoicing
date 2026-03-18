import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  webauthnLabDemoEmail,
  webauthnLabDemoPassword,
  webauthnLabEnvironment,
} from '../../playwright.lab-environment';

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

  test('registers, uses and revokes a passkey end-to-end', async ({ page }, testInfo) => {
    await page.goto('/');

    if (testInfo.project.name === 'chromium-loopback') {
      await page.waitForURL((url) => url.hostname === 'localhost');
      await expect(page.getByTestId('browser-origin')).toContainText('http://localhost:3100');
    }

    await page.getByTestId('email-input').fill(webauthnLabDemoEmail);
    await page.getByTestId('password-input').fill(webauthnLabDemoPassword);

    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('session-summary')).toContainText(webauthnLabDemoEmail);
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
    await expect(page.getByTestId('session-summary')).toContainText(webauthnLabDemoEmail);
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
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmExecPath ? [npmExecPath, 'run', 'seed:webauthn-demo'] : ['run', 'seed:webauthn-demo'];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: webauthnLabEnvironment,
  });

  if (result.status !== 0) {
    throw new Error('Failed to reset the WebAuthn demo user before the E2E test');
  }
}
