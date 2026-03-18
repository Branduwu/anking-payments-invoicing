import { spawnSync } from 'node:child_process';

const [, , scriptPath, ...scriptArgs] = process.argv;

if (!scriptPath) {
  console.error('Usage: node ./scripts/run-powershell.mjs <script.ps1> [args...]');
  process.exit(1);
}

const candidates =
  process.platform === 'win32' ? ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell'] : ['pwsh'];

let lastError = null;

for (const candidate of candidates) {
  const powershellArgs =
    process.platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...scriptArgs]
      : ['-NoLogo', '-NoProfile', '-File', scriptPath, ...scriptArgs];

  const result = spawnSync(candidate, powershellArgs, {
    stdio: 'inherit',
    shell: false,
  });

  if (!result.error) {
    process.exit(result.status ?? 0);
  }

  lastError = result.error;
}

console.error(
  `No se encontro un ejecutable de PowerShell compatible para correr ${scriptPath}.`,
);
if (lastError) {
  console.error(lastError.message);
}
process.exit(1);
