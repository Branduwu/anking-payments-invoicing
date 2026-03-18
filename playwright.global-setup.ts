import { spawnSync } from 'node:child_process';
import { webauthnLabEnvironment } from './playwright.lab-environment';

const runCommand = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: webauthnLabEnvironment,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

export default async function globalSetup(): Promise<void> {
  const repoRoot = process.cwd();
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmExecPath ? [npmExecPath, 'run', 'seed:webauthn-demo'] : ['run', 'seed:webauthn-demo'];

  runCommand(command, args, repoRoot);
}
