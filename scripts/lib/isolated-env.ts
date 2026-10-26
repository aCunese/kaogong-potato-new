/**
 * Isolated test environment for the 考公工作台 verification harness.
 *
 * Hard rules enforced here (see docs/implementation/evidence/test-isolation-baseline.md):
 * 1. Every server/CLI process started by the harness gets an EXPLICIT `DATA_DIR`
 *    that lives in a fresh temp directory outside the repository. There is no
 *    default `./data` fallback anywhere in this file — a missing/unsafe DATA_DIR
 *    is a hard failure before anything is spawned.
 * 2. The real repository `data/` directory is only ever read (hashed) for an
 *    isolation proof; it is never written to by this harness.
 * 3. Temp resources created here are removed on cleanup. Build artifacts (`dist/`)
 *    are produced by the normal project build command, not by this helper.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Repo / process helpers
// ---------------------------------------------------------------------------

export function resolveRepoRoot(): string {
  // This file lives at <repo>/scripts/lib/isolated-env.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

export function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `run-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export function nodeBin(): string {
  if (process.env.VERIFY_NODE_BIN) return process.env.VERIFY_NODE_BIN;
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

export function shellBin(): string {
  return process.env.VERIFY_BUN_BIN || 'bun';
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export interface CommandResult {
  command: string;
  exitCode: number;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** Runs a command synchronously with a hard timeout; never throws on non-zero exit. */
export function runCommand(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): CommandResult {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 240_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal ?? null,
    durationMs: Date.now() - started,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

export function tailOf(text: string, lines = 25): string[] {
  const split = text.split(/\r?\n/).filter(line => line.length > 0);
  return split.slice(-lines);
}

// ---------------------------------------------------------------------------
// Free port + explicit DATA_DIR guard
// ---------------------------------------------------------------------------

export async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => {
        if (!port) reject(new Error('Could not allocate an ephemeral TCP port'));
        else resolve(port);
      });
    });
  });
}

/**
 * Resolves a path to its real canonical path (following symlinks).
 * If the path or a subpath does not exist yet, resolves the deepest existing
 * ancestor and appends the non-existent tail.
 */
export function resolveRealPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync(resolved);
  }
  let curr = resolved;
  const tailParts: string[] = [];
  while (!fs.existsSync(curr)) {
    const parent = path.dirname(curr);
    if (parent === curr) break;
    tailParts.unshift(path.basename(curr));
    curr = parent;
  }
  if (fs.existsSync(curr)) {
    return path.join(fs.realpathSync(curr), ...tailParts);
  }
  return resolved;
}

/**
 * Fails fast unless `dataDir` is an explicit absolute path that is NOT the
 * repository `data/` directory and NOT anywhere inside the repository.
 * This is the guard that keeps the harness from silently using `./data`.
 * Both the unresolved path and canonical realpath (following all symlinks)
 * are verified.
 */
export function assertIsolatedDataDir(dataDir: string | undefined, repoRoot: string): string {
  if (!dataDir || !dataDir.trim()) {
    throw new Error('[isolation] DATA_DIR must be provided explicitly; refusing to fall back to <repo>/data');
  }
  const resolved = path.resolve(dataDir);
  const realDataDir = resolveRealPath(resolved);

  const repoRootResolved = path.resolve(repoRoot);
  const realRepoRoot = resolveRealPath(repoRootResolved);

  const repoData = path.join(repoRootResolved, 'data');
  const realRepoData = path.join(realRepoRoot, 'data');

  // Lexical path checks
  if (resolved === repoData) {
    throw new Error(`[isolation] DATA_DIR must not be the real repo data dir: ${resolved}`);
  }
  if (resolved === repoRootResolved || resolved.startsWith(repoRootResolved + path.sep)) {
    throw new Error(`[isolation] DATA_DIR must live outside the repository: ${resolved}`);
  }

  // Realpath / symlink resolution checks
  if (realDataDir === realRepoData || (fs.existsSync(repoData) && realDataDir === fs.realpathSync(repoData))) {
    throw new Error(`[isolation] DATA_DIR must not point to the real repo data dir (symlink target detected): ${realDataDir}`);
  }
  if (realDataDir === realRepoRoot || realDataDir.startsWith(realRepoRoot + path.sep)) {
    throw new Error(`[isolation] DATA_DIR must live outside the repository (symlink points inside repo): ${realDataDir}`);
  }

  const rootParsed = path.parse(resolved).root;
  const homeResolved = path.resolve(os.homedir());
  const realHome = resolveRealPath(homeResolved);

  if (
    resolved === rootParsed ||
    resolved === homeResolved ||
    realDataDir === path.parse(realDataDir).root ||
    realDataDir === realHome
  ) {
    throw new Error(`[isolation] DATA_DIR is too broad to be a disposable temp dir: ${resolved}`);
  }
  return realDataDir;
}

