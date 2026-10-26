/**
 * Evidence wrapper for the isolated 50-screen audit.
 *
 * Runs `bun scripts/verify-screens.ts` with an isolated temp DATA_DIR (created and
 * destroyed inside verify-screens.ts / scripts/lib/isolated-env.ts), captures the
 * complete stdout+stderr stream together with run metadata into
 * `docs/implementation/evidence/<stem>.log`, and appends the exit code, git
 * revision/working-tree fingerprint and the repository `data/` isolation proof.
 *
 * Usage:
 *   bun scripts/run-isolated-audit.ts                 # full baseline (visual + business)
 *   VERIFY_SCOPE=business bun scripts/run-isolated-audit.ts
 *   VERIFY_EVIDENCE_STEM=test-isolation-rerun bun scripts/run-isolated-audit.ts
 *
 * The wrapper never writes to the repository `data/` directory. It only hashes it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRunId,
  diffDirectories,
  getGitFingerprint,
  resolveRepoRoot,
  shellBin,
  snapshotDirectory,
  type DirectoryFingerprint,
  type GitFingerprint,
} from './lib/isolated-env';

const REPO_ROOT = resolveRepoRoot();
const RUN_ID = process.env.VERIFY_RUN_ID || createRunId();
const STEM = process.env.VERIFY_EVIDENCE_STEM || 'test-isolation-baseline';
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs', 'implementation', 'evidence');
const LOG_PATH = path.join(EVIDENCE_DIR, `${STEM}.log`);
const OUTPUT_DIR = path.resolve(process.env.VERIFY_OUTPUT_DIR || path.join(os.tmpdir(), `potato-isolated-${RUN_ID}`, 'verified-screens'));
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'verify-screens.ts');
const REAL_DATA_DIR = path.join(REPO_ROOT, 'data');
const STARTED_AT = new Date();

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function block(lines: string[]): string {
  return lines.join('\n') + '\n';
}

const gitBefore: GitFingerprint = getGitFingerprint(REPO_ROOT);
const dataBefore: DirectoryFingerprint = await snapshotDirectory(REAL_DATA_DIR);

const header = block([
  '==================================================================',
  ' 考公工作台 · 隔离验收基线证据 (test isolation baseline evidence)',
  '==================================================================',
  `RUN_ID:            ${RUN_ID}`,
  `STARTED_AT:        ${STARTED_AT.toISOString()}`,
  `WRAPPER:           bun scripts/run-isolated-audit.ts`,
  `CHILD_COMMAND:     ${shellBin()} scripts/verify-screens.ts`,
  `WRAPPER_CWD:       ${REPO_ROOT}`,
  `GIT_HEAD:          ${gitBefore.head} (${gitBefore.branch})`,
  `GIT_WORKTREE_SHA256: ${gitBefore.worktreeSha256}`,
  `GIT_TRACKED_DIFF_SHA256: ${gitBefore.trackedDiffSha256}`,
  `GIT_STATUS_LINES:  ${gitBefore.statusPorcelain.split(/\r?\n/).filter(Boolean).length}`,
  `GIT_UNTRACKED_FILES: ${gitBefore.untrackedFiles.length}`,
  `REAL_DATA_DIR:     ${REAL_DATA_DIR}`,
  `REAL_DATA_FINGERPRINT_BEFORE: exists=${dataBefore.exists} files=${dataBefore.files.length} aggregate_sha256=${dataBefore.aggregateSha256}`,
  `OUTPUT_DIR:        ${OUTPUT_DIR}`,
  `ENV: VERIFY_SCOPE=${process.env.VERIFY_SCOPE || 'all'} VERIFY_REBUILD=${process.env.VERIFY_REBUILD || '1'} VERIFY_URL=${process.env.VERIFY_URL || '<none>'} VERIFY_ISOLATED=${process.env.VERIFY_ISOLATED || '0'}`,
  '------------------------------------------------------------------',
  '',
]);

const logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });
logStream.write(header);

function writeBoth(text: string, isErr = false): void {
  logStream.write(text);
  if (isErr) process.stderr.write(text);
  else process.stdout.write(text);
}

const child = spawn(shellBin(), [SCRIPT_PATH], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    VERIFY_RUN_ID: RUN_ID,
    VERIFY_EVIDENCE_DIR: EVIDENCE_DIR,
    VERIFY_EVIDENCE_STEM: STEM,
    VERIFY_OUTPUT_DIR: OUTPUT_DIR,
    VERIFY_REBUILD: process.env.VERIFY_REBUILD || '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout?.on('data', chunk => writeBoth(chunk.toString('utf8')));
child.stderr?.on('data', chunk => writeBoth(chunk.toString('utf8')));

let forwardingSignal = false;
const forwardSignal = (signal: NodeJS.Signals) => {
  if (forwardingSignal) return;
  forwardingSignal = true;
  child.kill(signal);
};
process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
  child.on('exit', (code, signal) => resolve({ code, signal }));
});

const finishedAt = new Date();
const gitAfter = getGitFingerprint(REPO_ROOT);
const dataAfter = await snapshotDirectory(REAL_DATA_DIR);
const dataDiff = diffDirectories(dataBefore, dataAfter);
const sourceChanged = gitBefore.head !== gitAfter.head || gitBefore.trackedDiffSha256 !== gitAfter.trackedDiffSha256;

const resultsPath = path.join(EVIDENCE_DIR, `${STEM}-results.json`);
const isolationPath = path.join(EVIDENCE_DIR, `${STEM}-isolation.json`);
const footer: string[] = [
  '',
  '------------------------------------------------------------------',
  `EXIT_CODE: ${exit.code === null ? `null (signal=${exit.signal})` : exit.code}`,
  `FINISHED_AT: ${finishedAt.toISOString()}`,
  `DURATION: ${((finishedAt.getTime() - STARTED_AT.getTime()) / 1000).toFixed(1)}s`,
  `GIT_HEAD_AFTER: ${gitAfter.head}`,
  `GIT_WORKTREE_SHA256_AFTER: ${gitAfter.worktreeSha256}`,
  `SOURCE_CHANGED_DURING_RUN: ${sourceChanged} (true means another agent edited tracked sources while this run was executing)`,
  `REAL_DATA_FINGERPRINT_AFTER: exists=${dataAfter.exists} files=${dataAfter.files.length} aggregate_sha256=${dataAfter.aggregateSha256}`,
  `REAL_DATA_UNCHANGED: ${dataDiff.unchanged ? 'PASS' : 'FAIL'}`,
];
if (!dataDiff.unchanged) {
  footer.push(`REAL_DATA_DIFF: added=${JSON.stringify(dataDiff.added)} removed=${JSON.stringify(dataDiff.removed)} modified=${JSON.stringify(dataDiff.modified.map(entry => entry.path))}`);
}
footer.push(`RESULTS_JSON: ${fs.existsSync(resultsPath) ? resultsPath : '<missing>'}`);
footer.push(`ISOLATION_JSON: ${fs.existsSync(isolationPath) ? isolationPath : '<missing>'}`);
footer.push(`SCREENSHOTS_DIR: ${OUTPUT_DIR}`);
footer.push('==================================================================');
footer.push('');

writeBoth(block(footer));
await new Promise<void>(resolve => logStream.end(() => resolve()));

let finalExitCode = exit.code === null ? 1 : exit.code;
if (finalExitCode === 0) {
  if (!dataDiff.unchanged) {
    finalExitCode = 3;
  } else if (sourceChanged) {
    finalExitCode = 4;
  }
}

console.log(`\nEVIDENCE_LOG: ${LOG_PATH}`);
console.log(`EXIT_CODE: ${finalExitCode}`);
process.exit(finalExitCode);
