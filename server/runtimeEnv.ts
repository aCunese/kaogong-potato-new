import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads and applies runtime environment variable overrides from `dataDir/.env.runtime`.
 * Existing environment variables in targetEnv will not be overwritten unless empty.
 * Returns the number of variables successfully injected.
 */
export function loadRuntimeEnvOverrides(dataDir: string, targetEnv: NodeJS.ProcessEnv = process.env): number {
  const runtimeEnvFile = path.join(dataDir, '.env.runtime');
  if (!fs.existsSync(runtimeEnvFile)) return 0;

  try {
    const raw = fs.readFileSync(runtimeEnvFile, 'utf8');
    let injected = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip matching outer quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!targetEnv[key] && val) {
          targetEnv[key] = val;
          injected++;
        }
      }
    }
    return injected;
  } catch (err) {
    console.warn('[ENV] Failed to load data/.env.runtime overrides:', err);
    return 0;
  }
}