// ---------------------------------------------------------------------------
// Web build (dist/)
// ---------------------------------------------------------------------------

export type BuildStrategy = 'npm-run-build' | 'reused-existing-dist';

export interface WebBuildInfo {
  strategy: BuildStrategy;
  typecheckPassed: boolean | null;
  npmBuildExitCode: number | null;
  viteBuildExitCode: number | null;
  fallbackReason?: string;
  distIndexPath: string;
  distIndexMtimeMs: number;
  hashedAssets: string[];
}

/**
 * Builds the frontend that the isolated server will statically serve from
 * `<repoRoot>/dist`. Runs the project's real `npm run build` (typecheck +
 * vite). If `npm run build` fails (or typecheck fails), throws immediately.
 * No silent Vite-only fallback is allowed.
 */
export async function ensureWebBuild(repoRoot: string, opts: { rebuild: boolean } = { rebuild: true }): Promise<WebBuildInfo> {
  const distIndexPath = path.join(repoRoot, 'dist', 'index.html');
  const distAssetsDir = path.join(repoRoot, 'dist', 'assets');
  const readBuildInfo = (strategy: BuildStrategy, typecheckPassed: boolean | null, npmBuildExitCode: number | null, viteBuildExitCode: number | null, fallbackReason?: string): WebBuildInfo => {
    const stat = fs.statSync(distIndexPath);
    const hashedAssets = fs.existsSync(distAssetsDir) ? fs.readdirSync(distAssetsDir) : [];
    return { strategy, typecheckPassed, npmBuildExitCode, viteBuildExitCode, fallbackReason, distIndexPath, distIndexMtimeMs: stat.mtimeMs, hashedAssets };
  };

  if (!opts.rebuild && fs.existsSync(distIndexPath)) {
    return readBuildInfo('reused-existing-dist', null, null, null, 'VERIFY_REBUILD=0: reused existing dist/ without rebuilding');
  }

  const npm = runCommand('npm', ['run', 'build'], { cwd: repoRoot, timeoutMs: 300_000 });
  if (npm.exitCode === 0 && fs.existsSync(distIndexPath)) {
    return readBuildInfo('npm-run-build', true, 0, 0);
  }

  const npmTail = tailOf(`${npm.stdout}\n${npm.stderr}`).join('\n');
  throw new Error(`[build] npm run build failed (exitCode=${npm.exitCode}). Refusing to fall back to un-typechecked build.\nnpm build tail:\n${npmTail}`);
}

// ---------------------------------------------------------------------------
// Isolated server
// ---------------------------------------------------------------------------

export interface HealthPayload {
  ok: boolean;
  status: string;
  generationId: string;
  time: string;
  uptime: number;
}

export interface VersionPayload {
  version: string;
  build: string;
  schemaVersion: number;
  [key: string]: unknown;
}

export interface WebBuildStamp {
  version: string;
  build: string;
  schemaVersion: number;
  source: 'server-endpoint';
  servedAt: string;
}

export async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getWebBuildStamp(baseUrl: string): Promise<WebBuildStamp> {
  const payload = await fetchJson<VersionPayload>(`${baseUrl}/version.json`);
  return { version: String(payload.version), build: String(payload.build), schemaVersion: Number(payload.schemaVersion), source: 'server-endpoint', servedAt: new Date().toISOString() };
}

export interface ServerHandle {
  url: string;
  port: number;
  dataDir: string;
  pid: number;
  child: ChildProcess;
  logLines: string[];
  logFile: string;
  stop: () => Promise<void>;
}

