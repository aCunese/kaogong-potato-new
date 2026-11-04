import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const python = process.env.PYTHON_BIN || 'python3';
const helper = path.resolve('scripts/lib/image-orientation.py');
const fixture = path.resolve('tests/fixtures/image-orientation/study-page.png');

function nativeOrientation(file: string) {
  const result = spawnSync(python, [helper, file], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

test('native Chinese and English OCR returns the clockwise correction for every quarter turn without changing bytes', { timeout: 120_000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-native-orientation-'));
  const before = crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex');
  try {
    for (const [turn, expected] of [[0, 0], [90, 270], [180, 180], [270, 90]]) {
      const candidate = path.join(temp, `${turn}.png`);
      const rotation = spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.open(sys.argv[1]).rotate(-int(sys.argv[3]),expand=True).save(sys.argv[2])', fixture, candidate, String(turn)], { encoding: 'utf8' });
      assert.equal(rotation.status, 0, rotation.stderr);
      assert.deepEqual(nativeOrientation(candidate), { status: 'resolved', rotation: expected, version: 1 }, `input clockwise ${turn}`);
    }
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'), before);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('low text is unresolved and malformed images fail without returning a guessed orientation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-lowtext-orientation-'));
  try {
    const blank = path.join(temp, 'blank.png');
    const created = spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.new("RGB",(400,400),"white").save(sys.argv[1])', blank], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(nativeOrientation(blank), { status: 'unresolved', rotation: 0, version: 1 });
    const corrupt = path.join(temp, 'bad.png'); fs.writeFileSync(corrupt, 'not an image');
    const failed = spawnSync(python, [helper, corrupt], { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(failed.status, 0);
    assert.equal(failed.stdout.trim(), '');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
