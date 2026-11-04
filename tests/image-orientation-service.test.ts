import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImageOrientationService } from '../server/imageOrientation';

const python = process.env.PYTHON_BIN || 'python3';
const result = { status: 'resolved', rotation: 90, version: 1 };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function workspace() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-orientation-service-'));
  const image = path.join(temp, 'owned.png');
  fs.writeFileSync(image, 'server-owned-content');
  const helper = path.join(temp, 'helper.py');
  return { temp, image, helper, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

test('one worker rejects overlap and caches by bytes with bounded eviction', async () => {
  const w = workspace();
  const calls = path.join(w.temp, 'calls');
  fs.writeFileSync(w.helper, `import json,time\nfrom pathlib import Path\np=Path(${JSON.stringify(calls)})\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\ntime.sleep(0.08)\nprint(json.dumps(${JSON.stringify(result)}))\n`);
  const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper, cacheSize: 1 });
  try {
    const first = service.orient(w.image);
    await assert.rejects(service.orient(w.image), { code: 'ORIENTATION_BUSY' });
    assert.deepEqual(await first, result);
    const sameBytesElsewhere = path.join(w.temp, 'same.png'); fs.copyFileSync(w.image, sameBytesElsewhere);
    const cached = await service.orient(sameBytesElsewhere);
    assert.deepEqual(cached, result);
    cached.rotation = 180;
    assert.deepEqual(await service.orient(w.image), result);
    assert.equal(fs.readFileSync(calls, 'utf8'), '1');
    fs.writeFileSync(w.image, 'different-server-owned-content');
    await service.orient(w.image);
    await service.orient(sameBytesElsewhere);
    assert.equal(fs.readFileSync(calls, 'utf8'), '3');
  } finally { w.cleanup(); }
});

test('deadline terminates the worker and its native OCR child, then releases the slot', async () => {
  const w = workspace();
  const marker = path.join(w.temp, 'pids.json');
  fs.writeFileSync(w.helper, `import os,json,subprocess,time,sys\nfrom pathlib import Path\nchild=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\nPath(${JSON.stringify(marker)}).write_text(json.dumps({'pids':[os.getpid(),child.pid],'scratch':os.environ.get('TMPDIR')}))\ntime.sleep(60)\n`);
  const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper, deadlineMs: 300 });
  try {
    await assert.rejects(service.orient(w.image), { code: 'ORIENTATION_TIMEOUT' });
    const timedOut = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.ok(timedOut.scratch, 'each job owns an isolated scratch directory');
    assert.equal(fs.existsSync(timedOut.scratch), false, 'timeout removes native OCR scratch files');
    for (const pid of timedOut.pids as number[]) {
      let alive = true;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { process.kill(pid, 0); await delay(20); }
        catch { alive = false; break; }
      }
      assert.equal(alive, false, `timed-out process ${pid} must be gone`);
    }
    fs.writeFileSync(w.helper, 'print(\'{"status":"unresolved","rotation":0,"version":1}\')\n');
    assert.deepEqual(await service.orient(w.image), { status: 'unresolved', rotation: 0, version: 1 });
  } finally { w.cleanup(); }
});

test('spawn, file, malformed-output and child failures stay retryable and never cache guesses', async () => {
  const w = workspace();
  try {
    const noPython = new ImageOrientationService({ pythonBin: path.join(w.temp, 'missing-python') });
    await assert.rejects(noPython.orient(w.image), { code: 'ORIENTATION_UNAVAILABLE' });
    const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper });
    await assert.rejects(service.orient(path.join(w.temp, 'missing-image')), { code: 'ORIENTATION_UNAVAILABLE' });
    for (const source of ['raise RuntimeError("private data must not escape")', 'print("invalid json")', 'print(\'{"status":"resolved","rotation":45,"version":1}\')', 'print(\'{"status":"unresolved","rotation":90,"version":1}\')', 'print("x" * 10000)']) {
      fs.writeFileSync(w.helper, source);
      await assert.rejects(service.orient(w.image), { code: 'ORIENTATION_UNAVAILABLE' });
    }
    fs.writeFileSync(w.helper, 'print(\'{"status":"unresolved","rotation":0,"version":1}\')\n');
    assert.deepEqual(await service.orient(w.image), { status: 'unresolved', rotation: 0, version: 1 });
  } finally { w.cleanup(); }
});

test('an unresolved result can be retried for the same bytes instead of becoming a permanent cache hit', async () => {
  const w = workspace();
  const marker = path.join(w.temp, 'attempted');
  fs.writeFileSync(w.helper, `from pathlib import Path\np=Path(${JSON.stringify(marker)})\nprint('{"status":"resolved","rotation":90,"version":1}' if p.exists() else '{"status":"unresolved","rotation":0,"version":1}')\np.touch()\n`);
  const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper });
  try {
    assert.deepEqual(await service.orient(w.image), { status: 'unresolved', rotation: 0, version: 1 });
    assert.deepEqual(await service.orient(w.image), result);
  } finally { w.cleanup(); }
});

test('shutdown stops in-flight OCR, awaits scratch cleanup and refuses new work', async () => {
  const w = workspace();
  const marker = path.join(w.temp, 'shutdown-pids.json');
  fs.writeFileSync(w.helper, `import os,json,subprocess,time,sys\nfrom pathlib import Path\nchild=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\nPath(${JSON.stringify(marker)}).write_text(json.dumps({'pids':[os.getpid(),child.pid],'scratch':os.environ.get('TMPDIR')}))\ntime.sleep(60)\n`);
  const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper });
  const pending = service.orient(w.image);
  const rejected = assert.rejects(pending, { code: 'ORIENTATION_UNAVAILABLE' });
  try {
    for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) await delay(10);
    assert.ok(fs.existsSync(marker));
    const started = Date.now();
    await service.shutdown();
    await rejected;
    assert.ok(Date.now() - started < 2000, 'shutdown must not wait for the 30s job deadline');
    const stopped = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(fs.existsSync(stopped.scratch), false);
    for (const pid of stopped.pids as number[]) {
      let exists = true;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { process.kill(pid, 0); await delay(20); }
        catch { exists = false; break; }
      }
      assert.equal(exists, false, `shutdown must reap process ${pid}`);
    }
    await assert.rejects(service.orient(w.image), { code: 'ORIENTATION_UNAVAILABLE' });
    await service.shutdown();
  } finally { w.cleanup(); }
});

test('shutdown requested during the initial file read prevents spawning native OCR', async () => {
  const w = workspace();
  const marker = path.join(w.temp, 'unexpected-worker');
  fs.writeFileSync(w.helper, `from pathlib import Path\nPath(${JSON.stringify(marker)}).touch()\nprint('{"status":"resolved","rotation":90,"version":1}')\n`);
  const service = new ImageOrientationService({ pythonBin: python, helperScript: w.helper });
  const rejected = assert.rejects(service.orient(w.image), { code: 'ORIENTATION_UNAVAILABLE' });
  try {
    await service.shutdown();
    await rejected;
    assert.equal(fs.existsSync(marker), false);
  } finally { w.cleanup(); }
});
