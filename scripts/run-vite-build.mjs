import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');

if (process.platform === 'win32') {
  const originalExec = childProcess.exec;

  childProcess.exec = function patchedExec(command, options, callback) {
    const normalizedCommand = typeof command === 'string' ? command.trim().toLowerCase() : '';

    if (normalizedCommand === 'net use') {
      const actualCallback =
        typeof options === 'function' ? options : typeof callback === 'function' ? callback : null;

      const fakeProcess = new EventEmitter();
      fakeProcess.stdout = Readable.from([]);
      fakeProcess.stderr = Readable.from([]);
      fakeProcess.kill = () => true;

      queueMicrotask(() => {
        actualCallback?.(null, '', '');
        fakeProcess.emit('exit', 0);
        fakeProcess.emit('close', 0);
      });

      return fakeProcess;
    }

    return originalExec.call(this, command, options, callback);
  };
}

const { build } = await import('vite');

await build({
  configFile: 'vite.config.mjs',
  configLoader: 'runner',
});
