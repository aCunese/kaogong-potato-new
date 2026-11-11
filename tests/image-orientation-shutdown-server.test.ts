import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('SIGTERM closes the real server only after in-flight OCR descendants and scratch have been cleaned', { timeout: 20_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-orientation-shutdown-'));
  const marker = path.join(temp, 'native-pids.json');
  const inviteFile = path.join(temp, 'invite');
  const executable = path.join(temp, 'stalled-tesseract');
  // Stall the external native boundary while retaining the real Python helper,
  // process groups, auth/media route and production SIGTERM handler.
  fs.writeFileSync(executable, `#!/usr/bin/env ${process.env.PYTHON_BIN || 'python3'}\nimport os,json,time\nfrom pathlib import Path\nPath(${JSON.stringify(marker)}).write_text(json.dumps({'pids':[os.getppid(),os.getpid()],'group':os.getpgrp(),'scratch':os.environ['TMPDIR']}))\ntime.sleep(60)\n`, { mode: 0o700 });
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/image-orientation/shutdown-server-entry.ts'], {
    cwd: process.cwd(), env: { ...process.env, DATA_DIR: path.join(temp, 'data'), PORT: String(port), HOST: '127.0.0.1', ORIENTATION_INVITE_FILE: inviteFile, TESSERACT_BIN: executable },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.resume();
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) break;
      await delay(20);
    }
    assert.equal(ready, true, 'isolated production startup must become healthy');
    const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'shutdown-native-test', password: 'isolated-test-only', inviteCode: fs.readFileSync(inviteFile, 'utf8') }) });
    assert.equal(registered.status, 200);
    const auth = await registered.json();
    const headers = { cookie: registered.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': auth.csrfToken, 'x-workspace-user': auth.user.id };
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.resolve('tests/fixtures/image-orientation/study-page.png'))], { type: 'image/png' }), 'synthetic.png');
    const uploaded = await fetch(`${base}/api/media/upload`, { method: 'POST', headers, body: form });
    assert.equal(uploaded.status, 200);
    const media = await uploaded.json();
    const request = fetch(`${base}/api/media/${media.media.id}/orientation`, { method: 'POST', headers }).catch(() => null);
    for (let attempt = 0; attempt < 200 && !fs.existsSync(marker); attempt++) await delay(10);
    assert.ok(fs.existsSync(marker), 'native OCR child must be running before SIGTERM');
    const native = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const started = Date.now();
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.ok(Date.now() - started < 5000, 'shutdown cancels OCR instead of waiting for the 30s deadline');
    assert.equal((await request)?.status, 503);
    assert.equal(fs.existsSync(native.scratch), false);
    for (const pid of native.pids as number[]) {
      let exists = true;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { process.kill(pid, 0); await delay(20); }
        catch { exists = false; break; }
      }
      assert.equal(exists, false, `SIGTERM must leave no native process ${pid}`);
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (fs.existsSync(marker)) {
      const native = JSON.parse(fs.readFileSync(marker, 'utf8'));
      try { process.kill(-native.group, 'SIGKILL'); } catch {}
    }
    await exited;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
