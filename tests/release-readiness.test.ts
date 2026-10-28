import { expect, it } from 'bun:test';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import release from '../release.json';
import { CURRENT_WEB_VERSION, CURRENT_WEB_BUILD, compareBuildNumbers } from '../src/utils/versionCheck';

it('advertises a newer Web release with Schema 5 while preserving the verified APK identity', () => {
  const publicVersion = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
  expect(CURRENT_WEB_VERSION).toBe('1.0.10');
  expect(compareBuildNumbers(CURRENT_WEB_BUILD, '20261028.04')).toBeGreaterThan(0);
  expect(publicVersion).toMatchObject({version: CURRENT_WEB_VERSION, build: CURRENT_WEB_BUILD, schemaVersion: 5});
  expect(release.schemaVersion).toBe(5);
  expect(release.apkVersion).toBe('1.0.5');
  const apk = fs.readFileSync(`release/apk/kaogong-potato-v${release.apkVersion}.apk`);
  expect(apk.length).toBe(release.apkSizeBytes);
  expect(crypto.createHash('sha256').update(apk).digest('hex')).toBe(release.apkSha256);
});

it('the service worker reports the same new release and uses a separate shell cache', () => {
  const handlers = new Map<string, (event: any) => void>();
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {self: {addEventListener: (type: string, handler: any) => handlers.set(type, handler)}});
  let identity: any;
  handlers.get('message')!({data: {type: 'GET_RELEASE_INFO'}, ports: [{postMessage: (message: any) => {identity = message;}}]});
  expect(identity).toMatchObject({version: '1.0.10', build: '20261028.05', cacheName: 'kaogong-shell-v5-1.0.10-20261028.05'});
});
