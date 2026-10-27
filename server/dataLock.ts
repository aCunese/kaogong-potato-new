import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DataDirectoryLock {
  release(): Promise<void>;
  lost: Promise<Error>;
}

export class DataLockError extends Error {
  code: 'DATA_LOCK_BUSY' | 'DATA_LOCK_UNAVAILABLE' | 'DATA_LOCK_LOST';
  constructor(code: 'DATA_LOCK_BUSY' | 'DATA_LOCK_UNAVAILABLE' | 'DATA_LOCK_LOST', message: string) {
    super(`${code}: ${message}`);
    this.name = 'DataLockError';
    this.code = code;
  }
}

function getHelperScriptPath(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const candidate1 = path.resolve(path.dirname(currentFile), '../scripts/lib/data-lock.py');
    if (fs.existsSync(candidate1)) return candidate1;
  } catch {}

  const candidate2 = path.resolve(process.cwd(), 'scripts/lib/data-lock.py');
  if (fs.existsSync(candidate2)) return candidate2;

  return path.resolve(process.cwd(), 'scripts/lib/data-lock.py');
}

export function getCanonicalDataDir(dataDir: string): string {
  try {
    if (fs.existsSync(dataDir)) {
      return fs.realpathSync(dataDir);
    }
  } catch {}
  return path.resolve(dataDir);
}

export async function acquireDataDirectoryLock(
  dataDir: string,
  mode: 'shared' | 'exclusive'
): Promise<DataDirectoryLock> {
  if (mode !== 'shared' && mode !== 'exclusive') {
    throw new DataLockError('DATA_LOCK_UNAVAILABLE', `Invalid lock mode '${mode}', expected 'shared' or 'exclusive'`);
  }

  if (!fs.existsSync(dataDir)) {
    throw new DataLockError('DATA_LOCK_UNAVAILABLE', `Data directory does not exist: ${dataDir}`);
  }

  let canonicalDataDir: string;
  try {
    canonicalDataDir = fs.realpathSync(dataDir);
  } catch (err: any) {
    throw new DataLockError('DATA_LOCK_UNAVAILABLE', `Failed to canonicalize directory ${dataDir}: ${err.message}`);
  }

  const helperScript = getHelperScriptPath();
  if (!fs.existsSync(helperScript)) {
    throw new DataLockError('DATA_LOCK_UNAVAILABLE', `Helper script not found: ${helperScript}`);
  }

  const pythonBin = process.env.PYTHON_BIN || 'python3';

  return new Promise<DataDirectoryLock>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(pythonBin, [helperScript, canonicalDataDir, mode], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      return reject(new DataLockError('DATA_LOCK_UNAVAILABLE', `Failed to spawn ${pythonBin}: ${err.message}`));
    }

    let isHandshakeComplete = false;
    let isReleased = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    let lostReject!: (err: Error) => void;
    const lost = new Promise<Error>((_, rej) => {
      lostReject = rej;
    });
    // Attach noop catch to avoid UnhandledPromiseRejection warning before caller handles it
    lost.catch(() => {});

    proc.stdout?.setEncoding('utf-8');
    proc.stderr?.setEncoding('utf-8');

    proc.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      if (!isHandshakeComplete && stdoutBuf.includes('READY\n')) {
        isHandshakeComplete = true;
        resolve({
          release,
          lost,
        });
      }
    });

    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    proc.on('error', (err: any) => {
      if (!isHandshakeComplete) {
        reject(new DataLockError('DATA_LOCK_UNAVAILABLE', `Python helper spawn error: ${err.message}`));
      } else if (!isReleased) {
        lostReject(new DataLockError('DATA_LOCK_LOST', `Lock helper error while holding lock: ${err.message}`));
      }
    });

    proc.on('close', (code, signal) => {
      if (!isHandshakeComplete) {
        const fullErr = (stderrBuf || '').trim();
        if (code === 2 || fullErr.includes('DATA_LOCK_BUSY')) {
          reject(new DataLockError('DATA_LOCK_BUSY', fullErr || 'Lock busy'));
        } else if (code === 3 || fullErr.includes('DATA_LOCK_UNAVAILABLE')) {
          reject(new DataLockError('DATA_LOCK_UNAVAILABLE', fullErr || 'Lock unavailable'));
        } else {
          reject(new DataLockError('DATA_LOCK_UNAVAILABLE', `Lock helper exited prematurely with code ${code}, signal ${signal}: ${fullErr}`));
        }
      } else if (!isReleased) {
        lostReject(new DataLockError('DATA_LOCK_LOST', `Lock helper exited unexpectedly (code: ${code}, signal: ${signal}): ${stderrBuf.trim()}`));
      }
    });

    async function release(): Promise<void> {
      if (isReleased) {
        return;
      }
      isReleased = true;

      return new Promise<void>((resolveRelease) => {
        if (proc.exitCode !== null || proc.killed) {
          return resolveRelease();
        }

        const forceKillTimer = setTimeout(() => {
          try {
            proc.kill('SIGTERM');
          } catch {}
          resolveRelease();
        }, 3000);
        forceKillTimer.unref?.();

        proc.once('close', () => {
          clearTimeout(forceKillTimer);
          resolveRelease();
        });

        try {
          proc.stdin?.end();
        } catch {
          try {
            proc.kill('SIGTERM');
          } catch {}
        }
      });
    }
  });
}
