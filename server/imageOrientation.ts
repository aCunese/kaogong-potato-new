import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageOrientationResult } from '../src/types';

export class ImageOrientationError extends Error {
  constructor(public readonly code: 'ORIENTATION_BUSY' | 'ORIENTATION_TIMEOUT' | 'ORIENTATION_UNAVAILABLE') {
    super(code);
    this.name = 'ImageOrientationError';
  }
}

interface OrientationOptions {
  pythonBin?: string;
  helperScript?: string;
  deadlineMs?: number;
  cacheSize?: number;
}

/** Only call after getUserMediaFile has verified the current user's ownership. */
export class ImageOrientationService {
  private running = false;
  private readonly cache = new Map<string, ImageOrientationResult>();
  constructor(private readonly options: OrientationOptions = {}) {}

  async orient(diskPath: string): Promise<ImageOrientationResult> {
    if (this.running) throw new ImageOrientationError('ORIENTATION_BUSY');
    this.running = true;
    const started = Date.now();
    try {
      const bytes = await readFile(diskPath);
      const key = `1:${createHash('sha256').update(bytes).digest('hex')}`;
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return { ...cached };
      }
      const remaining = Math.min(this.options.deadlineMs ?? 30_000, 30_000) - (Date.now() - started);
      if (remaining <= 0) throw new ImageOrientationError('ORIENTATION_TIMEOUT');
      const result = await this.runHelper(diskPath, remaining);
      // Keep explicit retries meaningful for images that were not resolved.
      if (result.status === 'resolved') this.cache.set(key, result);
      const limit = Math.max(1, Math.min(this.options.cacheSize ?? 256, 256));
      while (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value!);
      return { ...result };
    } catch (error) {
      if (error instanceof ImageOrientationError) throw error;
      throw new ImageOrientationError('ORIENTATION_UNAVAILABLE');
    } finally {
      this.running = false;
    }
  }

  private async runHelper(diskPath: string, deadlineMs: number): Promise<ImageOrientationResult> {
    // The supervisor owns scratch storage so SIGKILL cannot leak image copies.
    const scratch = await mkdtemp(path.join(tmpdir(), 'potato-orientation-job-'));
    try {
      return await new Promise<ImageOrientationResult>((resolve, reject) => {
        const child = spawn(
          this.options.pythonBin || process.env.PYTHON_BIN || 'python3',
          [this.options.helperScript || fileURLToPath(new URL('../scripts/lib/image-orientation.py', import.meta.url)), diskPath],
          { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_THREAD_LIMIT: '1', TMPDIR: scratch } },
        );
        let output = '';
        let timedOut = false;
        let oversized = false;
        const killGroup = () => {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { /* Child may have exited just before the deadline. */ }
        };
        const timer = setTimeout(() => { timedOut = true; killGroup(); }, deadlineMs);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          if (output.length > 4096) { oversized = true; killGroup(); }
        });
        // Drain diagnostics without collecting private paths or unbounded output.
        child.stderr.resume();
        child.on('error', () => {
          clearTimeout(timer);
          reject(new ImageOrientationError('ORIENTATION_UNAVAILABLE'));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (timedOut) return reject(new ImageOrientationError('ORIENTATION_TIMEOUT'));
          if (code !== 0 || oversized) return reject(new ImageOrientationError('ORIENTATION_UNAVAILABLE'));
          try {
            const result = JSON.parse(output);
            if (result.version !== 1 || !['resolved', 'unresolved'].includes(result.status) ||
              ![0, 90, 180, 270].includes(result.rotation) || (result.status === 'unresolved' && result.rotation !== 0)) {
              throw new Error('Invalid orientation');
            }
            resolve({ status: result.status, rotation: result.rotation, version: 1 });
          } catch { reject(new ImageOrientationError('ORIENTATION_UNAVAILABLE')); }
        });
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

export const imageOrientationService = new ImageOrientationService();
