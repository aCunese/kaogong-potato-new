/**
 * Boundary regression verification script (V01–V12).
 *
 * Runs the complete suite of boundary condition tests for the 12 issues
 * discovered in the baseline review (commit e488847):
 *   V01: Account lock bypass & fallback queue deadlock
 *   V02: Retry backoff false conflict & expired in-flight lease recovery
 *   V03: Init-choice & refreshSession epoch guards, sync guard mutation order
 *   V04: Force upload second GET & force pull expectedLocalVersion
 *   V05: Media async hash inactive IDB transaction
 *   V06: Docker runner missing release.json & silent fallback
 *   V07: Media upload quota check after disk write (orphan files)
 *   V08: Historical restore of deleted media references
 *   V09: Guest migration StudyRecord sourceId mapping
 *   V10: SW auto-claim causes applyWebUpdate 12s timeout
 *   V11: Version check cache not bound to local build identity
 *   V12: Android install permission payload loss & state machine lockup
 *
 * Outputs evidence to:
 *   - docs/implementation/evidence/boundaries-baseline.log
 *   - docs/implementation/evidence/boundaries-baseline-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createRunId,
  getGitFingerprint,
  resolveRepoRoot,
} from './lib/isolated-env';
import { runAllBoundaryChecks, type CheckResult } from './lib/boundary-checks';

const REPO_ROOT = resolveRepoRoot();
const RUN_ID = process.env.VERIFY_RUN_ID || createRunId();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs', 'implementation', 'evidence');
const LOG_PATH = path.join(EVIDENCE_DIR, 'boundaries-baseline.log');
const RESULTS_PATH = path.join(EVIDENCE_DIR, 'boundaries-baseline-results.json');
const STARTED_AT = new Date();

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const git = getGitFingerprint(REPO_ROOT);
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });

function writeBoth(text: string, isErr = false): void {
  logStream.write(text + '\n');
  if (isErr) process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

writeBoth('==================================================================');
writeBoth(' 考公工作台 · 边界与并发回归基线审计 (V01–V12)');
writeBoth('==================================================================');
writeBoth(`RUN_ID:            ${RUN_ID}`);
writeBoth(`STARTED_AT:        ${STARTED_AT.toISOString()}`);
writeBoth(`GIT_HEAD:          ${git.head} (${git.branch})`);
writeBoth(`GIT_WORKTREE_SHA:  ${git.worktreeSha256}`);
writeBoth(`REPO_ROOT:         ${REPO_ROOT}`);
writeBoth('------------------------------------------------------------------');
writeBoth('');

console.log('Running boundary regression tests for V01 through V12...\n');

const results: CheckResult[] = await runAllBoundaryChecks((result: CheckResult) => {
  const statusStr = result.passed ? '[PASS]' : '[FAIL]';
  const line = `${statusStr} ${result.id}: ${result.name} (${result.durationMs}ms)`;
  writeBoth(line, !result.passed);
  if (!result.passed && result.detail) {
    writeBoth(`       DETAIL: ${JSON.stringify(result.detail)}`);
  }
  if (result.error) {
    writeBoth(`       ERROR:  ${result.error}`, true);
  }
});

const FINISHED_AT = new Date();
const durationMs = FINISHED_AT.getTime() - STARTED_AT.getTime();
const passedCount = results.filter(r => r.passed).length;
const failedCount = results.filter(r => !r.passed).length;

const summary = {
  runId: RUN_ID,
  startedAt: STARTED_AT.toISOString(),
  finishedAt: FINISHED_AT.toISOString(),
  durationMs,
  gitHead: git.head,
  gitBranch: git.branch,
  gitWorktreeSha256: git.worktreeSha256,
  total: results.length,
  passed: passedCount,
  failed: failedCount,
  results: results.map(r => ({
    id: r.id,
    name: r.name,
    passed: r.passed,
    durationMs: r.durationMs,
    detail: r.detail,
    error: r.error,
  })),
};

fs.writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2));

writeBoth('');
writeBoth('------------------------------------------------------------------');
writeBoth(`=== RESULT SUMMARY: total=${summary.total} passed=${summary.passed} failed=${summary.failed} duration=${(durationMs / 1000).toFixed(1)}s ===`);
for (const r of results) {
  writeBoth(`  ${r.passed ? 'PASS' : 'FAIL'} ${r.id}: ${r.name}`);
}
writeBoth('------------------------------------------------------------------');
writeBoth(`EVIDENCE_LOG:     ${LOG_PATH}`);
writeBoth(`RESULTS_JSON:     ${RESULTS_PATH}`);
writeBoth('==================================================================');

await new Promise<void>(resolve => logStream.end(() => resolve()));

// Baseline note: At baseline commit e488847, all 12 checks are expected to catch
// defects and fail. An exit code of 1 indicates defects caught (baseline verified).
const exitCode = failedCount > 0 ? 1 : 0;
console.log(`\nEXIT_CODE: ${exitCode} (${failedCount} defects caught at baseline)`);
process.exit(exitCode);