export async function startIsolatedServer(opts: {
  repoRoot: string;
  dataDir: string;
  port: number;
  logFile: string;
  timeoutMs?: number;
}): Promise<ServerHandle> {
  const dataDir = assertIsolatedDataDir(opts.dataDir, opts.repoRoot);
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(opts.port),
    HOST: '127.0.0.1',
    NODE_ENV: process.env.NODE_ENV || 'test',
  };
  const child = spawn(nodeBin(), ['--import', 'tsx', 'server/index.ts'], {
    cwd: opts.repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logLines: string[] = [];
  const write = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) if (line.trim()) logLines.push(line);
    fs.appendFileSync(opts.logFile, text);
  };
  child.stdout?.on('data', write);
  child.stderr?.on('data', write);

  let exited = false;
  let exitDetail = '';
  child.on('exit', (code, signal) => { exited = true; exitDetail = `server exited before becoming healthy (code=${code}, signal=${signal})`; });

  const baseUrl = `http://127.0.0.1:${opts.port}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  let lastError = '';
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const health = await fetchJson<HealthPayload>(`${baseUrl}/api/health`, 2_000);
      if (health.ok && health.status === 'healthy') {
        const dbPath = path.join(dataDir, 'potato.db');
        if (!fs.existsSync(dbPath)) {
          throw new Error(`[isolation] server became healthy but created no DB inside DATA_DIR (${dbPath}); refusing to continue`);
        }
        return {
          url: baseUrl, port: opts.port, dataDir, pid: child.pid ?? -1, child, logLines, logFile: opts.logFile,
          stop: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill('SIGTERM');
            const stopDeadline = Date.now() + 5_000;
            while (Date.now() < stopDeadline && child.exitCode === null && child.signalCode === null) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          },
        };
      }
      lastError = `health payload not healthy: ${JSON.stringify(health)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  throw new Error(`[isolation] isolated server did not become healthy on ${baseUrl}: ${lastError}\n${tailOf(`${exitDetail}\n${logLines.join('\n')}`, 25).join('\n')}`);
}

// ---------------------------------------------------------------------------
// Invite code via the project CLI (with explicit DATA_DIR)
// ---------------------------------------------------------------------------

export interface InviteResult {
  code: string;
  exitCode: number;
  command: string;
  stdout: string;
  stderr: string;
}

