import { spawnSync } from 'node:child_process';
import { webauthnLabEnvironment } from './playwright.lab-environment';

const runCommand = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: webauthnLabEnvironment,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

export default async function globalSetup(): Promise<void> {
  const repoRoot = process.cwd();
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  runCommand(npmCommand, ['run', 'seed:webauthn-demo'], repoRoot);
}
