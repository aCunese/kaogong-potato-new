/**
 * versionCheck.ts 状态机独立验证（Node 环境下 mock 浏览器 API，不修改仓库文件）
 * 覆盖 R16：失败/缓存/nonce 不匹配绝不 latest；节流；in-flight 去重
 * 覆盖 R17：原生 versionCode 比较、桥异常 unrecognized、浏览器只做 Web 更新、更新保护 guard
 */
import path from 'node:path';

const REPO = process.env.REPO_ROOT as string;
const modUrl = path.join(REPO, 'src/utils/versionCheck.ts');

let fetchCalls: string[] = [];
let fetchMode: 'valid' | 'http503' | 'badjson' | 'nonce-mismatch' | 'network-error' = 'valid';
let remoteOverrides: Record<string, unknown> = {};
let nextNonce: string | null = null;

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'Mozilla/5.0 NodeTest' }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });

(globalThis as unknown as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  fetchCalls.push(url);
  const nonceMatch = /nonce=([^&]+)/.exec(url);
  const echoed = nextNonce !== null ? nextNonce : (nonceMatch ? decodeURIComponent(nonceMatch[1]) : '');
  if (fetchMode === 'network-error') throw new TypeError('fetch failed');
  if (fetchMode === 'http503') {
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  if (fetchMode === 'badjson') {
    return new Response('<html>bad</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (fetchMode === 'nonce-mismatch') {
    return new Response(JSON.stringify({ version: '1.0.2', build: '20261026.03', schemaVersion: 3, nonce: 'stale-nonce-from-sw-cache' }), { status: 200 });
  }
  const payload = {
    version: '1.0.2',
    build: '20261026.03',
    schemaVersion: 3,
    nonce: echoed,
    servedAt: new Date().toISOString(),
    apkVersion: '1.0.3',
    apkVersionCode: 4,
    apkDownloadUrl: '/api/download/apk',
    apkSha256: 'a'.repeat(64),
    apkSizeBytes: 286912,
    apkPackageName: 'com.ruyne.kaogong',
    apkCertFingerprint: '85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1',
    summary: 'test',
    ...remoteOverrides,
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
};

type Mod = typeof import('../src/utils/versionCheck');
let mod: Mod;

let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function resetEnv() {
  fetchCalls = [];
  fetchMode = 'valid';
  remoteOverrides = {};
  nextNonce = null;
  storage.clear();
  delete (globalThis as Record<string, unknown>).AndroidBridge;
  mod.resetUpdateCheckState();
}

async function main() {
  mod = await import(modUrl);
  check('module exports checkAppUpdate', typeof mod.checkAppUpdate === 'function');
  check('module exports applyWebUpdate', typeof mod.applyWebUpdate === 'function');
  check('module exports compat performUpdateCheck', typeof mod.performUpdateCheck === 'function');

  // ---------------- R16: HTTP 503 must never be "latest" ----------------
  resetEnv();
  fetchMode = 'http503';
  let r = await mod.checkAppUpdate({ manual: true });
  check('R16 HTTP503 => failed (not latest)', r.status === 'failed' && r.errorCode === 'HTTP_503', r);

  // ---------------- R16: invalid JSON ----------------
  resetEnv();
  fetchMode = 'badjson';
  r = await mod.checkAppUpdate({ manual: true });
  check('R16 invalid JSON => failed', r.status === 'failed' && r.errorCode === 'INVALID_JSON', r);

  // ---------------- R16: network error ----------------
  resetEnv();
  fetchMode = 'network-error';
  r = await mod.checkAppUpdate({ manual: true });
  check('R16 network error => offline/failed (not latest)', r.status === 'offline' && r.errorCode === 'NETWORK_ERROR', r);

  // ---------------- R16: nonce mismatch (SW cache fallback) ----------------
  resetEnv();
  fetchMode = 'nonce-mismatch';
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R16 SW cached response (nonce mismatch) => failed ERROR_STALE_RESPONSE',
    r.status === 'failed' && r.errorCode === 'ERROR_STALE_RESPONSE' && r.cacheState === 'stale-fallback',
    r,
  );
  check('R16 request carries nonce param', fetchCalls.every((u) => /[?&]nonce=/.test(u)), fetchCalls);

  // ---------------- R16: valid fresh browser response (same build) => latest ----------------
  resetEnv();
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'browser same build + nonce echo => latest with fresh proof',
    r.status === 'latest' && r.cacheState === 'fresh' && r.source === 'web',
    r,
  );

  // ---------------- R16: 30-min throttle + manual bypass + in-flight dedup ----------------
  resetEnv();
  const first = await mod.checkAppUpdate();
  const callsAfterFirst = fetchCalls.length;
  const second = await mod.checkAppUpdate();
  check(
    'R16 30-min throttle: second non-manual call is cache-backed, no new fetch',
    first.status === 'latest' && second.fromCache === true && fetchCalls.length === callsAfterFirst,
    { callsAfterFirst, now: fetchCalls.length, second },
  );
  const third = await mod.checkAppUpdate({ manual: true });
  check('R16 manual check bypasses throttle (new fetch)', fetchCalls.length === callsAfterFirst + 1 && third.fromCache !== true, {
    calls: fetchCalls.length,
  });

  resetEnv();
  fetchMode = 'valid';
  const p1 = mod.checkAppUpdate();
  const p2 = mod.checkAppUpdate();
  await Promise.all([p1, p2]);
  check('R16 concurrent calls deduped to exactly one network call', fetchCalls.length === 1, fetchCalls.length);

  // ---------------- R17: browser update available (build newer) + never APK in browser ----------------
  resetEnv();
  remoteOverrides = { build: '20261027.01', version: '1.0.3' };
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R17 browser newer build => update_available(web), never APK',
    r.status === 'update_available'
      && r.webUpdateAvailable === true
      && (r.apkUpdateAvailable === false || r.apkUpdateAvailable === undefined)
      && r.source === 'web',
    r,
  );

  // ---------------- R17: native bridge protocol 2, versionCode compare ----------------
  resetEnv();
  remoteOverrides = { build: '20261026.03', version: '1.0.2' };
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () =>
      JSON.stringify({
        bridgeProtocol: 2,
        available: true,
        trusted: true,
        versionCode: 3,
        versionName: '1.0.2',
        packageName: 'com.ruyne.kaogong',
        certFingerprint: '85:75:82:EF:D9:20:83:CC:75:E5:C5:A0:C2:0D:B3:26:25:2C:BF:80:E7:11:23:23:4B:6B:F5:9D:CD:17:36:C1',
        installPermission: 'granted',
      }),
  };
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R17 native versionCode 3 -> remote 4 => APK update_available',
    r.status === 'update_available' && r.apkUpdateAvailable === true && r.source === 'native'
      && r.installedVersionCode === 3,
    r,
  );

  // 元数据缺失 => failed, 不允许 latest
  remoteOverrides = { build: '20261026.03', version: '1.0.2', apkVersionCode: undefined, apkSha256: undefined };
  delete remoteOverrides.apkVersionCode;
  delete remoteOverrides.apkSha256;
  fetchMode = 'valid';
  resetEnv();
  remoteOverrides = { apkVersionCode: undefined };
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () =>
      JSON.stringify({
        bridgeProtocol: 2, available: true, trusted: true, versionCode: 3, versionName: '1.0.2',
        packageName: 'com.ruyne.kaogong', installPermission: 'granted',
      }),
  };
  mod.resetUpdateCheckState();
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R17 native missing apkVersionCode => failed INVALID_APK_METADATA (never latest)',
    r.status === 'failed' && (r.errorCode === 'INVALID_APK_METADATA' || r.errorCode === 'APK_SHA256_MISSING'),
    r,
  );

  // 缺失 SHA-256 => failed
  resetEnv();
  remoteOverrides = { apkSha256: undefined };
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () =>
      JSON.stringify({
        bridgeProtocol: 2, available: true, trusted: true, versionCode: 3, versionName: '1.0.2',
        packageName: 'com.ruyne.kaogong', installPermission: 'granted',
      }),
  };
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R17 native upgrade without SHA-256 => failed APK_SHA256_MISSING (no unsafe download)',
    r.status === 'failed' && r.errorCode === 'APK_SHA256_MISSING',
    r,
  );

  // 桥抛异常（旧容器 R13 线程违规）=> unrecognized，绝不回退浏览器判断
  resetEnv();
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () => {
      throw new Error('java.lang.RuntimeException: Wrong thread');
    },
  };
  r = await mod.checkAppUpdate({ manual: true });
  check(
    'R17 bridge throws => unrecognized (not browser fallback)',
    r.status === 'unrecognized' && r.errorCode === 'BRIDGE_CALL_FAILED' && r.source === 'native',
    r,
  );

  // 桥存在但返回空版本
  resetEnv();
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () => JSON.stringify({ versionCode: 0, versionName: '', packageName: '' }),
  };
  r = await mod.checkAppUpdate({ manual: true });
  check('R17 legacy/empty bridge version => unrecognized', r.status === 'unrecognized', r);

  // ---------------- R17: startNativeApkInstall 保护 + 强校验参数 ----------------
  resetEnv();
  remoteOverrides = { build: '20261026.03', version: '1.0.2' };
  let capturedRequest: Record<string, unknown> | null = null;
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () =>
      JSON.stringify({
        bridgeProtocol: 2, available: true, trusted: true, versionCode: 3, versionName: '1.0.2',
        packageName: 'com.ruyne.kaogong', installPermission: 'granted',
      }),
    installApkVerified: (json: string) => {
      capturedRequest = JSON.parse(json);
    },
  };
  const guarded = await mod.startNativeApkInstall(
    { version: '1.0.3', build: '20261027.01', apkVersionCode: 4, apkVersion: '1.0.3', apkDownloadUrl: '/api/download/apk', apkSha256: 'b'.repeat(64) },
    { canActivate: () => ({ ok: false, reason: '计时器运行中' }) },
  );
  check('R17 startNativeApkInstall respects canActivate guard', guarded.ok === false && guarded.code === 'GUARD_BLOCKED', guarded);

  const started = await mod.startNativeApkInstall({
    version: '1.0.3', build: '20261027.01', apkVersionCode: 4, apkVersion: '1.0.3',
    apkDownloadUrl: '/api/download/apk', apkSha256: 'b'.repeat(64), apkSizeBytes: 286912,
    apkPackageName: 'com.ruyne.kaogong',
  });
  check('R17 startNativeApkInstall calls installApkVerified with full metadata',
    started.ok === true && started.code === 'STARTED' && capturedRequest !== null
      && (capturedRequest as Record<string, unknown>).versionCode === 4
      && (capturedRequest as Record<string, unknown>).sha256 === 'b'.repeat(64),
    { started, capturedRequest });

  // install permission denied => requiresPermission + 打开授权页
  resetEnv();
  let permissionRequested = false;
  (globalThis as Record<string, unknown>).AndroidBridge = {
    getAppInfo: () =>
      JSON.stringify({
        bridgeProtocol: 2, available: true, trusted: true, versionCode: 3, versionName: '1.0.2',
        packageName: 'com.ruyne.kaogong', installPermission: 'denied',
      }),
    requestInstallPermission: () => { permissionRequested = true; },
    installApkVerified: () => { throw new Error('should not be called'); },
  };
  const perm = await mod.startNativeApkInstall({
    version: '1.0.3', build: '20261027.01', apkVersionCode: 4, apkVersion: '1.0.3',
    apkDownloadUrl: '/api/download/apk', apkSha256: 'b'.repeat(64),
  });
  check('R17 install permission denied => requiresPermission + opens settings',
    perm.ok === false && perm.requiresPermission === true && perm.code === 'INSTALL_PERMISSION_REQUIRED' && permissionRequested,
    { perm, permissionRequested });

  // 无桥 => NO_NATIVE_BRIDGE（引导复制官方地址）
  resetEnv();
  const noBridge = await mod.startNativeApkInstall({
    version: '1.0.3', build: '20261027.01', apkVersionCode: 4, apkDownloadUrl: '/api/download/apk', apkSha256: 'b'.repeat(64),
  });
  check('R17 no bridge => NO_NATIVE_BRIDGE fallback', noBridge.ok === false && noBridge.code === 'NO_NATIVE_BRIDGE', noBridge);

  // ---------------- applyWebUpdate 无 SW => 诚实失败 ----------------
  resetEnv();
  const webApply = await mod.applyWebUpdate();
  check('R17 applyWebUpdate without SW => ok:false (no false success)', webApply.ok === false && webApply.controllerChanged === false, webApply);

  // ---------------- 横幅关闭持久化 ----------------
  resetEnv();
  check('banner not dismissed initially', mod.isUpdateBannerDismissed('1.0.3-20261027.01') === false);
  mod.markUpdateBannerDismissed('1.0.3-20261027.01');
  check('banner dismissed persisted', mod.isUpdateBannerDismissed('1.0.3-20261027.01') === true);

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