export async function createInviteViaCli(repoRoot: string, dataDir: string): Promise<InviteResult> {
  const safeDataDir = assertIsolatedDataDir(dataDir, repoRoot);
  const result = runCommand(nodeBin(), ['--import', 'tsx', 'server/cli.ts', 'create-invite'], {
    cwd: repoRoot,
    env: { ...process.env, DATA_DIR: safeDataDir, PORT: '', HOST: '' },
    timeoutMs: 60_000,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const match = combined.match(/invite_[0-9a-f]{8,}/);
  if (result.exitCode !== 0 || !match) {
    throw new Error(`[isolation] could not create invite code via CLI (exit ${result.exitCode}); output tail:\n${tailOf(combined).join('\n')}`);
  }
  return { code: match[0], exitCode: result.exitCode, command: result.command, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// Fingerprints (real data dir proof + source version proof)
// ---------------------------------------------------------------------------

export interface FileFingerprint {
  path: string; // relative to the snapshotted root
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface DirectoryFingerprint {
  root: string;
  exists: boolean;
  capturedAt: string;
  files: FileFingerprint[];
  aggregateSha256: string;
}

export async function snapshotDirectory(root: string): Promise<DirectoryFingerprint> {
  const files: FileFingerprint[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fsp.readlink(full);
        files.push({ path: path.relative(root, full), size: 0, mtimeMs: 0, sha256: `symlink:${target}` });
      } else if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full);
        const buffer = await fsp.readFile(full);
        files.push({ path: path.relative(root, full), size: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256Hex(buffer) });
      }
    }
  };
  const exists = fs.existsSync(root);
  if (exists) await walk(root);
  const aggregateSha256 = sha256Hex(files.map(f => `${f.path}:${f.size}:${f.sha256}`).join('\n'));
  return { root, exists, capturedAt: new Date().toISOString(), files, aggregateSha256 };
}

export interface FingerprintDiff {
  unchanged: boolean;
  added: string[];
  removed: string[];
  modified: { path: string; before: FileFingerprint; after: FileFingerprint }[];
}

export function diffDirectories(before: DirectoryFingerprint, after: DirectoryFingerprint): FingerprintDiff {
  const beforeMap = new Map(before.files.map(f => [f.path, f]));
  const afterMap = new Map(after.files.map(f => [f.path, f]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: { path: string; before: FileFingerprint; after: FileFingerprint }[] = [];
  for (const [p, a] of afterMap) {
    const b = beforeMap.get(p);
    if (!b) added.push(p);
    else if (b.sha256 !== a.sha256 || b.size !== a.size || b.mtimeMs !== a.mtimeMs) modified.push({ path: p, before: b, after: a });
  }
  for (const p of beforeMap.keys()) if (!afterMap.has(p)) removed.push(p);
  const unchanged = before.exists === after.exists && added.length === 0 && removed.length === 0 && modified.length === 0;
  return { unchanged, added, removed, modified };
}

export interface GitFingerprint {
  head: string;
  branch: string;
  statusPorcelain: string;
  trackedDiffSha256: string;
  untrackedFiles: { path: string; sha256: string | null }[];
  worktreeSha256: string;
  capturedAt: string;
}

export function getGitFingerprint(repoRoot: string): GitFingerprint {
  const head = runCommand('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const branch = runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const status = runCommand('git', ['status', '--porcelain=v1', '--', '.', ':!docs/implementation/evidence'], { cwd: repoRoot }).stdout;
  const diff = runCommand('git', ['diff', 'HEAD', '--', '.', ':!docs/implementation/evidence'], { cwd: repoRoot }).stdout;
  const untrackedRaw = runCommand('git', ['ls-files', '--others', '--exclude-standard', '--', '.', ':!docs/implementation/evidence'], { cwd: repoRoot }).stdout;
  const untrackedFiles = untrackedRaw.split(/\r?\n/).filter(Boolean).map(rel => {
    try {
      const full = path.join(repoRoot, rel);
      const stat = fs.statSync(full);
      if (!stat.isFile()) return { path: rel, sha256: null };
      return { path: rel, sha256: sha256Hex(fs.readFileSync(full)) };
    } catch {
      return { path: rel, sha256: null };
    }
  });
  const trackedDiffSha256 = sha256Hex(diff);
  const worktreeSha256 = sha256Hex([head, status, trackedDiffSha256, ...untrackedFiles.map(f => `${f.path}:${f.sha256}`)].join('\n'));
  return { head, branch, statusPorcelain: status, trackedDiffSha256, untrackedFiles, worktreeSha256, capturedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Full isolated environment
// ---------------------------------------------------------------------------

export interface IsolatedEnvironment {
  runId: string;
  repoRoot: string;
  tmpRoot: string;
  dataDir: string;
  outputDir: string;
  serverUrl: string;
  server: ServerHandle;
  invite: InviteResult;
  webBuild: WebBuildStamp;
  build: WebBuildInfo;
  cleanup: () => Promise<void>;
}

export async function createIsolatedEnvironment(opts: {
  repoRoot: string;
  runId: string;
  rebuild: boolean;
  outputDir?: string;
}): Promise<IsolatedEnvironment> {
  const repoRoot = path.resolve(opts.repoRoot);
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `potato-isolated-${opts.runId}-`));
  const dataDir = assertIsolatedDataDir(path.join(tmpRoot, 'data'), repoRoot);
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : path.join(tmpRoot, 'verified-screens');
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(outputDir, { recursive: true });

  let server: ServerHandle | undefined;
  const cleanup = async () => {
    if (server) {
      await server.stop().catch(() => {});
      server = undefined;
    }
    // Only the disposable isolated DB/env is removed; screenshots + logs stay
    // under the *outside-the-repo* temp output dir for inspection.
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const build = await ensureWebBuild(repoRoot, { rebuild: opts.rebuild });
    const port = await getFreePort();
    server = await startIsolatedServer({ repoRoot, dataDir, port, logFile: path.join(tmpRoot, 'isolated-server.log') });
    const webBuild = await getWebBuildStamp(server.url);
    if (webBuild.version !== '1.0.2' && !webBuild.build) {
      throw new Error(`[isolation] /version.json from isolated server is not a valid build stamp: ${JSON.stringify(webBuild)}`);
    }
    const invite = await createInviteViaCli(repoRoot, dataDir);
    return {
      runId: opts.runId, repoRoot, tmpRoot, dataDir, outputDir, serverUrl: server.url, server, invite, webBuild, build,
      cleanup: async () => { await cleanup(); },
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
