import { defineConfig, devices } from '@playwright/test';
import {
  webauthnLabAlternateWebBaseUrl,
  webauthnLabApiBaseUrl,
  webauthnLabEnvironment,
  webauthnLabWebBaseUrl,
} from './playwright.lab-environment';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  globalSetup: './playwright.global-setup.ts',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: webauthnLabWebBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `${npmCommand} --workspace apps/api run start:dev`,
      url: `${webauthnLabApiBaseUrl}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: webauthnLabEnvironment,
    },
    {
      command: `${npmCommand} --workspace apps/web run dev -- --host 0.0.0.0 --port 3100 --strictPort`,
      url: `${webauthnLabWebBaseUrl}/healthz.json`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: webauthnLabEnvironment,
    },
  ],
  projects: [
    {
      name: 'chromium-localhost',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webauthnLabWebBaseUrl,
      },
    },
    {
      name: 'chromium-loopback',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webauthnLabAlternateWebBaseUrl,
      },
    },
  ],
});
