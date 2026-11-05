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

for (const [language, top, bottom] of [['Chinese', 0, 180], ['English', 730, 1030]] as const) {
  test(`sparse ${language} question text stays upright among large diagrams`, { timeout: 120_000 }, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-diagram-orientation-'));
    try {
      const page = path.join(temp, 'question.png');
      const generated = spawnSync(python, ['-c', `
from PIL import Image, ImageDraw
import sys
source = Image.open(sys.argv[1])
excerpt = source.crop((0, int(sys.argv[3]), source.width, int(sys.argv[4])))
excerpt.thumbnail((1000, 250), Image.Resampling.LANCZOS)
image = Image.new('RGB', (1200, 900), 'white')
image.paste(excerpt, (80, 50))
draw = ImageDraw.Draw(image)
for row in range(2):
    for column in range(5):
        x, y = 100 + column * 200, 350 + row * 220
        draw.rectangle((x, y, x + 180, y + 180), outline='black', width=3)
        draw.ellipse((x + 20, y + 20, x + 160, y + 160), outline='black', width=4)
        draw.line((x + 20, y + 20, x + 160, y + 160), fill='black', width=4)
image.save(sys.argv[2])
`, fixture, page, String(top), String(bottom)], { encoding: 'utf8' });
      assert.equal(generated.status, 0, generated.stderr);
      for (const [turn, expected] of [[0, 0], [90, 270], [180, 180], [270, 90]]) {
        const candidate = path.join(temp, `${turn}.png`);
        const rotated = spawnSync(python, ['-c', 'from PIL import Image; import sys; Image.open(sys.argv[1]).rotate(-int(sys.argv[3]),expand=True).save(sys.argv[2])', page, candidate, String(turn)], { encoding: 'utf8' });
        assert.equal(rotated.status, 0, rotated.stderr);
        assert.deepEqual(nativeOrientation(candidate), { status: 'resolved', rotation: expected, version: 1 }, `${language} input clockwise ${turn}`);
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
}

test('diagrams with only four option labels stay unresolved instead of rotating OCR guesses', () => {
  assert.deepEqual(nativeOrientation(path.resolve('tests/fixtures/image-orientation/lowtext-diagrams.png')), { status: 'unresolved', rotation: 0, version: 1 });
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
